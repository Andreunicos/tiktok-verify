# Bugs e decisões

## Decisões

| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-10 | Projeto único `BigLoop-AutoClips/` (main/preload/renderer/shared) em vez de monorepo | Menos peças; separar quando houver plugin UXP |
| 2026-10-10 | electron-vite 5 + Vite 7 + React 19 + TypeScript | Template mantido; Vite 8 ainda não suportado pelo electron-vite 5 |
| 2026-10-10 | FFmpeg via `spawn`, sem wrapper npm, e não baixado pelo `npm install` | Controle total; evita download em postinstall e questões de licença |
| 2026-10-10 | Um único comando FFmpeg com `-filter_complex` para corte, união, velocidade, proporção, fades, legendas e áudio | Uma passada só; frame exato |
| 2026-10-10 | Legendas gravadas via arquivo `.ass` num diretório temporário e `cwd` do FFmpeg | Evita o escape de caminhos do Windows dentro do filtro |
| 2026-10-10 | Normalização em −14 LUFS (`loudnorm` de uma passada) | Referência comum das redes; uma passada é suficiente para cortes curtos |
| 2026-10-10 | Encoders de placa de vídeo só aparecem se um encode de teste funcionar | O FFmpeg lista NVENC/QSV/AMF mesmo sem a placa |
| 2026-10-10 | Persistência em JSON atômico (configurações, fila, projetos), **não SQLite** | Volume pequeno; SQLite exige módulo nativo recompilado para o Electron. Reavaliar se a biblioteca crescer muito |
| 2026-10-10 | Transcrição com **whisper.cpp** (binário), sem serviço Python | Instalação simples no Windows, sem Python; JSON com tempo por palavra (`-ml 1 -sow`) |
| 2026-10-10 | Sugestões por heurística explicável (sem modelo de IA) + pesos aprendidos | Grátis, local, explicável; o guia pede “pontuação explicável, não promessa de viralização” |
| 2026-10-10 | IA externa opcional, desligada, com a chave do usuário; SDK oficial `@anthropic-ai/sdk`, modelo `claude-opus-5-5`, esforço `low`, saída estruturada (zod), `fallbacks: "default"` | Custos explícitos; só texto sai do computador |
| 2026-10-10 | Premiere via **FCP XML** (e EDL), não plugin UXP | XML funciona em várias versões do Premiere e no DaVinci; a API UXP muda entre versões e não pôde ser testada |
| 2026-10-10 | OBS via obs-websocket v5 (pacote `ws`); importação ao receber `OBS_WEBSOCKET_OUTPUT_STOPPED` | Evento oficial de fim de gravação; a pasta monitorada cobre o caso sem OBS conectado |
| 2026-10-10 | Arquivo “pronto” = tamanho e data estáveis por 2 checagens + abrir para escrita | No Windows o OBS trava o arquivo enquanto grava |
| 2026-10-10 | Preload com `sandbox: true` | Menor superfície de ataque; o preload só usa `contextBridge`, `ipcRenderer` e `webUtils` |
| 2026-10-10 | Atualização automática com **electron-updater + GitHub Releases** do próprio repositório (público, sem token no app) | Padrão do electron-builder; funciona com instalador NSIS sem assinatura |
| 2026-10-10 | Versão = `0.3.<número da execução do robô>`; publica a cada push em `main` ou `claude/**` **somente se typecheck e testes passarem no Windows** | O usuário pediu que toda mudança chegue sozinha; os testes impedem que uma versão quebrada seja publicada |
| 2026-10-10 | Instalação silenciosa, reinício após contagem de 10 s com “Depois”; com cortes rodando, instala só ao fechar | Atualiza rápido sem interromper exportações |
| 2026-10-10 | Instalador por usuário (`perMachine: false`) | Atualizar sem pedir permissão de administrador |
| 2026-10-10 | **Modo automático (2 cliques)** como tela inicial; editor manual vira “Editor avançado” | Pedido do usuário: o app estava confuso; quer mandar o vídeo e receber os cortes prontos |
| 2026-10-10 | Modo automático usa enquadramento “vídeo inteiro com fundo desfocado” por padrão | Seguro para qualquer conteúdo (gameplay com HUD, tela, câmera); “Preencher a tela” fica como opção |
| 2026-10-10 | Limpeza de “éé/pausas” só corta pausa que também é **silêncio no áudio** e é desfeita se tirar mais de 25% do corte | Em gameplay, sem voz não significa sem ação; o teste mostrou um corte de 18 s virando 3 s |
| 2026-10-10 | FFmpeg grava em pasta temporária do app e o arquivo é movido no fim; teste de escrita antes; troca automática da pasta Vídeos bloqueada para `%USERPROFILE%\BigLoop AutoClips` | Erro real do usuário: “Error opening output … No such file or directory” na pasta Vídeos (provável “Acesso controlado a pastas”) |
| 2026-10-10 | Instalação do whisper.cpp/modelo/FFmpeg pelo próprio app (GitHub, Hugging Face, gyan.dev), com SHA-256 do modelo conferido quando o servidor informa | Legendas e FFmpeg em 1 clique, sem o usuário caçar arquivos |
| 2026-10-11 | Música/efeitos via **Openverse** (sem chave) filtrando `license=cc0,pdm` + `license_type=commercial`; CC BY só se o usuário marcar, com crédito automático | Uso comercial nas redes sem risco de direitos e sem obrigação de crédito por padrão |
| 2026-10-11 | Pacote de efeitos **sintetizado pelo app** com FFmpeg (não baixado) | Funciona offline e não tem direitos de terceiros |
| 2026-10-11 | Música com `sidechaincompress` (voz como chave), volume 0,22, fades e `alimiter` | Música não atrapalha a fala; medido: ≥ 6 dB mais baixa sob voz |
| 2026-10-11 | TikTok: OAuth do **app do próprio usuário** (PKCE, porta local 53682, página de retorno no GitHub Pages) | Não embutir segredo de terceiros no app; o TikTok exige redirect https cadastrado |
| 2026-10-11 | Automático = **rascunhos** (inbox); publicação direta só com tela de consentimento a cada post | Regras de UX da Content Posting API do TikTok e a regra do guia de não publicar sem confirmação |
| 2026-10-10 | Sem publicação automática de vídeos, sem apagar originais, sem importar VODs de terceiros | Regra do guia + termos de uso/direitos |

