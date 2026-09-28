# Diagnóstico do Javis — produto, melhorias e direção premium

Data da análise: 28 de setembro de 2026  
Escopo: leitura estática do repositório. O aplicativo, o daemon, os testes, builds e integrações externas **não foram executados**.

## Resumo executivo

O Javis já tem uma tese de produto forte e diferenciada: um assistente de IA que fica no navegador, respeita a privacidade e deixa o usuário escolher a inteligência por trás dele. Em vez de competir como “mais um chat”, ele resolve tarefas reais de consumo de conteúdo: entender páginas, vídeos, canais de Discord, trechos selecionados e áudio ao vivo.

A arquitetura escolhida é boa para esse posicionamento. A extensão Chromium é a camada de experiência; o daemon local é a camada de confiança e integração; o provedor de IA é intercambiável. Isso permite usar desde Ollama local até serviços comerciais, sem concentrar as chaves em um servidor próprio.

O projeto parece tecnicamente viável para uma primeira comunidade de usuários avançados. Para se tornar um produto premium e distribuível para público mais amplo, a prioridade não é adicionar muitas funções: é reduzir a fricção de instalação, transformar transparência em confiança visível, estabilizar os fluxos mais valiosos e dar acabamento consistente à interface e às mensagens.

## O que eu entendi do produto

### Proposta de valor

“Um mordomo de IA local no navegador.” O usuário abre o painel lateral e pode conversar, resumir uma página, extrair e resumir legendas do YouTube, coletar e resumir mensagens de um canal Discord, traduzir uma seleção e transcrever/traduzir uma live. A privacidade é um elemento central: não existe uma nuvem do Javis; o texto segue para o provedor escolhido pelo próprio usuário, ou pode ficar local com Ollama.

### Como as peças se conectam

```text
Usuário
   │
   ▼
Extensão Chromium (Manifest V3)
   ├─ painel lateral: chat, ações, histórico, voz e Live
   ├─ service worker: seleção de aba e injeção de extratores
   └─ scripts de conteúdo: página, YouTube, Discord e tradução contextual
   │  HTTP local com token Bearer
   ▼
Daemon Node em 127.0.0.1
   ├─ guarda configuração e chaves do usuário
   ├─ valida o token e expõe API local
   ├─ adapta chamadas OpenAI-compatíveis / Auth0
   └─ chama ffmpeg + whisper-cli quando há áudio
   │
   ▼
Provedor escolhido: Gemini, OpenAI, Groq, OpenRouter, DeepSeek,
Nous, Ollama, 9Router ou endpoint compatível
```

### Fluxos principais

1. O usuário instala a extensão e inicia o daemon local.
2. O daemon cria um token e o usuário o informa à extensão uma vez.
3. A extensão pede contexto da aba quando necessário: texto visível da página, legendas do YouTube ou mensagens carregadas no Discord.
4. O painel envia contexto e pedido ao daemon; o daemon encaminha ao modelo ativo e devolve a resposta, inclusive em streaming.
5. No modo voz/Live, o painel captura áudio. O daemon converte com ffmpeg e transcreve localmente com Whisper; em Live, a transcrição pode ser traduzida pelo provedor de IA.
6. Conversas ficam no armazenamento local do navegador, com retenção configurável.

## Pontos fortes

### Produto e posicionamento

- A proposta é clara e concreta. “Resumir/entender o que está aberto agora” é mais fácil de perceber do que um chat genérico.
- Combina funções que normalmente estão espalhadas em várias extensões: leitura de página, YouTube, Discord, tradução e voz.
- O modo Live PT-BR é um diferencial interessante para AMAs, aulas, calls e conteúdo internacional.
- O usuário escolhe o fornecedor de IA e o modelo. Isso atende quem prioriza custo, qualidade, privacidade ou modelos locais.
- O suporte a Ollama dá uma narrativa de privacidade real, não apenas de marketing.

### Arquitetura e engenharia

