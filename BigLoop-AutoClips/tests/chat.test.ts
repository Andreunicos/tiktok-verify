import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectGameEvents, PcmAnalyzer } from '../src/shared/analysis'
import { chatHype, parseChat } from '../src/shared/chat'
import { suggestClips } from '../src/shared/suggest'
import { buildDownloadArgs, downloadVideo, findChatFile, parseYtDlpProgress } from '../src/main/media/download'
import type { AnalysisResult } from '../src/shared/types'

const dir = join(__dirname, '.tmp-chat')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('chat da live', () => {
  it('lê o formato do YouTube (live_chat.json, uma linha por ação)', () => {
    const line = (ms: number, text: string) =>
      JSON.stringify({ replayChatItemAction: { videoOffsetTimeMsec: String(ms), actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text }, { emoji: { shortcuts: [':joy:'] } }] } } } } }] } })
    const msgs = parseChat([line(1500, 'kkkkk'), line(3000, 'que isso')].join('\n'))
    expect(msgs).toEqual([{ t: 1.5, text: 'kkkkk:joy:' }, { t: 3, text: 'que isso:joy:' }])
  })
  it('lê os formatos da Twitch (v5 "comments" e GraphQL "fragments")', () => {
    expect(parseChat(JSON.stringify({ comments: [{ content_offset_seconds: 7, message: { body: 'KEKW' } }] }))).toEqual([{ t: 7, text: 'KEKW' }])
    const gql = [{ node: { contentOffsetSeconds: 9, message: { fragments: [{ text: 'Pog' }, { text: 'Champ' }] } } }]
    expect(parseChat(JSON.stringify(gql))).toEqual([{ t: 9, text: 'PogChamp' }])
  })
  it('lê texto simples com horário', () => {
    expect(parseChat('[0:01:05] joao: CLIP\n01:02:03 maria: kkkk\nlixo')).toEqual([
      { t: 65, text: 'CLIP' },
      { t: 3723, text: 'kkkk' }
    ])
  })
  it('hype: o pico do chat aparece uns segundos antes de quando chegou (atraso do chat)', () => {
    const msgs = []
    for (let t = 0; t < 300; t += 3) msgs.push({ t, text: 'oi' })
    for (let k = 0; k < 40; k++) msgs.push({ t: 154 + k * 0.1, text: 'KKKKKK CLIP' })
    const h = chatHype(msgs, 300)
    const peak = h.indexOf(Math.max(...h))
    expect(peak).toBeGreaterThanOrEqual(146)
    expect(peak).toBeLessThanOrEqual(152)
    expect(h[50]).toBe(0)
  })
  it('chat explodindo vira ponto a favor do trecho', () => {
    const hype = Array(200).fill(0)
    for (let i = 120; i < 130; i++) hype[i] = 1
    const analysis: AnalysisResult = { durationSec: 200, peaks: [], bucketSec: 1, rmsDb: Array(200).fill(-25), silences: [], scenes: [], hasAudio: true, createdAt: 0, chatHype: hype }
    const s = suggestClips({ analysis, options: { minSec: 20, maxSec: 30, count: 1 } })
    expect(s[0].startSec).toBeLessThanOrEqual(120)
    expect(s[0].endSec).toBeGreaterThanOrEqual(125)
    expect(s[0].reasons.join(' ')).toMatch(/chat explodiu/)
  })
})

describe('eventos do jogo pelo som', () => {
  it('acha tiros (curtos e ásperos) e explosões (longas e graves)', () => {
    const SR = 8000
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)
    const buf = new Uint8Array(20 * SR * 2)
    const v = new DataView(buf.buffer)
    for (let i = 0; i < 20 * SR; i++) {
      const t = i / SR
      let x = 0.02 * (rnd() * 2 - 1) // fundo do jogo
      for (const shot of [5, 5.6, 6.2]) if (t >= shot && t < shot + 0.08) x += 0.7 * (rnd() * 2 - 1) * Math.exp(-(t - shot) * 30)
      if (t >= 12 && t < 13.5) x += 0.8 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-(t - 12) * 1.5)
      v.setInt16(i * 2, Math.max(-1, Math.min(1, x)) * 32767, true)
    }
    const a = new PcmAnalyzer(SR)
    a.push(buf)
    a.flush()
    const ev = detectGameEvents(a.rmsDb, a.zcr)
    expect(ev.filter((e) => e.kind === 'tiro').map((e) => Math.round(e.t * 10) / 10)).toEqual([5, 5.6, 6.2])
    expect(ev.some((e) => e.kind === 'explosao' && Math.abs(e.t - 12) < 0.2)).toBe(true)
  })
  it('som constante não gera eventos', () => {
    expect(detectGameEvents(Array(400).fill(-20), Array(400).fill(0.3))).toEqual([])
  })
})

describe('baixar por link (yt-dlp)', () => {
  it('monta os argumentos certos e lê o progresso', () => {
    const a = buildDownloadArgs(' https://www.twitch.tv/videos/123 ', { outDir: '/tmp/x', ffmpegDir: '/ff' })
    expect(a).toContain('--write-subs')
    expect(a[a.indexOf('--sub-langs') + 1]).toBe('rechat,live_chat')
    expect(a[a.indexOf('--ffmpeg-location') + 1]).toBe('/ff')
    expect(a.at(-1)).toBe('https://www.twitch.tv/videos/123')
    expect(parseYtDlpProgress('[download]  42.5% of 1.00GiB')).toBe(0.425)
    expect(parseYtDlpProgress('[Merger] Merging')).toBeNull()
  })
  it.skipIf(process.platform === 'win32')('baixa, acha o chat ao lado e explica erros', async () => {
    mkdirSync(dir, { recursive: true })
    const src = join(dir, 'fonte.mp4')
    writeFileSync(src, 'video falso')
    process.env.FAKE_YTDLP_SRC = src
    const ytdlp = join(__dirname, 'fixtures', 'fake-ytdlp.mjs')
    spawnSync('chmod', ['+x', ytdlp])
    const progress: number[] = []
    const r = await downloadVideo('https://www.twitch.tv/videos/123', { ytdlp, outDir: join(dir, 'out'), onProgress: (_l, p) => progress.push(p) })
    expect(r.videoPath).toBe(join(dir, 'out', 'Minha Live [v123].mp4'))
    expect(existsSync(r.videoPath)).toBe(true)
    expect(r.chatPath).toBe(join(dir, 'out', 'Minha Live [v123].rechat.json'))
    expect(findChatFile(r.videoPath)).toBe(r.chatPath)
    expect(progress).toContain(0.355)
    await expect(downloadVideo('https://www.twitch.tv/videos/privado', { ytdlp, outDir: join(dir, 'out') })).rejects.toThrow(/privado ou só para membros/)
    await expect(downloadVideo('isso nao e link', { ytdlp, outDir: join(dir, 'out') })).rejects.toThrow(/não parece um link/)
  })
})
