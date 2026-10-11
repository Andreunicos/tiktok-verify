import { spawn } from 'node:child_process'
import { analyzeFrame, decideTrack, type FrameSample, type TrackDecision } from '../../shared/track'
import type { Range } from '../../shared/types'

const FRAME_W = 96

/**
 * Lê o trecho em baixa resolução (2 quadros/s, 96 px) e decide o enquadramento 9:16.
 * `cropFrac` = largura da faixa 9:16 em relação à largura do vídeo (ex.: 0,316 para 16:9).
 */
export function trackPerson(ffmpeg: string, path: string, span: Range, srcW: number, srcH: number, cropFrac: number, signal?: AbortSignal): Promise<TrackDecision> {
  return new Promise((resolve, reject) => {
    const h = Math.max(2, Math.round((FRAME_W * srcH) / srcW / 2) * 2)
    const frameBytes = FRAME_W * h * 3
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-ss', span.startSec.toFixed(3), '-t', (span.endSec - span.startSec).toFixed(3), '-i', path,
      '-map', '0:v:0', '-an', '-vf', `fps=2,scale=${FRAME_W}:${h},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
    ]
    const child = spawn(ffmpeg, args, { windowsHide: true })
    const onAbort = () => child.kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    const samples: FrameSample[] = []
    let buf = Buffer.alloc(0)
    let prev: Uint8Array | null = null
    let idx = 0
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= frameBytes) {
        const frame = buf.subarray(0, frameBytes)
        const { sample, gray } = analyzeFrame(frame, FRAME_W, h, cropFrac, prev, span.startSec + idx * 0.5)
        samples.push(sample)
        prev = gray
        idx++
        buf = buf.subarray(frameBytes)
      }
    })
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-1000)))
    child.on('error', reject)
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(new Error('Cancelado.'))
      if (code !== 0) return reject(new Error(`Falha ao analisar o enquadramento: ${stderr.trim().split('\n').pop() ?? code}`))
      resolve(decideTrack(samples, cropFrac))
    })
  })
}
