import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { basename, dirname, extname, join } from 'node:path'
import { DEFAULT_FILLER_OPTIONS, removeFillers } from '../shared/fillers'
import { applyPreset } from '../shared/presets'
import { hashtags as localHashtags, localTitle } from '../shared/social'
import { findPhrase, peakTeaserRange, planEffects, planZooms, removeDeadTime, snapToSentences, toOutputTime as toOut, totalLength, withTeaser } from '../shared/smart'
import { outputSize } from '../shared/presets'
import { suggestClips } from '../shared/suggest'
import { formatTimecode } from '../shared/time'
import type {
  AnalysisResult,
  AutoClip,
  AutoLength,
  AutoOptions,
  AutoRun,
  AutoStep,
  AutoStepKey,
  CutRequest,
  AudioExtras,
  ExportOptions,
  Job,
  Mood,
  MediaMetadata,
  Project,
  Range,
  Segment,
  SuggestionFeatures,
  Transcript,
  VisualExtras
} from '../shared/types'
import type { TrackDecision } from '../shared/track'
import { blendScore, type PlanCandidate, type PlannedClip } from './brain'
import { readJson, writeJsonAtomic } from './jsonFile'

export const LENGTHS: Record<AutoLength, { minSec: number; maxSec: number; label: string }> = {
  curto: { minSec: 15, maxSec: 35, label: '15–35 s' },
  medio: { minSec: 30, maxSec: 60, label: '30–60 s' },
  longo: { minSec: 55, maxSec: 120, label: '1–2 min' }
}

const STEP_LABELS: Record<AutoStepKey, string> = {
  ler: 'Lendo o vídeo',
  analisar: 'Analisando áudio e cenas',
  transcrever: 'Transcrevendo a fala',
  escolher: 'Escolhendo os melhores momentos',
  limpar: 'Tirando enrolação e tempo parado',
  trilha: 'Colocando música e efeitos',
  editar: 'Enquadramento, zoom e título',
  exportar: 'Criando os cortes'
}

const PLATFORM_LABEL = { tiktok: 'TikTok', reels: 'Reels', shorts: 'Shorts', youtube: 'YouTube' } as const