## Limitações conhecidas

- **Windows não testado.** Diálogos nativos, bandeja, notificações, barra de tarefas, atalho global, DPAPI e o
  instalador precisam de verificação manual.
- Transcrição, OBS, Premiere/DaVinci e IA foram testados com **simuladores**, não com os programas reais.
- Emojis nas legendas gravadas saem **sem cor** (limitação do libass).
- Modo rápido (cópia) pode começar no keyframe anterior.
- O player usa o decodificador do Chromium: HEVC ou alguns MKV podem não ter prévia (o corte funciona).
- Interface só em português.
- Instalador **não assinado**: o Windows SmartScreen avisa na primeira instalação. As atualizações seguintes
  não passam pelo SmartScreen, mas também não têm verificação de assinatura (só o checksum SHA-512 do
  `latest.yml`). Um certificado de assinatura de código resolveria.
- Toda versão publicada fica pública na página de Releases (o repositório é público).
- **TikTok, Openverse e downloads não foram testados contra os serviços reais** (rede bloqueada neste ambiente);
  testados com servidores simulados que seguem a documentação. Pontos a confirmar no PC do usuário:
  formato do PKCE do TikTok para desktop (implementado com SHA-256 em hexadecimal, como na documentação do Login
  Kit para desktop) e se o redirect pelo GitHub Pages está publicado.
- `npm audit` aponta avisos em dependências de **desenvolvimento** (vitest/tinypool, electron-builder);
  não vão para o app instalado. Atualizar o vitest para 4.x resolve parte — pendente.

## Bugs

- **Exportação na pasta Vídeos falhava** no PC do usuário (“No such file or directory”). Corrigido com gravação em
  temporário + teste de escrita + troca automática de pasta. **Aguardando confirmação no Windows do usuário.**
- OBS fechado aparecia como erro vermelho; agora mostra “aguardando o OBS abrir” com instruções.

