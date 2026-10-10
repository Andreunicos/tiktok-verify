#!/usr/bin/env node
// Imita o whisper-cli: lê -of e -f, imprime progresso e grava <of>.json no formato do whisper.cpp (-ml 1 -sow).
import { existsSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const get = (flag) => args[args.indexOf(flag) + 1]
if (!existsSync(get('-f'))) {
  console.error('error: input file not found')
  process.exit(2)
}
if (process.env.FAKE_WHISPER_FAIL) {
  console.error('whisper_init_from_file: failed to load model')
  process.exit(3)
}
for (const p of [0, 50, 100]) console.error(`whisper_print_progress_callback: progress = ${p}%`)
const words = [
  [0, 320, ' Olá'], [320, 700, ' pessoal'], [700, 720, ','], [720, 1100, ' tudo'], [1100, 1500, ' bem?'],
  [1500, 1600, ' [_BEG_]'], [2600, 3000, ' Hoje'], [3000, 3400, ' vamos'], [3400, 3900, ' jogar.']
]
writeFileSync(`${get('-of')}.json`, JSON.stringify({
  params: { model: get('-m'), language: get('-l') },
  result: { language: 'pt' },
  transcription: words.map(([from, to, text]) => ({ offsets: { from, to }, text }))
}))
