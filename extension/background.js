async function ensurePanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {}
}
chrome.runtime.onInstalled.addListener(ensurePanelBehavior);
chrome.runtime.onStartup.addListener(ensurePanelBehavior);
ensurePanelBehavior();

let lastGoodTabId = null;
let liveVideoTabId = null;

function isRestricted(url) {
  return !url || /^(chrome|edge|about|devtools|chrome-extension|https:\/\/chrome\.google)/.test(url);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((t) => {
    if (t && !isRestricted(t.url)) lastGoodTabId = t.id;
  }).catch(() => {});
});

async function targetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !isRestricted(tab.url)) return tab;
  const all = await chrome.tabs.query({});
  const goods = all.filter((t) => !isRestricted(t.url));
  if (!goods.length) return null;
  goods.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  lastGoodTabId = goods[0].id;
  return goods[0];
}

const INJECTORS = {
  "content/extract.js": "__anExtract",
  "content/youtube.js": "__anYoutube",
  "content/discord.js": "__anDiscord",
  "content/video.js": "__anVideo",
  "content/live-video.js": "__anLiveVideo",
  "content/shot-picker.js": "__anShotPick",
  "content/forms.js": "__anForms",
};

const TR_INJECTED = new Set();

async function ensureTranslator(tabId) {
  if (TR_INJECTED.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/translator.js"],
      world: "ISOLATED",
    });
    TR_INJECTED.add(tabId);
  } catch {}
}

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status === "complete" && tab?.url && /discord\.com/.test(tab.url)) {
    ensureTranslator(tab.id);
  }
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const t = await chrome.tabs.get(tabId);
    if (t?.url && /discord\.com/.test(t.url)) ensureTranslator(tabId);
  } catch {}
});

const SYS_PT =
  "Você é um tradutor. Traduza o texto para português brasileiro de forma natural e fiel, mantendo nomes próprios e termos técnicos. Se o texto já estiver em português, apenas devolva o texto corrigido. Responda apenas com a tradução, sem comentários.";
const SYS_EN =
  "Você é um tradutor. Traduza o texto para inglês de forma natural e fiel, mantendo nomes próprios e termos técnicos. Se o texto já estiver em inglês, apenas devolva o texto corrigido. Responda apenas com a tradução, sem comentários.";

async function translateViaDaemon(text, target) {
  const data = (await chrome.storage.local.get(["assistConfig"])).assistConfig || {};
  const port = Number(data.port) || 57931;
  const token = data.token || "";
  const res = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: target === "en" ? SYS_EN : SYS_PT },
        { role: "user", content: String(text || "").slice(0, 10000) },
      ],
    }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || "erro do daemon");
  return out.text || "";
}

async function runInTab(tabId, file, args = [], world = "ISOLATED") {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file], world });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world,
    func: (name, a) => globalThis[name](...a),
    args: [INJECTORS[file], args],
  });
  return result?.result ?? null;
}

const SHOT_MAX_WIDTH = 1600;

async function devicePixelRatioOf(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => window.devicePixelRatio || 1,
    });
    return r?.result || 1;
  } catch {
    return 1;
  }
}

async function toDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return "data:image/png;base64," + btoa(bin);
}

async function cropDataUrl(dataUrl, rect, dpr) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  let sx = 0;
  let sy = 0;
  let sw = bmp.width;
  let sh = bmp.height;
  if (rect) {
    sx = Math.round(rect.x * dpr);
    sy = Math.round(rect.y * dpr);
    sw = Math.max(1, Math.round(rect.w * dpr));
    sh = Math.max(1, Math.round(rect.h * dpr));
    sx = Math.max(0, Math.min(sx, bmp.width - 1));
    sy = Math.max(0, Math.min(sy, bmp.height - 1));
    sw = Math.min(sw, bmp.width - sx);
    sh = Math.min(sh, bmp.height - sy);
  }
  let outW = sw;
  let outH = sh;
  if (outW > SHOT_MAX_WIDTH) {
    outH = Math.max(1, Math.round(sh * (SHOT_MAX_WIDTH / sw)));
    outW = SHOT_MAX_WIDTH;
  }
  const cnv = new OffscreenCanvas(outW, outH);
  cnv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, outW, outH);
  bmp.close();
  return toDataUrl(await cnv.convertToBlob({ type: "image/png" }));
}

