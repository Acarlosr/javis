// Leitura e preenchimento seguro de formulários.
// collect: lista campos visíveis com rótulos, tipos e opções.
// apply: aplica os valores escolhidos pela IA — nunca submete, nunca preenche senha.

const SKIP_TYPES = new Set(["submit", "button", "reset", "file", "image", "hidden", "range", "color"]);
const MAX_FIELDS = 60;
const CHECK_TRUE = /^(true|1|sim|yes|on|marc[ao]do?)$/i;

function fieldLabel(el) {
  const lbl = Array.from(el.labels || []).find((l) => (l.innerText || "").trim());
  if (lbl) return lbl.innerText.trim().slice(0, 80);
  const wrap = el.closest("label");
  if (wrap && (wrap.innerText || "").trim()) return wrap.innerText.trim().slice(0, 80);
  const forId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  if (forId && (forId.innerText || "").trim()) return forId.innerText.trim().slice(0, 80);
  return (
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    el.name ||
    ""
  ).trim();
}

function isVisible(el) {
  return Boolean(el.getClientRects().length) && !el.disabled && !el.readOnly;
}

function collectFields() {
  const els = Array.from(document.querySelectorAll("input, textarea, select"));
  const fields = [];
  const seenRadios = new Set();
  for (const el of els) {
    if (fields.length >= MAX_FIELDS) break;
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      if (SKIP_TYPES.has(t)) continue;
      if (t === "radio") {
        if (!el.name || seenRadios.has(el.name)) continue;
        seenRadios.add(el.name);
        const opts = Array.from(
          document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)
        )
          .map((r) => r.value)
          .filter(Boolean)
          .slice(0, 12);
        fields.push({
          el,
          i: fields.length,
          kind: "radio",
          label: fieldLabel(el) || el.name,
          name: el.name,
          required: Boolean(el.required),
          options: opts,
          current: (el.form?.elements[el.name]?.value || "").slice(0, 40),
        });
        continue;
      }
      if (t === "checkbox") {
        fields.push({
          el,
          i: fields.length,
          kind: "checkbox",
          label: fieldLabel(el),
          name: el.name || "",
          required: Boolean(el.required),
          current: el.checked ? "marcado" : "",
        });
        continue;
      }
      fields.push({
        el,
        i: fields.length,
        kind: t === "password" ? "senha" : "texto",
        type: t,
        label: fieldLabel(el),
        name: el.name || "",
        required: Boolean(el.required),
        current: (el.value || "").slice(0, 60),
      });
      continue;
    }
    if (tag === "textarea") {
      fields.push({
        el,
        i: fields.length,
        kind: "texto",
        label: fieldLabel(el),
        name: el.name || "",
        required: Boolean(el.required),
        current: (el.value || "").slice(0, 60),
      });
      continue;
    }
    const opts = Array.from(el.options || [])
      .map((o) => o.text || o.value)
      .filter(Boolean)
      .slice(0, 30);
    fields.push({
      el,
      i: fields.length,
      kind: "select",
      label: fieldLabel(el),
      name: el.name || "",
      required: Boolean(el.required),
      options: opts,
      current: (el.selectedOptions?.[0]?.text || "").slice(0, 40),
    });
  }
  globalThis.__anFormsState = { fields };
  return {
    ok: true,
    count: fields.length,
    truncated: fields.length >= MAX_FIELDS,
    fields: fields.map(({ el, ...rest }) => rest),
  };
}

function setNativeValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

function fire(el) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyFill(items, expected) {
  const state = globalThis.__anFormsState;
  if (!state?.fields?.length) {
    return { ok: false, error: "leia os campos antes de preencher — tente de novo" };
  }
  if (Number.isInteger(expected) && state.fields.length !== expected) {
    return { ok: false, error: "os campos da página mudaram desde a leitura — tente preencher de novo" };
  }
  const filled = [];
  const skipped = [];
  let firstEl = null;
  for (const it of Array.isArray(items) ? items : []) {
    const f = state.fields[Number(it?.i)];
    if (!f) {
      skipped.push({ label: "#" + it?.i, reason: "campo não encontrado" });
      continue;
    }
    const el = f.el;
    const name = f.label || f.name || el.name || "campo";
    try {
      if (f.kind === "senha") {
        skipped.push({ label: name, reason: "por segurança, não preencho senhas" });
        continue;
      }
      if (f.kind === "checkbox") {
        const on = CHECK_TRUE.test(String(it.value).trim());
        if (el.checked !== on) {
          el.checked = on;
          fire(el);
        }
        filled.push(name);
      } else if (f.kind === "radio") {
        const want = String(it.value).trim().toLowerCase();
        const group = Array.from(
          document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)
        );
        const hit =
          group.find((r) => (r.value || "").trim().toLowerCase() === want) ||
          group.find((r) => (Array.from(r.labels || [])[0]?.innerText || "").trim().toLowerCase() === want);
        if (!hit) {
          skipped.push({ label: name, reason: `opção "${it.value}" não encontrada` });
          continue;
        }
        if (!hit.checked) {
          hit.checked = true;
          fire(hit);
        }
        filled.push(name);
      } else if (f.kind === "select") {
        const want = String(it.value).trim().toLowerCase();
        const opts = Array.from(el.options || []);
        const opt =
          opts.find((o) => (o.text || "").trim().toLowerCase() === want) ||
          opts.find((o) => (o.value || "").trim().toLowerCase() === want) ||
          (want ? opts.find((o) => (o.text || "").toLowerCase().includes(want)) : null);
        if (!opt) {
          skipped.push({ label: name, reason: `opção "${it.value}" não existe` });
          continue;
        }
        if (el.selectedIndex !== opt.index) {
          el.selectedIndex = opt.index;
          fire(el);
        }
        filled.push(name);
      } else {
        const value = String(it.value ?? "");
        if (el.maxLength > 0 && value.length > el.maxLength) {
          skipped.push({ label: name, reason: "valor maior que o limite do campo" });
          continue;
        }
        setNativeValue(el, value);
        fire(el);
        filled.push(name);
      }
      el.style.outline = "2px solid #4ad07a";
      setTimeout(() => (el.style.outline = ""), 2500);
      if (!firstEl) firstEl = el;
    } catch (e) {
      skipped.push({ label: name, reason: "não aceitou o valor" });
    }
  }
  if (firstEl) firstEl.scrollIntoView({ block: "center", behavior: "smooth" });
  return { ok: true, filled, skipped };
}

globalThis.__anForms = (cmd, arg, expected) => {
  if (cmd === "apply") return applyFill(arg, expected);
  return collectFields();
};
