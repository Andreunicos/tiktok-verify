/**
 * Converte "hh:mm:ss.mmm", "mm:ss", "ss" ou "ss.mmm" em segundos.
 * Aceita vírgula como separador decimal. Retorna null se inválido.
 */
export function parseTimecode(input: string): number | null {
  const text = input.trim().replace(',', '.')
  if (text === '') return null
  const parts = text.split(':')
  if (parts.length > 3) return null
  let total = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isLast = i === parts.length - 1
    const pattern = isLast ? /^\d+(\.\d+)?$/ : /^\d+$/
    if (!pattern.test(part)) return null
    const value = Number(part)
    if (i > 0 && value >= 60) return null
    total = total * 60 + value
  }
  return Math.round(total * 1000) / 1000
}

/** Formata segundos como "hh:mm:ss.mmm" (ou "mm:ss.mmm" se < 1h). */
export function formatTimecode(seconds: number, alwaysHours = false): string {
  const safe = Math.max(0, seconds)
  const totalMs = Math.round(safe * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const tail = `${pad(m)}:${pad(s)}.${pad(ms, 3)}`
  return h > 0 || alwaysHours ? `${pad(h)}:${tail}` : tail
}

/** Versão segura para nomes de arquivo: "00h01m05s200". */
export function timecodeForFileName(seconds: number): string {
  const [hms, ms] = formatTimecode(seconds, true).split('.')
  const [h, m, s] = hms.split(':')
  return `${h}h${m}m${s}s${ms}`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
