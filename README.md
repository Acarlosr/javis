# Javis — seu assistente de IA local no navegador

> O mordomo que mora dentro do seu navegador. Resumos, tradução, Discord, live
> com tradução simultânea e chat — tudo com IA, rodando na sua máquina.

**Javis** é uma extensão de navegador (Chrome, Brave, Helium e qualquer fork de
Chromium) + um pequeno servidor local. Clique no ícone e ele abre ao lado da
página, pronto para:

- **Resumir a página atual** — em tópicos, direto ao ponto
- **Resumir vídeos do YouTube** — com estilos: padrão, por tópicos ou índice
  cronológico com timestamps (`[MM:SS] Assunto`)
- **Resumir canais do Discord por período** — 24h até 90 dias; ele rola o chat
  sozinho, coleta as mensagens e resume por assuntos, decisões e pendências
- **Traduzir o que você selecionar** — selecione um texto e clique: para
  PT-BR ou para inglês, no Discord ou em qualquer site
- **Live PT-BR** — transcreve ao vivo o áudio de uma live/AMA (aba ou
  microfone) e traduz simultaneamente para português, com timestamps; no fim,
  gera resumo e export `.md`
- **Traduzir página inteira** — conteúdo da aba ativa → PT-BR
- **Chat livre** — pergunte qualquer coisa, com contexto da página e histórico
- **Falar com o mordomo** — ditado por voz, com reconhecimento nativo ou
  transcrição 100% local via Whisper (funciona até em navegadores que bloqueiam
  o serviço de voz do Google, como o Helium)
- **Nova seção + Histórico** — trocou de assunto/site? Clique no **+** e comece
  do zero. O botão do relógio abre o histórico de todas as seções: clique para
  reabrir uma conversa antiga (e continuar de onde parou), apague o que
  quiser. Retenção selecionável — 1 dia, 5 dias, 1 semana, 15 dias ou 1 mês —
  e tudo é apagado automaticamente após 2 meses
- **Exportar tudo** — cada resposta tem botões "copiar" e "baixar .md"

Nada do que você vê passa por servidores nossos: a extensão conversa com um
daemon local (`127.0.0.1`), e só o texto que você pedir vai ao provedor de IA
que você escolher (que pode ser um modelo 100% local via Ollama, se preferir).

---

## Como funciona

```
┌─────────────────┐        http://127.0.0.1:57931        ┌──────────────────┐
│  Extensão (MV3) │ ──────── token Bearer local ───────► │   Daemon (Node)  │
│  painel lateral │        GET/POST JSON ou SSE          │                  │
└─────────────────┘                                      └────────┬─────────┘
        │  rola o chat, extrai página/video (DOM)                 │
        │                                                         ▼
        │                                              ┌──────────────────────┐
        └────────────────────────────────────────────► │  Provedor de IA      │
                                                       │  Gemini / OpenAI /   │
                                                       │  Groq / OpenRouter / │
                                                       │  Ollama / custom     │
                                                       └──────────────────────┘
                                                                  ▲
                          ┌──────────────────────────────────────┐│
                          │  whisper-cli + ffmpeg (da sua        ││
                          │  máquina) para ditado e Live PT-BR   ▼┘
                          └──────────────────────────────────────┘
```

- A **extensão** nunca fala direto com a internet da IA: tudo passa pelo
  **daemon local**, que guarda a chave do provedor com você.
- O daemon escuta **apenas em `127.0.0.1`** e exige um **token** (gerado na
  primeira execução, comparado de forma constante em memória).
- A fala e a transcrição de áudio usam **Whisper local** (`whisper-cli`), sem
  enviar áudio para nenhuma nuvem.

## Requisitos

| Item | Detalhe |
| --- | --- |
| Node.js | 20 ou superior (`node --version`) |
| Navegador | Chrome, Brave, Helium ou qualquer Chromium (Manifest V3) |
| ffmpeg | apenas para fala/transcrição local (ditado e Live) |
| whisper-cli | apenas para fala/transcrição local (seção abaixo) |
| SO | macOS, Linux ou Windows (os comandos abaixo variam um pouco) |

**Sem ffmpeg/whisper?** Tudo que não envolve áudio funciona igual: resumos,
tradução, Discord, chat.

---

## Instalação

### 1. Baixe o projeto

```bash
git clone https://github.com/Acarlosr/javis.git javis
cd javis
npm install   # se houver dependências; hoje o daemon roda com Node puro
```