Nenhum outro bug aberto conhecido. Corrigidos durante o desenvolvimento (achados pelos testes):
- Linha do tempo era achatada pelo layout e escondia a faixa de trechos (CSS `flex-shrink`).
- Capa JPG dos cortes não aparecia na galeria (arquivo não liberado no protocolo de mídia).
- Ferramentas não eram reconsultadas ao mudar o caminho do whisper/FFmpeg.
- Recusa da IA não era detectada antes de ler o JSON.
- Publicação: o electron-builder criava releases duplicadas ao enviar arquivos em paralelo (v0.3.1 sem
  `latest.yml`, v0.3.2 duplicada). Corrigido criando a release como rascunho antes; sobras são apagadas pelo robô.

## Registro de verificação (2026-10-10, Linux, FFmpeg 6.1.1, Electron 44.7.0)

| Comando | Resultado real |
|---|---|
| `npm run typecheck` | sem erros |
| `npm test` | 17 arquivos, **165 testes, todos passaram** (~45 s; inclui exportações reais com FFmpeg) |
| `npm run build` | build concluído; Fila/Configurações/Sobre em chunks separados |
| `xvfb-run -a node tests/e2e/app.e2e.mjs` | **passou**, sem erros no console: importar → analisar (10 pausas, 1 cena) → aprovar sugestão → transcrever (whisper simulado) → buscar → trecho por teclado → exportar 2 cortes TikTok 9:16 com legenda e capa (FFprobe confirmou 1080×1920 + áudio) → XML e EDL → apagar e desfazer → OBS simulado (conectar, marcador em 11 s, importar ao parar) → pasta monitorada → configurações, tema, sobre, diagnóstico |
| Teste real de atualização (AppImage Linux, servidor local no lugar do GitHub) | app **0.3.1** abriu → em 4 s achou a 0.3.2 → baixou (checksum ok) → contagem de 10 s → `quitAndInstall` → arquivo instalado passou a ser a 0.3.2 (SHA-256 igual ao publicado) → reaberto, registrou “0.3.2 iniciado” e “não há atualização”. A reabertura automática não ocorreu só porque o container não tem FUSE |
| GitHub Actions — CI (Linux + Windows) | passou: typecheck, 136 testes no Linux e no Windows, E2E no Linux |
| GitHub Actions — publicação | v0.3.3 publicada com `BigLoop-AutoClips-Setup-0.3.3.exe`, `.blockmap` e `latest.yml`; `releases/latest/download/latest.yml` responde `version: 0.3.3` |
| E2E do modo automático (Electron, Xvfb) | 2 cliques (escolher vídeo → Gerar cortes) → 3 cortes 1080×1920 com áudio, capas e `textos para postar.txt`; com whisper simulado a transcrição entra e as legendas são gravadas; OBS simulado ao parar de gravar dispara a geração sozinha (`origin: obs`, marcador preservado) |
| E2E de sons e TikTok (Openverse e TikTok simulados) | efeitos gerados aparecem; busca “calm” → adicionar à biblioteca (clima Calma); 2 cliques com música Calma + efeito → etapa “Colocando música e efeitos” cita a faixa; Configurações → Contas: salvar app, Conectar (retorno local) → “Conectado como André Teste”; corte → Rascunho (arquivo inteiro recebido) → Postar: botão bloqueado até escolher privacidade; post SELF_ONLY com interações desligadas |

## Cortes saindo sem música (2026-10-11)

- **Bug relatado:** depois do teste no Windows, os cortes saíram sem música de fundo.
- **Causa:** a música dependia 100% de baixar faixas do Openverse na hora. Se a busca ou o download falhasse
  (sem internet, limite de buscas, servidor fora, poucas faixas CC0 para o clima), o corte saía sem música — só
  com um aviso nas notas. Além disso, o `break` no erro fazia os cortes seguintes perderem também o efeito de entrada.
- **Correção:**
  - Trilhas geradas pelo próprio app (`src/shared/music.ts`), uma por clima (Pulso Animado, Manhã Calma,
    Horizonte Épico, Tarde Lo-fi, Passinho Engraçado): síntese local, loop perfeito, CC0, funcionam sem internet.
  - Ordem: músicas baixadas/importadas do clima → tenta o Openverse uma vez por sessão (limite de 45 s) → trilha gerada.
  - Erro de música não derruba mais os efeitos dos outros cortes.
  - Ducking mais suave (ratio 10 → 4, limiar 0,01) e volume da música 0,22 → 0,3, para a trilha continuar audível
    embaixo de voz alta. Medido no teste: música cai ~7,8 dB quando há voz (antes ~7 dB com voz baixa, mais com voz alta).
