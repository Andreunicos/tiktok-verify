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
