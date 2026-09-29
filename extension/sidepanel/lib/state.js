// Estado compartilhado entre os módulos do painel.

export const DEFAULTS = { port: 57931, token: "" };

export const state = {
  config: { ...DEFAULTS },
  history: [],
  busy: false,
  daemonStatus: null,
};

export async function loadConfig() {
  const data = await chrome.storage.local.get(["assistConfig"]);
  state.config = { ...DEFAULTS, ...(data.assistConfig || {}) };
}
