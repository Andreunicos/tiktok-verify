# Status das 100 melhorias

> **Novo:** modo automático de 2 cliques (tela inicial), instalação de legendas e FFmpeg com 1 clique e
> geração automática de cortes quando chega gravação nova do OBS/pasta. Ver README.

Legenda: ✅ feito e testado neste ambiente · 🟡 feito, mas não testado no cenário real (ver observação) · ❌ não feito (motivo)

Ambiente de teste: Linux (container), FFmpeg 6.1.1, Electron 44 sob Xvfb. **Nada foi testado no Windows ainda.**
"Testado" = coberto por teste automatizado (Vitest com FFmpeg real e/ou teste E2E no app Electron).

## Corte e edição
| # | Item | Status |
|---|---|---|
| 1 | Vários cortes de uma vez (lote) | ✅ marque os trechos e exporte todos |
| 2 | Quadro a quadro | ✅ ← / → e botões |
| 3 | Ajuste ±0,1 s / ±1 s / ±5 s | ✅ botões ‹ › (0,1 s), Shift+← → (1 s), J/L (5 s) |
| 4 | Arrastar início/fim na linha do tempo | ✅ alças e arrastar o trecho inteiro |
| 5 | Zoom na linha do tempo | ✅ + / −, Ctrl+roda, “Encaixar” |
| 6 | Forma de onda | ✅ |
| 7 | Miniaturas na linha do tempo | ✅ (cache por projeto) |
| 8 | Silêncios na linha do tempo | ✅ |
| 9 | Encaixar no keyframe (modo rápido) | ❌ não feito; o modo rápido avisa que pode começar no keyframe anterior |
| 10 | Unir vários pedaços num corte | ✅ “+ Unir outro pedaço” |
| 11 | Remover pedaços do meio | ✅ via vários pedaços e “Tirar éé e pausas” |
| 12 | Fade de vídeo | ✅ |
| 13 | Fade de áudio | ✅ |
| 14 | Normalizar volume (−14 LUFS) | ✅ |
| 15 | Escolher faixa de áudio | ✅ |
| 16 | Misturar faixas | ✅ |
| 17 | Velocidade | ✅ 0,5x–2x (motor aceita 0,25x–4x) |
| 18 | Desfazer/refazer | ✅ Ctrl+Z / Ctrl+Shift+Z |
| 19 | Nome por trecho | ✅ |
| 20 | Duplicar trecho | ✅ |

## Exportação
| # | Item | Status |
|---|---|---|
| 21 | Presets (TikTok, Reels, Shorts, YouTube, WhatsApp, Podcast, GIF…) | ✅ 10 presets; limites de duração são só avisos |
| 22 | 9:16 com recorte | ✅ quadro arrastável sobre o vídeo |
| 23 | 1:1 e 4:5 | ✅ |
| 24 | Fundo desfocado | ✅ |
| 25 | Qualidade alta/média/leve | ✅ |
| 26 | Limite de tamanho em MB | ✅ (testado: cabe no limite) |
| 27 | Placa de vídeo (NVENC, Quick Sync, AMF) | 🟡 detecção testa cada encoder de verdade; **sem placa de vídeo aqui para testar o encode** |
| 28 | H.265/HEVC | ✅ (libx265) |
| 29 | Só áudio (MP3/WAV) | ✅ |
| 30 | GIF | ✅ |
| 31 | Capa JPG | ✅ |
| 32 | Modelo de nome de arquivo | ✅ `{nome} {trecho} {inicio} {fim} {duracao} {n} {preset} {formato} {data} {hora}` |
| 33 | Subpasta por vídeo | ✅ |
| 34 | Metadados no arquivo | ✅ título = nome do trecho, comentário |
| 35 | Tempo restante (ETA) | ✅ |

## Fila e desempenho
| # | Item | Status |
|---|---|---|
| 36 | Fila com limite de cortes simultâneos | ✅ 1–4 |
| 37 | Fila sobrevive a fechar o app | ✅ em JSON (não SQLite — ver decisões); interrompidos voltam para a fila |
| 38 | Pausar/retomar | ✅ |
| 39 | Tentar de novo | ✅ |
| 40 | Reordenar | ✅ botões ↑ ↓ (não por arrastar) |
| 41 | Prioridade | ✅ alta/normal/baixa |
| 42 | Bandeja do sistema | 🟡 implementado; ícone provisório; não verificado visualmente no Windows |
| 43 | Notificação ao terminar | 🟡 implementado; não verificado no Windows |
| 44 | Checar espaço em disco | ✅ |
| 45 | FFmpeg com prioridade baixa | ✅ |

## Interface
| # | Item | Status |
|---|---|---|
| 46 | Projetos recentes | ✅ |
| 47 | Biblioteca | ✅ busca, remoção (não apaga o vídeo), aviso de arquivo sumido |
| 48 | Galeria de cortes prontos | ✅ |
| 49 | Ver o corte dentro do app | ✅ |
| 50 | Tela de atalhos (?) | ✅ |
| 51 | Tema claro | ✅ claro/escuro/igual ao sistema |
| 52 | Arrastar corte para fora do app | 🟡 implementado (startDrag); arrastar nativo não é testável no E2E |
| 53 | Dicas (tooltips) | ✅ nos botões e opções principais |
| 54 | Lembrar tamanho/posição da janela | ✅ |
| 55 | Lembrar última pasta | ✅ |
| 56 | Confirmar ao fechar com cortes em andamento | ✅ |
| 57 | Boas-vindas / configurar FFmpeg | ✅ |
| 58 | Progresso no ícone da barra de tarefas | 🟡 implementado; não verificado no Windows |
| 59 | Inglês | ❌ não feito (textos estão direto no código em pt-BR; exige extrair para arquivos de tradução) |
| 60 | Acessibilidade | 🟡 foco visível, rótulos ARIA, teclado; não testado com leitor de tela |

