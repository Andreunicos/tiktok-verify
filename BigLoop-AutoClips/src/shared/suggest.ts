import { percentile } from './analysis'
import { formatTimecode } from './time'
import type { AnalysisResult, Cue, Range, Suggestion, SuggestionFeatures, SuggestionOptions } from './types'

export const DEFAULT_WEIGHTS: Record<keyof SuggestionFeatures, number> = {
  energy: 1.2,
  peak: 1,
  speech: 1,
  scenes: 0.6,
  hook: 1,
  cleanStart: 0.6,
  cleanEnd: 0.6
}

export const FEATURE_LABELS: Record<keyof SuggestionFeatures, string> = {
  energy: 'Energia',
  peak: 'Pico',
  speech: 'Fala',
  scenes: 'Cenas',
  hook: 'Gancho',
  cleanStart: 'Início limpo',
  cleanEnd: 'Final limpo'
}

const HOOK_WORDS =
  /\b(olha|olhem|vejam?|presta atenção|sabia|segredo|nunca|ninguém|incrível|absurdo|cara|mano|gente|pessoal|imagina|por que|porque você|o que|como|qual|quem|eu não acredito|para tudo|espera)\b/i
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec))

export interface SuggestInput {
  analysis: AnalysisResult
  cues?: Cue[] | null
  options: SuggestionOptions
  weights?: Record<keyof SuggestionFeatures, number> | null
}

/**
 * Sugere trechos com pontuação explicável. Não promete viralização: apenas combina sinais
 * (energia do áudio, picos, fala contínua, cortes de cena, gancho no início e limites limpos).
 */