async function captureShot(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || isRestricted(tab.url)) {
    throw new Error("não dá para capturar esta aba (páginas internas do navegador são bloqueadas)");
  }
  let rect = null;
  let dpr = await devicePixelRatioOf(tab.id);
  if (mode === "area") {
    const pick = await runInTab(tab.id, "content/shot-picker.js");
    if (!pick || pick.ok === false) throw new Error(pick?.error || "seleção cancelada");
    rect = pick.rect;
    dpr = pick.dpr || dpr;
  }
  const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return cropDataUrl(full, rect, dpr);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "anTranslate") {
        try {
          const text = await translateViaDaemon(msg.text, msg.target);
          sendResponse({ ok: true, text });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        return;
      }
      const tab = await targetTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "nenhuma página aberta para analisar" });
        return;
      }
      if (msg?.type === "getSelectionTranslate") {
        try {
          await ensureTranslator(tab.id);
          const [sel] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "ISOLATED",
            func: () => (window.getSelection()?.toString() || "").trim(),
          });
          const text = sel?.result || "";
          if (!text) {
            sendResponse({
              ok: false,
              error: "nenhum texto selecionado na página — selecione o texto e clique de novo",
            });
            return;
          }
          const translated = await translateViaDaemon(text, msg.target);
          sendResponse({ ok: true, text: translated.trim(), source: text.slice(0, 300) });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        return;
      }
      if (msg?.type === "getTabInfo") {
        sendResponse({ ok: true, url: tab.url || "", title: tab.title || "" });
        return;
      }
      if (msg?.type === "captureShot") {
        try {
          const image = await captureShot(msg.mode === "area" ? "area" : "full");
          sendResponse({ ok: true, image });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        return;
      }
      if (msg?.type === "collectForm") {
        const data = await runInTab(tab.id, "content/forms.js", ["collect"]);
        sendResponse(
          data || { ok: false, error: "a página não respondeu — recarregue a aba e tente de novo" }
        );
        return;
      }
      if (msg?.type === "applyFormFill") {
        const data = await runInTab(tab.id, "content/forms.js", [
          "apply",
          Array.isArray(msg.fills) ? msg.fills : [],
          msg.expected,
        ]);
        sendResponse(data || { ok: false, error: "a página não respondeu" });
        return;
      }
      if (msg?.type === "getPageContext") {
        const ctx = await runInTab(tab.id, "content/extract.js");
        sendResponse({ ok: true, context: ctx });
        return;
      }
      if (msg?.type === "getYoutubeTranscript") {
        if (!/youtube\.com\/(watch|shorts|live)|youtu\.be\//.test(tab.url || "")) {
          sendResponse({ ok: false, error: "abra um vídeo do YouTube (watch, shorts ou live)" });
          return;
        }
        const data = await runInTab(tab.id, "content/youtube.js", [], "MAIN");
        if (!data) {
          sendResponse({ ok: false, error: "falha na extração (página não respondeu)" });
          return;
        }
        sendResponse(data.ok === false ? { ok: false, ...data } : { ok: true, ...data });
        return;
      }
      if (msg?.type === "collectDiscord") {
        if (!/discord\.com/.test(tab.url || "")) {
          sendResponse({ ok: false, error: "abra um canal no Discord" });
          return;
        }
        const data = await runInTab(tab.id, "content/discord.js", [msg.days || 14]);
        sendResponse(data ? { ok: true, ...data } : { ok: false, error: "falha na coleta" });
        return;
      }
      if (msg?.type === "getVideoContext") {
        const data = await runInTab(tab.id, "content/video.js", [msg.maxChars || 120000]);
        if (!data) {
          sendResponse({ ok: false, error: "falha na extração (página não respondeu)" });
          return;
        }
        sendResponse(data);
        return;
      }
      if (msg?.type === "liveVideoStart") {
        let data = null;
        try {
          data = await runInTab(tab.id, "content/live-video.js", ["start"]);
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
          return;
        }
        if (data?.ok) liveVideoTabId = tab.id;
        sendResponse(data || { ok: false, error: "a página não respondeu — recarregue a aba e tente de novo" });
        return;
      }
      if (msg?.type === "liveVideoStop") {
        const stopTabId = liveVideoTabId || tab.id;
        liveVideoTabId = null;
        try {
          await runInTab(stopTabId, "content/live-video.js", ["stop"]);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        return;
      }
      if (msg?.type === "liveVideoChunk") {
        let delivered = false;
        try {
          delivered = (await chrome.runtime.sendMessage({
            type: "liveVideoChunk",
            b64: msg.b64,
            mime: msg.mime,
          }))?.ok === true;
        } catch {}
        sendResponse({ ok: delivered });
        return;
      }
      if (msg?.type === "liveVideoError") {
        try {
          await chrome.runtime.sendMessage({ type: "liveVideoError", message: msg.message });
        } catch {}
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "mensagem desconhecida" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  })();
  return true;
});
