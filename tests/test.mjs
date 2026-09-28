process.env.ASSISTENTE_DATA = "/tmp/an-unit-" + Date.now();

const { after, before, describe, it } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { createApp } = await import("../daemon/server.mjs");
const { newToken, MASK } = await import("../daemon/config.mjs");
const { validateMessages, mockChat, callProvider, clearAuth0Cache } = await import("../daemon/provider.mjs");
const http = (await import("node:http")).default;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

describe("daemon server", () => {
  const config = {
    token: newToken(),
    activeProvider: null,
    providers: [],
  };
  const app = createApp({ config });
  let port;
  before(async () => {
    port = await listen(app);
  });
  after(() => app.close());

  const base = () => `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${config.token}` };

  it("recusa sem token", async () => {
    const res = await fetch(base() + "/health");
    assert.equal(res.status, 401);
  });

  it("recusa token errado", async () => {
    const res = await fetch(base() + "/health", { headers: { authorization: "Bearer x" } });
    assert.equal(res.status, 401);
  });

  it("health sem provedor", async () => {
    const res = await fetch(base() + "/health", { headers: auth });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.hasKey, false);
  });

  it("rota inexistente 404", async () => {
    const res = await fetch(base() + "/x", { headers: auth });
    assert.equal(res.status, 404);
  });

  it("chat JSON em modo teste (sem provedores)", async () => {
    const res = await fetch(base() + "/chat", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "olá" }] }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.text.includes("modo teste"));
  });

  it("chat recusa mensagens inválidas", async () => {
    for (const messages of [{}, null, "x", [], [{ role: "zz", content: "a" }]]) {
      const res = await fetch(base() + "/chat", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      assert.equal(res.status, 400);
    }
  });

  it("chat SSE emite delta e done", async () => {
    const res = await fetch(base() + "/chat", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "resuma" }] }),
    });
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const body = await res.text();
    assert.ok(body.includes("event: delta"));
    assert.ok(body.includes("event: done"));
  });

  it("config: GET inicial", async () => {
    const res = await fetch(base() + "/config", { headers: auth });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.deepEqual(data.providers, []);
    assert.equal(data.activeProvider, null);
  });

  it("config: PUT cria provedores e mascara segredos", async () => {
    const res = await fetch(base() + "/config", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { id: "gem1", name: "Gemini", type: "openai", baseUrl: "https://x/v1", model: "m1", apiKey: "chave123" },
          {
            id: "corp",
            name: "Corp Auth0",
            type: "auth0",
            baseUrl: "https://x/v1",
            model: "m2",
            auth0: { domain: "x.auth0.com", clientId: "cid", clientSecret: "segredo", audience: "aud" },
          },
        ],
        activeProvider: "gem1",
      }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.providers[0].apiKey, MASK);
    assert.equal(data.providers[0].hasKey, true);
    assert.equal(data.providers[1].auth0.clientSecret, MASK);
    assert.equal(data.activeProvider, "gem1");

    assert.equal(config.providers[0].apiKey, "chave123");
    assert.equal(config.providers[1].auth0.clientSecret, "segredo");
  });

  it("config: reenviar MASK preserva segredo", async () => {
    const res = await fetch(base() + "/config", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { id: "gem1", name: "Gemini", type: "openai", baseUrl: "https://x/v1", model: "m1", apiKey: MASK },
        ],
        activeProvider: "gem1",
      }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.providers[0].hasKey, true);
    assert.equal(config.providers[0].apiKey, "chave123");
  });

  it("config: recusa id duplicado", async () => {
    const res = await fetch(base() + "/config", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { id: "a", name: "A", type: "openai" },
          { id: "a", name: "B", type: "openai" },
        ],
      }),
    });
    assert.equal(res.status, 400);
  });

  it("config: activeProvider inválido cai no primeiro", async () => {
    const res = await fetch(base() + "/config", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ providers: [{ id: "b", name: "B", type: "openai" }], activeProvider: "zzz" }),
    });
    const data = await res.json();
    assert.equal(data.activeProvider, "b");
  });

  it("chat com provedor override desconhecido → 400", async () => {
    const res = await fetch(base() + "/chat", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ provider: "zz", messages: [{ role: "user", content: "oi" }] }),
    });
    assert.equal(res.status, 400);
  });

  it("active: troca provedor ativo", async () => {
    await fetch(base() + "/config", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { id: "t1", name: "T1", type: "openai", baseUrl: "", model: "m1", apiKey: "" },
          { id: "t2", name: "T2", type: "openai", baseUrl: "", model: "m2", apiKey: "" },
        ],
        activeProvider: "t1",
      }),
    });
    const res = await fetch(base() + "/active", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ id: "t2" }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.activeProvider, "t2");
    assert.equal(config.activeProvider, "t2");
  });

  it("active: id desconhecido → 400", async () => {
    const res = await fetch(base() + "/active", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ id: "zz" }),
    });
    assert.equal(res.status, 400);
  });

  it("test: prova o provedor ativo (modo teste)", async () => {
    const res = await fetch(base() + "/test", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.mock, true);
    assert.equal(data.provider, "T2");
    assert.ok(data.ms >= 0);
  });

  it("test: prova provedor específico", async () => {
    const res = await fetch(base() + "/test", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ provider: "t1" }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.mock, true);
    assert.equal(data.provider, "T1");
  });

  it("test: provedor desconhecido → ok:false", async () => {
    const res = await fetch(base() + "/test", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ provider: "zz" }),
    });
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.ok(data.error.includes("desconhecido"));
  });
});

