import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 57931;
export const MASK = "••••••";
export const DATA_DIR =
  process.env.ASSISTENTE_DATA || join(homedir(), ".config", "assistente-navegador");

const CONFIG_FILE = join(DATA_DIR, "config.json");
const BRIDGE_FILE = join(DATA_DIR, "bridge.json");

export const PRESETS = {
  gemini: {
    name: "Gemini",
    type: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  openai: { name: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { name: "Groq", type: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openrouter: { name: "OpenRouter", type: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
  ollama: { name: "Ollama (local)", type: "openai", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
  router9: { name: "9Router (local)", type: "openai", baseUrl: "http://127.0.0.1:20128/v1", model: "ag/gemini-3.8-flash-low" },
};

export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function str(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function normalizeProvider(p, i = 0) {
  const raw = p && typeof p === "object" ? p : {};
  const id =
    typeof raw.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(raw.id)
      ? raw.id
      : "p" + (i + 1) + "-" + randomBytes(4).toString("hex");
  return {
    id,
    name: str(raw.name, 60) || "Provedor",
    type: raw.type === "auth0" ? "auth0" : "openai",
    baseUrl: str(raw.baseUrl, 300),
    model: str(raw.model, 120),
    apiKey: str(raw.apiKey, 400),
    auth0:
      raw.auth0 && typeof raw.auth0 === "object"
        ? {
            domain: str(raw.auth0.domain, 200),
            clientId: str(raw.auth0.clientId, 200),
            clientSecret: str(raw.auth0.clientSecret, 400),
            audience: str(raw.auth0.audience, 300),
          }
        : null,
  };
}

export function loadConfig() {
  ensureDataDir();
  if (!existsSync(CONFIG_FILE)) return { port: DEFAULT_PORT, activeProvider: null, providers: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { port: DEFAULT_PORT, activeProvider: null, providers: [] };
  }
  const providers = Array.isArray(raw.providers)
    ? raw.providers.slice(0, 20).map(normalizeProvider)
    : [];
  if (!providers.length && raw.provider && typeof raw.provider === "object") {
    providers.push(normalizeProvider({ ...raw.provider, id: "default", name: "Gemini" }, 0));
  }
  const ids = new Set(providers.map((p) => p.id));
  const activeProvider = ids.has(raw.activeProvider) ? raw.activeProvider : providers[0]?.id || null;
  return {
    port: Number.isInteger(raw.port) ? raw.port : DEFAULT_PORT,
    activeProvider,
    providers,
  };
}

export function saveConfig(config) {
  ensureDataDir();
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      { port: config.port, activeProvider: config.activeProvider, providers: config.providers },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  );
}

export function activeProfile(config) {
  return config.providers.find((p) => p.id === config.activeProvider) || null;
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

export function writeBridge(token, port) {
  ensureDataDir();
  writeFileSync(BRIDGE_FILE, JSON.stringify({ token, port }, null, 2) + "\n", { mode: 0o600 });
}

export function readBridge() {
  try {
    return JSON.parse(readFileSync(BRIDGE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function isTokenValid(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bridgeFile() {
  return BRIDGE_FILE;
}
