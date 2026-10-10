# BigLoop AutoClips

Aplicativo desktop para Windows que transforma gravações longas em cortes curtos e legendados.
Inspirado no fluxo do OpusClip — ferramenta própria, sem copiar código de terceiros.

## Antes de mudar algo
- Leia README.md e ARCHITECTURE.md antes de mudanças relevantes.
- Veja em ROADMAP.md qual fase está em andamento; não pule fases.
- Registre decisões e bugs em BUGS_E_DECISOES.md.

## Comandos
- `npm install` — dependências
- `npm run dev` — app em modo desenvolvimento
- `npm run typecheck` — TypeScript (main/preload e renderer)
- `npm test` — Vitest (unitários + integração com FFmpeg real; integração é pulada se não houver FFmpeg)
- `npm run build` — build de produção em `out/`
- `npm run dist:win` — instalador NSIS (rodar no Windows)

## Regras
- Não invente resultados de testes. Rode os comandos e relate a saída real.
- Não apague nem sobrescreva arquivos do usuário sem autorização. O FFmpeg roda com `-n` e o nome de saída ganha sufixo `(2)`, `(3)`…
- O arquivo original nunca é modificado.
- Nunca grave segredos (senha do OBS, tokens) no código, nos logs ou no repositório.
- Implemente em etapas pequenas e testáveis; atualize ROADMAP.md e BUGS_E_DECISOES.md.
- Prefira processamento local para mídia. Custos de APIs externas precisam ser explícitos e opcionais.
- Documente limites das integrações OBS e Premiere; não prometa o que não foi testado.
- Código de mídia em `src/main/media/` não importa `electron` — assim é testável com Vitest em Node puro.
- Lógica pura (parse/format/args) fica em `src/shared/` e tem teste unitário.
- Textos de interface em português do Brasil.
