import { createServer } from "node:http";
import { MASK, isTokenValid, normalizeProvider, saveConfig } from "./config.mjs";
import { callProvider, validateMessages, MAX_BODY_BYTES } from "./provider.mjs";
import { sttAvailable, transcribeAudio } from "./stt.mjs";

function sanitizeProvider(p) {
  return {
    ...p,
    apiKey: p.apiKey ? MASK : "",
    hasKey: Boolean(p.apiKey),
    auth0: p.auth0
      ? { ...p.auth0, clientSecret: p.auth0.clientSecret ? MASK : "" }
      : null,
  };
}

export function createApp({ config, logger = () => {} } = {}) {
  async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new Error("corpo muito grande");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    if (origin) {
      res.setHeader("access-control-allow-origin", "chrome-extension://*");
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization,content-type");
      res.setHeader("access-control-allow-methods", "POST,GET,PUT,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!isTokenValid(token, config.token)) {
      sendJson(res, 401, { ok: false, error: "token inválido" });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      const active = config.providers.find((p) => p.id === config.activeProvider) || null;
      sendJson(res, 200, {
        ok: true,
        name: "assistente-navegador",
        version: "0.3.0",
        provider: active ? active.name : null,
        model: active ? active.model : null,
        hasKey: active ? Boolean(active.apiKey) || active.type === "auth0" : false,
        stt: sttAvailable(),
      });
      return;
    }

    if (req.method === "GET" && req.url === "/config") {
      sendJson(res, 200, {
        ok: true,
        activeProvider: config.activeProvider,
        providers: config.providers.map(sanitizeProvider),
      });
      return;
    }

    if (req.method === "PUT" && req.url === "/config") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido" });
        return;
      }
      if (!Array.isArray(body.providers)) {
        sendJson(res, 400, { ok: false, error: "providers deve ser um array" });
        return;
      }
      if (body.providers.length > 20) {
        sendJson(res, 400, { ok: false, error: "muitos provedores (max 20)" });
        return;
      }
      const seen = new Set();
      for (const p of body.providers) {
        const norm = normalizeProvider(p, 0);
        if (seen.has(norm.id)) {
          sendJson(res, 400, { ok: false, error: "id duplicado: " + norm.id });
          return;
        }
        seen.add(norm.id);
      }
      const restored = body.providers.map((p) => {
        const norm = normalizeProvider(p, body.providers.indexOf(p));
        const old = config.providers.find((o) => o.id === norm.id);
        if (norm.apiKey === MASK && old) norm.apiKey = old.apiKey;
        if (norm.auth0?.clientSecret === MASK && old?.auth0) {
          norm.auth0.clientSecret = old.auth0.clientSecret;
        }
        if (norm.type !== "auth0") norm.auth0 = null;
        return norm;
      });
      config.providers = restored;
      const ids = new Set(restored.map((p) => p.id));
      config.activeProvider =
        ids.has(body.activeProvider) ? body.activeProvider : restored[0]?.id || null;
      saveConfig({ port: config.port, activeProvider: config.activeProvider, providers: config.providers });
      logger("config atualizada: " + config.providers.length + " provedores");
      sendJson(res, 200, {
        ok: true,
        activeProvider: config.activeProvider,
        providers: config.providers.map(sanitizeProvider),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/active") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        body = {};
      }
      const profile = config.providers.find((p) => p.id === body.id);
      if (!profile) {
        sendJson(res, 400, { ok: false, error: "provedor desconhecido: " + body.id });
        return;
      }
      config.activeProvider = profile.id;
      saveConfig({ port: config.port, activeProvider: config.activeProvider, providers: config.providers });
      sendJson(res, 200, { ok: true, activeProvider: config.activeProvider });
      return;
    }

    if (req.method === "POST" && req.url === "/test") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        body = {};
      }
      const profile = body.provider
        ? config.providers.find((p) => p.id === body.provider)
        : config.providers.find((p) => p.id === config.activeProvider) || null;
      if (body.provider && !profile) {
        sendJson(res, 200, { ok: false, error: "provedor desconhecido: " + body.provider });
        return;
      }
      if (!profile) {
        sendJson(res, 200, { ok: false, error: "nenhum provedor configurado" });
        return;
      }
      const t0 = Date.now();
      try {
        const r = await callProvider(profile, [{ role: "user", content: "Responda apenas: ok" }]);
        sendJson(res, 200, {
          ok: true,
          mock: Boolean(r.mock),
          text: (r.text || "").slice(0, 120),
          ms: Date.now() - t0,
          provider: profile.name,
          model: profile.model,
        });
      } catch (e) {
        sendJson(res, 200, {
          ok: false,
          error: String(e.message || e),
          ms: Date.now() - t0,
          provider: profile.name,
          model: profile.model,
        });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/chat") {
      let raw;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido" });
        return;
      }
      const err = validateMessages(raw.messages);
      if (err) {
        sendJson(res, 400, { ok: false, error: err });
        return;
      }
      let profile = config.providers.find((p) => p.id === config.activeProvider) || null;
      if (raw.provider !== undefined) {
        profile = config.providers.find((p) => p.id === raw.provider) || null;
        if (raw.provider !== null && !profile) {
          sendJson(res, 400, { ok: false, error: "provedor desconhecido: " + raw.provider });
          return;
        }
      }
      const stream = Boolean(raw.stream);
      if (stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        try {
          await callProvider(profile, raw.messages, {
            onDelta: (delta) => send("delta", { delta }),
          });
          send("done", { ok: true });
        } catch (e) {
          send("error", { ok: false, error: String(e.message || e) });
        }
        res.end();
        return;
      }
      try {
        const result = await callProvider(profile, raw.messages);
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 502, { ok: false, error: String(e.message || e) });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/transcribe") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido" });
        return;
      }
      if (!body.audio_base64) {
        sendJson(res, 400, { ok: false, error: "campo audio_base64 obrigatório" });
        return;
      }
      try {
        const text = await transcribeAudio({
          base64: body.audio_base64,
          mime: body.mime,
          lang: typeof body.lang === "string" ? body.lang.slice(0, 8) : "pt",
          fast: Boolean(body.fast),
        });
        sendJson(res, 200, { ok: true, text });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "rota não encontrada" });
  });

  return server;
}
