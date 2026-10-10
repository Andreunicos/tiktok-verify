# Instalação

## Requisitos (Windows 10/11)

- Node.js LTS (testado com 22.x) e npm
- Git
- FFmpeg com `ffmpeg.exe` e `ffprobe.exe`

Verifique no terminal:

```powershell
node --version
npm --version
git --version
ffmpeg -version
ffprobe -version
```

Se `ffmpeg` não for reconhecido, baixe um build Windows (ex.: gyan.dev ou BtbN, links na
[documentação oficial](https://ffmpeg.org/download.html)), extraia em `C:\ffmpeg` e adicione
`C:\ffmpeg\bin` ao PATH — ou informe o caminho em **Configurações** dentro do app.

## Rodar em desenvolvimento

```powershell
git clone <repo>
cd BigLoop-AutoClips
npm install
npm run dev
```

## Como o app encontra o FFmpeg

Ordem de busca (primeiro que existir):
1. Caminho definido em **Configurações**
2. Variáveis de ambiente `BIGLOOP_FFMPEG` / `BIGLOOP_FFPROBE`
3. `resources\bin\` empacotado com o instalador
4. `PATH` do sistema

A tela **Configurações → Salvar e testar** mostra qual executável foi usado e a versão.

## Testes

```powershell
npm run typecheck
npm test
```

Os testes de integração geram vídeos sintéticos com FFmpeg, fazem cortes reais e conferem o resultado
com FFprobe. Sem FFmpeg no PATH eles são pulados (aparecem como "skipped").

## Gerar instalador Windows

1. (Opcional) copie `ffmpeg.exe` e `ffprobe.exe` para `resources\bin\` para embuti-los no instalador.
   Atenção à licença do build escolhido (LGPL/GPL) antes de distribuir.
2. Rode no Windows:

```powershell
npm run dist:win
```

O instalador NSIS fica em `release\`. **Ainda não testado** — ver ROADMAP.md, Fase 7.

## Onde ficam dados e logs

- Configurações: `%APPDATA%\bigloop-autoclips\settings.json`
- Logs: `%APPDATA%\bigloop-autoclips\logs\bigloop-autoclips.log`
- Cortes: `%USERPROFILE%\Videos\BigLoop AutoClips` (padrão)
