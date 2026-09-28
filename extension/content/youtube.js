globalThis.__anYoutube = async (maxChars = 60000) => {
  const fail = (error) => ({ transcript: "", title: document.title, hasCaptions: false, error });
  try {
    const url = location.href;
    let videoId = null;
    const mWatch = url.match(/[?&]v=([\w-]{6,})/);
    const mShorts = url.match(/\/shorts\/([\w-]{6,})/);
    const mLive = url.match(/\/live\/([\w-]{6,})/);
    const mBe = url.match(/youtu\.be\/([\w-]{6,})/);
    videoId = (mWatch && mWatch[1]) || (mShorts && mShorts[1]) || (mLive && mLive[1]) || (mBe && mBe[1]);
    if (!videoId) return fail("não consegui identificar o vídeo nesta URL");

    let player = window.ytInitialPlayerResponse;
    if (player?.videoDetails?.videoId !== videoId) {
      player = null;
    }
    if (!player?.captions) {
      const key =
        window.ytcfg?.data_?.INNERTUBE_API_KEY ||
        window.ytcfg?.get?.("INNERTUBE_API_KEY") ||
        "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
      const version =
        window.ytcfg?.data_?.INNERTUBE_CONTEXT_CLIENT_VERSION ||
        window.ytcfg?.get?.("INNERTUBE_CONTEXT_CLIENT_VERSION") ||
        "2.20240826.01.00";
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: version } },
            videoId,
          }),
        }
      );
      if (!res.ok) return fail(`YouTube player API respondeu HTTP ${res.status}`);
      player = await res.json();
      if (player?.playabilityStatus?.status && player.playabilityStatus.status !== "OK") {
        const reason = player.playabilityStatus?.reason || player.playabilityStatus.status;
        return fail(`vídeo indisponível para transcrição: ${reason}`);
      }
      if (!player?.captions) return fail("este vídeo não tem legendas disponíveis");
    }

    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return fail("este vídeo não tem legendas disponíveis");
    const pt = tracks.find((t) => (t.languageCode || "").startsWith("pt"));
    const en = tracks.find((t) => (t.languageCode || "").startsWith("en"));
    const track = pt || en || tracks[0];

    const mmss = (ms) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
    };

    let text = "";
    for (const suffix of ["&fmt=json3", "&fmt=vtt", ""]) {
      const base = track.baseUrl.replace(/&fmt=[^&]*/, "") + suffix;
      try {
        const res = await fetch(base);
        if (!res.ok) continue;
        if (suffix === "" || suffix === "&fmt=json3") {
          const data = await res.json();
          const events = (data.events || []).filter((ev) => Array.isArray(ev.segs));
          const lines = [];
          let lastMark = -Infinity;
          for (const ev of events) {
            const t = ev.tStartMs || 0;
            if (t - lastMark >= 20000) {
              lines.push(`[${mmss(t)}]`);
              lastMark = t;
            }
            lines.push(ev.segs.map((s) => s.utf8 || "").join(""));
          }
          text = lines.join(" ").replace(/\s+/g, " ").trim();
        } else {
          const vtt = await res.text();
          const lines = [];
          let lastMark = -Infinity;
          for (const line of vtt.split("\n")) {
            const l = line.trim();
            if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(l)) {
              const start = l.split("-->")[0].trim();
              const p = start.split(/[:.,]/).map(Number);
              const ms = (p[0] * 3600 + p[1] * 60 + p[2]) * 1000 + (p[3] || 0);
              if (ms - lastMark >= 20000) {
                lines.push(`[${mmss(ms)}]`);
                lastMark = ms;
              }
              continue;
            }
            if (/^\s*(WEBVTT|Kind:|Language:)/.test(l) || !l) continue;
            lines.push(l.replace(/<[^>]+>/g, " "));
          }
          text = lines.join(" ").replace(/\s+/g, " ").trim();
        }
        if (text) break;
      } catch {}
    }
    if (!text) return fail("não consegui baixar a transcrição (legendas bloqueadas para este acesso)");

    return {
      transcript: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      totalChars: text.length,
      limit: maxChars,
      title: document.title,
      lang: track.languageCode,
      hasCaptions: true,
    };
  } catch (e) {
    return fail("extração falhou: " + String(e?.message || e));
  }
};
