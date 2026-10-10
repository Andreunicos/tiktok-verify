import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logFile: string | null = null

export function initLogger(dir: string): string {
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'bigloop-autoclips.log')
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
