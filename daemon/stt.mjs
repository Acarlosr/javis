import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

function findBin(name, envName) {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const dirs = [...new Set([
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local/bin"),
    "/usr/bin",
    "/opt/local/bin",
    ...(process.env.PATH ? process.env.PATH.split(":") : []),
  ])];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return "/usr/local/bin/" + name;
}

const WHISPER_BIN = findBin("whisper-cli", "AN_WHISPER_BIN");
const FFMPEG_BIN = findBin("ffmpeg", "AN_FFMPEG_BIN");
export const MODEL_PATH =
  process.env.AN_WHISPER_MODEL || join(homedir(), ".config", "assistente-navegador", "models", "ggml-base.bin");

export const MIME_EXT = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".m4a",
};

export function sttAvailable() {
  return existsSync(WHISPER_BIN) && existsSync(MODEL_PATH);
}

function run(bin, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || "")
          .split("\n")
          .filter(Boolean)
          .slice(-3)
          .join(" | ")
          .slice(0, 300);
        reject(new Error(bin.split("/").pop() + " falhou: " + (detail || err.message)));
        return;
      }
      resolve(stdout || "");
    });
  });
}

export async function transcribeAudio({ base64, mime, lang = "pt", fast = false } = {}) {
  if (!sttAvailable()) {
    throw new Error("ditado local indisponível: falta whisper-cli ou o modelo em " + MODEL_PATH);
  }
  const buf = Buffer.from(String(base64 || ""), "base64");
  if (!buf.length) throw new Error("áudio vazio");
  if (buf.length > 25 * 1024 * 1024) throw new Error("áudio muito grande (max 25 MB)");
  const dir = await mkdtemp(join(tmpdir(), "an-stt-"));
  try {
    const ext = MIME_EXT[mime] || ".webm";
    const src = join(dir, "src" + ext);
    const wav = join(dir, "audio.wav");
    await writeFile(src, buf);
    await run(FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", wav]);
    const args = ["-m", MODEL_PATH, "-f", wav, "-nt", "-np"];
    if (lang && lang !== "auto") args.push("-l", lang);
    if (fast) args.push("-bs", "1", "-bo", "1");
    const out = await run(WHISPER_BIN, args);
    const text = String(out || "").replace(/\s+/g, " ").trim();
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