export function suggestClips({ analysis, cues, options, weights }: SuggestInput): Suggestion[] {
  const w = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) }
  const D = analysis.durationSec
  if (D < options.minSec) return []
  const secDb = analysis.rmsDb
  const voiced = secDb.filter((d) => d > -80)
  const median = percentile(voiced, 50)
  const p95 = percentile(voiced, 95)
  const spread = Math.max(3, p95 - median)
  const sentenceCues = (cues ?? []).filter((c) => c.text.trim())

  // Fronteiras candidatas
  const starts = new Set<number>([0])
  const ends = new Set<number>([D])
  for (const s of analysis.silences) {
    starts.add(s.endSec)
    ends.add(s.startSec)
  }
  for (const c of sentenceCues) {
    starts.add(c.startSec)
    if (/[.!?…]$/.test(c.text.trim()) || !c.text.trim()) ends.add(c.endSec)
  }
  for (const t of analysis.scenes) starts.add(t)
  // Sem pausas suficientes: grade de 2 em 2 segundos
  if (starts.size < 8) for (let t = 0; t < D; t += 2) starts.add(t)
  if (ends.size < 8) for (let t = options.minSec; t <= D; t += 2) ends.add(t)

  const startList = [...starts].filter((t) => t >= 0 && t < D - options.minSec).sort((a, b) => a - b)
  const endList = [...ends].filter((t) => t > 0 && t <= D).sort((a, b) => a - b)
  const silenceEnds = new Set(analysis.silences.map((s) => s.endSec))
  const silenceStarts = new Set(analysis.silences.map((s) => s.startSec))
  const cueStarts = new Set(sentenceCues.map((c) => c.startSec))
  const cueEndsSentence = new Set(sentenceCues.filter((c) => /[.!?…]$/.test(c.text.trim())).map((c) => c.endSec))

  const silentSeconds = (a: number, b: number) =>
    analysis.silences.reduce((sum, s) => sum + overlap(s, { startSec: a, endSec: b }), 0)
  const sceneCount = (a: number, b: number) => analysis.scenes.filter((t) => t > a && t < b).length
  const textIn = (a: number, b: number) =>
    sentenceCues
      .filter((c) => c.startSec >= a - 0.05 && c.endSec <= b + 0.05)
      .map((c) => c.text.trim())
      .join(' ')

  const candidates: Suggestion[] = []
  for (const s of startList) {
    const valid = endList.filter((e) => e - s >= options.minSec && e - s <= options.maxSec)
    if (valid.length === 0) continue
    const step = Math.max(1, Math.floor(valid.length / 6))
    for (let k = 0; k < valid.length; k += step) {
      const e = valid[k]
      const a = Math.floor(s)
      const b = Math.min(secDb.length, Math.ceil(e))
      const slice = secDb.slice(a, b)
      if (slice.length === 0) continue
      const meanPow = slice.reduce((x, db) => x + 10 ** (db / 10), 0) / slice.length
      const meanDb = 10 * Math.log10(Math.max(meanPow, 1e-9))
      const maxDb = Math.max(...slice)
      const maxAt = a + slice.indexOf(maxDb)
      const len = e - s
      const sceneN = sceneCount(s, e)
      const text = textIn(s, e)
      const firstText = sentenceCues.find((c) => c.startSec >= s - 0.05 && c.startSec < s + 5)?.text.trim() ?? ''
      const openingDb = secDb.slice(a, Math.min(b, a + 3))
      const openingLoud = openingDb.length ? Math.max(...openingDb) : -90
      const hookText = firstText && (/[?!]/.test(firstText) || HOOK_WORDS.test(firstText))
      const features: SuggestionFeatures = {
        energy: analysis.hasAudio ? clamp01((meanDb - median) / spread + 0.5) : 0,
        peak: analysis.hasAudio ? clamp01((maxDb - median) / spread) : 0,
        speech: analysis.hasAudio ? clamp01(1 - silentSeconds(s, e) / len) : 0,
        scenes: clamp01(((sceneN / len) * 60) / 10),
        hook: hookText ? 1 : analysis.hasAudio ? clamp01((openingLoud - median) / spread) * 0.7 : 0,
        cleanStart: s === 0 || silenceEnds.has(s) || cueStarts.has(s) ? 1 : 0.4,
        cleanEnd: e === D || silenceStarts.has(e) || cueEndsSentence.has(e) ? 1 : 0.4
      }
      const totalW = Object.values(w).reduce((x, y) => x + y, 0)
      const score = Math.round(((Object.keys(features) as (keyof SuggestionFeatures)[]).reduce((x, f) => x + w[f] * features[f], 0) / totalW) * 100)

      const reasons: string[] = []
      if (features.energy >= 0.6) reasons.push(`Energia do áudio ${(meanDb - median).toFixed(1)} dB acima da mediana do vídeo`)
      if (features.peak >= 0.75) reasons.push(`Pico de volume em ${formatTimecode(maxAt)} (grito, risada ou reação?)`)
      if (features.speech >= 0.85) reasons.push(`Fala contínua em ${Math.round(features.speech * 100)}% do trecho`)
      if (sceneN >= 2) reasons.push(`${sceneN} mudanças de cena — visual dinâmico`)
      if (hookText) reasons.push(`Começa com gancho: “${firstText.slice(0, 60)}${firstText.length > 60 ? '…' : ''}”`)
      else if (features.hook >= 0.6) reasons.push('Começo forte (volume alto nos 3 primeiros segundos)')
      if (features.cleanStart === 1 && s !== 0) reasons.push('Começa logo após uma pausa ou início de frase')
      if (features.cleanEnd === 1 && e !== D) reasons.push('Termina no fim de uma frase ou numa pausa')
      if (features.cleanStart < 1) reasons.push('⚠ Pode começar no meio de uma fala')
      if (features.cleanEnd < 1) reasons.push('⚠ Pode terminar no meio de uma fala')

      const title = text ? (text.match(/[^.!?…]+[.!?…]?/)?.[0] ?? text).trim().slice(0, 70) : `Momento em ${formatTimecode(s)}`
      candidates.push({ id: `s${Math.round(s * 100)}-${Math.round(e * 100)}`, startSec: s, endSec: e, score, features, reasons, title })
    }
  }

  // Remove sobreposições: mantém o melhor de cada região.
  candidates.sort((x, y) => y.score - x.score || x.startSec - y.startSec)
  const chosen: Suggestion[] = []
  for (const c of candidates) {
    const clash = chosen.some((k) => overlap(c, k) / Math.min(c.endSec - c.startSec, k.endSec - k.startSec) > 0.3)
    if (!clash) chosen.push(c)
    if (chosen.length >= options.count) break
  }
  return chosen
}

/**
 * Ajusta os pesos com o que o usuário aprovou ou rejeitou (aprendizado simples e explicável):
 * aprovar reforça as características altas do trecho; rejeitar as enfraquece.
 */
export function learnWeights(
  weights: Record<keyof SuggestionFeatures, number> | null,
  features: SuggestionFeatures,
  approved: boolean,
  rate = 0.15
): Record<keyof SuggestionFeatures, number> {
  const w = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) }
  for (const k of Object.keys(features) as (keyof SuggestionFeatures)[]) {
    const delta = rate * (features[k] - 0.5) * (approved ? 1 : -1)
    w[k] = Math.round(Math.min(3, Math.max(0.1, w[k] + delta)) * 1000) / 1000
  }
  return w
}
