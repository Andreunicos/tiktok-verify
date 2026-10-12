#!/usr/bin/env node
// Imita o yt-dlp: lê -o e o link, imprime progresso, "baixa" (copia FAKE_YTDLP_SRC) e grava o chat.
import { copyFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const url = args[args.length - 1]
const tpl = args[args.indexOf('-o') + 1]
if (url.includes('privado')) {
  console.error('ERROR: [twitch:vod] 123: This video is only available for subscribers')
  process.exit(1)
}
const out = tpl.replace('%(title).80B', 'Minha Live').replace('%(id)s', 'v123').replace('%(ext)s', 'mp4')
for (const p of [0, 35.5, 100]) console.log(`[download]  ${p}% of 10.00MiB at 1.00MiB/s ETA 00:05`)
copyFileSync(process.env.FAKE_YTDLP_SRC, out)
writeFileSync(out.replace(/\.mp4$/, '.rechat.json'), JSON.stringify({ comments: [{ content_offset_seconds: 12.5, message: { body: 'KEKW' } }, { content_offset_seconds: 13, message: { body: 'CLIP IT' } }] }))
console.log(out)