> **Prefere não usar git?** Na página do repo no GitHub: botão verde
> **Code → Download ZIP**, descompacte e siga os mesmos passos (a pasta
> descompactada é o "repo").

### 2. Rode o daemon

```bash
npm start
```

Na primeira execução ele cria a pasta de dados em
`~/.config/assistente-navegador/` (ou o caminho da variável `ASSISTENTE_DATA`)
com dois arquivos:

- **`bridge.json`** — contém o `token` e a `porta` (padrão `57931`). É a ponte
  com a extensão. Copie o token; ele aparece no terminal na primeira execução.
- **`config.json`** — provedores de IA configurados (veja a próxima seção).

Deixe o terminal aberto (ou configure o start automático, seção abaixo).

> **Windows:** `~` é `%USERPROFILE%`, ou seja
> `C:\Users\SEU_USUARIO\.config\assistente-navegador\`.

### 3. Instale a extensão

1. Abra `chrome://extensions` (ou `brave://extensions` etc.)
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação** e selecione a pasta `extension/`
4. Fixe o ícone: menu de peças de quebra-cabeça → alfinete ao lado de "Javis"

### 4. Conecte tudo

1. Clique no ícone do Javis → abre o painel lateral
2. Na primeira vez, vai pedir o token: cole o de `bridge.json` e clique em
   **Testar conexão** → **Salvar**
   (ou em `chrome://extensions` → Javis → **Detalhes** → **Opções**)
3. Pronto — o bolinho de status fica verde e o painel libera as ações

### 5. (Opcional) Iniciar com o sistema

