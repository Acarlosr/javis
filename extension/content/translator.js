(() => {
  if (globalThis.__anTranslatorLoaded) return;
  globalThis.__anTranslatorLoaded = true;

  const CSS_ID = "an-translator-css";
  if (!document.getElementById(CSS_ID)) {
    const st = document.createElement("style");
    st.id = CSS_ID;
    st.textContent =
      ".an-tr-pill{position:fixed;z-index:2147483647;display:flex;gap:6px;background:#1e1f22;" +
      "border:1px solid #3f4147;border-radius:10px;padding:6px;box-shadow:0 6px 24px rgba(0,0,0,.5)}" +
      ".an-tr-pill button{appearance:none;border:0;background:#5865f2;color:#fff;" +
      "font:600 12px/1.2 -apple-system,'Segoe UI',Roboto,sans-serif;padding:7px 10px;border-radius:8px;cursor:pointer}" +
      ".an-tr-pill button:hover{background:#4752c4}" +
      ".an-tr-pill button.alt{background:#2b2d31;color:#dbdee1}" +
      ".an-tr-pill button.alt:hover{background:#35373c}" +
      ".an-tr-card{position:fixed;z-index:2147483647;width:460px;max-width:calc(100vw - 24px);" +
      "max-height:60vh;display:flex;flex-direction:column;background:#111214;border:1px solid #3f4147;" +
      "border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#dbdee1;" +
      "font:400 13px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden}" +
      ".an-tr-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;" +
      "border-bottom:1px solid #2b2d31;font:600 12px/1.2 -apple-system,'Segoe UI',Roboto,sans-serif;color:#fff}" +
      ".an-tr-close{background:transparent;border:0;color:#949ba4;font-size:14px;cursor:pointer;padding:2px 4px}" +
      ".an-tr-close:hover{color:#fff}" +
      ".an-tr-body{padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word}" +
      ".an-tr-body.err{color:#f2777a}" +
      ".an-tr-foot{display:flex;gap:8px;padding:8px 12px;border-top:1px solid #2b2d31}" +
      ".an-tr-foot button{appearance:none;border:1px solid #3f4147;background:#2b2d31;color:#dbdee1;" +
      "font:500 12px/1.2 -apple-system,'Segoe UI',Roboto,sans-serif;padding:6px 10px;border-radius:8px;cursor:pointer}" +
      ".an-tr-foot button:hover{background:#35373c}";
    document.documentElement.appendChild(st);
  }

  let pill = null;
  let card = null;
  let cardBody = null;
  let cardCopy = null;

  const removePill = () => {
    if (pill) {
      pill.remove();
      pill = null;
    }
  };
  const removeCard = () => {
    if (card) {
      card.remove();
      card = null;
    }
    cardBody = null;
    cardCopy = null;
  };

  function clampPos(left, top, w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - h - 8));
    return { left, top };
  }

  function showPill(anchor) {
    removePill();
    pill = document.createElement("div");
    pill.className = "an-tr-pill";
    const toPt = document.createElement("button");
    toPt.textContent = "→ PT-BR";
    const toEn = document.createElement("button");
    toEn.className = "alt";
    toEn.textContent = "→ EN";
    toPt.onmousedown = (e) => e.stopPropagation();
    toEn.onmousedown = (e) => e.stopPropagation();
    toPt.onclick = (e) => {
      e.stopPropagation();
      startTranslate(anchor, "pt");
    };
    toEn.onclick = (e) => {
      e.stopPropagation();
      startTranslate(anchor, "en");
    };
    pill.append(toPt, toEn);
    document.documentElement.appendChild(pill);
    const r = pill.getBoundingClientRect();
    let top = anchor.bottom + 6;
    if (top + r.height > window.innerHeight - 8) top = anchor.top - r.height - 6;
    const pos = clampPos(anchor.left, top, r.width, r.height);
    pill.style.left = pos.left + "px";
    pill.style.top = pos.top + "px";
  }

  function currentSelectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (text.length < 2) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text, rect, len: text.length };
  }

  function buildCard(anchor, target, loadingText) {
    removeCard();
    card = document.createElement("div");
    card.className = "an-tr-card";
    const head = document.createElement("div");
    head.className = "an-tr-head";
    const title = document.createElement("span");
    title.textContent = target === "en" ? "Tradução → EN" : "Tradução → PT-BR";
    const close = document.createElement("button");
    close.className = "an-tr-close";
    close.textContent = "×";
    close.onclick = (e) => {
      e.stopPropagation();
      removeCard();
    };
    head.append(title, close);
    const body = document.createElement("div");
    body.className = "an-tr-body";
    body.textContent = loadingText || "";
    const foot = document.createElement("div");
    foot.className = "an-tr-foot";
    const copy = document.createElement("button");
    copy.textContent = "copiar";
    copy.style.display = "none";
    copy.onclick = () => {
      navigator.clipboard.writeText(body.textContent).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = body.textContent;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      });
      copy.textContent = "copiado";
      setTimeout(() => (copy.textContent = "copiar"), 1400);
    };
    foot.append(copy);
    card.append(head, body, foot);
    document.documentElement.appendChild(card);
    const r = card.getBoundingClientRect();
    let top = anchor.bottom + 6;
    if (top + r.height > window.innerHeight - 8) top = anchor.top - r.height - 6;
    const pos = clampPos(anchor.left, top, r.width, r.height);
    card.style.left = pos.left + "px";
    card.style.top = pos.top + "px";
    cardBody = body;
    cardCopy = copy;
    return card;
  }

  async function startTranslate(anchor, target) {
    const sel = currentSelectionRect();
    if (!sel) {
      removePill();
      return;
    }
    const text = sel.text.slice(0, 10000);
    removePill();
    buildCard(anchor, target, "Traduzindo…");
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "anTranslate",
        text,
        target,
      });
      if (!card || !cardBody) return;
      if (!resp || !resp.ok) {
        cardBody.textContent = "Falha na tradução: " + (resp?.error || "sem resposta do daemon") +
          "\nVerifique se o daemon está rodando (npm start).";
        cardBody.classList.add("err");
        return;
      }
      cardBody.textContent = (resp.text || "").trim() || "(sem texto)";
      if (cardCopy) cardCopy.style.display = "";
    } catch (e) {
      if (cardBody) {
        cardBody.textContent = "Falha na tradução: " + (e?.message || e);
        cardBody.classList.add("err");
      }
    }
  }

  let selTimer = null;

  document.addEventListener(
    "mouseup",
    (e) => {
      if (e.target.closest?.(".an-tr-pill, .an-tr-card")) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = currentSelectionRect();
        if (!sel) {
          removePill();
          return;
        }
        if (card) return;
        showPill(sel.rect);
      }, 120);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.target.closest?.(".an-tr-pill, .an-tr-card")) return;
      removePill();
      if (card) removeCard();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        removePill();
        removeCard();
      }
    },
    true
  );

  window.addEventListener("scroll", removePill, true);
  window.addEventListener("blur", () => {
    removePill();
    removeCard();
  });
})();