describe("auth0 + provedor mock", () => {
  let oauthHits = 0;
  let chatHits = 0;
  const mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/oauth/token") {
        oauthHits++;
        const parsed = JSON.parse(body);
        if (parsed.client_id !== "cid" || parsed.client_secret !== "sec") {
          res.writeHead(401).end();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "tok123", expires_in: 7200 }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        chatHits++;
        if (req.headers.authorization === "Bearer key456") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ choices: [{ message: { content: "direct ok" } }] }));
          return;
        }
        if (req.headers.authorization !== "Bearer tok123") {
          res.writeHead(401).end();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "auth0 ok" } }] }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  let mport;
  before(async () => {
    mport = await listen(mock);
  });
  after(() => mock.close());

  it("callProvider auth0 busca token e chama endpoint", async () => {
    clearAuth0Cache();
    const profile = {
      type: "auth0",
      baseUrl: `http://127.0.0.1:${mport}/v1`,
      model: "corp-model",
      auth0: {
        domain: `http://127.0.0.1:${mport}`,
        clientId: "cid",
        clientSecret: "sec",
        audience: "https://api.corp",
      },
    };
    const r1 = await callProvider(profile, [{ role: "user", content: "oi" }]);
    assert.equal(r1.text, "auth0 ok");
    assert.equal(oauthHits, 1);
    assert.equal(chatHits, 1);

    const r2 = await callProvider(profile, [{ role: "user", content: "de novo" }]);
    assert.equal(r2.text, "auth0 ok");
    assert.equal(oauthHits, 1, "token em cache, sem novo /oauth/token");
    assert.equal(chatHits, 2);
  });

  it("auth0 incompleto → erro claro", async () => {
    await assert.rejects(
      () => callProvider({ type: "auth0", auth0: { domain: "x" } }, [{ role: "user", content: "x" }]),
      /Auth0 incompleto/
    );
  });

  it("callProvider openai direto com apiKey", async () => {
    const r = await callProvider(
      { type: "openai", baseUrl: `http://127.0.0.1:${mport}/v1`, model: "direct-model", apiKey: "key456" },
      [{ role: "user", content: "oi" }]
    );
    assert.equal(r.text, "direct ok");
    assert.equal(r.mock, undefined);
  });
});

describe("provider", () => {
  it("validateMessages aplica limites", () => {
    assert.equal(validateMessages([{ role: "user", content: "ok" }]), null);
    assert.ok(validateMessages([]));
    assert.ok(validateMessages([{ role: "user", content: "x".repeat(400_001) }]));
  });

  it("mockChat resume histórico", () => {
    const r = mockChat([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    assert.equal(r.ok, true);
    assert.ok(r.text.includes("2"));
  });
});
