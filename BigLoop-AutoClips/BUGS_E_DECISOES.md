# Bugs e decisões

## Decisões

| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-10 | Projeto único `BigLoop-AutoClips/` com `src/main`, `src/preload`, `src/renderer`, `src/shared` em vez de monorepo `apps/`/`packages/` | Fase 1 não precisa de vários pacotes; o guia permite ajustar a estrutura. Separar quando surgir o plugin Premiere. |
| 2026-10-10 | electron-vite 5 + Vite 7 + React 19 + TypeScript | Template mantido, um só build para main/preload/renderer. Vite 8 ainda não suportado pelo electron-vite 5. |
| 2026-10-10 | FFmpeg chamado direto via `child_process.spawn` (sem wrapper npm) | Menos dependências; controle total dos argumentos e do progresso. |
| 2026-10-10 | FFmpeg não é baixado pelo `npm install` | Evita download de binário em postinstall e questões de licença. Usuário instala ou coloca em `resources/bin`. |
| 2026-10-10 | Dois modos: **preciso** (libx264 CRF 20 + AAC 192k) e **rápido** (`-c copy`) | Copiar é instantâneo mas só corta em keyframe; reencode corta no frame exato. |
| 2026-10-10 | `-ss` antes de `-i` | Busca rápida em arquivos longos; com reencode o FFmpeg ≥ 2.1 continua preciso. Testado: 3,5s pedidos → duração dentro de ±0,1s. |
| 2026-10-10 | Saída sempre `.mp4` com `+faststart`, `-n` e nome único | Compatível com redes sociais; nunca sobrescreve. |
| 2026-10-10 | Preferências em JSON, sem SQLite | Só há 4 preferências. SQLite entra com a fila persistente (Fase 5). |
| 2026-10-10 | Sem serviço Python | Recomendação do guia. Reavaliar na Fase 2 (faster-whisper vs. whisper.cpp). |
| 2026-10-10 | Protocolo `bigloop-media://` com suporte a Range | `file://` é bloqueado no renderer isolado e o `<video>` precisa de Range para buscar posições. |

## Limitações conhecidas

- **Windows não testado ainda.** Todo o desenvolvimento e testes rodaram em Linux (container). Caminhos,
  diálogos nativos e o instalador NSIS precisam de verificação manual no Windows 10/11.
- No modo **rápido**, o corte começa no keyframe anterior ao início pedido (até um GOP a mais de duração).
- O player usa o decodificador do Chromium: arquivos HEVC/H.265 ou alguns MKV podem não exibir prévia,
  mas o corte via FFmpeg funciona normalmente.
- A lista de cortes é só da sessão (não persiste ao fechar o app).
- O renderer tem ~665 kB (React em produção, sem divisão de código) — aceitável para app desktop.

## Bugs

Nenhum bug aberto.

## Registro de verificação (2026-10-10, Linux, FFmpeg 6.1.1)

| Comando | Resultado real |
|---|---|
| `npm run typecheck` | sem erros |
| `npm test` | 3 arquivos, 41 testes, todos passaram |
| `npm run build` | build de main, preload e renderer concluído |
| E2E com Playwright + Electron 44 sob Xvfb (script fora do repositório) | app abriu; vídeo 1280×720 de 20s importado; player carregou pelo `bigloop-media://`; marcado fim em 12,3s com o botão; corte 3,0→12,3s gerado; FFprobe confirmou h264 + aac e duração 9,300s; arquivo corrompido mostrou erro legível; Configurações detectou ffmpeg/ffprobe; nenhum erro no console |

Testes de integração cobrem: metadados, arquivo corrompido/inexistente, corte preciso e rápido
(decodificação completa sem erros), sem áudio, nome duplicado → sufixo `(2)`, intervalo inválido
e cancelamento apagando o arquivo parcial.
