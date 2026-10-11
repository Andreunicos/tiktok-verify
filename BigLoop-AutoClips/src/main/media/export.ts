import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { constants as osConstants, setPriority, tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
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

/** Mensagem clara quando o Windows (ou permissões) impedem gravar na pasta de saída. */
export function blockedFolderMessage(dir: string, cause?: string): string {
  return (
    `O Windows não deixou gravar em "${dir}"${cause ? ` (${cause})` : ''}. ` +
    'Isso costuma ser a proteção "Acesso controlado a pastas" (Segurança do Windows → Proteção contra ransomware), ' +
    'que bloqueia programas desconhecidos nas pastas Vídeos e Documentos. Escolha outra pasta de saída em Configurações ' +
    '(ex.: C:\\BigLoop Cortes) ou permita o BigLoop AutoClips nessa proteção.'
  )
}

/** Testa de verdade se dá para criar um arquivo na pasta (criando a pasta se preciso). Retorna null se der. */
export async function checkWritableDir(dir: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (err) {
    return blockedFolderMessage(dir, (err as NodeJS.ErrnoException).code ?? (err as Error).message)
  }
  const probe = join(dir, `.bigloop-teste-${process.pid}-${Date.now()}.tmp`)
  try {
    await writeFile(probe, 'ok')
    await rm(probe, { force: true })
    return null
  } catch (err) {
    await rm(probe, { force: true }).catch(() => undefined)
    return blockedFolderMessage(dir, (err as NodeJS.ErrnoException).code ?? (err as Error).message)
  }
}

/** Move sem sobrescrever; se o destino já existir, escolhe "nome (2).ext". Funciona entre discos. */
export async function moveNoOverwrite(from: string, to: string): Promise<string> {
  const ext = extname(to)
  const stem = to.slice(0, to.length - ext.length)
  let target = to
  for (let i = 2; existsSync(target); i++) target = `${stem} (${i})${ext}`
  try {
    await rename(from, target)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EBUSY') throw err
    // Outro disco (ou antivírus segurando o arquivo): copia sem sobrescrever e apaga o temporário.
    await copyFile(from, target, fsConstants.COPYFILE_EXCL)
    await rm(from, { force: true })
  }
  return target
}

/**
 * Exporta um corte. O FFmpeg grava numa pasta temporária do app e, no fim, o arquivo é movido
 * para a pasta de saída (assim proteções do Windows contra programas desconhecidos não bloqueiam o FFmpeg).
 * O original nunca é alterado; nada é sobrescrito; temporários são apagados em erro ou cancelamento.
 */
export async function startExport(req: CutRequest, opts: ExportOptionsRuntime): Promise<ExportHandle> {
  const invalid = validateRequest(req)
  if (invalid) throw new Error(invalid)
  if (!existsSync(req.inputPath)) throw new Error(`Arquivo de origem não encontrado: ${req.inputPath}`)

  const outputPath = resolveOutputPath(req)
  const outDir = dirname(outputPath)
  const blocked = await checkWritableDir(outDir)
  if (blocked) throw new Error(blocked)

  const workDir = await mkdtemp(join(tmpdir(), 'bigloop-'))
  const cleanupWork = () => rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  const needed = estimateOutputBytes(req) * 1.2 + (opts.minFreeBytes ?? 100 * 1024 * 1024)
  for (const dir of new Set([outDir, workDir])) {
    const free = await freeBytes(dir)
    if (free !== null && free < needed) {
      await cleanupWork()
      throw new Error(
        `Pouco espaço em disco em ${dir}: ${(free / 1024 ** 3).toFixed(2)} GB livres, estimativa necessária ${(needed / 1024 ** 3).toFixed(2)} GB.`
      )
    }
  }

  const o = req.options
  const burn = (o.subtitles === 'burn' || o.subtitles === 'both') && o.format === 'mp4'
  const clipCues = req.cues && o.subtitles !== 'none' ? mapCuesToClip(req.cues, req.ranges, o.speed) : []
  let assName: string | undefined
  const title = o.format === 'mp4' ? req.visual?.title?.trim() : undefined
  if ((burn && clipCues.length > 0) || title) {
    assName = 'legendas.ass'
    const [w, h] = outputSize(o.aspect, req.source.width, req.source.height)
    const cuesToBurn = burn ? clipCues : []
    await writeFile(join(workDir, assName), buildAss(cuesToBurn, o.subtitleStyle, w, h, { title, keywords: req.visual?.keywords }), 'utf8')
  }

  const ext = extname(outputPath)
  const tmpOut = join(workDir, `saida${ext}`)
  const { args, durationSec } = buildExportArgs(req, tmpOut, assName)
  const started = Date.now()
  let child: ChildProcess | null = null
  let cancelled = false

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
      try {
        if (cancelled) throw new CutCancelledError()
        if (code !== 0) throw new Error(describeFfmpegError(stderr, code))
        const out = await stat(tmpOut).catch(() => null)
        if (!out || out.size === 0) throw new Error('O FFmpeg terminou, mas o arquivo de saída está vazio.')

        // Extras gerados no temporário e movidos junto
        const extras: string[] = []
        if ((o.subtitles === 'srt' || o.subtitles === 'both') && clipCues.length > 0) {
          await writeFile(join(workDir, 'saida.srt'), formatSrt(clipCues), 'utf8')
          extras.push('srt')
        }
        if (o.thumbnail && (o.format === 'mp4' || o.format === 'gif')) {
          await runSimple(opts.ffmpegPath, buildThumbnailArgs(tmpOut, Math.min(1, durationSec / 3), join(workDir, 'saida.jpg')))
          extras.push('jpg')
        }

        let finalPath: string
        try {
          finalPath = await moveNoOverwrite(tmpOut, outputPath)
        } catch (err) {
          throw new Error(blockedFolderMessage(outDir, (err as NodeJS.ErrnoException).code ?? (err as Error).message))
        }
        const finalStem = finalPath.slice(0, finalPath.length - ext.length)
        const extraFiles: string[] = []
        for (const e of extras) {
          try {
            extraFiles.push(await moveNoOverwrite(join(workDir, `saida.${e}`), `${finalStem}.${e}`))
          } catch (err) {
            throw new Error(`Corte gerado, mas falhou ao salvar o arquivo .${e}: ${(err as Error).message}`)
          }
        }
        opts.onProgress?.(durationSec, 1, 0)
        resolve({ outputPath: finalPath, extraFiles, elapsedMs: Date.now() - started })
      } catch (err) {
        reject(err)
      } finally {
        await cleanupWork()
      }
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
  if (/No space left on device/i.test(text)) return 'Sem espaço em disco (pasta temporária do Windows ou pasta de saída).'
  if (/Error opening output|Permission denied/i.test(text))
    return `O FFmpeg não conseguiu gravar o arquivo temporário. Verifique antivírus/“Acesso controlado a pastas” para o ffmpeg.exe. (${text.split(/\r?\n/).slice(-1)[0]})`
  if (/Invalid data found|moov atom not found/i.test(text))
    return 'O arquivo de origem parece corrompido ou ainda está sendo gravado.'
  if (/Unknown encoder|Cannot load nv|No NVENC capable|Error initializing output stream|Failed to (create|initialise|initialize)/i.test(text))
    return `O encoder escolhido não está disponível neste computador. Use "libx264" em Configurações. (${text.split(/\r?\n/).slice(-1)[0]})`
  const tail = text.split(/\r?\n/).slice(-3).join(' ')
  return `O FFmpeg falhou (código ${code ?? '?'}). ${tail}`.trim()
}