- A divisão extensão + daemon local é uma boa fronteira de segurança: chaves de API não ficam distribuídas no código da extensão.
- O daemon fica preso ao loopback (`127.0.0.1`) e exige token Bearer; os arquivos de configuração são gravados com permissão restritiva. É uma base correta para uma ferramenta local.
- A comparação do token usa comparação de tempo constante.
- O projeto usa Node puro no daemon, reduzindo dependências, tamanho, vulnerabilidades transitivas e dificuldade de instalação técnica.
- Há validação de formato/limites para mensagens, provedores, áudio e tamanho de corpo HTTP.
- Há suporte a streaming via SSE, uma escolha que melhora a percepção de velocidade no chat.
- A descoberta de modelos e os presets tornam a configuração de diferentes provedores bem menos árdua.
- Há uma suíte de testes para rotas do daemon, token, mascaramento de segredos, Auth0, streaming e descoberta de modelos. A cobertura não foi medida nesta análise, mas a existência desses testes é um sinal positivo.

### Experiência já existente

- Histórico por “seções” é uma metáfora melhor que uma conversa infinita para uso por contexto/aba.
- Exportar respostas e transcrições como Markdown é simples e útil.
- O projeto antecipa falhas previsíveis: sem daemon, token inválido, ausência de legendas, permissão de microfone e captura de áudio.
- As ações rápidas reduzem esforço para tarefas comuns e a detecção por linguagem natural complementa esses atalhos.
- A documentação é incomumente completa para esta etapa: instalação, segurança, uso, troubleshooting, distribuição e política de privacidade já estão presentes.

## Pontos negativos e riscos

Os itens abaixo são observações de código e produto; precisam de validação prática antes de serem tratados como bugs confirmados.

### Alta prioridade — confiança e segurança

1. **Permissão ampla demais para o posicionamento atual.** A extensão declara `"<all_urls>"` em `host_permissions`. Mesmo que seja tecnicamente conveniente para tradução e leitura universal, isso assusta usuários e aumenta o escrutínio em revisão de loja. O projeto ainda declara que o botão flutuante de tradução em todos os sites é futuro; hoje o script persistente é direcionado ao Discord.

   Direção: migrar leitura e tradução universal para permissões opcionais e solicitadas no momento da ação (`optional_host_permissions`), quando possível. Explicar dentro do produto, em linguagem simples, qual página será lida e por quê antes da primeira ação em um domínio.

2. **O token da ponte fica em `chrome.storage.local`.** A chave do provedor corretamente permanece no daemon, mas o token local dá acesso à API local de configuração e chat. Em um ambiente de extensão comprometido ou com acesso ao perfil do navegador, ele pode ser reutilizado.

   Direção: manter o modelo atual para a primeira versão, mas registrar claramente a ameaça que ele resolve. Em uma versão madura, considerar pareamento local de curta duração, rotação/revogação do token na interface e escopo de origem/extensão validado no daemon.

3. **CORS precisa ser validado nos navegadores-alvo.** O daemon responde `access-control-allow-origin: chrome-extension://*` quando há `Origin`; esse valor não é um padrão de origem usual do CORS. A extensão pode funcionar por privilégios próprios de host permissions, mas este comportamento deve ser testado em Chrome, Brave e Helium. Além disso, o daemon deveria aceitar explicitamente apenas a origem do ID da extensão instalada, se essa validação for necessária.

4. **Risco de prompt injection vindo da página.** Todo conteúdo extraído — página, vídeo e Discord — é enviado junto do pedido ao modelo. Páginas podem conter instruções maliciosas como “ignore as instruções anteriores”. O sistema atual não marca claramente o conteúdo como dado não confiável.

   Direção: adotar um prompt-base que diga explicitamente que conteúdo de páginas/transcrições é referência não confiável, nunca instrução; separar pedido do usuário e fonte com delimitadores; exibir uma indicação de origem/contexto usado. Isso é importante para um produto que lê a web.

5. **Privacidade precisa ficar mais precisa em dois detalhes.** A política diz que o áudio “nunca sai” do computador, o que está correto para o Whisper, mas a transcrição do modo Live em outro idioma é enviada ao provedor de IA para tradução. Também há migração de uma chave legada armazenada no armazenamento da extensão. A comunicação deve diferenciar áudio, transcrição e texto de página para evitar interpretações amplas demais.

### Alta prioridade — experiência de produto

