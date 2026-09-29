globalThis.__anVideo = async (maxChars = 120000) => {
  const findActiveMedia = () => {
    const found = [];
    const walk = (root) => {
      for (const v of root.querySelectorAll("video, audio")) found.push(v);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          for (const v of el.shadowRoot.querySelectorAll("video, audio")) found.push(v);
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

  const mmss = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  };

  try {
    const media = findActiveMedia();
    if (!media) {
      return {
        ok: false,
        error: "nenhum vídeo nesta aba — abra a página da aula e tente de novo",
      };
    }
    const tracks = [...(media.textTracks || [])].filter(
      (t) => t.kind === "captions" || t.kind === "subtitles" || !t.kind
    );
    if (!tracks.length) {
      return {
        ok: false,
        error:
          "sem legendas expostas neste player — use Live (vídeo da página) para transcrever o áudio com Whisper",
        videoFound: true,
      };
    }
    const loaded = [];
    for (const t of tracks) {
      if (t.mode === "disabled") {
        try {
          t.mode = "hidden";
        } catch {}
      }
      let cues = null;
      for (let i = 0; i < 20; i++) {
        if (t.cues && t.cues.length) {
          cues = t.cues;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cues && cues.length) loaded.push({ track: t, cues: [...cues] });
    }
    if (!loaded.length) {
      return {
        ok: false,
        error:
          "sem legendas expostas neste player — use Live (vídeo da página) para transcrever o áudio com Whisper",
        videoFound: true,
      };
    }
    const pick = (lang) => loaded.find((x) => (x.track.language || "").startsWith(lang));
    const best = pick("pt") || pick("en") || loaded[0];
    let text = "";
    let lastMark = -Infinity;
    for (const cue of best.cues) {
      const t = (cue.startTime || 0) * 1000;
      if (t - lastMark >= 20000) {
        text += `\n[${mmss(t)}] `;
        lastMark = t;
      }
      const line = String(cue.text || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) text += line + " ";
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) {
      return {
        ok: false,
        error:
          "sem legendas expostas neste player — use Live (vídeo da página) para transcrever o áudio com Whisper",
        videoFound: true,
      };
    }
    return {
      ok: true,
      transcript: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      totalChars: text.length,
      limit: maxChars,
      title: document.title,
      lang: best.track.language || "",
      site: location.hostname,
      hasCaptions: true,
    };
  } catch (e) {
    return { ok: false, error: "extração falhou: " + String(e?.message || e) };
  }
};
