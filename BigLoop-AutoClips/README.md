# BigLoop AutoClips

Aplicativo desktop (Electron + React + TypeScript) que transforma gravações longas em cortes curtos,
legendados e prontos para redes sociais. Toda a edição é feita localmente pelo **FFmpeg** — não depende
do Premiere nem do OBS (os dois são integrações opcionais).

> **Estado:** versão 0.2.0. Funciona e foi testado de ponta a ponta em Linux. **Ainda não foi testado no
> Windows** — veja [BUGS_E_DECISOES.md](BUGS_E_DECISOES.md) e [docs/MELHORIAS.md](docs/MELHORIAS.md).

## O que faz

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
- **IA opcional e paga** (Claude, com a sua chave): títulos, descrições, hashtags e tradução de legendas. Há
  versão local gratuita para títulos e hashtags.
- Tema claro/escuro, atalhos (`?`), bandeja, notificações, relatório de diagnóstico sem dados pessoais.

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
| `npm test` | 131 testes (Vitest), incluindo exportações reais com FFmpeg |
| `npm run test:e2e` | Abre o app Electron e percorre o fluxo completo (no Linux sem tela: `xvfb-run -a npm run test:e2e`) |
| `npm run build` | Build de produção em `out/` |
| `npm run dist:win` | Instalador NSIS (rodar no Windows) |

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
