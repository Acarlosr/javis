export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function validateMessages(messages) {
  if (!Array.isArray(messages)) return "messages deve ser um array";
  if (messages.length === 0) return "messages vazio";
  if (messages.length > 200) return "muitas mensagens (max 200)";
  for (const m of messages) {
    if (!m || typeof m !== "object") return "mensagem inválida";
    if (!["system", "user", "assistant"].includes(m.role)) return "role inválido: " + m.role;
    if (typeof m.content !== "string") return "content inválido";
    if (m.content.length > 400_000) return "conteúdo muito grande (max 400k chars)";
  }
  return null;
}

export function mockChat(messages) {
  const last = messages[messages.length - 1];
  const head = (last?.content || "").slice(0, 200).replace(/\s+/g, " ");
  return {
    ok: true,
    mock: true,
    text:
      `[modo teste] Recebi sua mensagem: "${head}". ` +
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
  if (!onDelta) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
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
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {}
    }
  }
  return { ok: true, text: full };
}
