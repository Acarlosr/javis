// Voz: reconhecimento do navegador com fallback para gravação + Whisper local.

import { state } from "./state.js";
import { $ } from "./ui.js";
import { transcribeRecording } from "./api.js";
import { send } from "./chat.js";
import { takePendingImage } from "./shots.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let mediaRecorder = null;
let recTimer = null;
let listening = false;
let voiceMode = "auto";

function hideListening() {
  listening = false;
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
  $("listening").classList.add("hidden");
  $("mic").classList.remove("on");
}

export function flashListeningHint(msg, ms = 2600) {
  hideListening();
  $("listening-hint").textContent = msg;
  $("listening").classList.remove("hidden");
  setTimeout(hideListening, ms);
}

function beginListening(hint) {
  listening = true;
  $("listening-hint").textContent = hint;
  $("listening").classList.remove("hidden");
  $("mic").classList.add("on");
}

function sendVoice(text) {
  const img = takePendingImage();
  send(text, img ? { image: img } : undefined);
}

function stopVoice() {
  if (recognition) {
    hideListening();
    const text = $("input").value.trim();
    const r = recognition;
    recognition = null;
    try { r.stop(); } catch {}
    if (text) {
      $("input").value = "";
      sendVoice(text);
    }
    return;
  }
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  hideListening();
}

async function startRecorder() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    flashListeningHint("gravação de áudio não suportada neste navegador");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime =
      (MediaRecorder.isTypeSupported("audio/webm;codecs=opus") && "audio/webm;codecs=opus") ||
      (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") && "audio/ogg;codecs=opus") ||
      (MediaRecorder.isTypeSupported("audio/mp4") && "audio/mp4") ||
      "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder = rec;
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    rec.onerror = () => {
      mediaRecorder = null;
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      flashListeningHint("falha na gravação — tente de novo");
    };
    rec.onstop = async () => {
      const recorderRef = rec;
      mediaRecorder = null;
      stream.getTracks().forEach((t) => t.stop());
      if (recTimer) {
        clearInterval(recTimer);
        recTimer = null;
      }
      const blob = new Blob(chunks, { type: mime || recorderRef.mimeType || "audio/webm" });
      if (!blob.size) {
        hideListening();
        flashListeningHint("gravação vazia — tente de novo", 2200);
        return;
      }
      listening = true;
      $("listening-hint").textContent = "Transcrevendo…";
      $("listening").classList.remove("hidden");
      try {
        const text = (await transcribeRecording(blob)).trim();
        hideListening();
        if (!text) {
          flashListeningHint("não ouvi nada — fale mais perto do microfone", 2400);
          return;
        }
        $("input").value = text;
        sendVoice(text);
      } catch (e) {
        hideListening();
        flashListeningHint("Falha na transcrição: " + (e.message || e), 3400);
      }
    };
    rec.start();
    const t0 = Date.now();
    beginListening("Gravando… fale e clique no microfone para transcrever (0s)");
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $("listening-hint").textContent = `Gravando… fale e clique no microfone para transcrever (${s}s)`;
    }, 1000);
  } catch (e) {
    if (e?.name === "NotAllowedError" || /denied|permission/i.test(String(e?.message || e))) {
      flashListeningHint("microfone negado — clique em ⚙ (configurações) e depois em Permitir microfone", 6000);
      return;
    }
    flashListeningHint("microfone indisponível: " + (e?.message || e), 3200);
  }
}

function startSR() {
  const rec = new SR();
  recognition = rec;
  rec.lang = "pt-BR";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onstart = () => beginListening("Ouvindo… fale sua mensagem");
  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += t + " ";
      else interim += t;
    }
    $("input").value = (finalText + interim).trim();
  };
  rec.onend = () => {
    if (rec !== recognition) return;
    recognition = null;
    hideListening();
    const text = $("input").value.trim();
    if (text) {
      $("input").value = "";
      sendVoice(text);
    } else {
      flashListeningHint("não ouvi nada — clique no microfone e tente de novo", 2200);
    }
  };
  rec.onerror = (ev) => {
    if (rec !== recognition) return;
    recognition = null;
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
      voiceMode = "rec";
      if (state.daemonStatus?.stt) {
        hideListening();
        startRecorder();
        return;
      }
      flashListeningHint(
        "serviço de voz do navegador bloqueado — rode o daemon com o modelo Whisper para ditado local",
        3600
      );
      return;
    }
    if (ev.error === "no-speech") {
      flashListeningHint("não ouvi nada — tente de novo", 2200);
      return;
    }
    flashListeningHint("falha no reconhecimento de voz: " + ev.error);
  };
  try {
    rec.start();
  } catch {
    voiceMode = "rec";
    if (state.daemonStatus?.stt) {
      startRecorder();
    } else {
      flashListeningHint("não foi possível iniciar o microfone");
    }
  }
}

export function initVoice() {
  $("mic").addEventListener("click", () => {
    if (listening) {
      stopVoice();
      return;
    }
    if (voiceMode === "rec") {
      startRecorder();
      return;
    }
    if (!SR) {
      if (state.daemonStatus?.stt) {
        startRecorder();
        return;
      }
      flashListeningHint("reconhecimento de voz indisponível e ditado local desativado no daemon");
      return;
    }
    startSR();
  });
}
