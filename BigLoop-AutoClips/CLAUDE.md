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
- `npm run test:e2e` — teste de ponta a ponta no Electron (Linux sem tela: `xvfb-run -a npm run test:e2e`)
- `npm run build` — build de produção em `out/`
- `npm run dist:win` — instalador NSIS (rodar no Windows)

## Publicação e atualização automática
- Todo push em `main` ou `claude/**` que mexa em `BigLoop-AutoClips/` publica uma versão nova no GitHub Releases
  (se typecheck e testes passarem no Windows) e os apps instalados se atualizam sozinhos.
- Por isso: só envie código com `npm run typecheck`, `npm test` e o E2E passando. Nunca envie trabalho pela metade.
- Não mude `build.publish`, `appId` nem o `owner/repo` sem motivo: isso quebra a atualização dos apps já instalados.

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
- Comunicação interface ↔ main só pela API tipada em `src/shared/api.ts` (canais em `src/shared/ipc.ts`).
- IA externa é opcional, paga e desligada por padrão; nunca envie vídeo/áudio, só texto.
- Status de cada melhoria em `docs/MELHORIAS.md`: atualize ao mudar algo.