## Inteligência
| # | Item | Status |
|---|---|---|
| 61 | Transcrição local (Whisper) | 🟡 whisper.cpp integrado e **instalável com 1 clique**; testado com whisper e servidor simulados (download real bloqueado neste ambiente) |
| 62 | Clicar numa fala para criar trecho | ✅ Shift+clique seleciona várias |
| 63 | Buscar palavra | ✅ ignora acentos |
| 64 | Sugestões com nota explicada | ✅ |
| 65 | Mudança de cena | ✅ |
| 66 | Picos de áudio | ✅ |
| 67 | Detectar rostos | ❌ não feito (precisa de modelo de visão; o recorte é manual) |
| 68 | Seguir quem fala | ❌ não feito (depende do 67) |
| 69 | Título/hashtags por IA | 🟡 Claude (opcional, pago); testado com API simulada; versão local grátis ✅ |
| 70 | Descrição | 🟡 idem |
| 71 | Remover “éé”, “hum” e pausas | ✅ precisa de tempo por palavra (whisper.cpp) |
| 72 | Traduzir legendas | 🟡 via IA opcional; testado com API simulada |
| 73 | Detectar idioma | 🟡 usa o idioma informado pelo whisper.cpp (`-l auto`) |
| 74 | Nota de qualidade do corte | ✅ avisa se começa/termina no meio de fala |
| 75 | Aprender com aprovações | ✅ pesos ajustados a cada aprovar/rejeitar; dá para zerar |

## Legendas
| # | Item | Status |
|---|---|---|
| 76 | SRT sincronizado | ✅ |
| 77 | Legenda gravada estilo TikTok | ✅ palavra atual destacada |
| 78 | Editor de estilo | ✅ fonte, tamanho, cores, posição, linhas |
| 79 | Modelos de legenda salvos | 🟡 parcial: “Salvar como padrão”; sem lista de modelos nomeados |
| 80 | Prévia ao vivo | 🟡 parcial: prévia do estilo no painel; não sobre o vídeo |
| 81 | Emojis automáticos | 🟡 funcionam, mas o libass desenha emoji **sem cor** |
| 82 | Letras por linha | ✅ |
| 83 | VTT / ASS | 🟡 VTT ✅; ASS é gerado internamente, não exportado como arquivo |

## Integrações
| # | Item | Status |
|---|---|---|
| 84 | Monitorar pasta do OBS | ✅ espera o arquivo parar de crescer e ser liberado |
| 85 | OBS WebSocket | 🟡 testado com um **servidor OBS simulado** (protocolo v5, senha); não com o OBS real |
| 86 | Marcar momentos durante a live | 🟡 atalho global + OBS; testado com OBS simulado |
| 87 | Premiere | 🟡 gera FCP XML (Arquivo → Importar); XML validado, **não importado num Premiere real** |
| 88 | DaVinci (EDL) | 🟡 EDL CMX3600 gerada; não testada no DaVinci |
| 89 | Importar VOD da Twitch/YouTube | ❌ não feito (termos de uso e direitos autorais) |
| 90 | Publicar no TikTok | 🟡 conexão com o app do usuário, rascunhos (manual ou automático) e postagem com confirmação; testado com API simulada |

## Qualidade, segurança e distribuição
| # | Item | Status |
|---|---|---|
| 91 | Testar no Windows | ❌ não há Windows neste ambiente — **próximo passo seu** (CI do GitHub roda testes no Windows) |
| 92 | Instalador testado num Windows limpo | ❌ idem |
| 93 | FFmpeg embutido | 🟡 botão “Instalar agora” baixa o FFmpeg pelo app (testado com servidor local; não no Windows) + script `scripts/baixar-ffmpeg.ps1` |
| 94 | Atualização automática | 🟡 GitHub Releases + electron-updater; atualização testada de verdade com AppImage no Linux; publicação automática no GitHub funcionando (v0.3.3); falta ver um Windows real se atualizando |
| 95 | Sandbox no preload | ✅ |
| 96 | Instalador assinado | ❌ precisa de certificado de assinatura de código (pago) |
| 97 | Testes de interface + CI | ✅ E2E no Electron passando; workflow do GitHub criado (rodou? ver Actions) |
| 98 | Relatório de erro sem dados pessoais | ✅ |
| 99 | Interface carregada em partes | ✅ telas de Fila, Configurações e Sobre carregam sob demanda |
| 100 | Tela Sobre | ✅ |

**Resumo:** 70 ✅ · 22 🟡 · 8 ❌

Extras fora da lista original: biblioteca de sons (Openverse + 27 efeitos gerados), 15 trilhas geradas pelo app (funcionam sem internet), música com ducking, efeitos nos momentos certos, IA grátis na nuvem (Groq/Cerebras/OpenRouter), detecção de risadas e gritos, cortes em frases inteiras, gancho no começo, zoom nos picos, título na tela, barra de progresso, palavras-chave na legenda e enquadramento que segue a pessoa.
