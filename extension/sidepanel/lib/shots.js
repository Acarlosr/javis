// Print de tela: captura (toda ou área selecionada), anexo pendente e download.

let pending = null;
const DEFAULT_PLACEHOLDER = "Pergunte sobre esta página…";

export function hasPendingImage() {
  return Boolean(pending);
}

export function takePendingImage() {
  const p = pending;
  clearPending();
  return p;
}

export function clearPending() {
  pending = null;
  const bar = document.getElementById("attach-bar");
  if (bar) bar.classList.add("hidden");
  const input = document.getElementById("input");
  if (input) input.placeholder = DEFAULT_PLACEHOLDER;
}

export function setPendingImage(dataUrl) {
  pending = dataUrl;
  const bar = document.getElementById("attach-bar");
  const img = bar.querySelector("img");
  img.src = dataUrl;
  img.onclick = () => chrome.tabs.create({ url: dataUrl });
  bar.classList.remove("hidden");
  const input = document.getElementById("input");
  input.placeholder = "Pergunte sobre o print…";
  input.focus();
}

export function downloadShot(dataUrl) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download =
    "javis-print-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function captureShot(mode) {
  const r = await chrome.runtime.sendMessage({ type: "captureShot", mode });
  if (!r?.ok) throw new Error(r?.error || "falha na captura");
  setPendingImage(r.image);
}
