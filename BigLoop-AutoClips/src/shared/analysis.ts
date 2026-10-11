import type { Range } from './types'

/** Janela de análise de áudio em segundos. */
export const WINDOW_SEC = 0.05

/** Converte amplitude RMS (0..1) em dBFS, com piso de -90 dB. */
export const toDb = (rms: number) => (rms <= 1e-9 ? -90 : Math.max(-90, 20 * Math.log10(rms)))

export interface WindowStats {
  rmsDb: number[]
  peak: number[]
}

/**
 * Acumulador de PCM s16le mono: calcula RMS (dB) e pico (0..1) por janela.
 * Recebe blocos arbitrários (streaming), sem manter o áudio inteiro na memória.
 */
export class PcmAnalyzer {
  private readonly perWindow: number
  private sumSq = 0
  private peakAbs = 0
  private count = 0
  private leftover: number | null = null
  readonly rmsDb: number[] = []
  readonly peak: number[] = []

  constructor(sampleRate: number, windowSec = WINDOW_SEC) {
    this.perWindow = Math.max(1, Math.round(sampleRate * windowSec))
  }

  push(chunk: Uint8Array): void {
    let i = 0
    if (this.leftover !== null && chunk.length > 0) {
      this.add(((chunk[0] << 8) | this.leftover) << 16 >> 16)
      this.leftover = null
      i = 1
    }
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    for (; i + 1 < chunk.length; i += 2) this.add(view.getInt16(i, true))
    if (i < chunk.length) this.leftover = chunk[i]
  }

  private add(sample: number): void {
    const v = sample / 32768
    this.sumSq += v * v
    const a = Math.abs(v)
    if (a > this.peakAbs) this.peakAbs = a
    if (++this.count >= this.perWindow) this.flush()
  }

  flush(): void {
    if (this.count === 0) return
    this.rmsDb.push(toDb(Math.sqrt(this.sumSq / this.count)))
    this.peak.push(this.peakAbs)
    this.sumSq = 0
    this.peakAbs = 0
    this.count = 0
  }
}

/** Reduz picos por janela para N buckets (para desenhar a forma de onda). */
export function downsamplePeaks(peaks: number[], buckets: number): number[] {
  if (peaks.length <= buckets) return peaks.map((p) => Math.round(p * 1000) / 1000)
  const out: number[] = []
  const step = peaks.length / buckets
  for (let b = 0; b < buckets; b++) {
    let max = 0
    for (let i = Math.floor(b * step); i < Math.floor((b + 1) * step); i++) if (peaks[i] > max) max = peaks[i]
    out.push(Math.round(max * 1000) / 1000)
  }
  return out
}

/** Média de energia (em dB) por segundo, a partir das janelas. */
export function perSecondDb(windowsDb: number[], windowSec = WINDOW_SEC): number[] {
  const per = Math.round(1 / windowSec)
  const out: number[] = []
  for (let i = 0; i < windowsDb.length; i += per) {
    const slice = windowsDb.slice(i, i + per)
    // média em potência, não em dB
    const mean = slice.reduce((s, db) => s + 10 ** (db / 10), 0) / slice.length
    out.push(Math.round(10 * Math.log10(Math.max(mean, 1e-9)) * 10) / 10)
  }
  return out
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

/**
 * Detecta silêncios: janelas abaixo do limiar por pelo menos minDur.
 * O limiar é o maior entre thresholdDb e (mediana − 25 dB), para gravações com ruído de fundo.
 */
export function detectSilences(windowsDb: number[], windowSec = WINDOW_SEC, thresholdDb = -45, minDur = 0.5): Range[] {
  const voiced = windowsDb.filter((d) => d > -89)
  const threshold = Math.max(thresholdDb, voiced.length ? percentile(voiced, 50) - 25 : thresholdDb)
  const out: Range[] = []
  let start: number | null = null
  windowsDb.forEach((db, i) => {
    if (db < threshold) {
      if (start === null) start = i
    } else if (start !== null) {
      if ((i - start) * windowSec >= minDur) out.push({ startSec: r2(start * windowSec), endSec: r2(i * windowSec) })
      start = null
    }
  })
  if (start !== null && (windowsDb.length - start) * windowSec >= minDur)
    out.push({ startSec: r2(start * windowSec), endSec: r2(windowsDb.length * windowSec) })
  return out
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Extrai os tempos (pts_time) das linhas do filtro showinfo. */
export function parseShowinfoTimes(stderr: string): number[] {
  const out: number[] = []
  for (const m of stderr.matchAll(/pts_time:\s*([\d.]+)/g)) out.push(Math.round(Number(m[1]) * 100) / 100)
  return out
}
