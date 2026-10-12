import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ScheduledPost } from '../shared/types'
import { readJson, writeJsonAtomic } from './jsonFile'

/**
 * Agenda de postagens que o app faz na hora certa (o app precisa estar aberto; se estava fechado,
 * envia assim que abrir). Emite 'change' com a lista.
 */
export class PostScheduler extends EventEmitter {
  private items: ScheduledPost[]
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly file: string | null,
    private readonly runner: (p: ScheduledPost) => Promise<void>,
    private readonly now: () => number = Date.now
  ) {
    super()
    // Envio interrompido quando o app fechou volta para a fila
    this.items = (file ? readJson<ScheduledPost[]>(file, []) : []).map((p) => (p.status === 'enviando' ? { ...p, status: 'aguardando' } : p))
  }

  list(): ScheduledPost[] {
    return [...this.items].sort((a, b) => a.at - b.at)
  }

  add(entries: Omit<ScheduledPost, 'id' | 'status'>[]): ScheduledPost[] {
    const created = entries.map((e) => ({ ...e, id: randomUUID(), status: 'aguardando' as const }))
    this.items.push(...created)
    this.save()
    return created
  }

  remove(id: string): void {
    this.items = this.items.filter((p) => p.id !== id || p.status === 'enviando')
    this.save()
  }

  /** Envia o que já passou da hora (um por vez). */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const due = this.list().find((p) => p.status === 'aguardando' && p.at <= this.now())
        if (!due) break
        due.status = 'enviando'
        this.save()
        try {
          await this.runner(due)
          due.status = 'feito'
          due.error = undefined
        } catch (err) {
          due.status = 'erro'
          due.error = (err as Error).message
        }
        this.save()
      }
    } finally {
      this.running = false
    }
  }

  start(intervalMs = 60_000): void {
    this.stop()
    void this.tick()
    this.timer = setInterval(() => void this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private save(): void {
    if (this.file) writeJsonAtomic(this.file, this.items)
    this.emit('change', this.list())
  }
}

/** Horários de uma série: começa em `start` e repete a cada `everyHours`. */
export function seriesTimes(start: number, count: number, everyHours: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * everyHours * 3600_000)
}