**macOS — LaunchAgent** (`~/Library/LaunchAgents/com.SEU_USUARIO.javis.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.SEU_USUARIO.javis</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/node</string>
      <string>/CAMINHO/DO/REPO/daemon/start.mjs</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>30</integer>
    <key>StandardOutPath</key><string>/tmp/javis.log</string>
    <key>StandardErrorPath</key><string>/tmp/javis.error.log</string>
  </dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.SEU_USUARIO.javis.plist
# conferir:  curl http://127.0.0.1:57931/health  (deve responder JSON)
# reiniciar: launchctl kickstart -k gui/$(id -u)/com.SEU_USUARIO.javis
```

> Ajuste o caminho do `node` (`which node`) e do repositório.

**Linux — systemd (unidade de usuário)** em
`~/.config/systemd/user/javis.service`:

```ini
[Unit]
Description=Javis daemon
After=network-online.target

[Service]
ExecStart=/usr/bin/node /CAMINHO/DO/REPO/daemon/start.mjs
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now javis
```

**Windows:** use o Agendador de Tarefas com "Iniciar no logon" apontando para
`node daemon/start.mjs`.

---

## Configurando o provedor de IA

O Javis fala com qualquer endpoint **compatível com OpenAI** (`/v1/chat/completions`).
Vem com presets prontos:

| Preset | Base URL | Modelo padrão | Onde pegar a chave |
| --- | --- | --- | --- |
| **Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | <https://aistudio.google.com/apikey> (tem camada grátis) |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | <https://platform.openai.com/api-keys> |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | <https://console.groq.com/keys> (camada grátis) |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` | <https://openrouter.ai/keys> (tem modelos :free) |
| **Nous Research** | `https://inference-api.nousresearch.com/v1` | `Hermes-4-405B` | <https://build.nousresearch.com> |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` | <https://platform.deepseek.com> |
| **Ollama (local)** | `http://127.0.0.1:11434/v1` | `llama3.1` | nenhum — roda na sua máquina |
| **9Router (local)** | `http://127.0.0.1:20128/v1` | (o que seu router servir) | nenhum — roteador local próprio |

### Descoberta de modelos

Para provedores OpenAI-compatíveis, o Javis consulta o endpoint `/v1/models` do
provedor e mostra os modelos disponíveis como **chips clicáveis**:

- Ao **conectar** (ou abrir as configurações com o daemon no ar), cada card de
  provedor lista os modelos que ele serve — um clique troca o modelo ativo.
- No **editor de provedor**, o botão **Buscar modelos** consulta na hora
  (com a chave colada ou, se já salva, usando a chave gravada). Presets locais
  sem chave (Ollama, 9Router) buscam automaticamente ao escolher o preset.

Não apareceu nada? Veja *Troubleshooting* — alguns provedores exigem chave
válida para listar modelos; o 9Router/Ollama respondem sem chave.

### Pelo painel (recomendado)

1. Painel → botão **⚙** (canto superior direito)
2. Seção **Provedor de IA** → **+ Adicionar provedor**
3. Escolha o **preset** (preenche Base URL e modelo), ou "Personalizado"
4. Dê um **Nome**, confirme **Base URL** e **Modelo**, cole a **Chave de API**
5. **Salvar provedor** → **Usar** (vira o ativo)

O seletor no topo do painel troca de provedor/modelo a qualquer momento.

### Editando o arquivo (alternativa)

`~/.config/assistente-navegador/config.json`:

```json
{
  "port": 57931,
  "activeProvider": "gemini-1",
  "providers": [
    {
      "id": "gemini-1",
      "name": "Gemini",
      "type": "openai",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "model": "gemini-2.5-flash",
      "apiKey": "SUA_CHAVE_AQUI"
    },
    {
      "id": "ollama-local",
      "name": "Ollama local",
      "type": "openai",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "llama3.1",
      "apiKey": "ollama"
    }
  ]
}
```

- `type: "openai"` — qualquer endpoint compatível (funciona também com
  **LM Studio** `http://127.0.0.1:1234/v1`, **LiteLLM**, **vLLM**, **llama.cpp
  server**, etc. — é só apontar a Base URL)
- Máximo de 20 provedores; reinicie o daemon após editar o arquivo

### Endpoint atrás de Auth0 (client credentials)

Para APIs corporativas protegidas por OAuth2, escolha o tipo
**"Endpoint atrás de Auth0"** e preencha:

- **Domínio** (`seu-tenant.auth0.com`)
- **Client ID** e **Client Secret**
- **Audience** (o `audience` do token de acesso)

O daemon busca o token de acesso e renova automaticamente; o campo "Chave de
API" fica desabilitado nesse modo.

### Modo teste

Sem nenhum provedor ativo com chave, o daemon responde em **modo teste** (eco
simulado) — dá para validar toda a ponte antes de ter chave.

---

## Fala e transcrição local (Whisper)

O ditado por voz e o **Live PT-BR** usam Whisper rodando na sua máquina.

### Instale o ffmpeg

```bash
# macOS
brew install ffmpeg
# Ubuntu/Debian
sudo apt install ffmpeg
# Windows: https://www.gyan.dev/ffmpeg/builds/ (adicione ao PATH)
```

### Instale o whisper-cli

```bash
# macOS (Homebrew) — mais fácil
brew install whisper-cpp

# Ou compile do zero (qualquer SO):
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build -j --config Release
sudo cp build/bin/whisper-cli /usr/local/bin/   # macOS/Linux
```

### Baixe o modelo

O modelo padrão é o `ggml-base` multilíngue (~148 MB) — bom para tempo real:

```bash
mkdir -p ~/.config/assistente-navegador/models
curl -L -o ~/.config/assistente-navegador/models/ggml-base.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

Quer mais precisão? Troque por `ggml-small.bin` (~480 MB) — renomeie o arquivo
para `ggml-base.bin` ou ajuste com a variável abaixo.

### Variáveis opcionais

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `AN_WHISPER_BIN` | `/usr/local/bin/whisper-cli` | caminho do binário |
| `AN_FFMPEG_BIN` | `/usr/local/bin/ffmpeg` | caminho do ffmpeg |
| `AN_WHISPER_MODEL` | `~/.config/assistente-navegador/models/ggml-base.bin` | caminho do modelo |
| `ASSISTENTE_DATA` | `~/.config/assistente-navegador` | pasta de dados |

### Como funciona por baixo

- O áudio chega (webm/ogg/wav/mp3/m4a, máx. 25 MB), é convertido para
  WAV mono 16 kHz e transcrito com `whisper-cli`
- No **Live**, gravação contínua em blocos de 5 s (o gravador se reencaixa
  sozinho, sem lacunas), transcrição em modo rápido (`beam size 1`) e tradução
  simultânea quando o áudio está em inglês; quando a fila atrasa, o Javis pula
  a tradução para nunca perder fala
- Navegadores que bloqueiam o `SpeechRecognition` do Google (Helium, Brave com
  certas configurações) caem **automaticamente** no ditado local

---

## Uso (tutorial)

Abra a página/vídeo/canal desejado, clique no ícone do Javis e use os chips
(botões) da barra inferior:

### Resumir página
Clique em **Resumir página**. Ele lê o texto visível da aba e responde em
tópicos.

### Resumir YouTube
Abra o vídeo, escolha o **estilo** no seletor (padrão / tópicos / índice com
tempos) e clique em **Resumir YouTube**. Funciona com `watch`, `shorts` e
`live`; o índice usa os marcadores `[MM:SS]` da transcrição.

### Discord: resumo por período
Abra o canal, escolha o **período** (24h, 10, 14, 20, 30 ou 90 dias) e clique
em **Discord**. O Javis rola o chat até cobrir o período (faixa de progresso
azul e mensagens piscando), coleta tudo e resume por assuntos, decisões e
pendências citando quem falou.

### Discord: traduzir seleção
Selecione um texto no chat — aparece um **botão flutuante** com
**"→ PT-BR"** e **"→ EN"**. Clique e a tradução surge num cartão junto à
seleção, com **copiar**. `ESC` ou clique fora fecha.

### Traduzir seleção (em qualquer site)
Selecione o texto, escolha o idioma no seletor **"Seleção → PT-BR / EN"** e
clique em **Traduzir seleção**. O resultado aparece no painel, com botões
copiar e `.md`.

### Live PT-BR
1. Escolha a **fonte**: `Aba` (áudio da aba — ideal para lives/AMAs) ou `Mic`
2. Escolha o idioma: `inglês → PT-BR` (traduz na hora) ou `português`
3. Clique em **Live PT-BR**
4. A transcrição vai aparecendo numa única bolha rolante com `[MM:SS]`
5. Clique de novo (**Parar live**) → gera **resumo** e botão de **export .md**

> Dica: use a fonte **Aba** para capturar o áudio do vídeo/áudio da call; o
> microfone perto da caixa de som capta eco e distorce. Se a aba pedir
> permissão de captura, permita.

### Chat livre
Escreva no campo e enter. O Javis usa o contexto da página atual. Cada resposta
IA tem **copiar** e **baixar .md**.

### Falar (voz)
Clique no microfone e fale. A transcrição entra no campo e é enviada quando
você para de falar. Se o navegador bloquear o serviço de voz, o Javis alterna
sozinho para o ditado local (Whisper) — e se o microfone estiver bloqueado,
o botão **Permitir microfone** aparece nas **Configurações (⚙)**.

---

## API local do daemon

Tudo exige `Authorization: Bearer <token>` e escuta só em `127.0.0.1`.

| Método | Rota | Para quê |
| --- | --- | --- |
| GET | `/health` | status: provedor ativo, `stt: true/false` |
| GET | `/config` | lista de provedores + ativo |
| PUT | `/config` | atualiza provedores/porta/ativo |
| POST | `/active` | troca o provedor ativo (`{"id": "..."}`) |
| POST | `/test` | testa um provedor antes de salvar |
| POST | `/chat` | chat com o LLM; `stream: true` = SSE |
| POST | `/transcribe` | áudio base64 → texto (`lang`, `fast`) |

Exemplos:

```bash
TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.config/assistente-navegador/bridge.json'))['token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:57931/health

curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"Diga olá em uma frase"}]}' \
  http://127.0.0.1:57931/chat
