import { groupWordsIntoCues } from './subtitles'
import { suggestClips } from './suggest'
import type { AnalysisResult, Range, Transcript, Word } from './types'

/** A partir de quantos segundos vale transcrever só os trechos promissores. */
export const PARTIAL_TRANSCRIBE_MIN_SEC = 20 * 60

/**
 * Trechos de uma live longa que valem a transcrição (som alto, ação, chat, eventos do jogo),
 * com folga antes (contexto) e depois. Cobre cerca de 35% do vídeo (no mínimo 10 min).
 * Devolve null quando o vídeo é curto ou quando não compensa (cobriria quase tudo).
 */
export function promisingRegions(
  analysis: AnalysisResult,
  opts: { coverage?: number; minCoverSec?: number; padBefore?: number; padAfter?: number; maxPieces?: number } = {}
): Range[] | null {
  const D = analysis.durationSec
  if (D < PARTIAL_TRANSCRIBE_MIN_SEC) return null
  const target = Math.min(D, Math.max(opts.minCoverSec ?? 600, D * (opts.coverage ?? 0.35)))
  const padBefore = opts.padBefore ?? 25
  const padAfter = opts.padAfter ?? 10
  const maxPieces = opts.maxPieces ?? 40
  const windows = suggestClips({ analysis, cues: [], options: { minSec: 30, maxSec: 60, count: 80 } })
  if (!windows.length) return null

  const chosen: Range[] = []
  const covered = () => chosen.reduce((t, r) => t + r.endSec - r.startSec, 0)
  for (const w of windows) {
    chosen.push({ startSec: Math.max(0, w.startSec - padBefore), endSec: Math.min(D, w.endSec + padAfter) })
    const merged = mergeRanges(chosen, 15)
    chosen.splice(0, chosen.length, ...merged)
    if (covered() >= target || chosen.length >= maxPieces) break
  }
  if (covered() > D * 0.8) return null
  return chosen.map((r) => ({ startSec: Math.round(r.startSec * 1000) / 1000, endSec: Math.round(r.endSec * 1000) / 1000 }))
}

/** Junta trechos sobrepostos ou separados por menos de `gapSec`. */
export function mergeRanges(ranges: Range[], gapSec = 0): Range[] {
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.startSec - last.endSec <= gapSec) last.endSec = Math.max(last.endSec, r.endSec)
    else out.push({ ...r })
  }
  return out
}

/** Tempo no áudio "colado" (trechos um após o outro) → tempo no vídeo original. */
export function concatToSource(t: number, ranges: Range[]): number {
  let acc = 0
  for (let i = 0; i < ranges.length; i++) {
    const len = ranges[i].endSec - ranges[i].startSec
    if (t < acc + len || i === ranges.length - 1) return ranges[i].startSec + Math.min(Math.max(0, t - acc), len)
    acc += len
  }
  return t
}

/**
 * Converte a transcrição do áudio colado para os tempos do vídeo original.
 * As falas são reagrupadas para nenhuma atravessar o "pulo" entre dois trechos.
 */
export function remapTranscript(t: Transcript, ranges: Range[]): Transcript {
  const words: Word[] = t.cues.flatMap((c) => (c.words?.length ? c.words : [{ startSec: c.startSec, endSec: c.endSec, text: c.text }]))
  const mapped = words.map((w) => {
    const startSec = concatToSource(w.startSec, ranges)
    return { ...w, startSec, endSec: Math.max(startSec + 0.05, Math.min(concatToSource(w.endSec, ranges), startSec + (w.endSec - w.startSec))) }
  })
  return { ...t, engine: `${t.engine} (trechos)`, cues: groupWordsIntoCues(mapped) }
}
