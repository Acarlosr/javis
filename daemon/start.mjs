import { loadConfig, newToken, writeBridge, readBridge, saveConfig, bridgeFile, activeProfile } from "./config.mjs";
import { createApp } from "./server.mjs";

export function startDaemon({ config } = {}) {
  config = config || loadConfig();
  const existing = readBridge();
  if (existing?.token) {
    config.token = existing.token;
  } else {
    config.token = newToken();
  }
  if (!existing || existing.token !== config.token || existing.port !== config.port) {
    writeBridge(config.token, config.port);
  }
  saveConfig({ port: config.port, activeProvider: config.activeProvider, providers: config.providers });
  const server = createApp({ config });
  return new Promise((resolve) => {
    server.listen(config.port, "127.0.0.1", () => {
      const profile = activeProfile(config);
      console.log("Javis — daemon rodando");
      console.log(`  Endereço: http://127.0.0.1:${config.port}`);
      console.log(`  Token em: ${bridgeFile()}`);
      console.log(
        profile
          ? `  Provedor: ${profile.name} (${profile.model || "sem modelo"})${profile.apiKey || profile.type === "auth0" ? "" : " — MODO TESTE"}`
          : "  Provedor: nenhum — MODO TESTE (configure na extensão)"
      );
      resolve(server);
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith("start.mjs")) {
  startDaemon().catch((e) => {
    console.error("Falha ao iniciar daemon:", e);
    process.exit(1);
  });
}
