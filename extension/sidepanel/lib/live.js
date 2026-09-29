// Live: gravação em segmentos (painel ou direto do vídeo da página), transcrição com Whisper e tradução simultânea.

import { state } from "./state.js";
import { $, addMsg, downloadMd } from "./ui.js";
import { daemonTranslate, transcribeSegment } from "./api.js";
import { mmss, partialNote, externalContent, blobToBase64 } from "./text.js";
import { send } from "./chat.js";

let liveActive = false;
let liveMode = "panel";
let liveStream = null;
let liveStart = 0;
let liveLang = "en";
const liveSegments = [];
const liveSegmentsRaw = [];

let liveBubble = null;
let liveQueue = [];
let liveRecorder = null;
let flushing = false;
let drainPromise = null;
let liveStartError = "";

let silenceCtx = null;
let silenceAnalyser = null;
let silenceTimer = null;
let silenceWarned = false;

export function isLiveActive() {
  return liveActive;
}

function appendLive(text) {
  if (!liveBubble || !liveBubble.isConnected) {
    liveBubble = document.createElement("div");
    liveBubble.className = "msg ai";
    const c = document.createElement("div");
    c.className = "ctx";
    c.textContent = "live — transcrição ao vivo";
    const body = document.createElement("div");
    body.className = "body";
    liveBubble.append(c, body);
    $("log").appendChild(liveBubble);
  }
  const body = liveBubble.querySelector(".body");
  body.textContent = (body.textContent ? body.textContent + "\n" : "") + text;
  liveBubble.dataset.raw = body.textContent;
  $("log").scrollTop = $("log").scrollHeight;
}

function startSegmentRecorder(stream) {
  const audioLive = stream?.getAudioTracks().some((t) => t.readyState === "live");
  if (!audioLive) {
    liveStartError = "sem faixa de áudio ativa — a captura da aba/microfone terminou";
    return null;
  }
  const mimes = [];
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimes.push("audio/webm;codecs=opus");
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mimes.push("audio/ogg;codecs=opus");
  mimes.push("");
  let rec = null;
  let lastErr = null;
  for (const mime of mimes) {
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      break;
    } catch (e) {
      lastErr = e;
      rec = null;
    }
  }
  if (!rec) {
    liveStartError = "gravador não criado: " + (lastErr?.message || lastErr || "desconhecido");
    return null;
  }
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  rec.onerror = () => {
    if (rec.state === "recording") {
      try { rec.stop(); } catch {}
    }
  };
  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    if (liveActive && liveStream) {
      liveRecorder = startSegmentRecorder(stream);
      if (!liveRecorder) liveFail(liveStartError || "gravação interrompida");
    }
    if (blob.size) {
      try {
        liveQueue.push({ b64: await blobToBase64(blob), mime: blob.type });
      } catch {}
    }
    drainLiveQueue();
  };
  try {
    rec.start();
  } catch (e) {
    liveStartError = "gravador não iniciou: " + (e?.message || e);
    return null;
  }
  setTimeout(() => {
    if (rec.state === "recording") rec.stop();
  }, 5000);
  return rec;
}

function liveFail(msg) {
  if (!liveActive) return;
  const hint = liveMode === "page" ? "" : /aba|captura/i.test(msg) ? " Tente escolher 'Microfone' no seletor Live." : "";
  addMsg("err", "Live interrompida: " + msg + hint);
  stopLive();
}

function drainLiveQueue() {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    while (liveQueue.length && (liveActive || flushing)) {
      if (liveLang !== "pt" && liveQueue.length > 2) {
        liveQueue.splice(0, liveQueue.length - 2);
      }
      const seg = liveQueue.shift();
      try {
        const raw = await transcribeSegment(seg, liveLang);
        if (!raw) continue;
        const out =
          liveLang === "pt" ? raw : (await daemonTranslate(raw).catch(() => "")) || raw;
        const clock = mmss(Date.now() - liveStart);
        appendLive(`[${clock}] ${out}`);
        liveSegments.push(`[${clock}] ${out}`);
        liveSegmentsRaw.push(`[${clock}] ${raw}`);
      } catch {}
    }
    if (!liveQueue.length) flushing = false;
    drainPromise = null;
  })();
  return drainPromise;
}

async function acquireLiveStream(source) {
  if (source === "mic") {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } }), via: "mic" };
  }
  try {
    if (!chrome.tabCapture?.capture) throw new Error("tabCapture indisponível");
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({ audio: true, video: false }, (s) => {
        const err = chrome.runtime.lastError;
        if (err || !s) reject(new Error(err?.message || "tabCapture falhou"));
        else resolve(s);
      });
    });
    try {
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play().catch(() => {});
    } catch {}
    return { stream, via: "tabCapture" };
  } catch (e) {
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    s.getVideoTracks().forEach((t) => t.stop());
    return { stream: new MediaStream(s.getAudioTracks()), via: "share" };
  }
}

function startSilenceWatch(stream, via) {
  if (!stream || silenceTimer) return;
  try {
    silenceCtx = new AudioContext();
    silenceCtx.resume?.().catch?.(() => {});
    const src = silenceCtx.createMediaStreamSource(stream);
    silenceAnalyser = silenceCtx.createAnalyser();
    silenceAnalyser.fftSize = 256;
    src.connect(silenceAnalyser);
    const buf = new Uint8Array(silenceAnalyser.frequencyBinCount);
    let quiet = Date.now();
    silenceTimer = setInterval(() => {
      if (!liveActive || !silenceAnalyser) return;
      silenceAnalyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms < 0.01) {
        if (!silenceWarned && Date.now() - quiet > 8000) {
          silenceWarned = true;
          const dica =
            via === "share"
              ? "verifique se 'Compartilhar áudio da guia' está marcado no diálogo"
              : via === "mic"
                ? "fale mais perto do microfone"
                : "verifique o volume e o áudio da guia";
          addMsg(
            "ai",
            "Nota: o áudio da captura está silencioso — " +
              dica +
              ". Se preferir, pare a Live e escolha 'Vídeo da página' no seletor."
          );
        }
      } else {
        quiet = Date.now();
      }
    }, 1000);
  } catch {}
}

