const $ = (id) => document.getElementById(id);
const MASK = "••••••";
const DEFAULTS = { port: 57931, token: "" };
const PRESETS = {
  gemini: { name: "Gemini", type: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  openai: { name: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { name: "Groq", type: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openrouter: { name: "OpenRouter", type: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
  nous: { name: "Nous Research", type: "openai", baseUrl: "https://inference-api.nousresearch.com/v1", model: "Hermes-4-405B" },
  deepseek: { name: "DeepSeek", type: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  ollama: { name: "Ollama (local)", type: "openai", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
  router9: { name: "9Router (local)", type: "openai", baseUrl: "http://127.0.0.1:20128/v1", model: "ag/gemini-3.8-flash-low" },
};
const KEYLESS_PRESETS = new Set(["ollama", "router9"]);

let providers = [];
let activeProvider = null;
let editingId = null;
let creds = null;
let modelsByProvider = new Map();
let refreshingModels = false;
let editorModels = null;

function baseUrl() {
  return `http://127.0.0.1:${creds.port}`;
}

async function daemonFetch(path, method = "GET", body) {
  const res = await fetch(baseUrl() + path, {
    method,
    headers: {
      authorization: `Bearer ${creds.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

function note(text, cls = "") {
  const el = $("save-result");
  el.textContent = text;
  el.className = cls;
  if (text) setTimeout(() => (el.textContent = ""), 4000);
}

const EYE_ON =
  '<svg class="icon-eye" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg class="icon-eye-off" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

function wireEye(btn) {
  const input = $(btn.dataset.eyeTarget);
  if (!input) return;
  btn.insertAdjacentHTML("beforeend", EYE_ON + EYE_OFF);
  const what = btn.dataset.what || "valor";
  const set = (show) => {
    input.type = show ? "text" : "password";
    btn.classList.toggle("showing", show);
    const label = (show ? "Ocultar " : "Mostrar ") + what;
    btn.setAttribute("aria-label", label);
    btn.title = label;
  };
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    set(show);
    input.focus();
    if (show && input.value === MASK) {
      note(`O ${what} real fica só no daemon; o campo mostra ${MASK} para manter o valor salvo. Cole um novo para substituir.`);
    }
  });
  set(false);
}

function stripMaskOnInput(el) {
  el.addEventListener("input", () => {
    const v = el.value;
    if (v.includes(MASK) && v.trim() !== MASK) el.value = v.split(MASK).join("").trim();
  });
}

function cleanSecret(v) {
  const s = (v || "").trim();
  return !s || s === MASK ? s : s.split(MASK).join("").trim();
}

async function loadBridge() {
  const data = await chrome.storage.local.get(["assistConfig"]);
  const c = data.assistConfig || {};
  creds = { port: c.port || DEFAULTS.port, token: c.token || "" };
  $("port").value = creds.port;
  $("token").value = creds.token;
}

async function saveBridge() {
  creds = { port: Number($("port").value) || DEFAULTS.port, token: $("token").value.trim() };
  await chrome.storage.local.set({ assistConfig: creds });
}

async function connect() {
  await saveBridge();
  const el = $("test-result");
  el.textContent = "…";
  el.className = "";
  try {
    const res = await fetch(baseUrl() + "/health", {
      headers: { authorization: `Bearer ${creds.token}` },
    });
    const data = await res.json();
    el.textContent = data.ok ? "Conectado" : "Falhou";
    el.className = data.ok ? "ok" : "bad";
    if (data.ok) {
      await loadProviders();
      await maybeMigrateLegacy();
    }
  } catch (e) {
    el.textContent = "Daemon não responde";
    el.className = "bad";
  }
}

async function loadProviders() {
  const r = await daemonFetch("/config");
  if (!r.ok) {
    note("Não foi possível ler a config do daemon", "bad");
    return;
  }
  providers = r.data.providers || [];
  activeProvider = r.data.activeProvider;
  renderProviders();
  refreshModelChips();
}

function isLocalUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(url || "");
}

async function refreshModelChips() {
  if (refreshingModels) return;
  refreshingModels = true;
  try {
    const targets = providers.filter(
      (p) => p.type === "openai" && p.baseUrl && (p.hasKey || isLocalUrl(p.baseUrl))
    );
    await Promise.allSettled(
      targets.map(async (p) => {
        const r = await daemonFetch("/models?provider=" + encodeURIComponent(p.id));
        modelsByProvider.set(p.id, r.ok && r.data.ok ? r.data.models || [] : null);
      })
    );
    renderProviders();
  } finally {
    refreshingModels = false;
  }
}

async function updateProviderModel(id, model) {
  const p = providers.find((x) => x.id === id);
  if (!p) return;
  p.model = model;
  await putConfig();
}

let menuEl = null;
let menuAnchor = null;

function closeModelMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  menuAnchor = null;
  document.removeEventListener("mousedown", onMenuOutside, true);
  document.removeEventListener("keydown", onMenuKey, true);
}

function onMenuOutside(e) {
  if (menuEl && !menuEl.contains(e.target) && !menuAnchor.contains(e.target)) closeModelMenu();
}

function onMenuKey(e) {
  if (e.key === "Escape") closeModelMenu();
}

function openModelMenu(anchor, models, current, onPick, menuKey) {
  if (menuEl && menuEl.dataset.for === menuKey) {
    closeModelMenu();
    return;
  }
  closeModelMenu();
  if (!models || !models.length) return;
  menuAnchor = anchor;
  const menu = document.createElement("div");
  menu.className = "model-menu";
  menu.dataset.for = menuKey || "";
  const search = document.createElement("input");
  search.type = "text";
  search.className = "model-menu-search";
  search.placeholder = "filtrar modelos…";
  const list = document.createElement("div");
  list.className = "model-menu-list";
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = "";
    const filtered = q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "model-menu-empty";
      empty.textContent = "nenhum modelo com esse filtro";
      list.append(empty);
      return;
    }
    for (const m of filtered) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "model-menu-item" + (m.id === current ? " sel" : "");
      item.textContent = m.id;
      item.title = m.owned_by ? m.id + " · " + m.owned_by : m.id;
      item.onclick = () => {
        closeModelMenu();
        onPick(m.id);
      };
      list.append(item);
    }
  };
  search.addEventListener("input", paint);
  paint();
  menu.append(search, list);
  const rect = anchor.getBoundingClientRect();
  const MARGIN = 8;
  menu.style.visibility = "hidden";
  document.body.append(menu);
  const mh = menu.offsetHeight;
  let top = rect.bottom + 6;
  if (top + mh > window.innerHeight - MARGIN) top = Math.max(MARGIN, rect.top - mh - 6);
  menu.style.top = top + "px";
  menu.style.left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - menu.offsetWidth - MARGIN)) + "px";
  menu.style.visibility = "visible";
  search.focus();
  menuEl = menu;
  document.addEventListener("mousedown", onMenuOutside, true);
  document.addEventListener("keydown", onMenuKey, true);
}

function renderProviders() {
  const sel = $("active-provider");
  sel.innerHTML = "";
  if (!providers.length) {
    sel.append(new Option("— nenhum —", ""));
  }
  const list = $("provider-list");
  list.innerHTML = "";
  for (const p of providers) {
    if (p.id === activeProvider || !activeProvider) sel.append(new Option(p.name, p.id));
    const card = document.createElement("div");
    card.className = "provider-card" + (p.id === activeProvider ? " active" : "");
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${p.type === "auth0" ? "Auth0" : "API"} · ${p.model || "sem modelo"}${p.hasKey || p.type === "auth0" ? "" : " · sem chave (modo teste)"}`;
    info.append(name, meta);
    const models = modelsByProvider.get(p.id);
    if (models && models.length) {
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "model-pick";
      const label = document.createElement("span");
      label.textContent = p.model || "escolher modelo";
      const chev = document.createElement("span");
      chev.className = "chev";
      chev.textContent = "▾";
      pick.append(label, chev);
      pick.title = "Escolher modelo (" + models.length + ")";
      pick.onclick = () => openModelMenu(pick, models, p.model, (id) => updateProviderModel(p.id, id), "card:" + p.id);
      info.append(pick);
    }
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = p.id === activeProvider ? "ativo" : "";
    const btns = document.createElement("div");
    btns.className = "btns";
    const use = document.createElement("button");
    use.textContent = "Usar";
    use.onclick = () => setActive(p.id);
    const edit = document.createElement("button");
    edit.textContent = "Editar";
    edit.onclick = () => openEditor(p);
    const test = document.createElement("button");
    test.textContent = "Testar";
    test.onclick = async () => {
      note(`Testando ${p.name}…`);
      const r = await daemonFetch("/test", "POST", { provider: p.id });
      if (r.ok && r.data.ok) {
        note(
          `${p.name}: online (${r.data.ms}ms) — "${(r.data.text || "").slice(0, 60)}"${r.data.mock ? " (modo teste)" : ""}`,
          "ok"
        );
      } else {
        note(`${p.name}: FALHOU — ${r.data.error || "HTTP " + r.status}`, "bad");
      }
    };
    const del = document.createElement("button");
    del.textContent = "Remover";
    del.className = "danger";
    del.onclick = () => removeProvider(p.id);
    btns.append(use, edit, test, del);
    card.append(info, badge, btns);
    list.append(card);
  }
  if (activeProvider) sel.value = activeProvider;
}

async function putConfig() {
  const r = await daemonFetch("/config", "PUT", { providers, activeProvider });
  if (!r.ok) {
    note("Erro ao salvar: " + (r.data.error || r.status), "bad");
    return false;
  }
  providers = r.data.providers;
  activeProvider = r.data.activeProvider;
  renderProviders();
  note("Salvo", "ok");
  return true;
}

async function setActive(id) {
  activeProvider = id;
  await putConfig();
}

async function removeProvider(id) {
  if (!confirm("Remover este provedor?")) return;
  providers = providers.filter((p) => p.id !== id);
  if (activeProvider === id) activeProvider = providers[0]?.id || null;
  await putConfig();
}

function openEditor(p) {
  editingId = p ? p.id : null;
  $("editor-title").textContent = p ? "Editar provedor" : "Novo provedor";
  $("preset").value = "";
  $("p-name").value = p?.name || "";
  $("p-base").value = p?.baseUrl || "";
  $("p-model").value = p?.model || "";
  $("p-key").value = p?.hasKey ? MASK : "";
  $("p-key").placeholder = "cole uma nova chave para substituir";
  $("p-domain").value = p?.auth0?.domain || "";
  $("p-client-id").value = p?.auth0?.clientId || "";
  $("p-client-secret").value = p?.auth0?.clientSecret ? MASK : "";
  $("p-client-secret").placeholder = "cole um novo secret para substituir";
  $("p-audience").value = p?.auth0?.audience || "";
  const isAuth0 = p?.type === "auth0";
  $("p-auth0").classList.toggle("hidden", !isAuth0);
  $("p-key-label").classList.toggle("hidden", isAuth0);
  editorModels = null;
  $("p-models-status").textContent = "";
  $("editor").classList.remove("hidden");
  $("editor").scrollIntoView({ behavior: "smooth" });
  if (!isAuth0 && p?.id && p?.type === "openai" && p?.baseUrl) fetchEditorModels();
}

function closeEditor() {
  $("editor").classList.add("hidden");
  editingId = null;
}

async function fetchEditorModels({ openMenu = false } = {}) {
  const status = $("p-models-status");
  const key = $("p-key").value.trim();
  const useSaved = Boolean(editingId) && key === MASK;
  if (editorModels) {
    status.textContent = `${editorModels.length} modelos — clique em Buscar modelos para escolher`;
    if (openMenu) openModelMenu($("p-fetch-models"), editorModels, $("p-model").value.trim(), (id) => ($("p-model").value = id), "editor");
    return;
  }
  status.textContent = "Buscando modelos…";
  status.className = "hint";
  const r = useSaved
    ? await daemonFetch("/models?provider=" + encodeURIComponent(editingId))
    : await daemonFetch("/models", "POST", { baseUrl: $("p-base").value.trim(), apiKey: key });
  if (r.ok && r.data.ok) {
    editorModels = r.data.models || [];
    status.textContent = `${editorModels.length} modelos disponíveis`;
    if (openMenu) openModelMenu($("p-fetch-models"), editorModels, $("p-model").value.trim(), (id) => ($("p-model").value = id), "editor");
  } else {
    status.textContent = "Falhou: " + (r.data.error || "HTTP " + r.status);
    status.className = "bad";
  }
}

$("p-fetch-models").addEventListener("click", () => fetchEditorModels({ openMenu: true }));

$("preset").addEventListener("change", () => {
  const v = $("preset").value;
  const isAuth0 = v === "auth0";
  $("p-auth0").classList.toggle("hidden", !isAuth0);
  $("p-key-label").classList.toggle("hidden", isAuth0);
  editorModels = null;
  $("p-models-status").textContent = "";
  if (PRESETS[v]) {
    $("p-name").value = PRESETS[v].name;
    $("p-base").value = PRESETS[v].baseUrl;
    $("p-model").value = PRESETS[v].model;
    if (KEYLESS_PRESETS.has(v)) fetchEditorModels();
  }
});

$("p-save").addEventListener("click", async () => {
  const isAuth0 = !$("p-auth0").classList.contains("hidden");
  const provider = {
    id: editingId || ("prov-" + Math.random().toString(36).slice(2, 10)),
    name: $("p-name").value.trim() || "Provedor",
    type: isAuth0 ? "auth0" : "openai",
    baseUrl: $("p-base").value.trim(),
    model: $("p-model").value.trim(),
    apiKey: isAuth0 ? "" : cleanSecret($("p-key").value),
    auth0: isAuth0
      ? {
          domain: $("p-domain").value.trim(),
          clientId: $("p-client-id").value.trim(),
          clientSecret: cleanSecret($("p-client-secret").value),
          audience: $("p-audience").value.trim(),
        }
      : null,
  };
  const old = editingId ? providers.find((p) => p.id === editingId) : null;
  if (!isAuth0 && !provider.apiKey && old?.hasKey) provider.apiKey = MASK;
  if (isAuth0 && !provider.auth0.clientSecret && old?.auth0?.clientSecret) {
    provider.auth0.clientSecret = MASK;
  }
  providers = editingId ? providers.map((p) => (p.id === editingId ? provider : p)) : [...providers, provider];
  if (!activeProvider) activeProvider = provider.id;
  const saved = await putConfig();
  if (saved) closeEditor();
});

$("p-cancel").addEventListener("click", closeEditor);
document.querySelectorAll(".eye-btn").forEach(wireEye);
stripMaskOnInput($("p-key"));
stripMaskOnInput($("p-client-secret"));
$("add-provider").addEventListener("click", () => openEditor(null));
$("active-provider").addEventListener("change", () => setActive($("active-provider").value || null));
$("connect").addEventListener("click", connect);

$("mic-permission").addEventListener("click", async () => {
  const el = $("mic-result");
  el.textContent = "…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    el.textContent = "Microfone permitido";
    el.className = "ok";
  } catch (e) {
    el.textContent = "Negado: " + (e?.message || e);
    el.className = "bad";
  }
});

async function maybeMigrateLegacy() {
  if (providers.some((p) => p.hasKey || p.type === "auth0")) return;
  const data = await chrome.storage.local.get(["assistConfig"]);
  const legacy = data.assistConfig?.provider;
  if (!legacy?.apiKey) return;
  const migrated = {
    id: "migrado-" + Math.random().toString(36).slice(2, 8),
    name: legacy.name || "Gemini (migrado)",
    type: "openai",
    baseUrl: legacy.baseUrl || PRESETS.gemini.baseUrl,
    model: legacy.model || PRESETS.gemini.model,
    apiKey: legacy.apiKey,
    auth0: null,
  };
  providers = [...providers, migrated];
  activeProvider = migrated.id;
  const okSaved = await putConfig();
  if (okSaved) {
    const el = $("migrate-note");
    el.classList.remove("hidden");
    el.textContent = "Chave antiga migrada para o daemon como \"" + migrated.name + "\".";
  }
}

(async () => {
  await loadBridge();
  if (creds.token) await connect();
})();
