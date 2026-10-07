process.env.ASSISTENTE_DATA = "/tmp/an-unit-" + Date.now();

const { after, before, describe, it } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { createApp } = await import("../daemon/server.mjs");
const { newToken, MASK, PRESETS } = await import("../daemon/config.mjs");
const { validateMessages, mockChat, callProvider, clearAuth0Cache, fetchOpenAiModels, countImages } = await import("../daemon/provider.mjs");
const { parseFillsJson, extractJsonObj } = await import("../extension/sidepanel/lib/formfill.js");
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

  it("recusa host estranho (anti DNS-rebinding)", async () => {
    const status = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/health",
          headers: { host: "evil.example.com", authorization: `Bearer ${config.token}` },
        },
        (resp) => {
          resp.resume();
          resp.on("end", () => resolve(resp.statusCode));
        }
      );
      r.on("error", reject);
      r.end();
    });
    assert.equal(status, 403);
  });

  it("aceita host 127.0.0.1 com porta", async () => {
    const status = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/health",
          headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${config.token}` },
        },
        (resp) => {
          resp.resume();
          resp.on("end", () => resolve(resp.statusCode));
        }
      );
      r.on("error", reject);
      r.end();
    });
    assert.equal(status, 200);
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

  it("callProvider não-stream lida com provedor que responde SSE mesmo com stream:false", async () => {
    const sseUp = http.createServer((req, res) => {
      if (req.url === "/v1/chat/completions") {
        res.setHeader("content-type", "text/event-stream");
        res.write('data: {"choices":[{"delta":{"content":"ol"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"á!"}}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(404).end();
    });
    const sport = await listen(sseUp);
    try {
      const r = await callProvider(
        { type: "openai", baseUrl: `http://127.0.0.1:${sport}/v1`, model: "m", apiKey: "k" },
        [{ role: "user", content: "oi" }]
      );
      assert.equal(r.text, "olá!");
      const streamed = [];
      const r2 = await callProvider(
        { type: "openai", baseUrl: `http://127.0.0.1:${sport}/v1`, model: "m", apiKey: "k" },
        [{ role: "user", content: "oi" }],
        { onDelta: (d) => streamed.push(d) }
      );
      assert.equal(r2.text, "olá!");
      assert.deepEqual(streamed, ["ol", "á!"]);
    } finally {
      await new Promise((resolve) => sseUp.close(resolve));
    }
  });

  it("callProvider não-stream lê message.content em chunk final de SSE", async () => {
    const sseUp = http.createServer((req, res) => {
      res.setHeader("content-type", "text/event-stream");
      res.write('data: {"choices":[{"delta":{}}]}\n\n');
      res.write('data: {"choices":[{"message":{"content":"final"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const sport = await listen(sseUp);
    try {
      const r = await callProvider(
        { type: "openai", baseUrl: `http://127.0.0.1:${sport}/v1`, model: "m", apiKey: "k" },
        [{ role: "user", content: "oi" }]
      );
      assert.equal(r.text, "final");
    } finally {
      await new Promise((resolve) => sseUp.close(resolve));
    }
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

  it("presets nous e deepseek presentes", () => {
    assert.equal(PRESETS.nous.baseUrl, "https://inference-api.nousresearch.com/v1");
    assert.equal(PRESETS.nous.model, "Hermes-4-405B");
    assert.equal(PRESETS.deepseek.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(PRESETS.deepseek.model, "deepseek-chat");
  });
});

describe("multimodal (prints) + parse de formulário", () => {
  const img = (chars = 100) => "data:image/png;base64," + "A".repeat(chars);

  it("validateMessages aceita content com texto + imagem", () => {
    const ok = [
      { role: "user", content: [{ type: "text", text: "o que é isso?" }, { type: "image_url", image_url: { url: img() } }] },
    ];
    assert.equal(validateMessages(ok), null);
  });

  it("validateMessages recusa excessos de imagem", () => {
    const five = [1, 2, 3, 4, 5].map(() => ({ type: "image_url", image_url: { url: img(10) } }));
    assert.ok(validateMessages([{ role: "user", content: five }]));
    assert.ok(validateMessages([{ role: "user", content: [{ type: "image_url", image_url: { url: img(4_600_000) } }] }]));
  });

  it("validateMessages recusa partes inválidas", () => {
    assert.ok(validateMessages([{ role: "user", content: [{ type: "audio", data: "x" }] }]));
    assert.ok(validateMessages([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:text/html;base64,AAA" } }] }]));
    assert.ok(validateMessages([{ role: "user", content: [] }]));
    assert.ok(validateMessages([{ role: "user", content: [{ type: "text", text: 42 }] }]));
  });

  it("countImages conta imagens no histórico", () => {
    assert.equal(countImages([{ role: "user", content: "texto" }]), 0);
    assert.equal(
      countImages([
        { role: "user", content: [{ type: "text", text: "a" }, { type: "image_url", image_url: { url: img(10) } }] },
        { role: "assistant", content: "ok" },
      ]),
      1
    );
  });

  it("mockChat lida com array e menciona imagens", () => {
    const r = mockChat([
      { role: "user", content: [{ type: "text", text: "analise" }, { type: "image_url", image_url: { url: img(10) } }] },
    ]);
    assert.equal(r.ok, true);
    assert.ok(r.text.includes("analise"));
    assert.ok(r.text.includes("imagem"));
  });

  it("parseFillsJson lê JSON puro, cercado e com crases", () => {
    assert.deepEqual(parseFillsJson('{"fills":[{"i":0,"value":"Ana"}]}'), [{ i: 0, value: "Ana" }]);
    const wrapped = 'Claro!\n```json\n{"fills":[{"i":2,"value":"x@y.com"},{"i":5,"value":"true"}]}\n```';
    assert.deepEqual(parseFillsJson(wrapped), [
      { i: 2, value: "x@y.com" },
      { i: 5, value: "true" },
    ]);
  });

  it("parseFillsJson aceita aliases e checked; recusa lixo", () => {
    assert.deepEqual(parseFillsJson('{"fills":[{"index":3,"valor":"Brasil"}]}'), [{ i: 3, value: "Brasil" }]);
    assert.deepEqual(parseFillsJson('{"fills":[{"i":1,"checked":true}]}'), [{ i: 1, value: "true" }]);
    assert.equal(parseFillsJson("sem json aqui"), null);
    assert.equal(parseFillsJson('{"fills":[{"i":"a","value":1}]}'), null);
    assert.equal(parseFillsJson('{"fills":[{"i":1}]}'), null);
    assert.equal(parseFillsJson('{"outros":[]}'), null);
  });

  it("extractJsonObj acha o primeiro objeto balanceado", () => {
    assert.deepEqual(extractJsonObj('texto {"a":1} resto'), { a: 1 });
    assert.deepEqual(extractJsonObj('{"a":"tem } chave"}'), { a: "tem } chave" });
    assert.equal(extractJsonObj("nada"), null);
    assert.equal(extractJsonObj('{"aberto":'), null);
  });
});

describe("descoberta de modelos", () => {
  let hits = 0;
  let seenAuth = "";
  const upstream = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      hits++;
      seenAuth = req.headers.authorization || "";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "beta" }, { id: "alpha" }, { id: "gamma", owned_by: "org" }] }));
      return;
    }
    res.writeHead(404).end();
  });
  let uport;
  const config = {
    token: newToken(),
    activeProvider: null,
    providers: [],
  };
  const app = createApp({ config });
  let port;
  before(async () => {
    uport = await listen(upstream);
    port = await listen(app);
  });
  after(() => {
    app.close();
    upstream.close();
  });

  const base = () => `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${config.token}` };

  it("fetchOpenAiModels ordena e normaliza", async () => {
    const models = await fetchOpenAiModels(`http://127.0.0.1:${uport}/v1`, "k1");
    assert.deepEqual(models.map((m) => m.id), ["alpha", "beta", "gamma"]);
    assert.equal(models[2].owned_by, "org");
    assert.equal(hits, 1);
  });

  it("GET /models?provider= consulta upstream com a chave salva", async () => {
    await fetch(base() + "/config", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [{ id: "rt9", name: "9Router", type: "openai", baseUrl: `http://127.0.0.1:${uport}/v1`, model: "ag/x", apiKey: "k1" }],
        activeProvider: "rt9",
      }),
    });
    const res = await fetch(base() + "/models?provider=rt9", { headers: auth });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.provider, "rt9");
    assert.equal(data.count, 3);
    assert.equal(seenAuth, "Bearer k1");
    assert.equal(data.models[0].id, "alpha");
  });

  it("GET /models sem provider usa o ativo; desconhecido → 404", async () => {
    const r1 = await fetch(base() + "/models", { headers: auth });
    const d1 = await r1.json();
    assert.equal(d1.ok, true);
    assert.equal(d1.provider, "rt9");

    const r2 = await fetch(base() + "/models?provider=zz", { headers: auth });
    assert.equal(r2.status, 404);
  });

  it("POST /models ad-hoc com baseUrl e apiKey", async () => {
    const res = await fetch(base() + "/models", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${uport}/v1`, apiKey: "k2" }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.count, 3);
    assert.equal(seenAuth, "Bearer k2");
  });

  it("POST /models sem baseUrl → 400", async () => {
    const res = await fetch(base() + "/models", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 400);
  });

  it("GET /models de upstream fora do ar → ok:false", async () => {
    await new Promise((resolve) => upstream.close(resolve));
    const res = await fetch(base() + "/models?provider=rt9", { headers: auth });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, false);
    assert.ok(data.error);
  });
});
