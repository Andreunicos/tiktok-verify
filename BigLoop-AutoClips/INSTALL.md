# Instalação

## Requisitos (Windows 10/11)

- Node.js LTS (testado com 22.x) e npm, Git
- **FFmpeg** com `ffmpeg.exe` e `ffprobe.exe` (obrigatório)
- Opcional: **whisper.cpp** + um modelo ggml (transcrição local), **OBS Studio 28+** (WebSocket), chave da API
  Anthropic (IA paga)

```powershell
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## FFmpeg

Baixe um build Windows (links em https://ffmpeg.org/download.html), extraia em `C:\ffmpeg` e adicione
`C:\ffmpeg\bin` ao PATH — ou aponte os caminhos em **Configurações → FFmpeg**.

Ordem de busca do app: caminho nas Configurações → variáveis `BIGLOOP_FFMPEG`/`BIGLOOP_FFPROBE` →
`resources\bin\` do instalador → PATH. **Configurações → Salvar e testar** mostra qual foi usado, a versão e as
placas de vídeo que funcionam.

## Rodar

```powershell
cd BigLoop-AutoClips
npm install
npm run dev
```

## Transcrição local (opcional)

1. Baixe o whisper.cpp para Windows (https://github.com/ggml-org/whisper.cpp/releases) — use o `whisper-cli.exe`.
2. Baixe um modelo, por exemplo `ggml-small.bin` (https://huggingface.co/ggerganov/whisper.cpp).
3. Em **Configurações → Transcrição**, aponte os dois arquivos. Idioma padrão: português.

Sem whisper.cpp dá para importar um `.srt`/`.vtt` pronto na aba Transcrição.

## OBS (opcional)

1. No OBS: **Ferramentas → Configurações do servidor WebSocket → Ativar**. Anote porta e senha.
2. No app: **Configurações → OBS**, ligue, informe porta, salve a senha (fica criptografada pelo Windows) e
   clique em **Testar conexão**.
3. Durante a gravação, aperte o atalho (padrão `Ctrl+Shift+M`) para marcar momentos. Ao parar de gravar,
   a gravação é importada com os marcadores.
4. Opcional: **Configurações → Monitoramento** para importar tudo que aparecer na pasta de gravações.

## Premiere / DaVinci

No editor, **Premiere (XML)** ou **EDL** grava em `<pasta de saída>\Premiere e DaVinci\`.
No Premiere: **Arquivo → Importar** e escolha o `.xml`. No DaVinci: **Arquivo → Importar → Linha do tempo**.

## Testes

```powershell
npm run typecheck
npm test
npm run test:e2e
```

## Instalador Windows

1. (Opcional) `powershell -ExecutionPolicy Bypass -File scripts\baixar-ffmpeg.ps1` copia o FFmpeg para
   `resources\bin` e ele vai junto no instalador. **Script não testado.** O build baixado é GPL: ao distribuir o
   instalador, cumpra a licença do FFmpeg.
2. `npm run dist:win` → instalador em `release\`. **Ainda não testado**; sem assinatura digital o Windows
   mostra o aviso de “editor desconhecido”.

## Onde ficam dados e logs

- `%APPDATA%\bigloop-autoclips\settings.json` — configurações (senhas/chaves criptografadas)
- `%APPDATA%\bigloop-autoclips\projetos\` — biblioteca, trechos, transcrições, análises, miniaturas
- `%APPDATA%\bigloop-autoclips\fila.json` — fila de exportação
- `%APPDATA%\bigloop-autoclips\logs\bigloop-autoclips.log` — log (rotaciona em 5 MB)
- `%USERPROFILE%\Videos\BigLoop AutoClips` — cortes (padrão)
