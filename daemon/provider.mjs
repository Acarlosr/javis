export const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_URL_CHARS = 4_500_000;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

function validateParts(content) {
  if (!Array.isArray(content) || content.length === 0) return "content inválido";
  if (content.length > 12) return "muitas partes de conteúdo (max 12)";
  let images = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") return "parte de conteúdo inválida";
    if (part.type === "text") {
      if (typeof part.text !== "string") return "parte text inválida";
      if (part.text.length > 400_000) return "conteúdo muito grande (max 400k chars)";
    } else if (part.type === "image_url") {
      images++;
      const url = part.image_url?.url;
      if (typeof url !== "string" || !url.startsWith("data:image/")) {
        return "imagem inválida (use data URL de imagem)";
      }
      if (url.length > MAX_IMAGE_URL_CHARS) return "imagem muito grande (max ~4MB)";
    } else {
      return "tipo de conteúdo não suportado: " + part.type;
    }
  }
  if (images > MAX_IMAGES_PER_MESSAGE) return "muitas imagens (max 4 por mensagem)";
  return null;
}

export function validateMessages(messages) {
  if (!Array.isArray(messages)) return "messages deve ser um array";
  if (messages.length === 0) return "messages vazio";
  if (messages.length > 200) return "muitas mensagens (max 200)";
  for (const m of messages) {
    if (!m || typeof m !== "object") return "mensagem inválida";
    if (!["system", "user", "assistant"].includes(m.role)) return "role inválido: " + m.role;
    if (typeof m.content === "string") {
      if (m.content.length > 400_000) return "conteúdo muito grande (max 400k chars)";
    } else {
      const err = validateParts(m.content);
      if (err) return err;
    }
  }
  return null;
}

export function countImages(messages) {
  let n = 0;
  for (const m of messages || []) {
    if (Array.isArray(m?.content)) n += m.content.filter((p) => p?.type === "image_url").length;
  }
  return n;
}

export function mockChat(messages) {
  const last = messages[messages.length - 1];
  const head = textOf(last?.content).slice(0, 200).replace(/\s+/g, " ");
  const imgs = countImages(messages);
  return {
    ok: true,
    mock: true,
    text:
      `[modo teste] Recebi sua mensagem: "${head}".` +
      (imgs ? ` (${imgs} imagem(ns) anexada(s) — para análise visual, configure um provedor com modelo de visão.) ` : " ") +
      `Este é um eco simulado do Javis (sem chave de API configurada). ` +
      `Mensagens no histórico: ${messages.length}.`,
  };
}

export async function fetchOpenAiModels(baseUrl, apiKey, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const url = String(baseUrl || "").replace(/\/+$/, "") + "/models";
  if (!/^https?:\/\//.test(url)) throw new Error("Base URL inválida: " + url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {};
    if (apiKey && !/^•+$/.test(apiKey)) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      let detail = "HTTP " + res.status;
      try {
        const j = await res.json();
        detail = (j.error && (j.error.message || j.error)) || detail;
      } catch {}
      throw new Error(detail);
    }
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list
      .map((m) =>
        typeof m === "string"
          ? { id: m }
          : { id: String(m.id ?? m.name ?? ""), owned_by: String(m.owned_by || "") }
      )
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  } finally {
    clearTimeout(timer);
  }
}

const auth0Cache = new Map();

export function auth0Base(domain) {
  return /^https?:\/\//.test(domain) ? domain.replace(/\/+$/, "") : `https://${domain}`;
}

export async function getAuth0Token(auth0, fetchImpl = fetch) {
  const key = `${auth0.domain}|${auth0.clientId}|${auth0.audience}`;
  const cached = auth0Cache.get(key);
  if (cached && Date.now() < cached.exp) return cached.token;
  const res = await fetchImpl(auth0Base(auth0.domain) + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: auth0.clientId,
      client_secret: auth0.clientSecret,
      audience: auth0.audience || undefined,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {}
    throw new Error(`Auth0 respondeu ${res.status}: ${detail}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Auth0 não retornou access_token");
  const ttl = Number.isFinite(data.expires_in) ? data.expires_in * 1000 : 3600_000;
  auth0Cache.set(key, { token: data.access_token, exp: Date.now() + Math.max(ttl - 60_000, 10_000) });
  return data.access_token;
}

export function clearAuth0Cache() {
  auth0Cache.clear();
}

async function readSse(res, onDelta, { allowMessage = false } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let sawDelta = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const choice = json?.choices?.[0];
        const delta = choice?.delta?.content || "";
        const piece =
          delta || (allowMessage && !sawDelta ? choice?.message?.content || "" : "");
        if (piece) {
          if (delta) sawDelta = true;
          full += piece;
          if (onDelta) onDelta(piece);
        }
      } catch {}
    }
  }
  return { ok: true, text: full };
}

export async function callProvider(profile, messages, { onDelta, signal } = {}) {
  if (!profile) {
    const r = mockChat(messages);
    if (onDelta) onDelta(r.text);
    return r;
  }
  let authHeader;
  if (profile.type === "auth0") {
    if (!profile.auth0?.domain || !profile.auth0?.clientId || !profile.auth0?.clientSecret) {
      throw new Error("Auth0 incompleto: preencha domain, clientId e clientSecret");
    }
    const token = await getAuth0Token(profile.auth0);
    authHeader = `Bearer ${token}`;
  } else {
    if (!profile.apiKey || !profile.baseUrl || !profile.model) {
      const r = mockChat(messages);
      if (onDelta) onDelta(r.text);
      return r;
    }
    authHeader = `Bearer ${profile.apiKey}`;
  }
  const url = profile.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: authHeader,
    },
    body: JSON.stringify({ model: profile.model, messages, stream: Boolean(onDelta) }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {}
    throw new Error(`Provedor respondeu ${res.status}: ${detail}`);
  }
  if (onDelta) return readSse(res, onDelta);
  const ctype = String(res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("text/event-stream")) return readSse(res, null, { allowMessage: true });
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { ok: true, text };
}
