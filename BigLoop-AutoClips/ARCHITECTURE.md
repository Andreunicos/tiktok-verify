# Arquitetura

```
src/
  main/                 Processo principal do Electron (Node)
    index.ts            Janela, IPC, ciclo de vida
    mediaProtocol.ts    Protocolo bigloop-media:// para o player (com Range/seek)
    settings.ts         Preferências em JSON
    logger.ts           Log em arquivo
    media/              ⚠ sem import de "electron" — testável com Vitest
      tools.ts          Localiza ffmpeg/ffprobe e lê versão
      probe.ts          Metadados via ffprobe
      cut.ts            Corte via ffmpeg: progresso, cancelamento, nome único
  preload/index.ts      Ponte segura (contextBridge) → window.bigloop
  renderer/             React (interface)
    src/App.tsx         Tela de corte
    src/components/     Timeline, Metadados, Lista de cortes, Configurações
  shared/               Código puro usado por todos os processos
    types.ts, ipc.ts    Contratos e nomes de canais IPC
    time.ts             Parse/format de timecode
    ffmpeg.ts           Argumentos do FFmpeg, parse do ffprobe e do progresso
    validation.ts       Validação de intervalo
tests/                  Vitest (unitários + integração com FFmpeg real)
resources/bin/          FFmpeg opcional para o instalador
docs/                   Guia do projeto
```

## Fluxo de um corte

1. Renderer chama `window.bigloop.pickVideo()` → diálogo nativo no main.
2. `probe(path)` → main executa `ffprobe -print_format json` → `parseProbeOutput` → `MediaMetadata`.
   O caminho entra numa allowlist do protocolo `bigloop-media://`, usada pelo `<video>`.
3. `startCut(req)` → main valida o intervalo, escolhe nome único e executa
   `ffmpeg -n -progress pipe:1 -ss <início> -i <arquivo> -t <duração> …`.
4. Linhas `out_time_us` viram eventos `cut:progress`; o término vira `cut:done`.
5. Em erro ou cancelamento o arquivo parcial é apagado.

## Segurança

- `contextIsolation: true`, `nodeIntegration: false`; renderer só acessa a API tipada do preload.
- CSP restringe scripts a `'self'` e mídia a `bigloop-media:`.
- O protocolo de mídia só serve arquivos que o usuário importou (allowlist em memória).
- Links externos abrem no navegador do sistema; novas janelas são bloqueadas.
- O FFmpeg é chamado com `spawn` e lista de argumentos (sem shell), evitando injeção por nomes de arquivo.
- `sandbox: false` no preload por simplicidade — revisar na Fase 7.

## Decisões de tecnologia

Ver BUGS_E_DECISOES.md. Resumo: sem serviço Python e sem SQLite por enquanto; ambos entram
quando houver necessidade concreta (transcrição na Fase 2, fila persistente na Fase 5).