- **Testes:** `tests/music.test.ts` (som em toda a trilha, pico, loop sem estalo, WAV válido); biblioteca gera a trilha
  uma vez; exportação confirma que a música abaixa 6–14 dB sob a voz; E2E com Openverse respondendo 503 usa “Tarde Lo-fi”.

## Edição turbinada e IA grátis (2026-10-11)

Pedido: deixar o app mais inteligente, com mais sons, e IA open source ilimitada sem pesar no PC.

- **IA grátis na nuvem** (`src/main/freeai.ts`): Groq → Cerebras → OpenRouter, todos no formato OpenAI. O app
  lista os modelos da conta e escolhe o melhor de texto (GPT-OSS 120B, Llama 3.3 70B, Qwen…), pede JSON e, se um
  serviço falhar (limite, chave inválida, resposta quebrada), passa para o próximo. Não existe IA web realmente
  ilimitada: os planos grátis têm limites por minuto/dia, mas o app faz 1 pedido por vídeo no modo automático.
  Só texto é enviado. Política de Privacidade e Termos do site atualizados. Decisão: a chave é do usuário
  (nunca embutida no app, que é público).
- **Cérebro** (`src/main/brain.ts`): as regras locais acham até 15 candidatos; a IA dá nota, título, descrição,
  hashtags, frase de gancho e palavras-chave. Nota final = 60% IA + 40% regras. IA fora do ar → só regras + aviso.
- **Risadas e gritos** (`detectReactions` em `src/shared/analysis.ts`): sem IA, pelo áudio. Risada = volume
  acima do normal que pulsa em ritmo de 3–7 Hz; grito = alto, contínuo e áspero (cruzamentos por zero). Viraram a
  característica “Risada/grito” na nota dos trechos. Análises antigas são refeitas uma vez.
- **Frases inteiras** (`snapToSentences`): início/fim puxados para o começo/fim da frase (até 2,5 s antes e 3,5 s depois).
- **Gancho no começo** (`withTeaser`): se a IA aponta uma frase forte (1,2–5 s) que acontece depois de 4 s, ela é
  repetida no início, com efeito “rebobinar” na volta.
- **Efeitos no momento certo** (`planEffects`): whoosh na entrada, impacto no maior pico, ding/pop nas palavras-chave
  (no máximo 6 por corte, com espaçamento). Biblioteca passou de 8 para 27 efeitos gerados (CC0).
- **Trilhas**: 3 variações por clima (tom, andamento e ordem dos acordes); cada corte do mesmo vídeo pega uma diferente.
- **Visual** (`src/shared/ffmpeg.ts`): zoom em degrau com `zoompan` (sem animação para não tremer), barra de
  progresso com `overlay` de uma faixa branca (o `drawbox` não aceita tempo: `t` é a espessura), título em
  caixa branca no topo por 3,2 s e palavras-chave em verde e maiores na legenda (ASS).
- **Enquadramento inteligente** (`src/shared/track.ts`): quadros de 96 px a 2/s, pele + movimento por coluna,
  mediana e zona morta para a “câmera” não tremer. Só recorta quando a pessoa ocupa bastante a imagem; webcam
  pequena de gameplay → vídeo inteiro com fundo desfocado. Novo padrão “Inteligente”; quem usava “Vídeo inteiro”
  (o padrão antigo) passa para ele uma vez.
- **Testes**: `tests/smart.test.ts`, `tests/freeai.test.ts`, exportação real com recorte móvel/zoom/barra/título
  conferida por pixels, modo automático com IA simulada (e IA fora do ar), E2E com Groq simulado (colar chave,
  testar, gerar cortes com a IA). Resultado: typecheck limpo, 209 testes passando, E2E ok.
- **Limites honestos**: a detecção de risada e de pessoa é heurística (pode errar em jogos com muita cor de pele
  ou fala muito animada); a IA grátis depende dos limites e da disponibilidade de cada serviço. Não foi testado
  contra o Groq real daqui (rede bloqueada); o formato é o OpenAI-compatível documentado.
