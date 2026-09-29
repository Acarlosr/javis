// Fontes de contexto: página, intenção de chat do Discord e prompts do YouTube.

import { externalContent, partialNote } from "./text.js";

export const discordCap = (days) =>
  days <= 1 ? 80000 : days <= 14 ? 120000 : days <= 30 ? 180000 : 200000;

export async function askPage(question) {
  const r = await chrome.runtime.sendMessage({ type: "getPageContext" });
  if (!r?.ok) throw new Error(r?.error || "não foi possível ler a página");
  const c = r.context;
  return {
    note: c.title + (c.truncated ? partialNote(c.limit || 20000, c.totalChars || c.text.length) : ""),
    prompt: `Contexto da página "${c.title}" (${c.url}):\n\n${externalContent(c.text)}\n\nTarefa: ${question}`,
  };
}

export function parseChatIntent(text) {
  const t = text.toLowerCase();
  const chatish = /resum|resuma|resumo|hist[oó]rico|aconteceu|foi falado|foi dito|rolou|discutido/.test(t);
  const chatRef = /\bchat\b|\bconversa\b|\bcanal\b|discord|\bmensagens\b/.test(t);
  if (!chatish) return null;
  let days = null;
  const dias = t.match(/(\d+)\s*(?:dias|dia)\b/);
  const semanas = t.match(/(\d+)\s*semanas?\b/);
  const meses = t.match(/(\d+)\s*meses?\b/);
  const horas = t.match(/(\d+)\s*(?:horas|hora|hs)\b/);
  if (dias) days = Number(dias[1]);
  else if (semanas) days = Number(semanas[1]) * 7;
  else if (meses) days = Number(meses[1]) * 30;
  else if (horas) days = Math.max(1, Math.ceil(Number(horas[1]) / 24));
  else if (/quinze dias|quinzena/.test(t)) days = 15;
  else if (/\bhoje\b|\bontem\b|\b24\s*h/.test(t)) days = 1;
  else if (/\bsemana\b/.test(t)) days = 7;
  else if (/\bm[êe]s\b|mensal/.test(t)) days = 30;
  const isDiscordish = chatRef || days !== null;
  if (!isDiscordish) return null;
  days = days === null ? 14 : Math.min(Math.max(days, 1), 90);
  return days;
}

export async function autoCollectDiscord(prompt) {
  const days = parseChatIntent(prompt);
  if (days === null) return null;
  const info = await chrome.runtime.sendMessage({ type: "getTabInfo" });
  if (!info?.ok || !/discord\.com/.test(info.url || "")) return null;
  const r = await chrome.runtime.sendMessage({ type: "collectDiscord", days });
  if (!r?.ok || !r.messages?.length) {
    throw new Error(
      r?.error || "não encontrei mensagens no período — role um pouco o chat e tente de novo"
    );
  }
  const cap = discordCap(days);
  const joined = r.messages.map((m) => `[${m.time || "?"}] ${m.author}: ${m.text}`).join("\n");
  const convo = joined.slice(0, cap);
  const periodLabel = days === 1 ? "24 horas" : `${days} dias`;
  return {
    note: `${r.channel || "canal"} — ${r.count} mensagens (${periodLabel})${joined.length > cap ? partialNote(cap, joined.length) : ""}`,
    prompt: `Mensagens do canal Discord "${r.channel}" (últimos ${periodLabel}):\n\n${externalContent(convo)}\n\nTarefa: ${prompt}`,
  };
}

export function youtubePrompt(style) {
  const prompts = {
    padrao: {
      label: "Resumir vídeo",
      ask: "Resuma este vídeo: principais ideias, conclusões e algo prático para aplicar.",
      task: "resumo com principais ideias, conclusões e algo prático para aplicar",
    },
    topicos: {
      label: "Vídeo por tópicos",
      ask: "Resuma este vídeo por tópicos: seções bem separadas, com os pontos mais importantes de cada uma.",
      task: "resumo por tópicos, com seções bem separadas e os pontos mais importantes de cada uma",
    },
    indice: {
      label: "Índice do vídeo",
      ask: "Crie um índice dos principais assuntos deste vídeo usando os marcadores [MM:SS] da transcrição, no formato '[MM:SS] Assunto — descrição em uma linha', em ordem cronológica.",
      task:
        "índice cronológico dos principais assuntos, um por linha, no formato '[MM:SS] Assunto — descrição em uma linha', usando os marcadores [MM:SS] da transcrição",
    },
  };
  return prompts[style] || prompts.padrao;
}
