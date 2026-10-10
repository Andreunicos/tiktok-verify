# Roadmap

Legenda: ✅ feito e verificado · 🟡 parcial · ⏳ não iniciado

## Fase 1 — Aplicativo básico e cortes reais ✅
- ✅ Janela desktop e navegação (Cortar / Configurações)
- ✅ Importar vídeo por seletor de arquivos e arrastar-e-soltar
- ✅ Ler metadados via FFprobe
- ✅ Definir início e fim manualmente (campos, botões, atalhos I/O, linha do tempo)
- ✅ Executar FFmpeg e gerar MP4 real (modos preciso e rápido; com ou sem áudio)
- ✅ Progresso, erros, cancelamento, abrir pasta de saída
- **Critério de aceite:** importar vídeo de teste, criar corte, reproduzir e verificar áudio e imagem.
  Verificado automaticamente (testes de integração + E2E no Electron) em Linux.
  🟡 Falta confirmação manual no Windows.

## Fase 2 — Transcrição ⏳
- Avaliar faster-whisper (Python) vs. whisper.cpp (binário nativo, sem Python) no Windows
- Texto com timestamps por palavra/frase
- Selecionar fala → definir intervalo de corte
- Correção manual da transcrição
- Testar com vídeo curto, longo e áudio com ruído

## Fase 3 — Sugestões de melhores momentos ⏳
- Sinais: transcrição, pausas (silencedetect), mudanças de cena (scdetect)
- Pontuação editorial explicável (sem promessa de viralização)
- Remover duplicadas, configurar duração, mostrar o motivo de cada sugestão

## Fase 4 — Legendas e formato vertical ⏳
- SRT sincronizado; legenda incorporada ou arquivo separado
- Presets 9:16, 16:9, 1:1 com recorte central e ajuste manual
- Rastreamento de rosto só quando implementado e testado

## Fase 5 — Fila e monitoramento do OBS ⏳
- Fila persistente (SQLite) com estados aguardando/processando/concluído/erro
- OBS WebSocket com autenticação (senha fora do repositório/logs)
- Monitorar pasta de gravação; esperar o arquivo terminar; evitar duplicatas; liga/desliga

## Fase 6 — Premiere Pro ⏳
- Verificar versão e APIs UXP disponíveis
- Plugin UXP ou pacote de intercâmbio (mídia + metadados)
- Testar em cópia do projeto; documentar o que é automático e o que é manual

## Fase 7 — Acabamento ⏳
- Falhas de FFmpeg, vídeos corrompidos, disco cheio (parte já tratada na Fase 1)
- Repetição de tarefas, logs, revisão de privacidade e `sandbox` do preload
- Instalador Windows testado em ambiente limpo

## Checklist de aceitação (do guia)
- [ ] O aplicativo inicia no Windows *(inicia em Linux/Xvfb; Windows não testado)*
- [x] Importa um vídeo sem OBS conectado
- [x] Lê metadados corretamente
- [x] Gera um corte real com áudio e vídeo
- [ ] Transcreve um trecho com timestamps
- [ ] Gera legendas corrigíveis
- [ ] Cria vídeo vertical e oferece prévia
- [x] A lista de cortes mostra erros e progresso *(fila completa na Fase 5)*
- [ ] Não processa uma gravação que ainda está em andamento
- [ ] A integração OBS tem teste de conexão e autenticação
- [ ] A integração Premiere foi testada ou sua limitação está documentada
- [ ] O instalador foi testado em um ambiente limpo
- [x] Os documentos descrevem o estado real do produto
