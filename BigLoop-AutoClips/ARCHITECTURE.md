# Arquitetura

```
src/
  shared/                 Código puro (sem Node/Electron), usado por todos — tudo com teste unitário
    types.ts, api.ts      Tipos e contrato da API entre interface e processo principal
    ipc.ts                Nomes dos canais IPC
    ffmpeg.ts             Comando de exportação (filtros, encoders, formatos), parse do ffprobe/progresso
    presets.ts            Presets por rede e tamanhos de saída
    subtitles.ts          SRT/VTT, ASS estilo TikTok, mapeamento de legendas para o tempo do corte
    analysis.ts           Energia/picos do áudio (streaming), silêncios, cenas
    suggest.ts            Sugestões com nota explicável + aprendizado de pesos
    fillers.ts            Remoção de “éé/hum” e pausas por tempo de palavra
    whisper.ts            Leitura do JSON do whisper.cpp
    interchange.ts        FCP XML (Premiere/DaVinci) e EDL
    naming.ts, social.ts, time.ts, validation.ts
  main/                   Processo principal (Node + Electron)
    index.ts              Janela, IPC, bandeja, atalhos, notificações, segredos, ciclo de vida
    media/                ⚠ sem import de "electron" — testável no Node
      export.ts           Executa a exportação: espaço em disco, prioridade, legendas, capa, cancelamento
      analyze.ts          Análise de áudio/cenas e miniaturas
      transcribe.ts       whisper.cpp
      probe.ts, tools.ts  ffprobe; localizar ferramentas e testar encoders de placa de vídeo
    queue.ts              Fila persistente (concorrência, prioridade, pausa, repetir)
    projects.ts           Biblioteca de projetos (JSON atômico por projeto + cache)
    watcher.ts            Pasta monitorada com checagem de arquivo terminado
    obs.ts                Cliente obs-websocket v5 + gerenciador com reconexão e marcadores
    ai.ts                 IA opcional (SDK oficial da Anthropic, saída estruturada)
    settings.ts, jsonFile.ts, logger.ts, diagnostics.ts, mediaProtocol.ts
  preload/index.ts        contextBridge → window.bigloop (sandbox ativado)
  renderer/src/           Interface React
    App.tsx               Navegação, tema, arrastar e soltar, atalhos globais
    views/                Início, Editor, Fila, Configurações, Sobre (as três últimas carregam sob demanda)
    components/           Timeline (canvas), Player (quadro de recorte), painéis de exportação,
                          sugestões, transcrição e lista de trechos
tests/                    Vitest (unitários + integração com FFmpeg real) e e2e/app.e2e.mjs (Electron)
```

## Fluxo de um corte

1. A interface monta um `CutRequest` por trecho (intervalos, opções, legendas, dados da origem) e envia para a fila.
2. A fila chama `startExport`: valida, escolhe nome único, checa espaço, grava o `.ass` num diretório temporário
   e roda `ffmpeg -n -progress pipe:1 -ss … -t … -i origem -filter_complex …` com prioridade baixa.
3. O progresso (`out_time_us`) vira porcentagem e tempo restante; ao terminar, gera SRT e capa se pedido.
4. Erro ou cancelamento apagam o arquivo parcial. O original nunca é alterado.

## Segurança e privacidade

- `contextIsolation`, `nodeIntegration: false`, **`sandbox: true`**; a interface só acessa a API tipada.
- CSP: scripts só do próprio app; mídia e imagens só de `bigloop-media:`.
- O protocolo `bigloop-media://` só serve arquivos importados/gerados e pastas de cache do app.
- Navegação e novas janelas bloqueadas; links externos só `https:` no navegador do sistema.
- Processos externos via `spawn` com lista de argumentos (sem shell).
- Senha do OBS e chave da IA criptografadas com `safeStorage` (DPAPI no Windows); nunca vão para o log; o
  relatório de diagnóstico remove pasta do usuário, nome e segredos.
- A IA (desligada por padrão) recebe apenas o texto da transcrição do trecho.
