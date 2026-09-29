if (globalThis.__anLiveVideoState === undefined) globalThis.__anLiveVideoState = null;
globalThis.__anLiveVideo = async (action, chunkMs = 5000) => {
  const send = (msg) => {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {}
  };
  const findActiveVideo = () => {
    const found = [];
    const walk = (root) => {
      for (const v of root.querySelectorAll("video")) found.push(v);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          for (const v of el.shadowRoot.querySelectorAll("video")) found.push(v);
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
    if (!found.length) return null;
    const playing = found.filter((v) => !v.paused && !v.ended && v.readyState > 2);
    if (playing.length) return playing[0];
    return (
      [...found].sort(
        (a, b) => (b.videoWidth || 0) * (b.videoHeight || 0) - (a.videoWidth || 0) * (a.videoHeight || 0)
      )[0] || found[0]
    );
  };
  const toB64 = (blob) =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => resolve("");
      r.readAsDataURL(blob);
    });
  const pickRecorder = (stream) => {
    const mimes = [];
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimes.push("audio/webm;codecs=opus");
    if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mimes.push("audio/ogg;codecs=opus");
    mimes.push("");
    for (const mime of mimes) {
      try {
        return new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch (e) {}
    }
    return null;
  };
  const startRecorder = (state) => {
    const rec = pickRecorder(state.stream);
    if (!rec) {
      state.active = false;
      send({ type: "liveVideoError", message: "gravador não criado nesta página" });
      return null;
    }
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    rec.onerror = () => {
      if (rec.state === "recording") {
        try { rec.stop(); } catch {}
      }
    };
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (state.active) {
        if (state.tracks[0]?.readyState !== "live") {
          state.active = false;
          send({ type: "liveVideoError", message: "a faixa de áudio do vídeo terminou — reinicie a Live" });
          return;
        }
        state.rec = startRecorder(state);
        if (!state.rec) return;
      }
      if (blob.size) {
        const b64 = await toB64(blob);
        let ok = false;
        try {
          ok = (await chrome.runtime.sendMessage({ type: "liveVideoChunk", b64, mime: blob.type }))?.ok === true;
        } catch {}
        if (!ok) {
          state.fails = (state.fails || 0) + 1;
          if (state.fails >= 3) {
            state.active = false;
            try { if (state.rec?.state === "recording") state.rec.stop(); } catch {}
            try { state.stream?.getTracks().forEach((t) => t.stop()); } catch {}
            if (globalThis.__anLiveVideoState === state) globalThis.__anLiveVideoState = null;
            return;
          }
        } else {
          state.fails = 0;
        }
      }
    };
    rec.start();
    setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, chunkMs);
    return rec;
  };

  if (action === "start") {
    if (globalThis.__anLiveVideoState) {
      const prev = globalThis.__anLiveVideoState;
      prev.active = false;
      try { if (prev.rec?.state === "recording") prev.rec.stop(); } catch {}
      try { prev.stream?.getTracks().forEach((t) => t.stop()); } catch {}
      globalThis.__anLiveVideoState = null;
    }
    const video = findActiveVideo();
    if (!video) {
      return { ok: false, error: "nenhum vídeo nesta aba — abra a página da aula e ative a Live de novo" };
    }
    if (video.paused) {
      return { ok: false, error: "o vídeo está pausado — dê play e ative a Live de novo" };
    }
    let stream = null;
    try {
      if (typeof video.captureStream === "function") stream = video.captureStream();
      else if (typeof video.mozCaptureStream === "function") stream = video.mozCaptureStream();
      if (!stream) throw new Error("captureStream indisponível neste navegador");
    } catch (e) {
      return {
        ok: false,
        error:
          "este player bloqueia a captura do áudio (" +
          String(e?.message || e) +
          ") — use Live (aba) no seletor da Live",
      };
    }
    const tracks = stream.getAudioTracks();
    if (!tracks.length) {
      return { ok: false, error: "o vídeo não expõe faixa de áudio — use Live (aba) no seletor da Live" };
    }
    const state = { active: true, video, tracks, stream: new MediaStream(tracks), rec: null };
    globalThis.__anLiveVideoState = state;
    state.rec = startRecorder(state);
    if (!state.rec) {
      globalThis.__anLiveVideoState = null;
      return { ok: false, error: "não foi possível iniciar a gravação nesta página" };
    }
    return { ok: true };
  }
  if (action === "stop") {
    const s = globalThis.__anLiveVideoState;
    globalThis.__anLiveVideoState = null;
    if (!s) return { ok: true };
    s.active = false;
    try { if (s.rec?.state === "recording") s.rec.stop(); } catch {}
    try { s.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    return { ok: true };
  }
  return { ok: false, error: "ação desconhecida" };
};
