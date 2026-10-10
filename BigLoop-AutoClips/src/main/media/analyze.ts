import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { detectSilences, downsamplePeaks, PcmAnalyzer, parseShowinfoTimes, perSecondDb, WINDOW_SEC } from '../../shared/analysis'
import type { AnalysisResult, MediaMetadata } from '../../shared/types'

const SAMPLE_RATE = 8000
const WAVE_BUCKETS_PER_SEC = 20

export interface AnalyzeOptions {
  ffmpegPath: string
  audioTrack?: number
  detectScenes?: boolean
  sceneThreshold?: number
  signal?: AbortSignal
  onProgress?: (stage: 'áudio' | 'cenas', ratio: number) => void
}

class AbortedError extends Error {
  constructor() {
    super('Análise cancelada.')
  }
}

function spawnTracked(ffmpeg: string, args: string[], signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortedError()
  const child = spawn(ffmpeg, args, { windowsHide: true })
  const onAbort = () => child.kill()
  signal?.addEventListener('abort', onAbort, { once: true })
  child.on('close', () => signal?.removeEventListener('abort', onAbort))
  return child
}

/** Lê o áudio como PCM mono 8 kHz em streaming e calcula energia, picos e silêncios. */
export function analyzeAudio(
  path: string,
  durationSec: number,
  opts: AnalyzeOptions
): Promise<Pick<AnalysisResult, 'peaks' | 'bucketSec' | 'rmsDb' | 'silences'>> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', `0:a:${opts.audioTrack ?? 0}`, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1']
    let child
    try {
      child = spawnTracked(opts.ffmpegPath, args, opts.signal)
    } catch (e) {
      reject(e)
      return
    }
    const analyzer = new PcmAnalyzer(SAMPLE_RATE, WINDOW_SEC)
    let bytes = 0
    let lastReport = 0
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      analyzer.push(d)
      bytes += d.length
      const sec = bytes / 2 / SAMPLE_RATE
      if (durationSec > 0 && sec - lastReport > 5) {
        lastReport = sec
        opts.onProgress?.('áudio', Math.min(1, sec / durationSec))
      }
    })
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (opts.signal?.aborted) return reject(new AbortedError())
      if (code !== 0) return reject(new Error(`Falha ao analisar o áudio: ${stderr.trim().split('\n').pop() ?? code}`))
      analyzer.flush()
      const buckets = Math.max(1, Math.round((analyzer.peak.length * WINDOW_SEC) * WAVE_BUCKETS_PER_SEC))
      resolve({
        peaks: downsamplePeaks(analyzer.peak, Math.min(buckets, 200_000)),
        bucketSec: (analyzer.peak.length * WINDOW_SEC) / Math.min(buckets, 200_000),
        rmsDb: perSecondDb(analyzer.rmsDb, WINDOW_SEC),
        silences: detectSilences(analyzer.rmsDb, WINDOW_SEC)
      })
    })
  })
}

/** Detecta mudanças de cena em baixa resolução (5 quadros/s, 160 px). */
export function detectScenes(path: string, durationSec: number, opts: AnalyzeOptions): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const th = opts.sceneThreshold ?? 0.35
    const args = ['-hide_banner', '-nostdin', '-i', path, '-map', '0:v:0', '-an', '-vf', `fps=5,scale=160:-2,select='gt(scene\\,${th})',showinfo`, '-f', 'null', '-']
    let child
    try {
      child = spawnTracked(opts.ffmpegPath, args, opts.signal)
    } catch (e) {
      reject(e)
      return
    }
    let text = ''
    let tail = ''
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      text += s.split('\n').filter((l) => l.includes('pts_time')).join('\n') + '\n'
      tail = (tail + s).slice(-2000)
      const t = /time=(\d+):(\d+):([\d.]+)/.exec(s)
      if (t && durationSec > 0) opts.onProgress?.('cenas', Math.min(1, (+t[1] * 3600 + +t[2] * 60 + +t[3]) / durationSec))
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (opts.signal?.aborted) return reject(new AbortedError())
      if (code !== 0) return reject(new Error(`Falha ao detectar cenas: ${tail.trim().split('\n').pop() ?? code}`))
      resolve(parseShowinfoTimes(text))
    })
  })
}

export async function analyzeMedia(meta: MediaMetadata, opts: AnalyzeOptions): Promise<AnalysisResult> {
  const hasAudio = meta.audioTracks.length > 0
  const audio = hasAudio
    ? await analyzeAudio(meta.path, meta.durationSec, opts)
    : { peaks: [], bucketSec: 1, rmsDb: [], silences: [] }
  const scenes = meta.video && opts.detectScenes !== false ? await detectScenes(meta.path, meta.durationSec, opts) : []
  return { durationSec: meta.durationSec, ...audio, scenes, hasAudio, createdAt: Date.now() }
}

/**
 * Gera miniaturas para a linha do tempo (uma busca rápida por quadro, 4 em paralelo).
 * Retorna os caminhos na ordem; reaproveita as que já existem no cache.
 */
export async function generateThumbnails(
  ffmpeg: string,
  path: string,
  durationSec: number,
  count: number,
  outDir: string,
  signal?: AbortSignal
): Promise<{ timeSec: number; file: string }[]> {
  await mkdir(outDir, { recursive: true })
  const items = Array.from({ length: count }, (_, i) => {
    const timeSec = Math.round(((i + 0.5) * durationSec * 100) / count) / 100
    return { timeSec, file: join(outDir, `thumb_${String(i).padStart(3, '0')}.jpg`) }
  })
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      if (existsSync(item.file)) continue
      await new Promise<void>((resolve) => {
        const child = spawnTracked(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-ss', item.timeSec.toFixed(2), '-i', path, '-frames:v', '1', '-vf', 'scale=160:-2', '-q:v', '5', item.file], signal)
        child.on('close', () => resolve())
        child.on('error', () => resolve())
      })
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  if (signal?.aborted) throw new AbortedError()
  return items.filter((i) => existsSync(i.file))
}
