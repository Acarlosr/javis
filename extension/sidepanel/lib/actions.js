// Ações rápidas e roteamento de intenções em linguagem natural.

import { state } from "./state.js";
import { $, addMsg, setBusy } from "./ui.js";
import { send } from "./chat.js";
import { isLiveActive, startLive, stopLive } from "./live.js";
import { askPage, autoCollectDiscord, youtubePrompt, discordCap } from "./context.js";
import { partialNote, externalContent } from "./text.js";

export function runPageSummary() {
  send("Resuma esta página em tópicos claros, com os pontos mais importantes primeiro.", {
    label: "Resumir página atual",
    onContext: () => askPage("resumo em tópicos"),
  });
}

export function runVideo(style) {
  const p = youtubePrompt(style);
  send(p.ask, {
    label: p.label,
    onContext: async () => {
      let info = null;
      try {
        info = await chrome.runtime.sendMessage({ type: "getTabInfo" });
      } catch {}
      const isYoutube = /youtube\.com\/(watch|shorts|live)|youtu\.be\//.test(info?.url || "");
      const r = await chrome.runtime.sendMessage({
        type: isYoutube ? "getYoutubeTranscript" : "getVideoContext",
      });
      if (!r?.ok) {
        throw new Error(
          r?.error ||
            (isYoutube ? "falha no YouTube" : "falha ao ler o vídeo desta página")
        );
      }
      const note =
        r.title +
        (r.hasCaptions ? ` (${r.lang || "?"})` : " — sem legendas") +
        (r.truncated ? partialNote(r.limit || 60000, r.totalChars || (r.transcript || "").length) : "");
      return {
        note,
        prompt: `Transcrição do vídeo "${r.title}":\n\n${externalContent(r.transcript || "(vazia)")}\n\nTarefa: ${p.task}.`,
      };
    },
  });
}

export async function runSelTrans(target) {
  target = target === "en" ? "en" : "pt";
  if (state.busy) return;
  setBusy(true);
  $("seltrans-btn").textContent = "Traduzindo…";
  try {
    const r = await chrome.runtime.sendMessage({
      type: "getSelectionTranslate",
      target,
    });
    if (!r?.ok) throw new Error(r?.error || "falha na tradução da seleção");
    addMsg("ai", r.text, `seleção da página → ${target === "en" ? "EN" : "PT-BR"}`);
  } catch (e) {
    addMsg("err", "seleção: " + (e?.message || e));
  } finally {
    setBusy(false);
    $("seltrans-btn").textContent = "Traduzir seleção";
  }
}

export function runTranslatePage() {
  send("Traduza o conteúdo da página para português brasileiro, mantendo nomes e termos técnicos.", {
    label: "Página → PT-BR (inteira)",
    onContext: () => askPage("traduza o texto para PT-BR, preservando estrutura e termos técnicos"),
  });
}

function runDiscord(days) {
  const periodLabel = days === 1 ? "24h" : `${days} dias`;
  send(
    days === 1
      ? "Resuma o que aconteceu nas últimas 24 horas neste canal."
      : `Resuma o que aconteceu nos últimos ${days} dias neste canal.`,
    {
      label: `Discord: ${periodLabel}`,
      onContext: async () => {
        const r = await chrome.runtime.sendMessage({ type: "collectDiscord", days });
        if (!r?.ok) throw new Error(r?.error || "falha no Discord");
        if (!r.messages?.length) throw new Error("nenhuma mensagem encontrada no período");
        const cap = discordCap(days);
        const joined = r.messages.map((m) => `[${m.time || "?"}] ${m.author}: ${m.text}`).join("\n");
        const convo = joined.slice(0, cap);
        return {
          note: `${r.channel || "canal"} — ${r.count} mensagens${joined.length > cap ? partialNote(cap, joined.length) : ""}`,
          prompt: `Mensagens do canal Discord "${r.channel}" (últimos ${periodLabel}):\n\n${externalContent(convo)}\n\nTarefa: resumo organizado por assuntos, decisões tomadas e pendências, citando quem participou.`,
        };
      },
    }
  );
}

export function detectIntent(text) {
  const t = text.toLowerCase();
  if (/\b(live|ao vivo|transcrever)\b/.test(t) && !/(resum|hist[óo]ri|traduz|discord|youtube)/.test(t)) {
    const src = /(mic|microf|microfone)/.test(t)
      ? "mic"
      : /(v[íi]deo|aula|curso|player)/.test(t)
        ? "video"
        : "tab";
    const lang = /(portugu|em pt|\bpt\b|\bbr\b|português)/.test(t) ? "pt" : "en";
    return { type: "live", stop: /(par[ae]|stop|encerrar|desligar|cancelar|pausar)/.test(t), src, lang };
  }
  if (/(traduz|tradu[cç][ãa]o)/.test(t) && /(sele|isso|trecho|selecion)/.test(t)) {
    const target = /(ingl[êe]s|\ben\b|english)/.test(t) ? "en" : "pt";
    return { type: "seltrans", target };
  }
  if (/(youtube|\bv[íi]deos?\b)/.test(t) && /(resum|t[óo]picos|índice|indice|pontos|sobre|explique|o que)/.test(t)) {
    const style = /(índice|indice|tempos|timestamps)/.test(t)
      ? "indice"
      : /t[óo]picos/.test(t)
        ? "topicos"
        : "padrao";
    return { type: "youtube", style };
  }
  if (/(resum|sumariz)/.test(t) && /(p[áa]gina|site|artigo)/.test(t) && !/(youtube|v[íi]deo)/.test(t)) {
    return { type: "page" };
  }
  if (/(traduz|tradu[cç][ãa]o)/.test(t) && /(p[áa]gina|site|conte[úu]do|tudo)/.test(t)) {
    return { type: "translate" };
  }
  return null;
}

export function dispatch(text) {
  const it = detectIntent(text);
  if (it?.type === "live") {
    if (it.stop) {
      if (isLiveActive()) stopLive();
    } else {
      startLive(it.src, it.lang);
    }
    return;
  }
  if (it?.type === "seltrans") {
    runSelTrans(it.target);
    return;
  }
  if (it?.type === "youtube") {
    runVideo(it.style);
    return;
  }
  if (it?.type === "page") {
    runPageSummary();
    return;
  }
  if (it?.type === "translate") {
    runTranslatePage();
    return;
  }
  send(text);
}

export function initActions() {
  const actionsMenu = $("actions-menu");
  $("btn-actions").addEventListener("click", () => actionsMenu.classList.toggle("hidden"));
  document.addEventListener("mousedown", (e) => {
    if (actionsMenu.contains(e.target) || e.target.closest?.("#btn-actions")) return;
    actionsMenu.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !actionsMenu.classList.contains("hidden")) actionsMenu.classList.add("hidden");
  });

  document.querySelectorAll("#actions-menu [data-action]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const action = chip.dataset.action;
      actionsMenu.classList.add("hidden");
      if (action === "page") runPageSummary();
      else if (action === "youtube") runVideo($("yt-style").value || "padrao");
      else if (action === "live") {
        if (isLiveActive()) {
          stopLive();
          return;
        }
        const cfg = ($("live-src").value || "video:en").split(":");
        startLive(cfg[0] || "video", cfg[1] || "en");
      } else if (action === "discord") {
        runDiscord(Number($("discord-days").value || 14));
      } else if (action === "seltrans") {
        runSelTrans($("sel-lang").value || "pt");
      } else if (action === "translate") {
        runTranslatePage();
      }
    });
  });
}
