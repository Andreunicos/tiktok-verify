# Conversor WAV (app para Windows)

Converte qualquer áudio (MP3, M4A, OGG, FLAC, OPUS, WMA, AIFF, MP4…) para WAV.
Aceita arquivos e pastas inteiras (com subpastas), salva ao lado do original ou em outra pasta
e pode mandar o original para a Lixeira depois. A conversão usa o ffmpeg embutido.

## Atualização automática

O app confere a última release deste repositório ao abrir. Se houver versão nova, baixa,
e reinicia sozinho para instalar (se estiver convertendo, espera você clicar em
"Reiniciar e atualizar" ou fechar o app). O botão **Verificar atualização** fica sempre no topo.

## Publicar uma nova versão

1. Mude `version` em `conversor-wav-app/package.json` (ex.: `1.0.1`) e faça commit.
2. Suba a tag com o mesmo número:

   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. O workflow `Release Conversor WAV` gera o instalador no GitHub e publica a release.
   Quem já tem o app instalado recebe a atualização na próxima abertura.

## Desenvolvimento

```
cd conversor-wav-app
npm install
npm start      # abre o app (a atualização só funciona no app instalado)
npm test       # testa a conversão com o ffmpeg de verdade
```

O instalador não é assinado, então o Windows pode mostrar o aviso do SmartScreen na primeira
instalação ("Mais informações" → "Executar assim mesmo").
