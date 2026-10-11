import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

let logFile: string | null = null

export const logPath = () => logFile

const MAX_LOG_BYTES = 5 * 1024 * 1024

export function initLogger(dir: string): string {
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'bigloop-autoclips.log')
  // Rotação simples: guarda um arquivo anterior.
  try {
    if (statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, `${logFile}.1`)
  } catch {
    // ainda não existe
  }
  return logFile
}

export function log(level: 'info' | 'warn' | 'error', message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${
    extra === undefined ? '' : ' ' + (extra instanceof Error ? extra.message : JSON.stringify(extra))
  }`
  if (level === 'error') console.error(line)
  else console.log(line)
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n')
    } catch {
      // Falha ao gravar log não deve derrubar o app.
    }
  }
}