```

---

## Segurança

- Daemon **só em loopback** (`127.0.0.1`), com token Bearer gerado na primeira
  execução e comparado com `timingSafeEqual`
- `bridge.json` e `config.json` salvos com permissão `600`
- A chave do provedor fica **no seu daemon**, nunca na extensão
- Nenhum dado trafega para "a nuvem do projeto" — só para o provedor que você
  configurou (ou zero, se usar Ollama)

## Solução de problemas

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| "Daemon não encontrado" no painel | daemon parado ou porta diferente | rode `npm start`; confira a porta nas Configurações |
| "Token inválido" | token errado/antigo | copie de `bridge.json` e cole nas Configurações |
| Bolinha de status não fica verde | daemon sem provedor ativo | tudo funciona menos IA; configure o provedor |
| Voz não funciona no Helium/Brave | serviço de voz do Google bloqueado | o Javis cai sozinho no ditado local; instale ffmpeg + whisper-cli |
| "microfone negado" | permissão do SO/navegador | Configurações (⚙) → **Permitir microfone** → aceite no prompt |
| Live não inicia / erro MediaRecorder | painel antigo na memória | recarregue a extensão **e reabra o painel lateral** |
| Live não captura o áudio da aba | permissão de captura | escolha a fonte **Aba** e permita quando o navegador pedir |
| Discord não coleta mensagens | canal sem histórico visível | role manualmente até ver mensagens e repita |
| Resumo do YouTube vazio | vídeo sem legendas | o próprio Javis avisa; vídeo sem legenda não tem o que extrair |
| Página não é lida | `chrome://` ou loja | o Chrome bloqueia; use páginas http(s) normais |

