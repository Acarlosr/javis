// Camada de interface: mensagens do log, overlays e estado visual de ocupado.

import { plain } from "./text.js";
import { state } from "./state.js";

export const $ = (id) => document.getElementById(id);

export function addMsg(role, text, extra) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (extra) {
    const c = document.createElement("div");
    c.className = "ctx";
    c.textContent = extra;
    div.appendChild(c);
  }
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  div.appendChild(body);
  if (role === "ai") {
    div.dataset.raw = text || "";
    const acts = document.createElement("div");
    acts.className = "acts";
    const copy = document.createElement("button");
    copy.textContent = "copiar";
    copy.onclick = () => navigator.clipboard.writeText(div.dataset.raw || body.textContent);
    const md = document.createElement("button");
    md.textContent = "baixar .md";
    md.onclick = () => downloadMd(div.dataset.raw || body.textContent);
    acts.append(copy, md);
    div.appendChild(acts);
  }
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
  return div;
}

export function downloadMd(text) {
  const blob = new Blob([text || ""], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    "assistente-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function aiBody(div) {
  return div.querySelector(".body");
}

export function setBusy(b) {
  state.busy = b;
  $("send").disabled = b;
  $("mic").disabled = b;
  document.querySelectorAll(".chip").forEach((c) => (c.disabled = b));
}

export function resetLog() {
  const log = $("log");
  log.innerHTML = "";
  const w = document.createElement("div");
  w.className = "welcome";
  w.innerHTML =
    "<h1>Javis</h1><p>Seu mordomo de IA no navegador — pergunte ou use uma ação rápida:</p>";
  log.appendChild(w);
}

export function showSetup(msg) {
  $("status-dot").classList.remove("ok");
  $("setup-msg").textContent = msg;
  $("setup").classList.remove("hidden");
  const sel = $("provider-select");
  sel.innerHTML = "";
  sel.append(new Option("modo teste", ""));
}
