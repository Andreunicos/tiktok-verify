import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { constants as osConstants, setPriority, tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { OUTPUT_EXT, buildExportArgs, buildThumbnailArgs, estimateOutputBytes, parseProgressChunk, sanitizeFileName } from '../../shared/ffmpeg'
import { renderName } from '../../shared/naming'
import { outputSize } from '../../shared/presets'
import { buildAss, formatSrt, mapCuesToClip } from '../../shared/subtitles'
import type { CutRequest } from '../../shared/types'
import { validateRequest } from '../../shared/validation'

export class CutCancelledError extends Error {
  constructor() {
    super('Corte cancelado.')
    this.name = 'CutCancelledError'
  }
}

/** Pasta e nome final, sem sobrescrever nada existente. */
export function resolveOutputPath(req: CutRequest, now = new Date()): string {
  const source = basename(req.inputPath, extname(req.inputPath))
  const dir = req.options.subfolderPerSource ? join(req.outputDir, sanitizeFileName(source)) : req.outputDir
  const first = req.ranges[0]
  const last = req.ranges[req.ranges.length - 1]
  const base = req.baseName?.trim()
    ? sanitizeFileName(req.baseName.trim())
    : renderName(req.options.nameTemplate, {
        nome: source,
        trecho: req.segmentName,
        inicio: first.startSec,
        fim: last.endSec,
        duracao: req.ranges.reduce((s, r) => s + r.endSec - r.startSec, 0) / req.options.speed,
        n: req.sequence,
        preset: req.presetName,
        formato: req.options.format,
        data: now
      })
  const ext = OUTPUT_EXT[req.options.format]
  let candidate = join(dir, `${base}.${ext}`)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base} (${i}).${ext}`)
  return candidate
}

/** Bytes livres no disco da pasta, ou null se não for possível saber. */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}

export interface ExportHandle {
  outputPath: string
  done: Promise<{ outputPath: string; extraFiles: string[]; elapsedMs: number }>
  cancel(): void
}

export interface ExportOptionsRuntime {
  ffmpegPath: string
  onProgress?: (processedSec: number, ratio: number, etaSec: number | null) => void
  /** Roda o FFmpeg com prioridade abaixo do normal (não trava jogos/gravação). */
  lowPriority?: boolean
  /** Espaço mínimo livre exigido além da estimativa. */
  minFreeBytes?: number
}

function run(ffmpeg: string, args: string[], cwd: string | undefined, lowPriority: boolean): ChildProcess {
  const child = spawn(ffmpeg, args, { windowsHide: true, cwd })
  if (lowPriority && child.pid) {
    try {
      setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Sem permissão para mudar prioridade: segue normalmente.
    }
  }
  return child
}

/**
 * Exporta um corte. O original nunca é alterado; nada é sobrescrito (-n e nome único);
 * arquivos parciais são apagados em erro ou cancelamento.
 */
export async function startExport(req: CutRequest, opts: ExportOptionsRuntime): Promise<ExportHandle> {
  const invalid = validateRequest(req)
  if (invalid) throw new Error(invalid)
  if (!existsSync(req.inputPath)) throw new Error(`Arquivo de origem não encontrado: ${req.inputPath}`)

  const outputPath = resolveOutputPath(req)
  const outDir = join(outputPath, '..')
  try {
    await mkdir(outDir, { recursive: true })
  } catch (err) {
    throw new Error(`Não foi possível criar a pasta de saída: ${(err as Error).message}`)
  }
  const free = await freeBytes(outDir)
  const needed = estimateOutputBytes(req) * 1.2 + (opts.minFreeBytes ?? 100 * 1024 * 1024)
  if (free !== null && free < needed) {
    throw new Error(
      `Pouco espaço em disco: ${(free / 1024 ** 3).toFixed(2)} GB livres, estimativa necessária ${(needed / 1024 ** 3).toFixed(2)} GB.`
    )
  }

  const o = req.options
  const burn = (o.subtitles === 'burn' || o.subtitles === 'both') && o.format === 'mp4'
  const clipCues = req.cues && o.subtitles !== 'none' ? mapCuesToClip(req.cues, req.ranges, o.speed) : []
  let workDir: string | undefined
  let assName: string | undefined
  if (burn && clipCues.length > 0) {
    workDir = await mkdtemp(join(tmpdir(), 'bigloop-'))
    assName = 'legendas.ass'
    const [w, h] = outputSize(o.aspect, req.source.width, req.source.height)
    await writeFile(join(workDir, assName), buildAss(clipCues, o.subtitleStyle, w, h), 'utf8')
  }

  const { args, durationSec } = buildExportArgs(req, outputPath, assName)
  const started = Date.now()
  let child: ChildProcess | null = null
  let cancelled = false
  const cleanupWork = () => (workDir ? rm(workDir, { recursive: true, force: true }).catch(() => undefined) : Promise.resolve())

  const done = new Promise<{ outputPath: string; extraFiles: string[]; elapsedMs: number }>((resolve, reject) => {
    child = run(opts.ffmpegPath, args, workDir, !!opts.lowPriority)
    let stderr = ''
    let buffer = ''
    child.stdout?.on('data', (d: Buffer) => {
      buffer += d.toString()
      const cut = buffer.lastIndexOf('\n')
      if (cut === -1) return
      const processed = parseProgressChunk(buffer.slice(0, cut))
      buffer = buffer.slice(cut + 1)
      if (processed !== null && opts.onProgress) {
        const ratio = Math.min(1, Math.max(0, processed / durationSec))
        const elapsed = (Date.now() - started) / 1000
        const eta = ratio > 0.02 ? Math.max(0, (elapsed / ratio) * (1 - ratio)) : null
        opts.onProgress(processed, ratio, eta)
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    child.on('error', (err) => {
      void cleanupWork()
      reject(new Error(`Não foi possível executar o FFmpeg: ${err.message}`))
    })
    child.on('close', async (code) => {
      await cleanupWork()
      if (code === 0 && !cancelled) {
        const out = await stat(outputPath).catch(() => null)
        if (!out || out.size === 0) {
          reject(new Error('O FFmpeg terminou, mas o arquivo de saída está vazio.'))
          return
        }
        const extraFiles: string[] = []
        try {
          const stem = outputPath.slice(0, -extname(outputPath).length)
          if ((o.subtitles === 'srt' || o.subtitles === 'both') && clipCues.length > 0) {
            await writeFile(`${stem}.srt`, formatSrt(clipCues), 'utf8')
            extraFiles.push(`${stem}.srt`)
          }
          if (o.thumbnail && (o.format === 'mp4' || o.format === 'gif')) {
            const jpg = `${stem}.jpg`
            await runSimple(opts.ffmpegPath, buildThumbnailArgs(outputPath, Math.min(1, durationSec / 3), jpg))
            extraFiles.push(jpg)
          }
        } catch (err) {
          reject(new Error(`Corte gerado, mas falhou ao criar arquivos extras: ${(err as Error).message}`))
          return
        }
        opts.onProgress?.(durationSec, 1, 0)
        resolve({ outputPath, extraFiles, elapsedMs: Date.now() - started })
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
      child.kill()
    }
  }
}

/** Executa o FFmpeg e espera terminar; lança erro com o stderr. */
export function runSimple(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(describeFfmpegError(stderr, code)))))
  })
}

export function describeFfmpegError(stderr: string, code: number | null): string {
  const text = stderr.trim()
  if (/No space left on device/i.test(text)) return 'Sem espaço em disco na pasta de saída.'
  if (/Permission denied/i.test(text)) return 'Sem permissão para gravar na pasta de saída.'
  if (/Invalid data found|moov atom not found/i.test(text))
    return 'O arquivo de origem parece corrompido ou ainda está sendo gravado.'
  if (/Unknown encoder|Cannot load nv|No NVENC capable|Error initializing output stream|Failed to (create|initialise|initialize)/i.test(text))
    return `O encoder escolhido não está disponível neste computador. Use "libx264" em Configurações. (${text.split(/\r?\n/).slice(-1)[0]})`
  const tail = text.split(/\r?\n/).slice(-3).join(' ')
  return `O FFmpeg falhou (código ${code ?? '?'}). ${tail}`.trim()
}