1. **Instalação em duas partes ainda é a maior barreira.** Para o público técnico, carregar a extensão e rodar `npm start` é aceitável. Para consumidores, é uma queda grande antes do primeiro valor percebido. Também faltam instaladores/guias automatizados para Node, ffmpeg e Whisper.

   Direção: criar um “Javis Desktop Bridge” instalável para macOS/Windows (ou um instalador guiado) que inicia junto com o sistema, atualiza, verifica dependências e mostra um único estado de conexão. A extensão deveria abrir um onboarding visual, não apenas levar a uma tela de token.

2. **O modo teste pode confundir.** Sem provedor ou chave, o chat devolve uma resposta simulada. É útil para desenvolvimento, mas o usuário pode interpretar a interface como IA funcionando de verdade.

   Direção: tornar o estado visualmente inequívoco: faixa “Demonstração — nenhuma IA foi chamada”, CTA para configurar um provedor e nenhum resultado que pareça resposta real.

3. **Há limites silenciosos de contexto.** Página é cortada em 20 mil caracteres; YouTube em 60 mil; Discord e Live em valores maiores; o histórico guarda 40 mensagens. Alguns fluxos informam truncamento no objeto extraído, mas o usuário não recebe um aviso consistente de “analisei apenas X%/primeiros N caracteres”. Isso pode diminuir confiança no resumo.

   Direção: exibir “Fonte parcial” e o motivo, oferecer seleção de escopo e implementar chunking/map-reduce para conteúdos longos, preservando uma estimativa de custo e tempo.

4. **O coletor do Discord depende da estrutura visual do site e auto-scroll.** Isso é inevitavelmente frágil: mudanças no DOM, virtualização de mensagens, mídias, threads e canais extensos podem gerar coleta incompleta. O usuário também pode ficar sem saber exatamente até onde a coleta chegou.

   Direção: apresentar uma etapa de prévia antes de resumir: canal, intervalo efetivamente alcançado, quantidade de mensagens, primeira/última data e opção “continuar coletando”. Salvar um relatório de cobertura no resultado.

5. **Live privilegia atualidade em detrimento de completude.** Quando a fila atrasa, trechos antigos são descartados. Isso é defensável em tradução simultânea, mas deve ser uma escolha explícita — não uma surpresa em uma transcrição que o usuário talvez queira arquivar.

   Direção: dois perfis claros: “Ao vivo, menor atraso” (pode omitir trechos) e “Registro completo, maior atraso” (nunca descarta). Mostrar atraso/fila e avisar cada lacuna registrada.

### Média prioridade — qualidade e manutenção

1. **Os maiores arquivos concentram responsabilidades.** `extension/sidepanel/sidepanel.js` reúne estado, UI, streaming, reconhecimento de voz, gravação, Live, extração, roteamento por intenção, histórico e persistência. `options.js` também concentra configuração e UI. Isso torna regressões mais prováveis.

   Direção: modularizar por domínio: `api-client`, `session-store`, `chat-controller`, `voice-controller`, `live-controller`, `actions`, `ui`. Não é necessário adotar um framework para obter essa organização.

2. **Há duplicação de presets e regras.** A lista de provedores aparece no daemon e nas opções; limites de conteúdo aparecem em vários fluxos. Com o tempo, versões podem se desencontrar.

   Direção: criar um módulo compartilhado de metadados de provedores e uma configuração central de limites/telemetria local. Se o bundle continuar sem etapa de build, manter um arquivo de dados compartilhado simples e versionado.

3. **Versões estão desalinhadas.** Manifesto e `package.json` indicam `0.5.2`, enquanto `/health` responde `0.5.0`. É pequeno, mas reduz confiança em diagnósticos e suporte.

   Direção: ler a versão de uma única fonte durante empacotamento/build e expor a mesma versão no daemon, interface e artefato ZIP.

4. **Tratamento de erro às vezes silencia a causa.** Existem vários `catch {}` e falhas de processamento Live que são ignoradas. Isso evita travar a interface, mas dificulta suporte e diagnóstico.

   Direção: manter mensagens humanas curtas na interface e criar um “Diagnóstico” exportável com eventos locais, versões, permissões, status de dependências e causa técnica sem incluir chaves ou conteúdo privado.

