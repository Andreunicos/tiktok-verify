import type { Range, Word } from './types'

/** Vícios de linguagem removidos por padrão. "tipo" e "né" ficam de fora por mudarem o sentido. */
export const DEFAULT_FILLERS = ['é', 'éé', 'éh', 'ã', 'ãh', 'ah', 'hum', 'hm', 'hmm', 'uh', 'um', 'eh', 'ahn', 'ééé']

export interface FillerOptions {
  fillers: string[]
  /** Pausas maiores que isto entre palavras são encurtadas. */
  maxPauseSec: number
  /** Quanto de pausa manter quando encurta. */
  keepPauseSec: number
}

export const DEFAULT_FILLER_OPTIONS: FillerOptions = { fillers: DEFAULT_FILLERS, maxPauseSec: 0.6, keepPauseSec: 0.15 }

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}]/gu, '')

/**
 * Recalcula os intervalos de um trecho sem vícios ("éé", "hum") e sem pausas longas.
 * Requer tempos por palavra. Retorna os intervalos a manter e o total removido.
 */
export function removeFillers(
  range: Range,
  words: Word[],
  opts: FillerOptions = DEFAULT_FILLER_OPTIONS
): { ranges: Range[]; removedSec: number; removedWords: number } {
  const fillerSet = new Set(opts.fillers.map(norm))
  const inside = words.filter((w) => w.startSec >= range.startSec - 0.01 && w.endSec <= range.endSec + 0.01)
  if (inside.length === 0) return { ranges: [range], removedSec: 0, removedWords: 0 }
  const isFiller = (w: Word) => fillerSet.has(norm(w.text))
  const kept = inside.filter((w) => !isFiller(w))
  const removedWords = inside.length - kept.length
  if (kept.length === 0) return { ranges: [], removedSec: round(range.endSec - range.startSec), removedWords }

  const half = opts.keepPauseSec / 2
  const fillerBetween = (a: number, b: number) => inside.some((w) => isFiller(w) && w.startSec >= a - 0.01 && w.endSec <= b + 0.01)
  const out: Range[] = []

  // Início: corta pausa longa ou vício antes da primeira palavra mantida.
  const first = kept[0]
  let cursor =
    first.startSec - range.startSec > opts.maxPauseSec || fillerBetween(range.startSec, first.startSec)
      ? Math.max(range.startSec, first.startSec - half)
      : range.startSec

  for (let i = 1; i < kept.length; i++) {
    const prev = kept[i - 1]
    const cur = kept[i]
    const gap = cur.startSec - prev.endSec
    if (gap > opts.maxPauseSec || fillerBetween(prev.endSec, cur.startSec)) {
      const pad = Math.min(half, Math.max(0, gap) / 2)
      out.push({ startSec: cursor, endSec: prev.endSec + pad })
      cursor = cur.startSec - pad
    }
  }
  const last = kept[kept.length - 1]
  const tailCut = range.endSec - last.endSec > opts.maxPauseSec || fillerBetween(last.endSec, range.endSec)
  out.push({ startSec: cursor, endSec: tailCut ? Math.min(range.endSec, last.endSec + half) : range.endSec })

  const merged: Range[] = []
  for (const r of out) {
    const rr = { startSec: round(r.startSec), endSec: round(r.endSec) }
    if (rr.endSec - rr.startSec < 0.05) continue
    const prev = merged[merged.length - 1]
    if (prev && rr.startSec - prev.endSec < 0.05) prev.endSec = rr.endSec
    else merged.push(rr)
  }
  const keptSec = merged.reduce((sum, r) => sum + r.endSec - r.startSec, 0)
  return { ranges: merged, removedSec: round(range.endSec - range.startSec - keptSec), removedWords }
}

const round = (n: number) => Math.round(n * 1000) / 1000
