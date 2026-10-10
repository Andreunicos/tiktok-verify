import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { CutRequest, Job, QueueState } from '../shared/types'
import { readJson, writeJsonAtomic } from './jsonFile'

export interface RunHandle {
  done: Promise<{ outputPath: string; extraFiles: string[] }>
  cancel(): void
}

/** Executa um job; relata progresso. Pode lançar erro antes de começar (validação, disco). */
export type JobRunner = (job: Job, report: (ratio: number, etaSec: number | null) => void) => Promise<RunHandle>

const PRIORITY_ORDER = { alta: 0, normal: 1, baixa: 2 } as const
const CANCELLED_MESSAGE = 'Corte cancelado.'

/**
 * Fila de exportação persistente. Eventos:
 *  - 'change' (QueueState) sempre que a lista muda
 *  - 'progress' (job) durante o processamento (não grava em disco)
 *  - 'finished' (job) quando um job termina com sucesso ou erro
 */
export class JobQueue extends EventEmitter {
  private jobs: Job[] = []
  private paused = false
  private concurrency: number
  private running = new Map<string, RunHandle>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string | null,
    private readonly runner: JobRunner,
    opts: { concurrency?: number } = {}
  ) {
    super()
    this.concurrency = Math.max(1, opts.concurrency ?? 1)
    if (file) {
      const saved = readJson<{ jobs?: Job[]; paused?: boolean }>(file, {})
      // Jobs que estavam rodando quando o app fechou voltam para a fila.
      this.jobs = (saved.jobs ?? []).map((j) =>
        j.status === 'processando' ? { ...j, status: 'aguardando', ratio: 0, etaSec: null, error: 'Interrompido ao fechar o app; será refeito.' } : j
      )
      this.paused = !!saved.paused
    }
  }

  state(): QueueState {
    return { jobs: this.jobs.map((j) => ({ ...j })), paused: this.paused, concurrency: this.concurrency }
  }

  get activeCount(): number {
    return this.running.size
  }

  add(request: CutRequest, priority: Job['priority'] = 'normal'): Job {
    const job: Job = { id: randomUUID(), request, status: 'aguardando', priority, ratio: 0, etaSec: null, createdAt: Date.now(), attempts: 0 }
    this.jobs.push(job)
    this.changed()
    this.pump()
    return job
  }

  cancel(id: string): void {
    const job = this.find(id)
    if (!job) return
    const handle = this.running.get(id)
    if (handle) handle.cancel()
    else if (job.status === 'aguardando') {
      job.status = 'cancelado'
      job.finishedAt = Date.now()
      this.changed()
    }
  }

  retry(id: string): void {
    const job = this.find(id)
    if (!job || job.status === 'processando' || job.status === 'aguardando') return
    Object.assign(job, { status: 'aguardando', ratio: 0, etaSec: null, error: undefined, outputPath: undefined, extraFiles: undefined, finishedAt: undefined })
    this.changed()
    this.pump()
  }

  remove(id: string): void {
    if (this.running.has(id)) return
    this.jobs = this.jobs.filter((j) => j.id !== id)
    this.changed()
  }

  move(id: string, delta: -1 | 1): void {
    const i = this.jobs.findIndex((j) => j.id === id)
    const k = i + delta
    if (i < 0 || k < 0 || k >= this.jobs.length) return
    ;[this.jobs[i], this.jobs[k]] = [this.jobs[k], this.jobs[i]]
    this.changed()
  }

  setPriority(id: string, priority: Job['priority']): void {
    const job = this.find(id)
    if (!job) return
    job.priority = priority
    this.changed()
  }

  pause(): void {
    this.paused = true
    this.changed()
  }

  resume(): void {
    this.paused = false
    this.changed()
    this.pump()
  }

  setConcurrency(n: number): void {
    this.concurrency = Math.min(4, Math.max(1, Math.round(n)))
    this.changed()
    this.pump()
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status === 'aguardando' || j.status === 'processando')
    this.changed()
  }

  cancelAll(): void {
    for (const j of this.jobs) if (j.status === 'aguardando') j.status = 'cancelado'
    for (const h of this.running.values()) h.cancel()
    this.changed()
  }

  /** Grava imediatamente (ao fechar o app). */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.file) writeJsonAtomic(this.file, { jobs: this.jobs, paused: this.paused })
  }

  private find(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  private changed(): void {
    this.emit('change', this.state())
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.flush()
      } catch (err) {
        this.emit('error', err)
      }
    }, 300)
  }

  private next(): Job | undefined {
    return this.jobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => job.status === 'aguardando')
      .sort((a, b) => PRIORITY_ORDER[a.job.priority] - PRIORITY_ORDER[b.job.priority] || a.index - b.index)[0]?.job
  }

  private pump(): void {
    while (!this.paused && this.running.size < this.concurrency) {
      const job = this.next()
      if (!job) return
      void this.start(job)
    }
  }

  private async start(job: Job): Promise<void> {
    Object.assign(job, { status: 'processando', startedAt: Date.now(), ratio: 0, etaSec: null, error: undefined })
    job.attempts++
    const placeholder: RunHandle = { done: new Promise(() => undefined), cancel: () => (cancelledEarly = true) }
    let cancelledEarly = false
    this.running.set(job.id, placeholder)
    this.changed()
    try {
      const handle = await this.runner(job, (ratio, etaSec) => {
        job.ratio = ratio
        job.etaSec = etaSec
        this.emit('progress', { ...job })
      })
      this.running.set(job.id, handle)
      if (cancelledEarly) handle.cancel()
      const { outputPath, extraFiles } = await handle.done
      Object.assign(job, { status: 'concluído', ratio: 1, etaSec: 0, outputPath, extraFiles })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const cancelled = cancelledEarly || message === CANCELLED_MESSAGE
      Object.assign(job, { status: cancelled ? 'cancelado' : 'erro', error: cancelled ? undefined : message, etaSec: null })
    } finally {
      job.finishedAt = Date.now()
      this.running.delete(job.id)
      this.changed()
      this.emit('finished', { ...job })
      this.pump()
    }
  }
}
