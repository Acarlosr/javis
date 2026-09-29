// Histórico por seções: persistência, purga, renderização e troca de seção.

import { state } from "./state.js";
import { $, addMsg, resetLog } from "./ui.js";
import { plain } from "./text.js";

let sessions = [];
let curSessionId = null;
let curSessionCreated = 0;
let retainDays = 30;
const MAX_RETAIN_DAYS = 60;

function relDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toTimeString().slice(0, 5);
  if (d.toDateString() === now.toDateString()) return "hoje " + hm;
  if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) return "ontem " + hm;
  return d.toLocaleDateString("pt-BR") + " " + hm;
}

function sessionTitle() {
  const first =
    state.history.find((m) => m.role === "user")?.content || "";
  return (
    first.replace(/\s+/g, " ").trim().slice(0, 60) ||
    "seção de " + relDate(Date.now()).split(" ")[0]
  );
}

function purgeSessions() {
  const cutoff = Math.min(retainDays, MAX_RETAIN_DAYS) * 86400000;
  sessions = sessions.filter((s) => Date.now() - (s.updated || s.created || 0) <= cutoff);
  sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (sessions.length > 400) sessions = sessions.slice(0, 400);
}

async function persistSessions() {
  purgeSessions();
  try {
    await chrome.storage.local.set({ javisSessions: sessions });
  } catch {}
}

export async function upsertCurrent() {
  if (!state.history.length) return;
  const now = Date.now();
  if (!curSessionId) {
    curSessionId = "s" + now.toString(36) + Math.random().toString(36).slice(2, 6);
    curSessionCreated = now;
  }
  const existing = sessions.find((s) => s.id === curSessionId);
  if (existing) {
    existing.title = sessionTitle();
    existing.updated = now;
    existing.messages = state.history.slice();
  } else {
    sessions.unshift({
      id: curSessionId,
      title: sessionTitle(),
      created: curSessionCreated || now,
      updated: now,
      messages: state.history.slice(),
    });
  }
  await persistSessions();
  renderHistory();
}

export async function loadSessions() {
  try {
    const data = await chrome.storage.local.get(["javisSessions", "javisSettings"]);
    sessions = Array.isArray(data.javisSessions) ? data.javisSessions : [];
    retainDays = Number(data.javisSettings?.retainDays) || 30;
    $("hp-retain").value = String(retainDays);
    purgeSessions();
    renderHistory();
  } catch {}
}

export function renderHistory() {
  const list = $("hp-list");
  list.innerHTML = "";
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "hp-empty";
    empty.textContent = "Nenhuma seção guardada ainda. Use o + para começar novas seções.";
    list.appendChild(empty);
    return;
  }
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "hp-item" + (s.id === curSessionId ? " cur" : "");
    const main = document.createElement("div");
    main.className = "hp-main";
    const title = document.createElement("div");
    title.className = "hp-title";
    title.textContent = s.title || "seção";
    const meta = document.createElement("div");
    meta.className = "hp-meta";
    meta.textContent =
      relDate(s.updated || s.created || Date.now()) +
      " · " +
      Math.max(1, Math.ceil((s.messages?.length || 0) / 2)) +
      " mensagens";
    main.append(title, meta);
    const del = document.createElement("button");
    del.className = "hp-del";
    del.textContent = "×";
    del.title = "Apagar esta seção";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (state.busy) return;
      sessions = sessions.filter((x) => x.id !== s.id);
      if (s.id === curSessionId) {
        curSessionId = null;
        curSessionCreated = 0;
        state.history = [];
        resetLog();
      }
      await persistSessions();
      renderHistory();
    };
    item.append(main, del);
    item.onclick = () => {
      if (state.busy) return;
      openSession(s.id);
    };
    list.appendChild(item);
  }
}

export function newSection() {
  if (state.busy) return;
  upsertCurrent();
  curSessionId = null;
  curSessionCreated = 0;
  state.history = [];
  $("history-pop").classList.add("hidden");
  resetLog();
}

function openSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  curSessionId = s.id;
  curSessionCreated = s.created || Date.now();
  state.history = s.messages.slice();
  $("history-pop").classList.add("hidden");
  const log = $("log");
  log.innerHTML = "";
  for (const m of s.messages) {
    if (m.role === "user") {
      const t = m.content || "";
      addMsg("user", t.length > 300 ? t.slice(0, 300) + "…" : t);
    } else {
      addMsg("ai", plain(m.content || ""));
    }
  }
}

export async function setRetainDays(days) {
  retainDays = days || 30;
  await chrome.storage.local.set({ javisSettings: { retainDays } });
  purgeSessions();
  renderHistory();
}

export function initHistoryControls() {
  $("btn-new").addEventListener("click", newSection);
  $("btn-history").addEventListener("click", () => {
    const pop = $("history-pop");
    pop.classList.toggle("hidden");
    if (!pop.classList.contains("hidden")) renderHistory();
  });
  $("hp-retain").addEventListener("change", (e) => {
    setRetainDays(Number(e.target.value));
  });
  document.addEventListener("mousedown", (e) => {
    if ($("history-pop").contains(e.target) || e.target.closest?.("#btn-history")) return;
    $("history-pop").classList.add("hidden");
  });
}
