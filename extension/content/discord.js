globalThis.__anDiscord = async (days = 14) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CSS_ID = "an-collector-css";
  if (!document.getElementById(CSS_ID)) {
    const st = document.createElement("style");
    st.id = CSS_ID;
    st.textContent =
      ".an-flash{outline:2px solid #7b8cff !important;outline-offset:-2px;border-radius:8px;transition:outline-color .5s}" +
      "#an-collector-badge{position:fixed;right:24px;bottom:24px;z-index:2147483647;background:#4c5bd4;color:#fff;" +
      "font:600 13px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;padding:10px 14px;border-radius:10px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:320px}";
    document.documentElement.appendChild(st);
  }
  const ensureBadge = () => {
    let b = document.getElementById("an-collector-badge");
    if (!b) {
      b = document.createElement("div");
      b.id = "an-collector-badge";
      (document.body || document.documentElement).appendChild(b);
    }
    return b;
  };
  const removeBadge = () => document.getElementById("an-collector-badge")?.remove();

  const scroller = Array.from(document.querySelectorAll('main [class*="scroller"]')).find(
    (el) => el.scrollHeight > el.clientHeight && el.querySelector('[data-list-item-id^="chat-messages"]')
  );
  if (!scroller) {
    removeBadge();
    return { messages: [], error: "chat não encontrado — abra um canal e role até ver mensagens" };
  }
  const cutoff = Date.now() - days * 86400000;
  const seen = new Map();
  let lastNew = null;
  const collect = () => {
    let newest = null;
    document.querySelectorAll('[data-list-item-id^="chat-messages"]').forEach((el) => {
      const id = el.getAttribute("data-list-item-id");
      if (seen.has(id)) return;
      const timeEl = el.querySelector("time[datetime]");
      const ts = timeEl ? Date.parse(timeEl.getAttribute("datetime")) : null;
      const authorEl = el.querySelector('[class*="username"]');
      const author = authorEl ? authorEl.textContent.trim() : "?";
      const contentEl = el.querySelector('[id^="message-content"]');
      const text = contentEl ? contentEl.innerText.trim() : "";
      if (!text && !ts) return;
      seen.set(id, { id, author, text: text.slice(0, 2000), ts });
      newest = el;
    });
    if (newest && newest !== lastNew) {
      newest.classList.add("an-flash");
      setTimeout(() => newest.classList.remove("an-flash"), 700);
      lastNew = newest;
    }
  };
  const oldestTs = () => {
    let min = Infinity;
    for (const m of seen.values()) if (m.ts && m.ts < min) min = m.ts;
    return min === Infinity ? null : min;
  };
  const badge = ensureBadge();
  badge.textContent = days === 1 ? "Javis: coletando 24 horas…" : `Javis: coletando ${days} dias…`;
  let rounds = 0;
  let lastSize = -1;
  const maxRounds = days <= 1 ? 40 : days <= 30 ? 100 : 150;
  while (rounds < maxRounds) {
    collect();
    const oldest = oldestTs();
    if (oldest !== null && oldest < cutoff) break;
    if (seen.size === lastSize) break;
    lastSize = seen.size;
    const oldestTxt = oldest ? new Date(oldest).toLocaleDateString("pt-BR") : "…";
    badge.textContent = `Javis: ${seen.size} mensagens · chegou em ${oldestTxt}`;
    scroller.scrollTop = 0;
    await sleep(450);
    rounds++;
  }
  collect();
  const messages = Array.from(seen.values())
    .filter((m) => m.ts === null || m.ts >= cutoff)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const channel = document.querySelector('h1, [class*="title"]');
  badge.textContent = `Pronto: ${messages.length} mensagens coletadas`;
  setTimeout(removeBadge, 2500);
  return {
    messages: messages.map(({ author, text, ts }) => ({
      author,
      text,
      time: ts ? new Date(ts).toISOString() : null,
    })),
    count: messages.length,
    channel: channel ? channel.textContent.trim().slice(0, 80) : "",
  };
};
