import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { buildCutArgs, parseProgressChunk, sanitizeFileName } from '../../shared/ffmpeg'
import { timecodeForFileName } from '../../shared/time'
import type { CutRequest } from '../../shared/types'
import { validateCutRange } from '../../shared/validation'

/** Escolhe um caminho de saída que não sobrescreve nada existente. */
export function uniqueOutputPath(req: CutRequest): string {
  const source = basename(req.inputPath, extname(req.inputPath))
  const base = sanitizeFileName(
    req.baseName?.trim() || `${source}_corte_${timecodeForFileName(req.startSec)}-${timecodeForFileName(req.endSec)}`
  )
  let candidate = join(req.outputDir, `${base}.mp4`)
  for (let i = 2; existsSync(candidate); i++) candidate = join(req.outputDir, `${base} (${i}).mp4`)
  return candidate
}

export interface CutHandle {
  outputPath: string
  done: Promise<{ outputPath: string; elapsedMs: number }>
  cancel(): void
}

export interface CutOptions {
  ffmpegPath: string
  /** Duração conhecida da mídia de origem, para validar o intervalo. 0 = desconhecida. */
  sourceDurationSec: number
  onProgress?: (processedSec: number, ratio: number) => void
}

/**
 * Executa um corte com FFmpeg. O arquivo parcial é apagado em caso de erro
 * ou cancelamento; o original nunca é alterado e nenhum arquivo é sobrescrito (-n).
 */
export async function startCut(req: CutRequest, opts: CutOptions): Promise<CutHandle> {
  const rangeError = validateCutRange(req.startSec, req.endSec, opts.sourceDurationSec)
  if (rangeError) throw new Error(rangeError)
  if (!existsSync(req.inputPath)) throw new Error(`Arquivo de origem não encontrado: ${req.inputPath}`)
  await mkdir(req.outputDir, { recursive: true })

  const outputPath = uniqueOutputPath(req)
  const total = req.endSec - req.startSec
  const started = Date.now()
  let child: ChildProcess | null = null
  let cancelled = false

  const done = new Promise<{ outputPath: string; elapsedMs: number }>((resolve, reject) => {
    child = spawn(opts.ffmpegPath, buildCutArgs(req, outputPath), { windowsHide: true })
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => {
      const processed = parseProgressChunk(d.toString())
      if (processed !== null && opts.onProgress) {
        opts.onProgress(processed, Math.min(1, Math.max(0, processed / total)))
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    child.on('error', (err) => reject(new Error(`Não foi possível executar o FFmpeg: ${err.message}`)))
    child.on('close', async (code) => {
      if (code === 0 && !cancelled) {
        const out = await stat(outputPath).catch(() => null)
        if (!out || out.size === 0) {
          reject(new Error('O FFmpeg terminou, mas o arquivo de saída está vazio.'))
          return
        }
        opts.onProgress?.(total, 1)
        resolve({ outputPath, elapsedMs: Date.now() - started })
        return
      }
      await rm(outputPath, { force: true }).catch(() => undefined)
      if (cancelled) reject(new CutCancelledError())
      else reject(new Error(describeFfmpegError(stderr, code)))
    })
  })

  return {
    outputPath,
    done,
    cancel() {
      if (cancelled || !child || child.exitCode !== null) return
      cancelled = true
      // "q" no stdin não funciona com -nostdin; encerra o processo.
      child.kill()
    }
  }
}

export class CutCancelledError extends Error {
  constructor() {
    super('Corte cancelado.')
    this.name = 'CutCancelledError'
  }
}

export function describeFfmpegError(stderr: string, code: number | null): string {
  const text = stderr.trim()
  if (/No space left on device/i.test(text)) return 'Sem espaço em disco na pasta de saída.'
  if (/Permission denied/i.test(text)) return 'Sem permissão para gravar na pasta de saída.'
  if (/Invalid data found|moov atom not found/i.test(text))
    return 'O arquivo de origem parece corrompido ou ainda está sendo gravado.'
  const tail = text.split(/\r?\n/).slice(-3).join(' ')
  return `O FFmpeg falhou (código ${code ?? '?'}). ${tail}`.trim()
}