5. **A estratégia de transcrição tem caminhos fixos por padrão.** `whisper-cli` e `ffmpeg` assumem `/usr/local/bin`, que pode não existir em Linux, Windows, Macs Apple Silicon ou instalações via ferramentas diferentes.

   Direção: procurar executáveis no PATH, permitir escolha assistida, validar dependências na primeira abertura e mostrar instruções específicas do SO.

6. **Testes ainda são concentrados no daemon.** Há bons testes de API, mas não há evidência estática de testes para extratores de DOM, fluxo de painel, persistência de sessões, permissões, acessibilidade ou cenários de browser.

   Direção: adicionar testes unitários para parsers/intenções, fixtures HTML para YouTube e Discord, e uma pequena suíte E2E com extensão carregada em Chromium de teste. Incluir smoke tests para os três navegadores prometidos.

## O que mudar primeiro — plano por fases

### Fase 1 — tornar confiável e pronto para os primeiros usuários (1–2 semanas)

1. Corrigir o desalinhamento de versão e adicionar uma tela “Sobre/Diagnóstico”.
2. Reescrever onboarding: estado do daemon, token, provedor, teste de conexão e primeiro resumo em uma sequência guiada.
3. Tornar “modo teste” inequivocamente visual e impedir que pareça uma resposta de IA real.
4. Adicionar defesa contra prompt injection e aviso de dados enviados ao provedor selecionado.
5. Mostrar cobertura e truncamento em página, YouTube, Discord e Live.
6. Validar permissões, CORS e captura de áudio no Chrome, Brave e Helium antes de qualquer publicação.
7. Criar logs locais exportáveis e erros acionáveis.

### Fase 2 — experiência premium (2–4 semanas)

1. Redesenhar painel, opções e onboarding com uma linguagem visual única.
2. Criar “cartões de tarefa” no resultado: fonte, modelo, tempo, cobertura, custo estimado quando aplicável e ações de repetir/continuar/exportar.
3. Implementar perfis de tarefa: rápido, equilibrado, profundo; e perfis de privacidade: local, econômico, melhor qualidade.
4. Melhorar documentos longos com processamento em etapas e síntese final, em vez de corte seco.
5. Dar ao Live os dois modos de operação: baixa latência e registro completo.
6. Refatorar o painel por módulos e centralizar presets/limites.

### Fase 3 — distribuição sem atrito (4–8 semanas)

1. Criar instalador/bridge desktop ou instalador guiado com inicialização automática.
2. Preparar publicação na Chrome Web Store com permissões minimizadas, política de privacidade ajustada e screenshots reais.
3. Criar atualização segura para daemon e extensão, com tela de compatibilidade de versão.
4. Adicionar backup/restauração local criptografável das configurações, sem enviar segredos ao projeto.
5. Só então expandir para OCR, tradução visual e demais itens do roadmap.

## Direção visual: como fazê-lo parecer premium

Premium aqui não deve significar “mais efeitos”; deve significar calma, previsibilidade, clareza e sensação de controle.

### Identidade

- Manter “Javis” como nome, mas evitar estética de robô genérico ou cópia literal de filmes. A personalidade pode ser discreta: um assistente preciso, reservado e confiável.
- Usar uma marca com monograma simples “J” ou uma forma de bússola/sinal, não apenas o ícone atual como único elemento visual.
- Definir uma paleta escura sofisticada: carvão profundo, superfícies azul-grafite, um único acento elétrico (azul-violeta ou verde-menta) e estados semânticos bem distintos. Não misturar muitos tons saturados.
- Escolher uma tipografia de interface contemporânea e uma escala curta/consistente. O painel atual pode ganhar mais respiro, hierarquia e alinhamento.

### Painel lateral

