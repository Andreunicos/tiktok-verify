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
| `npm test` | 15 arquivos, **149 testes, todos passaram** (~45 s; inclui exportações reais com FFmpeg) |
| `npm run build` | build concluído; Fila/Configurações/Sobre em chunks separados |
| `xvfb-run -a node tests/e2e/app.e2e.mjs` | **passou**, sem erros no console: importar → analisar (10 pausas, 1 cena) → aprovar sugestão → transcrever (whisper simulado) → buscar → trecho por teclado → exportar 2 cortes TikTok 9:16 com legenda e capa (FFprobe confirmou 1080×1920 + áudio) → XML e EDL → apagar e desfazer → OBS simulado (conectar, marcador em 11 s, importar ao parar) → pasta monitorada → configurações, tema, sobre, diagnóstico |
| Teste real de atualização (AppImage Linux, servidor local no lugar do GitHub) | app **0.3.1** abriu → em 4 s achou a 0.3.2 → baixou (checksum ok) → contagem de 10 s → `quitAndInstall` → arquivo instalado passou a ser a 0.3.2 (SHA-256 igual ao publicado) → reaberto, registrou “0.3.2 iniciado” e “não há atualização”. A reabertura automática não ocorreu só porque o container não tem FUSE |
| GitHub Actions — CI (Linux + Windows) | passou: typecheck, 136 testes no Linux e no Windows, E2E no Linux |
| GitHub Actions — publicação | v0.3.3 publicada com `BigLoop-AutoClips-Setup-0.3.3.exe`, `.blockmap` e `latest.yml`; `releases/latest/download/latest.yml` responde `version: 0.3.3` |
| E2E do modo automático (Electron, Xvfb) | 2 cliques (escolher vídeo → Gerar cortes) → 3 cortes 1080×1920 com áudio, capas e `textos para postar.txt`; com whisper simulado a transcrição entra e as legendas são gravadas; OBS simulado ao parar de gravar dispara a geração sozinha (`origin: obs`, marcador preservado) |
