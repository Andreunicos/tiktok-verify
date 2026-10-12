# BigLoop AutoClips

Aplicativo desktop (Electron + React + TypeScript) que transforma gravações longas em cortes curtos,
legendados e prontos para redes sociais. Toda a edição é feita localmente pelo **FFmpeg** — não depende
do Premiere nem do OBS (os dois são integrações opcionais).

> **Estado:** versão 0.3.x. Funciona e foi testado de ponta a ponta em Linux. **Ainda não foi testado no
> Windows** — veja [BUGS_E_DECISOES.md](BUGS_E_DECISOES.md) e [docs/MELHORIAS.md](docs/MELHORIAS.md).

## Jeito rápido: 2 cliques

1. Arraste o vídeo para a janela (ou clique para escolher).
2. Clique em **✨ Gerar cortes**.

O app lê o vídeo, analisa áudio e cenas, transcreve a fala (se as legendas automáticas estiverem ativadas),
escolhe os melhores momentos, tira “éé”, “hum” e pausas silenciosas, e exporta cada corte no formato da
plataforma (9:16 para TikTok/Reels/Shorts, com legenda estilo TikTok, volume ajustado e capa), numa pasta com o
nome do vídeo, mais um `textos para postar.txt` com título e hashtags. As escolhas (plataforma, quantidade,
tamanho, enquadramento) já vêm marcadas com as últimas usadas.

- **Legendas automáticas**: botão “Ativar” na tela inicial baixa o whisper.cpp + modelo (uma vez, ~470 MB).
- **Falta FFmpeg?** Botão “Instalar agora”.
- **Gravações do OBS**: em Configurações → Monitoramento, “Gerar os cortes sozinho quando chegar gravação nova”.
- Quer ajustar à mão? “Ajustar” em cada corte abre o **Editor avançado**.

## Música, efeitos e TikTok

- **Sons** (menu): busca músicas e efeitos no **Openverse** (catálogo aberto que reúne Freesound, Jamendo,
  Wikimedia e outros) filtrando só licenças livres para uso comercial (CC0 e domínio público; CC BY opcional,
  com crédito automático no texto do post). Também importa arquivos seus. Vem com um pacote de **efeitos gerados
  pelo próprio app** (whoosh, pop, ding, impacto, riser, clique, notificação, buzina) — livres (CC0).
- No **Criar cortes**: escolha o clima da música (Animada, Épica, Lo-fi, Calma, Engraçada). A música
  **abaixa sozinha quando alguém fala** (ducking) e entra/sai com fade; opção de efeito sonoro de entrada.
  Se a biblioteca não tiver música do clima, o app baixa algumas do Openverse na hora.
- **TikTok** (Configurações → Contas): conecte com o **seu app** do developers.tiktok.com (Client Key/Secret).
  - **Rascunhos**: manda o corte para a Caixa de entrada do app TikTok; você revisa e posta no celular. Pode
    ser **automático** quando os cortes ficam prontos.
  - **Postar**: publicação direta com a tela de confirmação exigida pelo TikTok (conta, quem pode ver, interações,
    divulgação comercial, consentimento). Até o TikTok auditar o seu app, só posta como “Somente eu”.
  - O login volta pela página `tiktok-callback.html` (GitHub Pages do repositório), que precisa estar
    publicada na branch principal.

## Novidades: link, YouTube, agendamento, A/B e séries

- **Colar link** da live (Twitch, YouTube, Kick…) em vez de arquivo: o app baixa o vídeo e o chat da live
  (yt-dlp, baixado no 1º uso). O chat vira sinal de “momento bom”. Só baixe o que é seu ou tem permissão.
- **Jogo sem fala**: tiros, explosões e impactos no áudio contam como momento de ação.
- **✏️ Editar** em cada corte: título, texto na tela, começo/fim, música e legenda → refaz o corte.
- **Estilos de legenda** (TikTok, MrBeast, Hormozi, Karaokê, Caixa, Discreta) com **emojis coloridos**.
- **Kit da marca** (Configurações → Marca): @, logo, cor e chamada no fim.
- **YouTube Shorts** (Configurações → Contas): conecte com o **seu** cliente OAuth do Google Cloud
  (tipo “App para computador”, YouTube Data API v3 ativada). Botão **▶️ YouTube** em cada corte.
- **📅 Agendar todos**: 1 corte a cada 6/12/24/48 h no TikTok (rascunhos) e/ou YouTube (publicação nativa).
- **Aprende com as visualizações** dos seus posts (48 h depois): mais do que deu certo, menos do que não deu.
- **Mais rápido**: lives longas transcrevem só as partes promissoras; com placa NVIDIA, dá para usar a versão
  CUDA do whisper.cpp (Configurações → Legendas automáticas).
- **Teste A/B** (2 versões de cada corte) e **Série** (Parte 1, 2, 3… seguidas) no Criar cortes, ou escrevendo
  “faz em partes” / “teste A/B” no pedido.

## O que faz (completo)

- **Importar** por botão, Ctrl+O ou arrastar; **biblioteca** com os projetos e trechos salvos.
- **Editor** com player, linha do tempo com zoom, forma de onda, miniaturas, pausas, cenas, marcadores e
  sugestões; trechos com vários pedaços, ajuste quadro a quadro, alças arrastáveis, desfazer/refazer.
