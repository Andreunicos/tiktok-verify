import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/projects'
import { FolderWatcher } from '../src/main/watcher'
import { buildEdl, buildFcpXml, fcpRate, smpte, toPathUrl } from '../src/shared/interchange'
import type { MediaMetadata } from '../src/shared/types'
import { spawnSync } from 'node:child_process'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'bl-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const meta = (path: string): MediaMetadata => ({
  path, fileName: 'live.mp4', sizeBytes: 1, durationSec: 100, formatName: 'mp4', bitRate: null,
  video: { codec: 'h264', width: 1920, height: 1080, fps: 30 }, audio: null, audioTracks: []
})

describe('ProjectStore', () => {
  it('abre, atualiza, lista e remove sem apagar o vídeo', () => {
    const dir = tmp()
    const video = join(dir, 'live.mp4')
    writeFileSync(video, 'x')
    const s = new ProjectStore(join(dir, 'projetos'))
    const p = s.open(meta(video), 'manual')
    expect(s.open(meta(video), 'pasta').id).toBe(p.id)
    s.update(p.id, { segments: [{ id: '1', name: 'A', ranges: [{ startSec: 0, endSec: 5 }], createdAt: 0 }] })
    s.addMarkers(p.id, [{ timeSec: 50, label: 'gol', source: 'obs' }, { timeSec: 10, label: 'x', source: 'manual' }])
    s.saveAnalysis(p.id, { durationSec: 100, peaks: [1], bucketSec: 1, rmsDb: [], silences: [], scenes: [], hasAudio: false, createdAt: 0 })
    const again = new ProjectStore(join(dir, 'projetos'))
    expect(again.list()).toMatchObject([{ id: p.id, segments: 1, missing: false, origin: 'manual' }])
    expect(again.get(p.id)!.markers.map((m) => m.timeSec)).toEqual([10, 50])
    expect(again.get(p.id)!.hasAnalysis).toBe(true)
    expect(again.getAnalysis(p.id)!.peaks).toEqual([1])
    again.remove(p.id)
    expect(again.list()).toEqual([])
    expect(again.getAnalysis(p.id)).toBeNull()
    expect(again.get('../../etc')).toBeNull()
  })
})

describe('FolderWatcher', () => {
  it('só entrega o arquivo quando ele para de crescer, uma vez só', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'antigo.mp4'), 'velho')
    const ready: string[] = []
    const w = new FolderWatcher({ dir, intervalMs: 40, stableChecks: 2 })
    w.on('ready', (f) => ready.push(f))
    await w.start()
    const rec = join(dir, 'gravacao.mkv')
    writeFileSync(rec, 'a')
    writeFileSync(join(dir, 'nota.txt'), 'ignorar')
    for (let i = 0; i < 5; i++) {
      await wait(45)
      appendFileSync(rec, 'mais dados')
      expect(ready).toEqual([])
    }
    await wait(400)
    w.stop()
    expect(ready).toEqual([rec])
  })
  it('respeita isKnown e informa erro de pasta', async () => {
    const dir = tmp()
    const w = new FolderWatcher({ dir, intervalMs: 30, isKnown: () => true })
    const ready: string[] = []
    w.on('ready', (f) => ready.push(f))
    await w.start()
    writeFileSync(join(dir, 'x.mp4'), 'abc')
    await wait(200)
    w.stop()
    expect(ready).toEqual([])
    const bad = new FolderWatcher({ dir: join(dir, 'nao-existe') })
    await bad.scan()
    expect(bad.lastError).toMatch(/Não foi possível ler/)
  })
})

describe('Premiere / DaVinci', () => {
  const src = { path: 'C:\\Gravações\\minha live.mp4', fileName: 'minha live.mp4', durationSec: 600, width: 1920, height: 1080, fps: 29.97, audioChannels: 2, sampleRate: 48000 }
  const segs = [
    { id: '1', name: 'Jogada & "gol"', ranges: [{ startSec: 10, endSec: 20 }], createdAt: 0 },
    { id: '2', name: 'Final', ranges: [{ startSec: 100, endSec: 105 }, { startSec: 110, endSec: 112 }], createdAt: 0 }
  ]
  it('taxa NTSC e pathurl do Windows', () => {
    expect(fcpRate(29.97)).toEqual({ timebase: 30, ntsc: true })
    expect(fcpRate(25)).toEqual({ timebase: 25, ntsc: false })
    expect(fcpRate(60)).toEqual({ timebase: 60, ntsc: false })
    expect(toPathUrl(src.path)).toBe('file://localhost/C:/Grava%C3%A7%C3%B5es/minha%20live.mp4')
    expect(toPathUrl('/home/u/a b.mp4')).toBe('file://localhost/home/u/a%20b.mp4')
  })
  it('FCP XML bem formado com clipes, áudio e marcadores', () => {
    const x = buildFcpXml('Cortes', src, segs)
    expect(x).toContain('<ntsc>TRUE</ntsc>')
    expect(x.match(/<clipitem id="clip-\d+-v">/g)).toHaveLength(3)
    expect(x.match(/<clipitem id="clip-\d+-a\d">/g)).toHaveLength(6)
    expect(x.match(/<file id="file-1">/g)).toHaveLength(1)
    expect(x).toContain('Jogada &amp; &quot;gol&quot;')
    expect(x).toContain('<in>300</in><out>599</out>')
    const py = spawnSync('python3', ['-c', 'import sys,xml.dom.minidom as m; m.parseString(sys.stdin.read()); print("ok")'], { input: x })
    if (py.status !== null && !py.error) expect(py.stdout.toString().trim()).toBe('ok')
  })
  it('EDL CMX3600', () => {
    expect(smpte(3661.5, 30)).toBe('01:01:01:15')
    const edl = buildEdl('Cortes', src, segs)
    expect(edl).toContain('FCM: NON-DROP FRAME')
    expect(edl).toContain('001  AX       AA/V  C        00:00:10:00 00:00:20:00 01:00:00:00 01:00:10:00')
    expect(edl).toContain('003  AX       AA/V  C        00:01:50:00 00:01:52:00 01:00:15:00 01:00:17:00')
    expect(edl).toContain('* COMMENT: Final')
  })
})
