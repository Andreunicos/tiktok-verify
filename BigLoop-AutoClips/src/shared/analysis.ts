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
  private crossings = 0
  private prev = 0
  private leftover: number | null = null
  readonly rmsDb: number[] = []
  readonly peak: number[] = []
  /** Taxa de cruzamentos por zero (0..1) por janela: alta em sons ásperos (risada, grito, chiado). */
  readonly zcr: number[] = []

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
    if ((v >= 0) !== (this.prev >= 0)) this.crossings++
    this.prev = v
    if (++this.count >= this.perWindow) this.flush()
  }

  flush(): void {
    if (this.count === 0) return
    this.rmsDb.push(toDb(Math.sqrt(this.sumSq / this.count)))
    this.peak.push(this.peakAbs)
    this.zcr.push(this.crossings / this.count)
    this.sumSq = 0
    this.peakAbs = 0
    this.count = 0
    this.crossings = 0
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

/**
 * Lê a saída combinada de showinfo (mudanças de cena) e metadata/signalstats (YDIF = quanto a imagem
 * mudou entre quadros). Retorna as cenas e o movimento médio por segundo (0 = parado).
 */
export function parseScenesAndMotion(stderr: string): { scenes: number[]; motion: number[] } {
  const scenes: number[] = []
  const sum: number[] = []
  const cnt: number[] = []
  let cur: number | null = null
  for (const line of stderr.split('\n')) {
    if (line.includes('Parsed_showinfo')) {
      const m = /pts_time:\s*([\d.]+)/.exec(line)
      if (m) scenes.push(Math.round(Number(m[1]) * 100) / 100)
    } else if (line.includes('Parsed_metadata')) {
      const t = /pts_time:\s*([\d.]+)/.exec(line)
      if (t) cur = Number(t[1])
      const y = /YDIF=([\d.]+)/.exec(line)
      if (y && cur !== null) {
        const sec = Math.floor(cur)
        sum[sec] = (sum[sec] ?? 0) + Number(y[1])
        cnt[sec] = (cnt[sec] ?? 0) + 1
      }
    }
  }
  const motion = Array.from({ length: sum.length }, (_, i) => (cnt[i] ? Math.round((sum[i] / cnt[i]) * 100) / 100 : 0))
  return { scenes, motion }
}

export interface Reaction {
  startSec: number
  endSec: number
  kind: 'risada' | 'grito'
}

/**
 * Detecta risadas e gritos só com o áudio (sem IA): risada = volume alto que pulsa num ritmo
 * regular de 3–7 vezes por segundo ("ha-ha-ha"); grito = volume bem acima do normal, contínuo e
 * áspero (muitos cruzamentos por zero). É uma estimativa: serve para dar pontos ao trecho.
 */
export function detectReactions(rmsDb: number[], zcr: number[], windowSec = WINDOW_SEC): Reaction[] {
  const n = Math.min(rmsDb.length, zcr.length)
  if (n === 0) return []
  const voicedIdx = [...Array(n).keys()].filter((i) => rmsDb[i] > -60)
  if (voicedIdx.length < 20) return []
  const med = percentile(voicedIdx.map((i) => rmsDb[i]), 50)
  const zmed = Math.max(0.01, percentile(voicedIdx.map((i) => zcr[i]), 50))
  const seg = Math.max(8, Math.round(1 / windowSec)) // 1 s
  const step = Math.max(1, Math.round(0.25 / windowSec))
  const hits: Reaction[] = []
  for (let a = 0; a + seg <= n; a += step) {
    // Envelope com piso (os vales entre um "ha" e outro não contam como silêncio absoluto)
    const env = rmsDb.slice(a, a + seg).map((v) => Math.max(v, med - 25))
    const mean = env.reduce((x, y) => x + y, 0) / seg
    const std = Math.sqrt(env.reduce((x, y) => x + (y - mean) ** 2, 0) / seg)
    const z = zcr.slice(a, a + seg).reduce((x, y) => x + y, 0) / seg
    // Volume pela média de potência (não pela média em dB, que afunda com os vales)
    const loud = 10 * Math.log10(env.reduce((x, y) => x + 10 ** (y / 10), 0) / seg) - med
    let kind: Reaction['kind'] | null = null
    if (loud >= 9 && z >= zmed * 1.4 && std < 4) kind = 'grito'
    else if (loud >= 3 && std >= 3 && z >= zmed * 1.1) {
      // periodicidade do envelope (autocorrelação nos atrasos de 150–330 ms)
      const d = env.map((v) => v - mean)
      const ac0 = d.reduce((x, y) => x + y * y, 0) || 1
      let best = 0
      const lo = Math.max(2, Math.round(0.15 / windowSec))
      const hi = Math.max(lo, Math.round(0.33 / windowSec))
      for (let lag = lo; lag <= hi; lag++) {
        let s = 0
        for (let i = 0; i + lag < seg; i++) s += d[i] * d[i + lag]
        best = Math.max(best, s / ac0)
      }
      if (best >= 0.45) kind = 'risada'
    }
    if (!kind) continue
    const startSec = Math.round(a * windowSec * 100) / 100
    const endSec = Math.round((a + seg) * windowSec * 100) / 100
    const last = hits[hits.length - 1]
    if (last && last.kind === kind && startSec <= last.endSec + 0.3) last.endSec = endSec
    else hits.push({ startSec, endSec, kind })
  }
  return hits.filter((h) => h.endSec - h.startSec >= (h.kind === 'risada' ? 1.2 : 1))
}
