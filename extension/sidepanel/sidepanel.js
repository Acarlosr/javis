// Entrada do painel: boot, wiring dos controles globais e composer.

import { loadConfig } from "./lib/state.js";
import { loadSessions, initHistoryControls } from "./lib/sessions.js";
import { healthCheck, setActiveProvider } from "./lib/api.js";
import { $ } from "./lib/ui.js";
import { initVoice } from "./lib/voice.js";
import { initActions, dispatch } from "./lib/actions.js";
import { takePendingImage } from "./lib/shots.js";

const SHOT_AUTO_PROMPT =
  "Analise esta captura de tela: descreva o que vê e aponte o que for relevante.";

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("send").click();
  }
});
$("input").addEventListener("input", () => {
  $("input").style.height = "auto";
  $("input").style.height = Math.min($("input").scrollHeight, 120) + "px";
});

$("send").addEventListener("click", () => {
  const v = $("input").value.trim();
  const img = takePendingImage();
  if (!v && !img) return;
  $("input").value = "";
  $("input").style.height = "auto";
  const prompt = v || SHOT_AUTO_PROMPT;
  dispatch(prompt, img ? { image: img, label: v ? undefined : "print da tela" } : {});
});

$("btn-config").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("btn-setup").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("provider-select").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  await setActiveProvider(id);
  await healthCheck();
});

initHistoryControls();
initActions();
initVoice();

(async () => {
  await loadConfig();
  await loadSessions();
  await healthCheck();
})();