function stopSilenceWatch() {
  if (silenceTimer) {
    clearInterval(silenceTimer);
    silenceTimer = null;
  }
  try { silenceCtx?.close(); } catch {}
  silenceCtx = null;
  silenceAnalyser = null;
  silenceWarned = false;
}

function resetLiveSession() {
  liveStart = Date.now();
  liveSegments.length = 0;
  liveSegmentsRaw.length = 0;
  liveQueue.length = 0;
  liveBubble = null;
}

export async function stopLive() {
  const mode = liveMode;
  liveActive = false;
  flushing = true;
  $("live-btn").textContent = "Live PT-BR";
  if (mode === "page") {
    try {
      await chrome.runtime.sendMessage({ type: "liveVideoStop" });
    } catch {}
  } else {
    if (liveRecorder && liveRecorder.state === "recording") {
      try { liveRecorder.stop(); } catch {}
    }
    liveRecorder = null;
    if (liveStream) {
      liveStream.getTracks().forEach((t) => t.stop());
      liveStream = null;
    }
    stopSilenceWatch();
  }
  await new Promise((r) => setTimeout(r, 150));
  for (let i = 0; i < 3 && liveQueue.length; i++) {
    await drainLiveQueue();
    await new Promise((r) => setTimeout(r, 120));
  }
  await drainLiveQueue();
  flushing = false;
  const segs = liveSegments.slice();
  if (!segs.length) return;
  const div = addMsg("ai", `Live encerrada — ${segs.length} trechos coletados.`);
  const acts = document.createElement("div");
  acts.className = "acts";
  const sum = document.createElement("button");
  sum.textContent = "resumir live";
  sum.onclick = () => {
    send("Resuma esta live: principais assuntos, decisões e pendências.", {
      label: "Resumir live",
    onContext: async () => {
      const joined = segs.join("\n");
      const cap = 160000;
      const convo = joined.slice(0, cap);
      return {
        note: `transcrição da live — ${segs.length} trechos${joined.length > cap ? partialNote(cap, joined.length) : ""}`,
        prompt: `Transcrição de uma live (PT-BR):\n\n${externalContent(convo)}\n\nTarefa: resuma os principais assuntos, decisões tomadas e pendências, em ordem cronológica.`,
      };
    },
    });
  };
  const md = document.createElement("button");
  md.textContent = "baixar .md";
  md.onclick = () => downloadMd(segs.join("\n\n"));
  acts.append(sum, md);
  div.appendChild(acts);
  liveSegments.length = 0;
  liveSegmentsRaw.length = 0;
}

export async function startLive(source, lang) {
  if (state.busy) return;
  liveLang = lang === "pt" ? "pt" : "en";
  resetLiveSession();
  if (source === "video") {
    liveMode = "page";
    liveActive = true;
    $("live-btn").textContent = "Parar live";
    const r = await chrome.runtime.sendMessage({ type: "liveVideoStart" });
    if (!r?.ok) {
      liveActive = false;
      $("live-btn").textContent = "Live PT-BR";
      addMsg("err", "Live: " + (r?.error || "a página não respondeu"));
      return;
    }
    addMsg(
      "ai",
      "Live iniciada com o áudio do vídeo desta página" +
        (liveLang === "pt" ? " — transcrevendo em português." : " — traduzindo ao vivo para PT-BR.")
    );
    return;
  }
  liveMode = "panel";
  let cap = null;
  try {
    cap = await acquireLiveStream(source);
  } catch (e) {
    addMsg(
      "err",
      "Live: não foi possível capturar o áudio (" +
        (e?.message || e) +
        "). Dica: escolha a guia no diálogo e deixe 'Compartilhar áudio da guia' marcado."
    );
    return;
  }
  liveStream = cap.stream;
  liveActive = true;
  $("live-btn").textContent = "Parar live";
  const via =
    source === "mic"
      ? "Live iniciada com o microfone"
      : cap.via === "share"
        ? "Live iniciada com o áudio da guia (compartilhamento)"
        : "Live iniciada com o áudio desta aba";
  addMsg(
    "ai",
    via +
      (liveLang === "pt" ? " — transcrevendo em português." : " — traduzindo ao vivo para PT-BR.") +
      (cap.via === "share"
        ? " (o diálogo de compartilhamento é normal: escolha a guia e deixe o áudio da guia marcado)"
        : "")
  );
  liveRecorder = startSegmentRecorder(liveStream);
  if (!liveRecorder) {
    addMsg(
      "err",
      "Live: " +
        (liveStartError || "não foi possível iniciar a gravação") +
        " Tente 'Microfone' ou 'Vídeo da página' no seletor Live."
    );
    stopLive();
    return;
  }
  startSilenceWatch(liveStream, cap.via);
}

chrome.runtime.onMessage?.addListener((msg, _sender, sendResponse) => {
  if (!liveActive || !msg) return;
  if (msg.type === "liveVideoChunk" && msg.b64) {
    liveQueue.push({ b64: msg.b64, mime: msg.mime || "audio/webm" });
    drainLiveQueue();
    sendResponse?.({ ok: true });
  } else if (msg.type === "liveVideoError") {
    liveFail(msg.message || "falha na captura do vídeo da página");
    sendResponse?.({ ok: true });
  }
});
