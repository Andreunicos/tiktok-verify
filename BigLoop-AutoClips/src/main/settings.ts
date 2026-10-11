import { DEFAULT_EXPORT } from '../shared/presets'
import type { AppSettings } from '../shared/types'
import { readJson, writeJsonAtomic } from './jsonFile'

export function defaultSettings(paths: { outputDir: string }): AppSettings {
  return {
    outputDir: paths.outputDir,
    ffmpegPath: '',
    ffprobePath: '',
    defaultMode: 'precise',
    exportDefaults: DEFAULT_EXPORT,
    concurrency: 1,
    lowPriority: true,
    notifyOnDone: true,
    minimizeToTray: false,
    theme: 'system',
    lastImportDir: '',
    whisperPath: '',
    whisperModelPath: '',
    whisperLanguage: 'pt',
    whisperThreads: 4,
    watchEnabled: false,
    watchDir: '',
    watchAutoAnalyze: true,
    obsEnabled: false,
    obsHost: '127.0.0.1',
    obsPort: 4455,
    obsPasswordEnc: '',
    markerShortcut: 'CommandOrControl+Shift+M',
    suggestion: { minSec: 20, maxSec: 60, count: 8 },
    learnedWeights: null,
    aiEnabled: false,
    aiKeyEnc: '',
    aiModel: '',
    onboardingDone: false,
    autoUpdate: true,
    auto: { platform: 'tiktok', count: 5, length: 'medio', subtitles: true, cleanSpeech: true, framing: 'blur', music: 'animada', effects: true },
    autoOnNewRecording: false,
    tiktokClientKey: '',
    tiktokClientSecretEnc: '',
    tiktokTokensEnc: '',
    tiktokRedirectUri: 'https://andreunicos.github.io/tiktok-verify/tiktok-callback.html',
    tiktokCallbackPort: 53682,
    tiktokDisplayName: '',
    tiktokAutoDrafts: false
  }
}

/** Aceita só chaves conhecidas e com o mesmo tipo do padrão; objetos aninhados são mesclados. */
export function sanitizeSettings(input: unknown, defaults: AppSettings): Partial<AppSettings> {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(defaults)) {
    if (!(key in raw)) continue
    const v = raw[key]
    if (key === 'learnedWeights') {
      if (v === null || (typeof v === 'object' && Object.values(v as object).every((n) => typeof n === 'number'))) out[key] = v
    } else if (def && typeof def === 'object' && !Array.isArray(def)) {
      if (v && typeof v === 'object') out[key] = mergeTyped(def as Record<string, unknown>, v as Record<string, unknown>)
    } else if (typeof v === typeof def) out[key] = v
  }
  return out as Partial<AppSettings>
}

function mergeTyped(def: Record<string, unknown>, v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...def }
  for (const [k, d] of Object.entries(def)) {
    if (!(k in v)) continue
    if (d && typeof d === 'object' && !Array.isArray(d) && v[k] && typeof v[k] === 'object') out[k] = mergeTyped(d as Record<string, unknown>, v[k] as Record<string, unknown>)
    else if (d === null || typeof v[k] === typeof d || (k === 'audioTrack' && (v[k] === 'mix' || typeof v[k] === 'number')) || (k === 'maxSizeMB' && (v[k] === null || typeof v[k] === 'number'))) out[k] = v[k]
  }
  return out
}

export class SettingsStore {
  private data: AppSettings

  constructor(
    private readonly file: string,
    private readonly defaults: AppSettings
  ) {
    this.data = { ...defaults, ...sanitizeSettings(readJson(file, {}), defaults) }
  }

  get(): AppSettings {
    return structuredClone(this.data)
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...sanitizeSettings(patch, this.defaults) }
    writeJsonAtomic(this.file, this.data)
    return this.get()
  }
}
