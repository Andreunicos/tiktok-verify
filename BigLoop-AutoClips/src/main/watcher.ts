import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'm4v', 'webm', 'avi']

interface Tracked {
  size: number
  mtimeMs: number
  stable: number
}

export interface WatcherOptions {
  dir: string
  /** Quantas verificações seguidas com tamanho igual antes de considerar pronto. */
  stableChecks?: number
  intervalMs?: number
  /** Ignora arquivos que já existiam ao ligar o monitoramento. */
  ignoreExisting?: boolean
  /** Retorna true se o arquivo já foi importado (evita duplicatas). */
  isKnown?: (path: string) => boolean
}

/**
 * Monitora uma pasta (ex.: gravações do OBS). Um arquivo só é entregue ('ready') quando:
 * o tamanho e a data param de mudar por N verificações e ele pode ser aberto para escrita
 * (no Windows o OBS mantém o arquivo travado enquanto grava).
 */
export class FolderWatcher extends EventEmitter {
  private tracked = new Map<string, Tracked>()
  private seen = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private fsWatcher: FSWatcher | null = null
  private scanning = false
  lastError: string | null = null

  constructor(private readonly opts: WatcherOptions) {
    super()
  }

  get pending(): string[] {
    return [...this.tracked.keys()]
  }

  async start(): Promise<void> {
    const files = await this.list()
    if (this.opts.ignoreExisting !== false) for (const f of files) this.seen.add(f)
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs ?? 2000)
    try {
      this.fsWatcher = watch(this.opts.dir, () => void this.scan())
      this.fsWatcher.on('error', () => undefined)
    } catch {
      // fs.watch indisponível: a varredura periódica continua funcionando.
    }
    await this.scan()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.fsWatcher?.close()
    this.timer = null
    this.fsWatcher = null
  }

  /** Marca um arquivo como finalizado (ex.: OBS avisou que parou de gravar). */
  markFinished(path: string): void {
    const t = this.tracked.get(path)
    if (t) t.stable = Math.max(t.stable, (this.opts.stableChecks ?? 2) - 1)
  }

  private async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.opts.dir, { withFileTypes: true })
      this.lastError = null
      return entries
        .filter((e) => e.isFile() && VIDEO_EXTENSIONS.includes(extname(e.name).slice(1).toLowerCase()))
        .map((e) => join(this.opts.dir, e.name))
    } catch (err) {
      this.lastError = `Não foi possível ler a pasta monitorada: ${(err as Error).message}`
      return []
    }
  }

  async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      for (const file of await this.list()) {
        if (this.seen.has(file) || this.opts.isKnown?.(file)) continue
        const info = await stat(file).catch(() => null)
        if (!info) continue
        const prev = this.tracked.get(file)
        if (!prev) {
          this.tracked.set(file, { size: info.size, mtimeMs: info.mtimeMs, stable: 0 })
          this.emit('pending', file)
          continue
        }
        if (info.size > 0 && info.size === prev.size && info.mtimeMs === prev.mtimeMs) prev.stable++
        else Object.assign(prev, { size: info.size, mtimeMs: info.mtimeMs, stable: 0 })
        if (prev.stable >= (this.opts.stableChecks ?? 2) && (await canOpenForWrite(file))) {
          this.tracked.delete(file)
          this.seen.add(file)
          this.emit('ready', file)
        }
      }
    } finally {
      this.scanning = false
    }
  }
}

async function canOpenForWrite(file: string): Promise<boolean> {
  try {
    const h = await open(file, 'r+')
    await h.close()
    return true
  } catch {
    return false
  }
}
