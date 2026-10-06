// Extração tolerante do JSON de preenchimento na resposta da IA — puro, sem DOM.

export function extractJsonObj(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseFillsJson(text) {
  const obj = extractJsonObj(text);
  const fills = obj && (obj.fills || obj.preenchimentos || obj.values);
  if (!Array.isArray(fills)) return null;
  const out = [];
  for (const f of fills) {
    if (!f || typeof f !== "object") continue;
    const i = Number(f.i ?? f.index ?? f.indice ?? f.indice);
    if (!Number.isInteger(i) || i < 0 || i > 999) continue;
    let value = f.value ?? f.valor ?? f.val;
    if (value === undefined || value === null) {
      if (typeof f.checked === "boolean") value = f.checked ? "true" : "false";
      else continue;
    }
    out.push({ i, value: String(value) });
  }
  return out.length ? out : null;
}
