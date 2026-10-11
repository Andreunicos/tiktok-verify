import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AutoPilot, type AutoDeps } from '../src/main/autopilot'
import { analyzeMedia } from '../src/main/media/analyze'
import { moveNoOverwrite, startExport } from '../src/main/media/export'
import { probeMedia } from '../src/main/media/probe'
import { resolveTool } from '../src/main/media/tools'
import { transcribe } from '../src/main/media/transcribe'
import { ProjectStore } from '../src/main/projects'
import { JobQueue } from '../src/main/queue'
import { DEFAULT_EXPORT } from '../src/shared/presets'
import type { AutoOptions, AutoRun } from '../src/shared/types'

const ffmpeg = resolveTool('ffmpeg', '')
const ffprobe = resolveTool('ffprobe', '')
const dir = join(__dirname, '.tmp-auto')
const fakeWhisper = join(__dirname, 'fixtures', 'fake-whisper.mjs')

/** 90 s: som com pausas a cada 5 s, cena muda no meio. */
function makeLive(path: string) {
  const r = spawnSync(ffmpeg!, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=45',
    '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=45',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=90',
    '-filter_complex', "[0:v][1:v]concat=n=2:v=1[v];[2:a]volume='if(lt(mod(t\\,10)\\,8)\\,1\\,0)':eval=frame[a]",
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path
  ])
  if (r.status !== 0) throw new Error(r.stderr.toString())
}

function setup(withWhisper: boolean, sound?: { music: string; fx: string; attribution?: string | null; fail?: boolean }) {
  const projects = new ProjectStore(join(dir, 'projetos'))
  const outDir = join(dir, withWhisper ? 'cortes-com-legenda' : 'cortes')
  const queue = new JobQueue(null, (job, report) => startExport(job.request, { ffmpegPath: ffmpeg!, onProgress: (_s, r, e) => report(r, e) }), { concurrency: 2 })
  const deps: AutoDeps = {
    probe: (p) => probeMedia(ffprobe!, p),
    openProject: (m, o) => projects.open(m, o),
    getProject: (id) => projects.get(id),
    updateProject: (id, patch) => void projects.update(id, patch),
    getAnalysis: (id) => projects.getAnalysis(id),
    saveAnalysis: (id, a) => projects.saveAnalysis(id, a),
    analyze: (meta, signal, onProgress) => analyzeMedia(meta, { ffmpegPath: ffmpeg!, signal, onProgress: (_s, r) => onProgress(r) }),
    transcriber: () =>
      withWhisper
        ? (path, signal, onProgress) => transcribe(path, { ffmpegPath: ffmpeg!, whisperPath: fakeWhisper, modelPath: fakeWhisper, language: 'pt', threads: 2, signal, onProgress: (_s, r) => onProgress(r) })
        : null,
    pickMusic: sound
      ? async () => {
          if (sound.fail) throw new Error('sem internet')
          return { file: sound.music, title: 'Trilha Teste', attribution: sound.attribution ?? null }
        }
      : undefined,
    pickEffect: sound ? () => sound.fx : undefined,
    enqueue: (req) => queue.add(req),
    cancelJob: (id) => queue.cancel(id),
    getJob: (id) => queue.state().jobs.find((j) => j.id === id),
    exportDefaults: () => DEFAULT_EXPORT,
    outputDir: () => outDir,
    learnedWeights: () => null,
    writeText: async (path, text) => {
      const tmp = `${path}.tmp`
      await writeFile(tmp, text, 'utf8')
      return moveNoOverwrite(tmp, path)
    }
  }
  const pilot = new AutoPilot(deps, null)
  queue.on('progress', (j) => pilot.jobUpdated(j))
  queue.on('finished', (j) => pilot.jobUpdated(j))
  return { pilot, outDir, projects }
}

function waitDone(pilot: AutoPilot, id: string, timeoutMs = 120_000): Promise<AutoRun> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo esgotado')), timeoutMs)
    const check = (r: AutoRun) => {
      if (r.id === id && r.state !== 'rodando') {
        clearTimeout(t)
        pilot.off('change', check)
        resolve(r)
      }
    }
    pilot.on('change', check)
  })
}

