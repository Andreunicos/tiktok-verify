# Roadmap

Legenda: ✅ feito e testado aqui · 🟡 feito, falta testar no cenário real · ⏳ não iniciado

Fases do guia (`docs/Guia_BigLoop_AutoClips_Passo_a_Passo.pdf`). Detalhe item a item em
[docs/MELHORIAS.md](docs/MELHORIAS.md).

| Fase | Estado | Observação |
|---|---|---|
| 1 — App básico e cortes reais | ✅ | |
| 2 — Transcrição | 🟡 | whisper.cpp integrado; testado com whisper simulado (download de modelos bloqueado aqui) |
| 3 — Sugestões de melhores momentos | ✅ | nota explicável + aprendizado |
| 4 — Legendas e formato vertical | ✅ | rastreamento de rosto **não** feito (recorte manual) |
| 5 — Fila e OBS | 🟡 | fila ✅; OBS testado com servidor simulado |
| 6 — Premiere | 🟡 | FCP XML/EDL gerados e validados; não importados num Premiere real; plugin UXP não feito |
| 7 — Acabamento | 🟡 | erros, cancelamento, logs, privacidade ✅; instalador e Windows ⏳ |

## Próximos passos (precisam de você / de um Windows)

1. Rodar `npm install && npm run dev` no Windows e testar com uma gravação real do OBS.
2. Instalar whisper.cpp + modelo e testar a transcrição real em português.
3. Conectar no OBS real (senha) e testar marcadores e importação automática.
4. Importar o XML no seu Premiere e conferir a sequência.
5. `npm run dist:win` e testar o instalador num Windows limpo.

## Checklist de aceitação (do guia)
- [ ] O aplicativo inicia no Windows *(inicia em Linux/Xvfb)*
- [x] Importa um vídeo sem OBS conectado
- [x] Lê metadados corretamente
- [x] Gera um corte real com áudio e vídeo
- [~] Transcreve um trecho com timestamps *(com whisper simulado)*
- [x] Gera legendas corrigíveis
- [x] Cria vídeo vertical e oferece prévia
- [x] A fila mostra erros e progresso
- [x] Não processa uma gravação que ainda está em andamento *(teste com arquivo crescendo)*
- [~] A integração OBS tem teste de conexão e autenticação *(com OBS simulado)*
- [~] A integração Premiere foi testada ou sua limitação está documentada *(documentada)*
- [ ] O instalador foi testado em um ambiente limpo
- [x] Os documentos descrevem o estado real do produto
