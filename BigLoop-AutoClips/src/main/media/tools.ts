import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface ToolPaths {
  ffmpeg: string
  ffprobe: string
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

/** Procura um executável no PATH. */
export function findOnPath(name: string): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = join(dir, exe(name))
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Ordem de resolução: caminho configurado → variável de ambiente
 * (BIGLOOP_FFMPEG / BIGLOOP_FFPROBE) → pasta "bin" empacotada → PATH.
 */
export function resolveTool(name: 'ffmpeg' | 'ffprobe', configured: string, bundledDir?: string): string | null {
  if (configured && existsSync(configured)) return configured
  const env = process.env[name === 'ffmpeg' ? 'BIGLOOP_FFMPEG' : 'BIGLOOP_FFPROBE']
  if (env && existsSync(env)) return env
  if (bundledDir) {
    const bundled = join(bundledDir, exe(name))
    if (existsSync(bundled)) return bundled
  }
  return findOnPath(name)
}

/** Executa "<tool> -version" e devolve a primeira linha. */
export function readVersion(toolPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(toolPath, ['-version'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out.split(/\r?\n/)[0] ?? '')
      else reject(new Error(`${toolPath} -version terminou com código ${code}`))
    })
  })
}

const HW_CANDIDATES = ['h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf'] as const

/**
 * Detecta encoders de placa de vídeo que realmente funcionam: o FFmpeg pode listar
 * NVENC/QSV/AMF mesmo sem a placa, então cada um é testado com um encode minúsculo.
 */
export async function detectHardwareEncoders(ffmpeg: string): Promise<string[]> {
  const listed = await new Promise<string>((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(out))
  })
  const present = HW_CANDIDATES.filter((e) => new RegExp(`\\s${e}\\s`).test(listed))
  const works = await Promise.all(
    present.map(
      (enc) =>
        new Promise<boolean>((resolve) => {
          const child = spawn(
            ffmpeg,
            ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', enc, '-f', 'null', '-'],
            { windowsHide: true }
          )
          const timer = setTimeout(() => child.kill(), 8000)
          child.on('error', () => resolve(false))
          child.on('close', (code) => {
            clearTimeout(timer)
            resolve(code === 0)
          })
        })
    )
  )
  return present.filter((_, i) => works[i])
}
