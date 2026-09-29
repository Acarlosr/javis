// Cliente do daemon local: saúde, provedores, chat (com streaming), tradução e transcrição.

import { state } from "./state.js";
import { showSetup, $ } from "./ui.js";
import { blobToBase64 } from "./text.js";

export function baseUrl() {
  return `http://127.0.0.1:${state.config.port}`;
}

export async function healthCheck() {
  try {
    const res = await fetch(baseUrl() + "/health", {
      headers: { authorization: `Bearer ${state.config.token}` },
    });
    if (res.status === 401) {
      showSetup("Token inválido — confirme o token nas configurações.");
      return false;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.daemonStatus = await res.json();
    $("status-dot").classList.add("ok");
    $("setup").classList.add("hidden");
    await loadProviders();
    return true;
  } catch (e) {
    showSetup(
      `Daemon não encontrado em ${baseUrl()}. Rode \`npm start\` na pasta do projeto e cole o token nas configurações.`
    );
    return false;
  }
}

export async function loadProviders() {
  const res = await fetch(baseUrl() + "/config", {
    headers: { authorization: `Bearer ${state.config.token}` },
  });
  if (!res.ok) return;
  const data = await res.json();
  const sel = $("provider-select");
  sel.innerHTML = "";
  const list = data.providers || [];
  if (!list.length) {
    sel.append(new Option("modo teste", ""));
    return;
  }
  for (const p of list) {
    sel.append(
      new Option(
        `${p.name} · ${p.model || "?"}${p.hasKey || p.type === "auth0" ? "" : " (teste)"}`,
        p.id
      )
    );
  }
  sel.value = data.activeProvider || list[0].id;
}

export async function setActiveProvider(id) {
  try {
    await fetch(baseUrl() + "/active", {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
  } catch {}
}

export async function daemonChat(messages, onDelta) {
  const res = await fetch(baseUrl() + "/chat", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messages, stream: Boolean(onDelta) }),
  });
  if (!res.ok) {
    let err = "HTTP " + res.status;
    try {
      err = (await res.json()).error || err;
    } catch {}
    throw new Error(err);
  }
  if (!onDelta) {
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "erro do daemon");
    return data.text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      let payload;
      try {
        payload = JSON.parse(t.slice(5).trim());
      } catch {
        continue;
      }
      if (payload.error) throw new Error(payload.error);
      if (payload.delta) {
        full += payload.delta;
        onDelta(payload.delta);
      }
    }
  }
  return full;
}

export async function daemonTranslate(text) {
  const res = await fetch(baseUrl() + "/chat", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "Você é um tradutor simultâneo. Traduza para português brasileiro de forma natural e concisa. Se o texto já estiver em português, apenas devolva o texto corrigido. Responda apenas com a tradução, sem comentários.",
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "erro do daemon");
  return data.text;
}

async function transcribeBlob(blob, opts = {}) {
  const res = await fetch(baseUrl() + "/transcribe", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_base64: await blobToBase64(blob),
      mime: blob.type,
      ...opts,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "HTTP " + res.status);
  return (data.text || "").trim();
}

export function transcribeRecording(blob) {
  return transcribeBlob(blob);
}

export function transcribeSegment(seg, lang) {
  return transcribeB64({
    audio_base64: seg.b64,
    mime: seg.mime || "audio/webm",
    lang,
    fast: true,
  });
}

async function transcribeB64(body) {
  const res = await fetch(baseUrl() + "/transcribe", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "HTTP " + res.status);
  return (data.text || "").trim();
}