const opts = (o: Partial<AutoOptions> = {}): AutoOptions => ({ platform: 'tiktok', count: 3, length: 'curto', subtitles: true, cleanSpeech: true, framing: 'blur', music: 'nenhuma', effects: false, ...o })
const probeJson = (p: string) => JSON.parse(spawnSync(ffprobe!, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', p]).stdout.toString())

describe.skipIf(!ffmpeg || !ffprobe || process.platform === 'win32')('Modo automático de ponta a ponta (FFmpeg real)', () => {
  const live = join(dir, 'minha live.mp4')
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    makeLive(live)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('sem legendas instaladas: escolhe 3 momentos, exporta 9:16 e escreve os textos', async () => {
    const { pilot, outDir } = setup(false)
    const run = pilot.start(live, opts())
    const done = await waitDone(pilot, run.id)
    expect(done.state).toBe('concluído')
    expect(done.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['ler:ok', 'analisar:ok', 'transcrever:pulado', 'escolher:ok', 'limpar:pulado', 'trilha:pulado', 'exportar:ok'])
    expect(done.clips).toHaveLength(3)
    expect(done.notes.join(' ')).toMatch(/sem legenda/)
    const folder = join(outDir, 'minha live')
    expect(done.outputDir).toBe(folder)
    const mp4s = readdirSync(folder).filter((f) => f.endsWith('.mp4'))
    expect(mp4s).toHaveLength(3)
    expect(mp4s.sort()[0]).toMatch(/^001 Melhor momento 1\.mp4$/)
    for (const c of done.clips) {
      expect(existsSync(c.outputPath!)).toBe(true)
      expect(existsSync(c.thumbnail!)).toBe(true)
      const info = probeJson(c.outputPath!)
      const v = info.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
      expect(`${v.width}x${v.height}`).toBe('1080x1920')
      const dur = Number(info.format.duration)
      expect(dur).toBeGreaterThanOrEqual(14)
      expect(dur).toBeLessThanOrEqual(36)
    }
    expect(readFileSync(done.textsFile!, 'utf8')).toMatch(/Hashtags: .*#cortes/)
  })

  it('com legendas: transcreve, reaproveita a análise, grava legenda e limpa pausas', async () => {
    const { pilot, outDir, projects } = setup(true)
    const run = pilot.start(live, opts({ count: 2 }))
    const done = await waitDone(pilot, run.id)
    expect(done.state).toBe('concluído')
    const st = Object.fromEntries(done.steps.map((s) => [s.key, s.state]))
    expect(st).toMatchObject({ analisar: 'ok', transcrever: 'ok', exportar: 'ok' })
    expect(done.steps.find((s) => s.key === 'analisar')!.detail).toBe('Já analisado antes')
    expect(projects.get(done.projectId)!.transcript!.cues.length).toBeGreaterThan(0)
    expect(readdirSync(join(outDir, 'minha live')).filter((f) => f.endsWith('.mp4'))).toHaveLength(2)
  })

  it('música e efeito entram nos cortes e o crédito vai para o texto', async () => {
    const music = join(dir, 'trilha.wav')
    const fx = join(dir, 'whoosh.wav')
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', music])
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.5', fx])
    const { pilot } = setup(false, { music, fx, attribution: '"Trilha Teste" por Fulano — CC BY 4.0' })
    const done = await waitDone(pilot, pilot.start(live, opts({ count: 1, music: 'animada', effects: true })).id)
    expect(done.state).toBe('concluído')
    const st = done.steps.find((s) => s.key === 'trilha')!
    expect(st.state).toBe('ok')
    expect(st.detail).toMatch(/Trilha Teste/)
    expect(done.clips[0].description).toMatch(/CC BY 4\.0/)
    expect(readFileSync(done.textsFile!, 'utf8')).toMatch(/Fulano/)
    // tem áudio no corte (voz + música)
    expect(probeJson(done.clips[0].outputPath!).streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true)
  })

  it('sem internet para música: avisa e continua', async () => {
    const { pilot } = setup(false, { music: '', fx: '', fail: true })
    const done = await waitDone(pilot, pilot.start(live, opts({ count: 1, music: 'calma', effects: false })).id)
    expect(done.state).toBe('concluído')
    expect(done.notes.join(' ')).toMatch(/Sem música de fundo: sem internet/)
  })

  it('cancelar para tudo', async () => {
    const { pilot } = setup(false)
    const run = pilot.start(live, opts({ count: 5 }))
    await new Promise((r) => setTimeout(r, 50))
    pilot.cancel(run.id)
    expect(pilot.get(run.id)!.state).toBe('cancelado')
  })

  it('arquivo sem vídeo dá erro claro', async () => {
    const audio = join(dir, 'audio.mp3')
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=3', audio])
    const { pilot } = setup(false)
    const run = pilot.start(audio, opts())
    const done = await waitDone(pilot, run.id)
    expect(done.state).toBe('erro')
    expect(done.error).toMatch(/não tem vídeo/)
  })

  it('execução interrompida antes da fila vira erro ao reabrir', () => {
    const file = join(dir, 'auto.json')
    writeFileSync(file, JSON.stringify([{ id: 'x', state: 'rodando', clips: [], steps: [{ key: 'analisar', state: 'rodando' }], createdAt: 1 }]))
    const p = new AutoPilot({} as AutoDeps, file)
    expect(p.get('x')).toMatchObject({ state: 'erro' })
    expect(p.get('x')!.error).toMatch(/Refazer/)
  })
})
