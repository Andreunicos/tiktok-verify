import { estimateWordTimes, groupWordsIntoCues } from './subtitles'
import type { Cue, Transcript, Word } from './types'

interface WhisperSegment {
  offsets?: { from: number; to: number }
  timestamps?: { from: string; to: string }
  text?: string
}

interface WhisperJson {
  result?: { language?: string }
  params?: { language?: string }
  transcription?: WhisperSegment[]
}

const SPECIAL = /^\s*\[(_?[A-Z_]+_?|BLANK_AUDIO|Música|Music|MÚSICA|música|Aplausos|Risos)\]\s*$|^\s*\(.*\)\s*$/

/**
 * Converte o JSON do whisper.cpp (-oj). Com "-ml 1 -sow" cada segmento é uma palavra
 * e o resultado tem tempos por palavra; sem isso, cada segmento vira uma frase.
 */
export function parseWhisperJson(json: string, engine = 'whisper.cpp'): Transcript {
  let data: WhisperJson
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Saída do whisper.cpp inválida (JSON).')
  }
  const segments = (data.transcription ?? []).filter((s) => s.offsets && typeof s.text === 'string' && !SPECIAL.test(s.text))
  const language = data.result?.language ?? (data.params?.language && data.params.language !== 'auto' ? data.params.language : null)
  const wordsPerSeg = segments.reduce((n, s) => n + (s.text!.trim().split(/\s+/).filter(Boolean).length || 0), 0) / Math.max(1, segments.length)

  let cues: Cue[]
  if (wordsPerSeg <= 1.5) {
    const words: Word[] = []
    for (const s of segments) {
      const text = s.text!.trim()
      if (!text) continue
      const w = { startSec: s.offsets!.from / 1000, endSec: s.offsets!.to / 1000, text }
      // Pontuação solta gruda na palavra anterior
      if (/^[,.!?;:…]+$/.test(text) && words.length) {
        words[words.length - 1].text += text
        words[words.length - 1].endSec = Math.max(words[words.length - 1].endSec, w.endSec)
      } else words.push(w)
    }
    cues = groupWordsIntoCues(words)
  } else {
    cues = segments
      .map((s, i) => {
        const startSec = s.offsets!.from / 1000
        const endSec = s.offsets!.to / 1000
        const text = s.text!.trim()
        return { id: `c${i + 1}`, startSec, endSec, text, words: estimateWordTimes(text, startSec, endSec) }
      })
      .filter((c) => c.text && c.endSec > c.startSec)
  }
  return { language, engine, createdAt: Date.now(), cues }
}

/** Lê "progress = 42%" da saída do whisper.cpp (-pp). */
export function parseWhisperProgress(text: string): number | null {
  const all = [...text.matchAll(/progress\s*=\s*(\d+)%/g)]
  return all.length ? Number(all[all.length - 1][1]) / 100 : null
}

/** Argumentos do whisper-cli para transcrição com tempos por palavra. */
export function buildWhisperArgs(model: string, wav: string, outBase: string, language: string, threads: number): string[] {
  return ['-m', model, '-f', wav, '-l', language || 'auto', '-t', String(Math.max(1, threads)), '-ml', '1', '-sow', '-oj', '-of', outBase, '-pp', '-np']
}

/** Busca texto na transcrição (sem acento e sem diferenciar maiúsculas). */
export function searchCues(cues: Cue[], query: string): Cue[] {
  const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const q = fold(query.trim())
  if (!q) return []
  return cues.filter((c) => fold(c.text).includes(q))
}