- Cabeçalho: marca compacta, indicador de conexão com rótulo (“Local e protegido”), seletor de modelo como controle secundário e não como texto apertado.
- Área vazia: substituir o texto genérico por três cartões de início contextual (“Resumir esta página”, “Traduzir uma seleção”, “Perguntar sobre esta aba”).
- Ações: trocar o menu de ações por uma grade/command menu com ícones, descrição curta e estado contextual. Desabilitar elegantemente o que não se aplica à aba atual e explicar o motivo.
- Respostas: usar blocos com título automático, fonte analisada, estado de streaming discreto, seções legíveis e toolbar de ações ao passar o mouse. Manter texto simples por padrão, mas permitir Markdown seguro para resultados estruturados.
- Composer: campo com placeholder que muda conforme a página, botão de enviar mais evidente e mic com estado de gravação visual sem depender apenas de texto.

### Transparência como acabamento premium

Após cada tarefa, um pequeno rodapé pode dizer:

```text
Página atual · 18.400 caracteres lidos · Gemini 2.5 Flash · 4,2 s
Dados enviados somente ao provedor selecionado
```

Isso transforma uma preocupação técnica em valor percebido. Para Ollama, a mensagem seria ainda mais forte: “Processado localmente — nenhum texto saiu deste computador”.

### Configurações

- Separar em três páginas ou abas: Conexão local, IA e privacidade/dados.
- Tratar provedores como “perfis” com propósito (“Melhor qualidade”, “Mais econômico”, “100% local”), não apenas como campos técnicos.
- Exibir diagnóstico de cada perfil: chave válida, modelos disponíveis, última conexão, latência e, quando houver, aviso de cobrança.
- Incluir “apagar todo o histórico”, exportar dados e rotação do token em área de privacidade, com confirmações claras.

## Indicadores para decidir se as mudanças funcionaram

Mesmo sem telemetria remota obrigatória, o usuário pode optar por registrar métricas agregadas locais ou exportar diagnóstico. Os melhores indicadores iniciais seriam:

- taxa de conclusão do onboarding até o primeiro resumo;
- tempo entre instalação e primeira resposta útil;
- taxa de falha por etapa: daemon, token, provedor, extração, Live e STT;
- porcentagem de tarefas com fonte truncada/incompleta;
- uso recorrente por tipo de tarefa, sem guardar conteúdo;
- taxa de abandono no fluxo de Live;
- avaliação explícita “isso respondeu ao que eu precisava?” após resumos longos.

## O que eu evitaria agora

- Não adicionaria novos provedores antes de consolidar instalação, diagnóstico e confiança.
- Não transformaria o painel em um chat cheio de ferramentas autônomas. O valor está em entender o contexto atual do navegador com clareza.
- Não usaria automações que cliquem, publiquem ou executem ações em páginas sem uma camada robusta de revisão humana.
- Não prometeria “100% privado” quando o usuário escolhe um provedor remoto; a promessa correta é controle local, transparência e opção de processamento local.
- Não tentaria reescrever tudo em um framework apenas por estética. Primeiro separar responsabilidades e estabilizar fluxos; a escolha de framework pode vir depois, se trouxer ganho mensurável.

## Veredito

O Javis tem uma fundação melhor do que a média de projetos de extensão: uma ideia fácil de explicar, uma arquitetura que respeita a propriedade dos dados, recursos com utilidade cotidiana e documentação séria. O maior salto para um produto premium vem de três frentes: **instalação sem dor**, **transparência radical sobre dados e cobertura da análise**, e **uma interface calma e altamente polida**.

Se essas três bases forem resolvidas antes de expandir o escopo, o produto pode deixar de parecer “uma extensão com muitas funções” e passar a parecer um assistente pessoal de navegação que o usuário confia em manter aberto todos os dias.

## Arquivos mais relevantes observados

- `README.md` — proposta, instalação, fluxos e documentação de distribuição.
- `extension/manifest.json` — permissões e registro da extensão MV3.
- `extension/background.js` — mediação entre painel, aba, extração e tradução.
- `extension/sidepanel/sidepanel.js` — principal orquestrador da experiência do usuário.
- `extension/options/options.js` — conexão, configurações e perfis de provedores.
- `extension/content/` — leitura de página, YouTube, Discord e tradução contextual.
- `daemon/server.mjs` — API local, autenticação e rotas.
- `daemon/provider.mjs` — integração com provedores e streaming.
- `daemon/config.mjs` e `daemon/stt.mjs` — segredos/configuração e áudio local.
- `tests/test.mjs` — testes existentes do daemon.
