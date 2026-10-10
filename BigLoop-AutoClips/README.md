# BigLoop AutoClips

Aplicativo desktop (Electron + React + TypeScript) para transformar gravações longas em cortes curtos,
prontos para redes sociais. Construído em fases, seguindo `docs/Guia_BigLoop_AutoClips_Passo_a_Passo.pdf`.

## Estado atual — Fase 1 concluída

| Função | Estado |
|---|---|
| Importar vídeo (botão ou arrastar e soltar) | ✅ pronto |
| Ler metadados via FFprobe (duração, resolução, fps, codecs, bitrate) | ✅ pronto |
| Player com linha do tempo, marcar início/fim (atalhos **I**/**O**), prévia do trecho | ✅ pronto |
| Corte manual real em MP4 — modo **preciso** (H.264/AAC) ou **rápido** (cópia) | ✅ pronto |
| Progresso, cancelamento, erros legíveis, "abrir pasta" / "mostrar na pasta" | ✅ pronto |
| Configurações: pasta de saída, caminho do FFmpeg, teste de versão | ✅ pronto |
| Logs em arquivo | ✅ pronto |
| Transcrição, sugestões, legendas, 9:16, OBS, Premiere | ⏳ planejado (ver ROADMAP.md) |

Nada além da tabela acima está implementado. Integrações com OBS e Premiere **ainda não existem**.

## Uso rápido

```bash
npm install
npm run dev
```

1. Clique em **Importar vídeo** ou arraste um arquivo para a janela.
2. Navegue no player; pressione **I** para marcar o início e **O** para marcar o fim (ou digite `mm:ss.mmm`).
3. Escolha o modo, clique em **Gerar corte MP4** e acompanhe o progresso.
4. Use **Mostrar na pasta** para abrir o arquivo gerado.

Os cortes vão para `Vídeos\BigLoop AutoClips` (alterável em Configurações) com nome
`<original>_corte_00h00m03s000-00h00m12s300.mp4`. Arquivos existentes nunca são sobrescritos.

## Versões testadas

Verificado em 2026-10-10 num container Linux (o app ainda **não foi testado em Windows** — ver BUGS_E_DECISOES.md):

| Ferramenta | Versão |
|---|---|
| Node.js | 22.22.0 |
| npm | 10.9.4 |
| Electron | 44.7.0 |
| React | 19.3.0 |
| electron-vite / Vite | 5.0.0 / 7.3.7 |
| FFmpeg / FFprobe | 6.1.1 |

## Documentação

- [INSTALL.md](INSTALL.md) — instalação no Windows, FFmpeg, instalador
- [ARCHITECTURE.md](ARCHITECTURE.md) — processos, módulos, segurança
- [ROADMAP.md](ROADMAP.md) — fases e critérios de aceitação
- [BUGS_E_DECISOES.md](BUGS_E_DECISOES.md) — decisões, limitações e registro de testes
- [CLAUDE.md](CLAUDE.md) — regras para o Claude Code