export interface AutoDeps {
  probe(path: string): Promise<MediaMetadata>
  openProject(meta: MediaMetadata, origin: Project['origin']): Project
  getProject(id: string): Project | null
  updateProject(id: string, patch: Partial<Project>): void
  getAnalysis(id: string): AnalysisResult | null
  saveAnalysis(id: string, a: AnalysisResult): void
  analyze(meta: MediaMetadata, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<AnalysisResult>
  /** null quando a transcrição não está configurada. */
  transcriber: (() => ((path: string, signal: AbortSignal, onProgress: (ratio: number) => void) => Promise<Transcript>) | null)
  /** Texto para redes com IA (opcional). Retorna null se desligada. */
  aiSocial?: (text: string, platform: string) => Promise<{ title: string; description: string; hashtags: string[] } | null>
  /** Música do clima pedido (da biblioteca ou baixada). Lança erro se não conseguir. */
  pickMusic?: (mood: Mood, signal: AbortSignal, index?: number) => Promise<{ file: string; title: string; attribution: string | null; generated?: boolean } | null>
  /** Arquivo de um efeito gerado (ex.: 'whoosh'). */
  pickEffect?: (key: string) => string | null
  /** IA (grátis ou Claude) que escolhe os melhores trechos e escreve os textos. null = desligada. */
  aiPlan?: (platform: string, count: number, candidates: PlanCandidate[]) => Promise<{ via: string; clips: PlannedClip[] } | null>
  /** Decide o enquadramento 9:16 seguindo a pessoa. */
  track?: (path: string, span: Range, srcW: number, srcH: number, cropFrac: number, signal: AbortSignal) => Promise<TrackDecision>
  enqueue(req: CutRequest): Job
  cancelJob(id: string): void
  getJob(id: string): Job | undefined
  exportDefaults(): ExportOptions
  outputDir(): string
  learnedWeights(): Record<keyof SuggestionFeatures, number> | null
  /** Grava texto sem sobrescrever; retorna o caminho final. */
  writeText(path: string, text: string): Promise<string>
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void
}

class Cancelled extends Error {
  constructor() {
    super('Cancelado.')
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const round = (n: number) => Math.round(n * 1000) / 1000
const clipText = (cues: Transcript['cues'] | undefined, ranges: Range[]) =>
  (cues ?? [])
    .filter((c) => ranges.some((r) => c.endSec > r.startSec + 0.05 && c.startSec < r.endSec - 0.05))
    .map((c) => c.text.trim())
    .join(' ')

/**
 * Piloto automático: recebe um vídeo e entrega os melhores cortes prontos para postar.
 * Emite 'change' (AutoRun) a cada mudança. Não publica nada nem apaga o original.
 */
export class AutoPilot extends EventEmitter {
  private runs: AutoRun[]
  private controllers = new Map<string, AbortController>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly deps: AutoDeps,
    private readonly file: string | null
  ) {
    super()
    const saved = file ? readJson<AutoRun[]>(file, []) : []
    // Execuções interrompidas antes de enviar os cortes para a fila não continuam sozinhas.
    this.runs = saved.map((r) =>
      r.state === 'rodando' && !r.clips.some((c) => c.jobId)
        ? { ...r, state: 'erro', error: 'Interrompido quando o app fechou. Clique em “Refazer”.', steps: r.steps.map((s) => (s.state === 'rodando' ? { ...s, state: 'erro' } : s)) }
        : r
    )
  }

  list(): AutoRun[] {
    return [...this.runs].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): AutoRun | undefined {
    return this.runs.find((r) => r.id === id)
  }

  remove(id: string): void {
    this.cancel(id)
    this.runs = this.runs.filter((r) => r.id !== id)
    this.save()
  }

  isBusy(): boolean {
    return this.runs.some((r) => r.state === 'rodando')
  }

  /** Começa a gerar cortes. Retorna na hora; o progresso chega por 'change'. */
  start(path: string, options: AutoOptions, origin: Project['origin'] = 'manual'): AutoRun {
    const steps: AutoStep[] = (Object.keys(STEP_LABELS) as AutoStepKey[]).map((key) => ({ key, label: STEP_LABELS[key], state: 'pendente' }))
    const run: AutoRun = {
      id: randomUUID(),
      projectId: '',
      path,
      fileName: basename(path),
      origin,
      options,
      state: 'rodando',
      steps,
      clips: [],
      notes: [],
      createdAt: Date.now()
    }
    this.runs.push(run)
    if (this.runs.length > 60) this.runs = this.runs.filter((r) => r.state === 'rodando').concat(this.list().filter((r) => r.state !== 'rodando').slice(0, 50))
    const ctrl = new AbortController()
    this.controllers.set(run.id, ctrl)
    this.changed(run)
    void this.pipeline(run, ctrl.signal)
    return run
  }

  cancel(id: string): void {
    const run = this.get(id)
    if (!run || run.state !== 'rodando') return
    this.controllers.get(id)?.abort()
    for (const c of run.clips) if (c.jobId) this.deps.cancelJob(c.jobId)
    run.state = 'cancelado'
    run.finishedAt = Date.now()
    for (const s of run.steps) if (s.state === 'rodando' || s.state === 'pendente') s.state = 'pulado'
    this.changed(run)
  }

  /** Registra/atualiza um envio de um corte para uma rede social. */
  setClipPost(runId: string, segmentId: string, post: import('../shared/types').ClipPost): void {
    const run = this.get(runId)
    const clip = run?.clips.find((c) => c.segmentId === segmentId)
    if (!run || !clip) return
    const list = (clip.posts ?? []).filter((p) => !(p.platform === post.platform && p.mode === post.mode && p.at === post.at))
    clip.posts = [...list, post]
    this.changed(run)
  }

  /** Chamado pelo app a cada progresso/fim de um job da fila. */
  jobUpdated(job: Job): void {
    const run = this.runs.find((r) => r.clips.some((c) => c.jobId === job.id))
    if (!run) return
    const clip = run.clips.find((c) => c.jobId === job.id)!
    clip.status = job.status
    clip.ratio = job.status === 'concluído' ? 1 : job.ratio
    if (job.outputPath) clip.outputPath = job.outputPath
    clip.thumbnail = job.extraFiles?.find((f) => f.endsWith('.jpg')) ?? clip.thumbnail
    clip.error = job.error
    const step = run.steps.find((s) => s.key === 'exportar')!
    const queued = run.clips.filter((c) => c.jobId)
    step.ratio = queued.reduce((t, c) => t + c.ratio, 0) / Math.max(1, queued.length)
    const done = queued.filter((c) => c.status === 'concluído').length
    step.detail = `${done} de ${queued.length} prontos`
    if (run.state === 'rodando' && queued.every((c) => ['concluído', 'erro', 'cancelado'].includes(c.status))) void this.finish(run)
    else this.changed(run, false)
  }

  private changed(run: AutoRun, persist = true): void {
    this.emit('change', structuredClone(run))
    if (persist) this.save()
  }

  private save(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        writeJsonAtomic(this.file!, this.runs)
      } catch (err) {
        this.deps.log?.('error', 'Falha ao salvar histórico do modo automático', err)
      }
    }, 300)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.file) writeJsonAtomic(this.file, this.runs)
  }

  private async step<T>(run: AutoRun, key: AutoStepKey, signal: AbortSignal, fn: (setRatio: (r: number) => void) => Promise<T>): Promise<T> {
    if (signal.aborted) throw new Cancelled()
    const st = run.steps.find((s) => s.key === key)!
    st.state = 'rodando'
    st.ratio = 0
    this.changed(run)
    let last = 0
    const result = await fn((r) => {
      st.ratio = r
      if (Date.now() - last > 250) {
        last = Date.now()
        this.changed(run, false)
      }
    })
    if (signal.aborted) throw new Cancelled()
    if (st.state === 'rodando') st.state = 'ok'
    st.ratio = 1
    this.changed(run)
    return result
  }

  private skip(run: AutoRun, key: AutoStepKey, detail: string): void {
    const st = run.steps.find((s) => s.key === key)!
    st.state = 'pulado'
    st.detail = detail
    this.changed(run)
  }

  private async pipeline(run: AutoRun, signal: AbortSignal): Promise<void> {
    const d = this.deps
    const o = run.options
    try {
      // 1. Ler
      const { meta, project } = await this.step(run, 'ler', signal, async () => {
        const meta = await d.probe(run.path)
        if (!meta.video) throw new Error('Esse arquivo não tem vídeo. O modo automático precisa de um vídeo.')
        const project = d.openProject(meta, run.origin)
        return { meta, project }
      })
      run.projectId = project.id
      run.steps[0].detail = `${formatTimecode(meta.durationSec, true).replace(/\.\d+$/, '')} · ${meta.video!.width}×${meta.video!.height}`

      // 2. Analisar (reaproveita análise anterior)
      let analysis = d.getAnalysis(project.id)
      if (analysis && Math.abs(analysis.durationSec - meta.durationSec) < 1 && analysis.reactions && (analysis.motion || !meta.video)) {
        this.skip(run, 'analisar', 'Já analisado antes')
        run.steps[1].state = 'ok'
      } else {
        analysis = await this.step(run, 'analisar', signal, (p) => d.analyze(meta, signal, p))
        d.saveAnalysis(project.id, analysis)
        run.steps[1].detail = `${plural(analysis.silences.length, 'pausa', 'pausas')} · ${plural(analysis.scenes.length, 'mudança de cena', 'mudanças de cena')}`
      }

      // 3. Transcrever (opcional)
      let transcript = d.getProject(project.id)?.transcript ?? null
      const transcriber = d.transcriber()
      if (transcript?.cues.length) {
        this.skip(run, 'transcrever', 'Já transcrito antes')
        run.steps[2].state = 'ok'
      } else if (!transcriber) {
        this.skip(run, 'transcrever', 'Legendas automáticas não instaladas — ative em Configurações (1 clique)')
        if (o.subtitles) run.notes.push('Os cortes saíram sem legenda porque as legendas automáticas não estão instaladas.')
      } else {
        try {
          transcript = await this.step(run, 'transcrever', signal, (p) => transcriber(run.path, signal, p))
          d.updateProject(project.id, { transcript })
          run.steps[2].detail = `${plural(transcript.cues.length, 'fala', 'falas')}${transcript.language ? ` · idioma ${transcript.language}` : ''}`
        } catch (err) {
          if (err instanceof Cancelled || signal.aborted) throw new Cancelled()
          const st = run.steps[2]
          st.state = 'erro'
          st.detail = (err as Error).message
          run.notes.push(`Não deu para transcrever (${(err as Error).message}). Os cortes saem sem legenda.`)
          transcript = null
          this.changed(run)
        }
      }

      // 4. Escolher: regras locais acham candidatos; a IA (se ativa) escolhe entre eles e escreve os textos
      const len = LENGTHS[o.length]
      const cues = transcript?.cues ?? []
      let aiVia = ''
      const clips = await this.step(run, 'escolher', signal, async () => {
        const wantAi = !!d.aiPlan && cues.length > 0
        const pool = suggestClips({ analysis: analysis!, cues, options: { minSec: len.minSec, maxSec: len.maxSec, count: wantAi ? Math.min(15, o.count * 3) : o.count }, weights: d.learnedWeights() })
        // Não corta no meio da frase
        const snapped = pool.map((sg) => {
          const raw = { startSec: Math.max(0, sg.startSec - 0.15), endSec: Math.min(meta.durationSec, sg.endSec + 0.3) }
          const range = cues.length ? snapToSentences(raw, cues, meta.durationSec, { maxBefore: 2.5, maxAfter: 3.5, maxLength: len.maxSec + 6 }) : raw
          return { s: sg, range: { startSec: round(range.startSec), endSec: round(range.endSec) } }
        })
        let planned = new Map<string, PlannedClip>()
        if (wantAi && snapped.length > 0) {
          try {
            const cands: PlanCandidate[] = snapped.map(({ s: sg, range }) => ({ id: sg.id, startSec: range.startSec, endSec: range.endSec, ruleScore: sg.score, text: clipText(cues, [range]) }))
            const res = await d.aiPlan!(PLATFORM_LABEL[o.platform], o.count, cands)
            if (res) {
              planned = new Map(res.clips.map((c) => [c.id, c]))
              aiVia = res.via
            }
          } catch (err) {
            if (signal.aborted) throw new Cancelled()
            run.notes.push(`IA indisponível agora (${(err as Error).message}); escolhi só pelas regras locais.`)
          }
        }
        const ranked = snapped
          .map((x) => ({ ...x, plan: planned.get(x.s.id), score: blendScore(x.s.score, planned.get(x.s.id)?.aiScore) }))
          .sort((p1, p2) => p2.score - p1.score || p1.range.startSec - p2.range.startSec)
          .slice(0, o.count)
          .sort((p1, p2) => p1.range.startSec - p2.range.startSec)
        d.updateProject(project.id, { suggestions: pool.slice(0, Math.max(o.count, 8)) })
        const chosen =
          ranked.length > 0 ? ranked : [{ s: null, plan: undefined, score: 0, range: { startSec: 0, endSec: round(Math.min(meta.durationSec, len.maxSec)) } }]
        if (ranked.length === 0) run.notes.push('O vídeo é curto para a duração escolhida; fiz um corte do começo.')
        return chosen.map(({ s: sg, plan, score, range }, i): AutoClip & { ranges: Range[]; hook: string; keywords: string[]; screenTitle: string } => {
          const text = clipText(cues, [range])
          const local = (text && localTitle(text)) || `Melhor momento ${i + 1}`
          const title = plan?.title || local
          return {
            segmentId: randomUUID(),
            index: i + 1,
            title,
            description: plan?.description ?? '',
            hashtags: plan?.hashtags.length
              ? plan.hashtags
              : localHashtags(text || run.fileName.replace(/\.[^.]+$/, '').replace(/[\d_-]+/g, ' '), ['cortes', PLATFORM_LABEL[o.platform].toLowerCase()]),
            startSec: range.startSec,
            endSec: range.endSec,
            durationSec: round(range.endSec - range.startSec),
            score,
            reasons: [...(plan ? [`IA: nota ${Math.round(plan.aiScore)} (${aiVia})`] : []), ...(sg?.reasons ?? [])],
            status: 'pendente',
            ratio: 0,
            ranges: [range],
            hook: plan?.hook ?? '',
            keywords: plan?.keywords ?? [],
            // Título na tela só quando é curto e bom (da IA ou a primeira frase com gancho)
            screenTitle: plan?.title && plan.title.length <= 60 ? plan.title : local.length >= 12 && local.length <= 55 && /[?!]/.test(local) ? local : ''
          }
        })
      })
      run.steps[3].detail = `${plural(clips.length, 'momento escolhido', 'momentos escolhidos')}${aiVia ? ` · IA: ${aiVia}` : ''}`

      // 5. Limpar: "éé"/"hum"/pausas (com transcrição) ou tempo morto sem som e sem ação (sem transcrição)
      const words = (transcript?.cues ?? []).flatMap((c) => c.words ?? [])
      const hasWordTimes = words.length > 0 && !transcript?.engine.startsWith('importado')
      if (!o.cleanSpeech) this.skip(run, 'limpar', 'Desligado')
      else
        await this.step(run, 'limpar', signal, async () => {
          let removed = 0
          // Só corta pausa que também é silêncio no áudio (gameplay sem voz continua)
          const silences = analysis!.silences
          const canCutPause = (a: number, b: number) => {
            const covered = silences.reduce((t, s) => t + Math.max(0, Math.min(b, s.endSec) - Math.max(a, s.startSec)), 0)
            return covered >= (b - a) * 0.8
          }
          for (const c of clips) {
            const original = c.ranges[0].endSec - c.ranges[0].startSec
            const ranges = hasWordTimes
              ? removeFillers(c.ranges[0], words, { ...DEFAULT_FILLER_OPTIONS, canCutPause }).ranges
              : removeDeadTime(c.ranges[0], silences, analysis!.motion)
            const kept = totalLength(ranges)
            // Proteção: se tirar demais, mantém o corte original
            const safe = kept >= original * 0.75 && kept >= len.minSec * 0.8
            if (ranges.length > 0 && original - kept > 0.2 && safe) {
              c.ranges = ranges
              removed += original - kept
              c.durationSec = round(kept)
            }
          }
          run.steps[4].detail = removed > 0 ? `${removed.toFixed(1)} s de enrolação/tempo parado removidos` : 'Nada para remover'
        })

      // Gancho no começo: repete a frase mais forte antes do corte (precisa de tempo por palavra)
      const smart = o.smartEdit !== false
      const teaserByClip = new Map<string, number>()
      if (smart) {
        for (const c of clips) {
          // Frase de gancho da IA; sem ela, o momento mais intenso (som + ação) do próprio corte
          const hookRange = (c.hook && words.length > 0 ? findPhrase(c.hook, words, c.ranges) : null) ?? peakTeaserRange(c.ranges, analysis!.rmsDb, analysis!.motion)
          const t = withTeaser(c.ranges, hookRange)
          if (t.teaserSec > 0 && totalLength(t.ranges) <= len.maxSec + 8) {
            c.ranges = t.ranges
            c.durationSec = round(totalLength(t.ranges))
            teaserByClip.set(c.segmentId, t.teaserSec)
          }
        }
      }

      // 6. Música e efeitos
      const extrasByClip = new Map<string, AudioExtras>()
      if (o.music === 'nenhuma' && !o.effects) this.skip(run, 'trilha', 'Desligado')
      else
        await this.step(run, 'trilha', signal, async () => {
          const parts: string[] = []
          let fxCount = 0
          let musicFailed = false
          for (const c of clips) {
            const extras: AudioExtras = {}
            if (o.music !== 'nenhuma' && d.pickMusic && !musicFailed) {
              try {
                const m = await d.pickMusic(o.music, signal, c.index - 1)
                if (m) {
                  // Trilha gerada pelo app fica mais baixa (é o último recurso); música real um pouco mais alta
                  extras.music = { file: m.file, volume: m.generated ? 0.16 : 0.28, duck: true, attribution: m.attribution }
                  if (m.attribution) c.description = [c.description, `🎵 ${m.attribution}`].filter(Boolean).join('\n')
                  if (!parts.includes(m.title)) parts.push(m.title)
                }
              } catch (err) {
                if (signal.aborted) throw new Cancelled()
                run.notes.push(`Sem música de fundo: ${(err as Error).message}`)
                musicFailed = true // segue sem música, mas mantém os efeitos nos outros cortes
              }
            }
            if (o.effects && d.pickEffect) {
              // Efeitos no momento certo: entrada, volta do gancho, "ding" nas palavras de destaque, impacto no pico
              const planned = planEffects(
                { ranges: c.ranges, rmsDb: analysis!.rmsDb, reactions: analysis!.reactions, words, keywords: c.keywords, teaserSec: teaserByClip.get(c.segmentId) },
                (key) => !!d.pickEffect!(key)
              )
              const list = planned.flatMap((p) => {
                const file = d.pickEffect!(p.key)
                return file ? [{ file, atSec: p.atSec, volume: p.volume }] : []
              })
              if (list.length) extras.effects = list
              fxCount += list.length
            }
            extrasByClip.set(c.segmentId, extras)
          }
          run.steps.find((s) => s.key === 'trilha')!.detail = [parts.length ? `música: ${parts.slice(0, 2).join(', ')}` : '', fxCount ? plural(fxCount, 'efeito', 'efeitos') : ''].filter(Boolean).join(' · ') || 'nada encontrado'
        })

      // Textos para redes (IA opcional; se falhar usa os locais)
      if (d.aiSocial && transcript?.cues.length && !aiVia) {
        for (const c of clips) {
          const text = clipText(transcript.cues, c.ranges)
          if (!text) continue
          try {
            const ai = await d.aiSocial(text, PLATFORM_LABEL[o.platform])
            if (ai) Object.assign(c, { title: ai.title || c.title, description: [ai.description, c.description].filter(Boolean).join('\n'), hashtags: ai.hashtags.length ? ai.hashtags : c.hashtags })
          } catch (err) {
            run.notes.push(`IA indisponível (${(err as Error).message}); usei títulos automáticos locais.`)
            break
          }
        }
      }

      // 7. Edição visual: enquadramento que segue a pessoa, zooms nos picos, título e barra de progresso
      const options = this.exportOptions(o, !!transcript?.cues.length)
      const visualByClip = new Map<string, VisualExtras>()
      const fitByClip = new Map<string, ExportOptions['fit']>()
      const vertical = options.aspect === '9:16' || options.aspect === '4:5'
      if (!smart && o.framing !== 'auto') this.skip(run, 'editar', 'Desligado')
      else
        await this.step(run, 'editar', signal, async (setRatio) => {
          const [OW, OH] = outputSize(options.aspect, meta.video!.width, meta.video!.height)
          const cover = Math.max(OW / meta.video!.width, OH / meta.video!.height)
          const cropFrac = Math.min(1, OW / (meta.video!.width * cover))
          let followed = 0
          let zoomed = 0
          for (const [i, c] of clips.entries()) {
            const v: VisualExtras = {}
            if (vertical && o.platform !== 'youtube' && (o.framing === 'auto' || o.framing === 'crop') && cropFrac < 0.95 && d.track) {
              try {
                const span = { startSec: Math.min(...c.ranges.map((r) => r.startSec)), endSec: Math.max(...c.ranges.map((r) => r.endSec)) }
                const dec = await d.track(run.path, span, meta.video!.width, meta.video!.height, cropFrac, signal)
                if (dec.follow) {
                  // pontos da origem → tempo do corte
                  const pts = dec.points.flatMap((p) => {
                    const t = toOut(p.t, c.ranges)
                    return t === null ? [] : [{ t, x: p.x }]
                  })
                  if (pts.length) {
                    v.track = pts
                    fitByClip.set(c.segmentId, 'crop')
                    followed++
                  }
                } else if (o.framing === 'auto') fitByClip.set(c.segmentId, 'game')
              } catch (err) {
                if (signal.aborted) throw new Cancelled()
                d.log?.('warn', 'Enquadramento automático falhou', err)
              }
            }
            if (o.framing === 'auto' && !fitByClip.has(c.segmentId)) fitByClip.set(c.segmentId, 'game')
            if (smart && vertical) {
              v.zooms = planZooms(
                { ranges: c.ranges, rmsDb: analysis!.rmsDb, reactions: analysis!.reactions, words, keywords: c.keywords, teaserSec: teaserByClip.get(c.segmentId) },
                totalLength(c.ranges)
              )
              if (v.zooms.length) zoomed++
              v.progressBar = true
              if (c.screenTitle) v.title = c.screenTitle
              if (c.keywords.length) v.keywords = c.keywords
            }
            visualByClip.set(c.segmentId, v)
            setRatio((i + 1) / clips.length)
          }
          run.steps.find((s) => s.key === 'editar')!.detail =
            [followed ? `${followed} seguindo a pessoa` : '', zoomed ? plural(zoomed, 'corte com zoom', 'cortes com zoom') : '', smart ? 'título e barra de progresso' : ''].filter(Boolean).join(' · ') || 'nada a ajustar'
        })

      // Salva os trechos no projeto (dá para ajustar depois no editor avançado)
      const segments: Segment[] = clips.map((c) => ({ id: c.segmentId, name: c.title.slice(0, 60), ranges: c.ranges, createdAt: Date.now(), origin: 'suggestion' }))
      const existing = d.getProject(project.id)?.segments ?? []
      d.updateProject(project.id, { segments: [...existing, ...segments] })

      // 8. Exportar
      const st = run.steps.find((s) => s.key === 'exportar')!
      st.state = 'rodando'
      st.ratio = 0
      run.clips = clips.map(({ ranges: _r, hook: _h, keywords: _k, screenTitle: _t, ...c }) => c)
      for (const c of clips) {
        if (signal.aborted) throw new Cancelled()
        const req: CutRequest = {
          inputPath: run.path,
          outputDir: d.outputDir(),
          ranges: c.ranges,
          options: fitByClip.has(c.segmentId) ? { ...options, fit: fitByClip.get(c.segmentId)! } : options,
          segmentName: c.title.slice(0, 60),
          presetName: PLATFORM_LABEL[o.platform],
          cues: transcript?.cues,
          sequence: c.index,
          audioExtras: extrasByClip.get(c.segmentId),
          visual: visualByClip.get(c.segmentId),
          source: { durationSec: meta.durationSec, width: meta.video!.width, height: meta.video!.height, fps: meta.video!.fps, audioTracks: meta.audioTracks.length }
        }
        const job = d.enqueue(req)
        const clip = run.clips.find((x) => x.segmentId === c.segmentId)!
        clip.jobId = job.id
        clip.status = job.status
      }
      run.outputDir = options.subfolderPerSource ? join(d.outputDir(), basename(run.path, extname(run.path)).replace(/[<>:"/\\|?*]/g, '_')) : d.outputDir()
      this.changed(run)
      // Jobs que já terminaram muito rápido
      for (const c of run.clips) {
        const j = c.jobId ? d.getJob(c.jobId) : undefined
        if (j) this.jobUpdated(j)
      }
    } catch (err) {
      if (err instanceof Cancelled || signal.aborted) {
        if (run.state === 'rodando') this.cancel(run.id)
        return
      }
      const st = run.steps.find((s) => s.state === 'rodando')
      if (st) {
        st.state = 'erro'
        st.detail = (err as Error).message
      }
      run.state = 'erro'
      run.error = (err as Error).message
      run.finishedAt = Date.now()
      d.log?.('error', 'Modo automático falhou', err)
      this.changed(run)
    }
  }

  exportOptions(o: AutoOptions, hasTranscript: boolean): ExportOptions {
    const base = applyPreset(this.deps.exportDefaults(), o.platform)
    return {
      ...base,
      mode: 'precise',
      fit: o.platform === 'youtube' ? base.fit : o.framing === 'auto' ? 'game' : o.framing,
      cropX: 0.5,
      speed: 1,
      fadeInSec: 0,
      fadeOutSec: 0.3,
      normalizeAudio: true,
      includeAudio: true,
      thumbnail: true,
      subtitles: o.subtitles && hasTranscript ? (o.platform === 'youtube' ? 'srt' : 'burn') : 'none',
      nameTemplate: '{n} {trecho}',
      subfolderPerSource: true
    }
  }

  private async finish(run: AutoRun): Promise<void> {
    const st = run.steps.find((s) => s.key === 'exportar')!
    const ok = run.clips.filter((c) => c.status === 'concluído')
    const failed = run.clips.filter((c) => c.status === 'erro')
    st.state = ok.length > 0 ? 'ok' : 'erro'
    st.ratio = 1
    st.detail = `${ok.length} de ${run.clips.length} prontos${failed.length ? ` · ${failed.length} com erro` : ''}`
    run.state = ok.length > 0 ? 'concluído' : 'erro'
    if (ok.length === 0) run.error = failed[0]?.error ?? 'Nenhum corte foi gerado.'
    run.finishedAt = Date.now()
    if (ok.length > 0) {
      const dir = dirname(ok[0].outputPath!)
      run.outputDir = dir
      const text = ok
        .map((c) => [`${c.index}. ${basename(c.outputPath!)}`, `Título: ${c.title}`, c.description ? `Descrição: ${c.description}` : '', `Hashtags: ${c.hashtags.join(' ')}`].filter(Boolean).join('\n'))
        .join('\n\n')
      const file = join(dir, 'textos para postar.txt')
      try {
        run.textsFile = await this.deps.writeText(file, `Cortes de ${run.fileName}\n\n${text}\n`)
      } catch (err) {
        run.notes.push(`Não deu para salvar os textos (${(err as Error).message}).`)
      }
    }
    this.changed(run)
  }
}