## Estrutura do repositório

```
daemon/                  servidor local (Node puro, sem dependências)
  config.mjs             config, token, presets de provedores, bridge.json
  provider.mjs           cliente OpenAI-compatível + SSE + Auth0 (client creds)
  server.mjs             rotas: /health /config /active /test /chat /transcribe
  stt.mjs                transcrição local (ffmpeg → whisper-cli)
  start.mjs              inicialização
extension/               extensão Manifest V3
  manifest.json          permissões e registro do painel/opções
  background.js          service worker: abas, extração, tradução de seleção
  sidepanel/             painel lateral (chat, chips, Live, voz)
  options/               configurações (token, porta, provedores, Auth0)
  content/
    extract.js           extrai texto da página (injetado sob demanda)
    youtube.js           extrai transcrição/legendas do YouTube
    discord.js           coleta mensagens do Discord com auto-scroll
    translator.js        botão flutuante de tradução por seleção (Discord)
tests/
  test.mjs               testes unitários (node --test)
```

## Desenvolvimento

```bash
npm start          # roda o daemon
npm test           # suíte de testes unitários
node --check daemon/server.mjs   # checagem rápida de sintaxe
npm run package    # gera javis-extension-<versao>.zip (para loja ou distribuir)
```

- O daemon não tem dependências externas — Node puro
- Os extratores de página são **injetados sob demanda** pelo background
  (`chrome.scripting.executeScript`) e comunicam-se por mensagens
  (`chrome.runtime.sendMessage`)
- A tradução por seleção no Discord passa pelo background por causa do CSP da
  página (content scripts não podem chamar `127.0.0.1` direto lá)

## Distribuindo o Javis

Há dois caminhos — escolha pelo público:

### A) ZIP pelo GitHub (grátis, para amigos próximos)

A extensão fica "não publicada" (developer mode) — perfeita para quem você
puder orientar pessoalmente:

1. Vá em **Releases**: <https://github.com/Acarlosr/javis/releases> e baixe o
   `javis-extension-<versão>.zip` (o arquivo da versão mais recente)
2. Descompacte o ZIP
3. `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem
   compactação** → selecione a pasta descompactada
4. Instale o daemon (`npm start`) e cole o token no painel
5. Pronto — o Chrome lembra da extensão; ela só atualiza manualmente
   (botão de recarregar)

> No **Helium/Brave** os passos são idênticos (`helium://extensions` etc. —
> some `chrome` pelo nome do navegador).

### B) Chrome Web Store (oficial, um clique para todo mundo)

| Passo | Detalhe |
| --- | --- |
| 1. Conta de desenvolvedor | <https://console.cloud.google.com/developer-registration> — taxa única de **US$ 5** |
| 2. Pacote | rode `npm run package` na raiz e faça upload do `javis-extension-<versão>.zip` |
| 3. Política de privacidade | o `PRIVACY.md` deste repo já serve — publique-o no GitHub (Settings → Pages) e informe a URL |
| 4. Listagem | nome, descrição, categoria, screenshots (o painel aberto numa página real rende bem), ícone 128px (já temos) |
| 5. Permissões justificadas | explique cada uma (o quadro da PRIVACY.md cobre) — `tabCapture` + `<all_urls>` tendem a acelerar revisão se bem justificados |
| 6. Enviar para revisão | revisão costuma levar de alguns dias a 1-2 semanas; depois, um clique instala para qualquer pessoa |

> Com a extensão na loja, o daemon continua sendo instalado à parte —
> o Javis depende de um servidor local, então o README sempre guiará o
> usuário pelos dois passos (extensão + daemon).

## Nota sobre nomes internos

O projeto se chama **Javis**, mas a pasta de dados continua em
`~/.config/assistente-navegador/` — é intencional: quem instalou versões
anteriores mantém token, provedores e modelo do Whisper sem reconfigurar nada.
Usuários novos só veem esse caminho se forem editar os arquivos de config na
mão.

## Roadmap

- [ ] Botão flutuante de tradução em todos os sites (hoje: Discord + painel)
- [ ] Captura de área com OCR para traduzir imagens
- [ ] Modelos Whisper maiores (`small`/`medium`) como opção nas configurações
- [x] Empacotamento (zip pronto para loja: `npm run package`)

## Licença

MIT — use, modifique e compartilhe.

---

*Feito com carinho por [@acarlosr](https://github.com/acarlosr). Se der problema, abra uma issue!*
