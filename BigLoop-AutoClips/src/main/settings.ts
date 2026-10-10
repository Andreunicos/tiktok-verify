import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppSettings, CutMode } from '../shared/types'

/** Preferências em JSON. Migrar para SQLite na Fase 5 (ver BUGS_E_DECISOES.md). */
export class SettingsStore {
  private data: AppSettings

  constructor(
    private readonly file: string,
    defaults: AppSettings
  ) {
    this.data = { ...defaults, ...this.read() }
  }

  private read(): Partial<AppSettings> {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      return typeof raw === 'object' && raw ? sanitize(raw) : {}
    } catch {
      return {}
    }
  }

  get(): AppSettings {
    return { ...this.data }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...sanitize(patch) }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    return this.get()
  }
}

function sanitize(input: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  for (const key of ['outputDir', 'ffmpegPath', 'ffprobePath'] as const) {
    if (typeof input[key] === 'string') out[key] = input[key] as string
  }
  if (input.defaultMode === 'precise' || input.defaultMode === 'fast') out.defaultMode = input.defaultMode as CutMode
  return out
}
