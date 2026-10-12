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

function setup(withWhisper: boolean, sound?: { music: string; fx: string; attribution?: string | null; fail?: boolean }, extra: Partial<AutoDeps> = {}) {
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
    },
    ...extra
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
    expect(done.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['ler:ok', 'analisar:ok', 'transcrever:pulado', 'escolher:ok', 'limpar:ok', 'trilha:pulado', 'editar:ok', 'exportar:ok'])
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

  it('IA escolhe os trechos e escreve os textos; edição turbinada aplica título, zoom e barra', async () => {
    const fx = join(dir, 'fx.wav')
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.3', fx])
    let seen = 0
    const { pilot } = setup(true, { music: '', fx }, {
      aiPlan: async (_platform, count, candidates) => {
        seen = candidates.length
        expect(count).toBe(2)
        return {
          via: 'IA de teste',
          clips: candidates.map((c, i) => ({ id: c.id, aiScore: 100 - i * 10, title: `Título da IA ${i + 1}`, description: 'Descrição da IA', hashtags: ['#ia', '#teste'], hook: '', overlay: 'OLHA ISSO', keywords: ['jogar'] }))
        }
      }
    })
    const done = await waitDone(pilot, pilot.start(live, opts({ count: 2, effects: true })).id)
    expect(done.state).toBe('concluído')
    expect(seen).toBeGreaterThan(2) // pediu mais candidatos para a IA escolher
    expect(done.steps.find((s) => s.key === 'escolher')!.detail).toMatch(/IA: IA de teste/)
    expect(done.clips.every((c) => c.title.startsWith('Título da IA'))).toBe(true)
    expect(done.clips[0].hashtags).toEqual(['#ia', '#teste'])
    expect(done.clips[0].reasons[0]).toMatch(/IA: nota/)
    expect(done.steps.find((s) => s.key === 'trilha')!.detail).toMatch(/efeito/)
    expect(done.steps.find((s) => s.key === 'editar')!.detail).toMatch(/título e barra/)
    expect(readFileSync(done.textsFile!, 'utf8')).toMatch(/Descrição da IA/)
    for (const c of done.clips) expect(probeJson(c.outputPath!).streams.find((s: { codec_type: string }) => s.codec_type === 'video').height).toBe(1920)
  })

  it('IA lê a transcrição inteira, o momento dela entra no corte, com texto de gancho; 👍 fica guardado', async () => {
    const { pilot } = setup(true, undefined, {
      aiDiscover: async () => [{ startSec: 61, endSec: 79, reason: 'piada completa' }],
      aiPlan: async (_p, _count, candidates) => ({
        via: 'IA de teste',
        clips: candidates.map((c) => ({ id: c.id, aiScore: c.id.startsWith('ia') ? 99 : 10, title: 'Título', description: 'd', hashtags: ['#a'], hook: '', overlay: 'ELE NÃO ESPERAVA', keywords: [] }))
      })
    })
    const done = await waitDone(pilot, pilot.start(live, opts({ count: 1 })).id)
    expect(done.state).toBe('concluído')
    const c = done.clips[0]
    expect(c.startSec).toBeLessThanOrEqual(61.2)
    expect(c.endSec).toBeGreaterThanOrEqual(78.5)
    expect(c.reasons.join(' ')).toMatch(/IA: piada completa/)
    expect(c.features).toBeTruthy()
    const back = pilot.setFeedback(done.id, c.segmentId, 'up')
    expect(back?.feedback).toBe('up')
    expect(pilot.get(done.id)!.clips[0].feedback).toBe('up')
  })

  it('IA fora do ar: avisa e escolhe pelas regras locais', async () => {
    const { pilot } = setup(true, undefined, { aiPlan: async () => Promise.reject(new Error('Limite grátis do Groq atingido por agora.')) })
    const done = await waitDone(pilot, pilot.start(live, opts({ count: 1 })).id)
    expect(done.state).toBe('concluído')
    expect(done.notes.join(' ')).toMatch(/IA indisponível agora \(Limite grátis do Groq/)
    expect(done.clips).toHaveLength(1)
  })

  it('gameplay sem fala: acha a ação, abre com o pico e usa o layout de jogo', async () => {
    const game = join(dir, 'gameplay.mp4')
    // 0–40 s parado e baixo; 40–60 s ação (imagem mexendo + barulho alto, pico em 52 s); 60–90 s parado
    const r = spawnSync(ffmpeg!, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x334455:size=640x360:rate=30:duration=40',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20',
      '-f', 'lavfi', '-i', 'color=c=0x334455:size=640x360:rate=30:duration=30',
      '-f', 'lavfi', '-i', 'anoisesrc=d=90:a=0.02',
      '-filter_complex',
      "[0:v][1:v][2:v]concat=n=3:v=1[v];[3:a]volume='if(between(t\\,40\\,60)\\,if(between(t\\,51.5\\,53)\\,30\\,8)\\,1)':eval=frame[a]",
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', game
    ])
    expect(r.status).toBe(0)
    const { pilot, projects } = setup(false)
    const done = await waitDone(pilot, pilot.start(game, opts({ count: 1, framing: 'auto', cleanSpeech: true })).id)
    expect(done.state).toBe('concluído')
    const a = projects.getAnalysis(done.projectId)!
    expect(a.motion!.length).toBeGreaterThan(80)
    expect(Math.max(...a.motion!.slice(42, 58))).toBeGreaterThan(Math.max(...a.motion!.slice(5, 35)) + 1)
    const seg = projects.get(done.projectId)!.segments.at(-1)!
    // o corte cobre a ação e abre com o pico (gancho) antes de seguir
    expect(seg.ranges.some((x) => x.startSec <= 52 && x.endSec >= 52)).toBe(true)
    expect(seg.ranges.length).toBeGreaterThanOrEqual(2)
    expect(seg.ranges[0].startSec).toBeGreaterThan(seg.ranges[1].startSec)
    expect(done.clips[0].reasons.join(' ')).toMatch(/ação|Energia|Pico/)
    expect(probeJson(done.clips[0].outputPath!).streams.find((s: { codec_type: string }) => s.codec_type === 'video').height).toBe(1920)
  })

  it('instala as legendas sozinho e segue o pedido escrito (quantidade, duração, IA)', async () => {
    let installed = false
    let request: string | undefined
    const realTranscriber = (path: string, signal: AbortSignal, onProgress: (r: number) => void) =>
      transcribe(path, { ffmpegPath: ffmpeg!, whisperPath: fakeWhisper, modelPath: fakeWhisper, language: 'pt', threads: 2, signal, onProgress: (_s, r) => onProgress(r) })
    const labels: string[] = []
    const { pilot, projects } = setup(false, undefined, {
      transcriber: () => (installed ? realTranscriber : null),
      installTranscriber: async (_signal, onProgress) => {
        onProgress('Baixando o modelo de fala', 0.5)
        labels.push('instalou')
        installed = true
      },
      aiPlan: async (_p, count, candidates, req) => {
        request = req
        return { via: 'IA de teste', clips: candidates.slice(0, count).map((c) => ({ id: c.id, aiScore: 90, title: 'Um título bem chamativo', description: 'd', hashtags: ['#a'], hook: '', overlay: '', keywords: [] })) }
      }
    })
    const live2 = join(dir, 'outra live.mp4')
    makeLive(live2)
    const done = await waitDone(pilot, pilot.start(live2, opts({ count: 5, length: 'longo', instructions: 'faz 2 cortes de 20 segundos dos momentos engraçados' })).id)
    expect(done.state).toBe('concluído')
    expect(labels).toEqual(['instalou'])
    expect(done.steps.find((s) => s.key === 'transcrever')!.state).toBe('ok')
    expect(projects.get(done.projectId)!.transcript!.cues.length).toBeGreaterThan(0)
    expect(done.options.count).toBe(2)
    expect(done.options.music).toBe('engracada')
    expect(done.options.customSec).toEqual({ min: 17, max: 22 })
    expect(done.clips).toHaveLength(2)
    expect(request).toBe('faz 2 cortes de 20 segundos dos momentos engraçados')
    for (const c of done.clips) {
      const dur = Number(probeJson(c.outputPath!).format.duration)
      expect(dur).toBeGreaterThan(12)
      expect(dur).toBeLessThan(32)
    }
  })

  it('série + teste A/B: Parte 1/2/3 seguidas, cada uma com versão B (outro começo e outra legenda)', async () => {
    const { pilot } = setup(true)
    const run = pilot.start(live, opts({ count: 3, framing: 'game', series: true, abTest: true }))
    const done = await waitDone(pilot, run.id, 180_000)
    expect(done.state).toBe('concluído')
    expect(done.clips).toHaveLength(6)
    const a = done.clips.filter((c) => c.variant === 'A')
    const b = done.clips.filter((c) => c.variant === 'B')
    expect(a.map((c) => c.part)).toEqual([{ k: 1, n: 3 }, { k: 2, n: 3 }, { k: 3, n: 3 }])
    expect(a.map((c) => c.title.replace(/^.* — /, ''))).toEqual(['Parte 1/3', 'Parte 2/3', 'Parte 3/3'])
    expect(b.every((c) => /\(versão B\)$/.test(c.title))).toBe(true)
    // partes seguidas, sem buraco nem repetição
    for (let i = 1; i < a.length; i++) expect(a[i].startSec).toBeCloseTo(a[i - 1].endSec, 1)
    // chamada para a próxima parte no fim; a última não tem
    expect(a.map((c) => c.request!.visual?.cta ?? '')).toEqual(['PARTE 2 NO PERFIL', 'PARTE 3 NO PERFIL', ''])
    expect(a[1].request!.visual?.title).toMatch(/^PARTE 2\/3/)
    // versão B usa outro estilo de legenda (tiktok → hormozi)
    expect(a[0].request!.options.subtitleStyle.highlightColor).not.toBe(b[0].request!.options.subtitleStyle.highlightColor)
    expect(done.notes.join(' ')).toMatch(/Série: 3 partes/)
    expect(done.notes.join(' ')).toMatch(/Teste A\/B/)
    for (const c of done.clips) expect(existsSync(c.outputPath!)).toBe(true)
  }, 200_000)

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
