// Seleção de área para o print: overlay de arrasto sobre a página.
// Resolve { ok, rect: {x, y, w, h} em CSS px, dpr } — o recorte é feito no background.

globalThis.__anShotPick = () =>
  new Promise((resolve) => {
    let dragging = false;
    let sx = 0;
    let sy = 0;

    const overlay = document.createElement("div");
    const box = document.createElement("div");
    const label = document.createElement("div");
    const hint = document.createElement("div");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      background: "rgba(0, 0, 0, 0.18)",
      userSelect: "none",
      touchAction: "none",
    });
    Object.assign(box.style, {
      position: "fixed",
      display: "none",
      border: "2px solid #7b8cff",
      boxShadow: "0 0 0 100000px rgba(0, 0, 0, 0.35)",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    Object.assign(label.style, {
      position: "fixed",
      display: "none",
      background: "#1e1f24",
      color: "#e8e9ee",
      font: "12px/1.4 -apple-system, 'Segoe UI', Roboto, sans-serif",
      padding: "3px 7px",
      borderRadius: "6px",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    Object.assign(hint.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#1e1f24",
      color: "#e8e9ee",
      font: "13px/1.4 -apple-system, 'Segoe UI', Roboto, sans-serif",
      padding: "8px 14px",
      borderRadius: "999px",
      zIndex: "2147483647",
      boxShadow: "0 6px 24px rgba(0, 0, 0, 0.4)",
      whiteSpace: "nowrap",
    });
    hint.textContent = "Arraste para selecionar a área do print — ESC cancela";
    overlay.append(box, label, hint);
    document.documentElement.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
      window.removeEventListener("keydown", onKey, true);
      overlay.removeEventListener("pointermove", onMove);
      overlay.removeEventListener("pointerup", onUp);
      overlay.removeEventListener("pointercancel", onLost);
    };
    const cancel = (error) => {
      cleanup();
      resolve({ ok: false, error: error || "seleção cancelada" });
    };
    const done = (rect) => {
      cleanup();
      resolve({ ok: true, rect, dpr: window.devicePixelRatio || 1 });
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    const onLost = () => {
      if (dragging) cancel("seleção interrompida — tente de novo");
      else cancel();
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        overlay.setPointerCapture(e.pointerId);
      } catch {}
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      overlay.style.background = "transparent";
      overlay.addEventListener("pointermove", onMove);
      overlay.addEventListener("pointerup", onUp);
      overlay.addEventListener("pointercancel", onLost);
    };
    const onMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const x = Math.min(sx, e.clientX);
      const y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      Object.assign(box.style, {
        display: "block",
        left: x + "px",
        top: y + "px",
        width: w + "px",
        height: h + "px",
      });
      Object.assign(label.style, {
        display: "block",
        left: x + "px",
        top: Math.max(2, y - 26) + "px",
      });
      label.textContent = w + " × " + h;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      e.preventDefault();
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      if (w < 4 || h < 4) {
        cancel("área muito pequena — arraste um retângulo maior");
        return;
      }
      done({
        x: Math.min(sx, e.clientX),
        y: Math.min(sy, e.clientY),
        w,
        h,
      });
    };

    overlay.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  });
