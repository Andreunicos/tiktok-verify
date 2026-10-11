import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeMedia, detectScenes, generateThumbnails } from '../src/main/media/analyze'
import { probeMedia } from '../src/main/media/probe'
import { resolveTool } from '../src/main/media/tools'
import { suggestClips } from '../src/shared/suggest'
import { makeVideo } from './helpers'

const ffmpeg = resolveTool('ffmpeg', '')
const ffprobe = resolveTool('ffprobe', '')
const dir = join(__dirname, '.tmp-analyze')
const src = join(dir, 'pausas.mp4')

describe.skipIf(!ffmpeg || !ffprobe)('Análise com FFmpeg real', () => {
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    // 3 s de som, 3 s de silêncio, alternando
    makeVideo(ffmpeg!, src, 24, { silenceEvery: 3 })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('encontra silêncios, energia por segundo e forma de onda', async () => {
    const meta = await probeMedia(ffprobe!, src)
    const stages: string[] = []
    const a = await analyzeMedia(meta, { ffmpegPath: ffmpeg!, onProgress: (s) => stages.push(s) })
    expect(a.hasAudio).toBe(true)
    expect(a.rmsDb.length).toBeGreaterThanOrEqual(23)
    expect(a.peaks.length).toBeGreaterThan(400)
    // silêncios em 3–6, 9–12, 15–18, 21–24
    expect(a.silences.length).toBe(4)
    for (const [i, s] of a.silences.entries()) {
      expect(Math.abs(s.startSec - (3 + i * 6))).toBeLessThan(0.15)
      expect(Math.abs(s.endSec - (6 + i * 6))).toBeLessThan(0.15)
    }
    const sug = suggestClips({ analysis: a, options: { minSec: 5, maxSec: 12, count: 3 } })
    expect(sug.length).toBeGreaterThan(0)
    expect(sug[0].reasons.length).toBeGreaterThan(0)
  })

  it('detecta cortes de cena', async () => {
    const scenes = join(dir, 'cenas.mp4')
    // 3 fontes visuais diferentes coladas: cortes em ~2 s e ~4 s
    const r = spawnSync(ffmpeg!, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'smptebars=size=320x240:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'mandelbrot=size=320x240:rate=25',
      '-filter_complex', '[2:v]trim=duration=2[m];[0:v][1:v][m]concat=n=3:v=1[v]', '-map', '[v]',
      '-c:v', 'libx264', '-preset', 'ultrafast', scenes
    ])
    expect(r.status).toBe(0)
    const times = await detectScenes(scenes, 6, { ffmpegPath: ffmpeg! })
    expect(times).toHaveLength(2)
    expect(Math.abs(times[0] - 2)).toBeLessThan(0.25)
    expect(Math.abs(times[1] - 4)).toBeLessThan(0.25)
  })

  it('cancela a análise', async () => {
    const meta = await probeMedia(ffprobe!, src)
    const ctrl = new AbortController()
    const p = analyzeMedia(meta, { ffmpegPath: ffmpeg!, signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toThrow(/cancelada/)
  })

  it('gera miniaturas e reaproveita cache', async () => {
    const out = join(dir, 'thumbs')
    const t = await generateThumbnails(ffmpeg!, src, 24, 8, out)
    expect(t).toHaveLength(8)
    expect(t[0].timeSec).toBe(1.5)
    const again = await generateThumbnails(ffmpeg!, src, 24, 8, out)
    expect(again.map((x) => x.file)).toEqual(t.map((x) => x.file))
  })
})
