# Política de Privacidade — Javis

Última atualização: 28/09/2026

## Resumo em uma frase

O Javis roda **100% na sua máquina** e **não coleta, transmite nem vende
nenhum dado seu** — não há telemetria, analytics ou servidores nossos.

## O que o Javis faz com dados

- **Conversas e seções** — ficam salvas apenas no armazenamento local do
  navegador (`chrome.storage.local`), na sua máquina. O histórico expira de
  acordo com a retenção que você escolher (até 2 meses, máximo).
- **Páginas, vídeos e mensagens lidas** — são extraídos do navegador e enviados
  apenas ao **daemon local** (`http://127.0.0.1`), nunca a terceiros.
- **Áudio do microfone/aba (ditado e Live)** — é transcrito com **Whisper
  local** (`whisper-cli`) na sua máquina. O áudio **nunca sai** do seu
  computador.
- **Chaves de API de provedores de IA** — ficam no daemon local
  (`~/.config/assistente-navegador/`, permissão 600) ou no armazenamento local
  do navegador. Nada é enviado para nós.

## Único ponto de rede (sob seu controle)

Quando você usa uma ação que exige IA, o daemon envia o texto solicitado ao
**provedor que você mesmo configurou** (ex.: Gemini, OpenAI, Groq, OpenRouter
ou Ollama local). Nesse caso, aplicam-se a política de privacidade e os termos
do provedor escolhido — não do Javis. Se usar Ollama ou 9Router local, nada
sai da sua máquina.

## Permissões e por quê

| Permissão | Uso |
| --- | --- |
| `storage` / `unlimitedStorage` | salvar token, provedores e histórico de seções localmente |
| `activeTab` / `scripting` | extrair o texto da página quando você pede um resumo/tradução |
| `tabCapture` | capturar o áudio da aba para o Live PT-BR (com seu consentimento) |
| `sidePanel` | abrir o painel do assistente |

## Contato

Dúvidas sobre privacidade: abra uma issue no repositório do projeto.