- **Sugestões de melhores momentos** com nota explicada (energia, picos, fala, cenas, gancho, cortes limpos)
  que aprende com o que você aprova ou rejeita.
- **Transcrição local** com whisper.cpp (opcional) ou importação de SRT/VTT; busca; clique numa fala para virar
  trecho; remoção automática de “éé”, “hum” e pausas longas.
- **Exportação** em fila (pausar, prioridade, repetir, sobrevive a fechar o app): presets TikTok/Reels/Shorts/…,
  9:16, 1:1, 4:5, 16:9 com recorte, barras ou fundo desfocado; legendas estilo TikTok gravadas no vídeo e/ou SRT;
  velocidade, fades, volume normalizado, escolha/mistura de faixas de áudio, limite de tamanho, capa JPG,
  MP3/WAV/GIF, H.264/H.265 e placa de vídeo (NVIDIA/Intel/AMD) quando disponível.
- **OBS**: conexão por WebSocket, atalho global para marcar momentos durante a live, importação automática ao
  parar de gravar; **pasta monitorada** que só importa arquivos que terminaram de ser gravados.
- **Premiere / DaVinci**: exporta sequência FCP XML e EDL apontando para a gravação original.
- **IA grátis na nuvem** (Groq, com Cerebras e OpenRouter de reserva; chave grátis do usuário) ou **Claude**
  (pago): escolhe os trechos com história completa, acha a frase de gancho, destaca palavras e escreve título,
  descrição e hashtags. Só texto é enviado. Sem IA, tudo funciona com as regras locais.
- **Edição turbinada** no modo automático: não corta no meio da frase, detecta risadas e gritos, repete o gancho
  no começo, zoom rápido nos picos, título na tela, barra de progresso, palavras-chave coloridas na legenda,
  enquadramento que segue a pessoa (ou vídeo inteiro quando é webcam pequena), 27 efeitos sonoros gerados pelo
  app colocados nos momentos certos e 15 trilhas próprias (5 climas × 3 variações).
- Tema claro/escuro, atalhos (`?`), bandeja, notificações, relatório de diagnóstico sem dados pessoais.

## Atualização automática

O app se atualiza sozinho:

1. Cada mudança enviada para o GitHub (branches `main` ou `claude/...`) dispara o robô
   [`bigloop-release.yml`](../.github/workflows/bigloop-release.yml). Ele roda o typecheck e **todos os testes no
   Windows**; **só se passarem**, gera o instalador com versão nova (`0.3.<número>`) e publica em
   [Releases](https://github.com/Andreunicos/tiktok-verify/releases).
2. Ao abrir (e a cada 4 horas), o app instalado consulta essa página, baixa a versão nova em segundo plano e
   mostra uma faixa no topo: reinicia sozinho em 10 segundos (botão “Depois” adia). Se houver cortes rodando,
   instala só quando você fechar o app.
3. Dá para desligar em **Sobre → Atualizar sozinho** e verificar na mão em **Sobre → Verificar agora**.

A **primeira** instalação é manual: baixe `BigLoop-AutoClips-Setup-<versão>.exe` na página de Releases. Como o
instalador não é assinado, o Windows mostra “O Windows protegeu o computador” → **Mais informações → Executar
assim mesmo**. As atualizações seguintes são automáticas.

## Uso rápido

```bash
npm install
npm run dev
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | App em modo desenvolvimento |
| `npm run typecheck` | Verificação de tipos (main/preload e interface) |
| `npm test` | 165 testes (Vitest), incluindo exportações reais com FFmpeg |
| `npm run test:e2e` | Abre o app Electron e percorre o fluxo completo (no Linux sem tela: `xvfb-run -a npm run test:e2e`) |
| `npm run build` | Build de produção em `out/` |
| `npm run dist:win` | Instalador NSIS local, sem publicar (rodar no Windows) |
| `npm run release:win` | Gera e publica no GitHub Releases (usado pelo robô; precisa de `GH_TOKEN`) |

## Versões testadas

Verificado em 2026-10-10 num container Linux:

| Ferramenta | Versão |
|---|---|
| Node.js / npm | 22.22.0 / 10.9.4 |
| Electron | 44.7.0 |
| React | 19.3.0 |
| electron-vite / Vite | 5.0.0 / 7.3.7 |
| FFmpeg / FFprobe | 6.1.1 |
| @anthropic-ai/sdk | 0.133.0 |

## Documentação

- [INSTALL.md](INSTALL.md) — instalação no Windows, FFmpeg, whisper.cpp, OBS, instalador
- [ARCHITECTURE.md](ARCHITECTURE.md) — processos, módulos, segurança
- [ROADMAP.md](ROADMAP.md) — fases do guia e o que falta
- [BUGS_E_DECISOES.md](BUGS_E_DECISOES.md) — decisões, limitações e registro de testes
- [docs/MELHORIAS.md](docs/MELHORIAS.md) — status de cada uma das 100 melhorias
- [CLAUDE.md](CLAUDE.md) — regras para o Claude Code
