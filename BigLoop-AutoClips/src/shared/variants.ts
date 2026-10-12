import type { AutoOptions, Cue, Range } from './types'

type CaptionStyle = NonNullable<AutoOptions['captionStyle']>

/** Estilo de legenda da versão B (contrasta com o da versão A). */
export const ALT_CAPTION: Record<CaptionStyle, CaptionStyle> = {
  tiktok: 'hormozi',
  mrbeast: 'karaoke',
  hormozi: 'tiktok',
  karaoke: 'mrbeast',
  caixa: 'tiktok',
  minimal: 'caixa'
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()

/** Primeiro texto da lista que é diferente de `current` (para o título da versão B). */
export function alternateText(current: string, candidates: (string | undefined | null)[]): string {
  const cur = fold(current)
  for (const c of candidates) if (c && c.trim() && fold(c) !== cur) return c.trim()
  return ''
}

/** Pedido escrito pede série ("em partes", "parte 1, 2, 3", "série")? */
export function wantsSeries(text: string | undefined): boolean {
  return !!text && /\b(em partes|serie|parte 1|parte um|dividid[oa] em|continua(cao)?)\b/.test(fold(text))
}

/** Pedido escrito pede versões A/B ("teste a/b", "duas versões")? */
export function wantsAbTest(text: string | undefined): boolean {
  return !!text && /\b(ab|a b|teste ab|duas versoes|2 versoes|versao b|variacoes|variantes)\b/.test(fold(text).replace(/\//g, ' '))
}

/**
 * Trecho contínuo para uma série: começa no melhor momento e vai até `parts × partSec`
 * (sem passar do fim do vídeo; se faltar vídeo, recua o começo).
 */
export function seriesSpan(bestStart: number, durationSec: number, parts: number, partSec: number): Range {
  const want = parts * partSec
  const startSec = Math.max(0, Math.min(bestStart, durationSec - want))
  return { startSec, endSec: Math.min(durationSec, startSec + want) }
}

/**
 * Divide um trecho em `n` partes seguidas, cortando no fim de uma frase (ou numa pausa)
 * perto de cada divisão ideal — assim ninguém fica no meio de uma palavra entre a Parte 1 e a 2.
 */
export function splitIntoParts(span: Range, n: number, cues: Cue[], silences: Range[] = []): Range[] {
  const total = span.endSec - span.startSec
  if (n <= 1 || total <= 0) return [{ ...span }]
  const L = total / n
  const tol = L * 0.25
  const ends = [
    ...cues.filter((c) => /[.!?…]$/.test(c.text.trim())).map((c) => c.endSec),
    ...silences.map((s) => (s.startSec + s.endSec) / 2)
  ]
  const parts: Range[] = []
  let start = span.startSec
  for (let k = 1; k < n; k++) {
    const ideal = span.startSec + k * L
    const near = ends.filter((e) => e > start + L * 0.5 && Math.abs(e - ideal) <= tol).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0]
    const cut = Math.round((near ?? ideal) * 1000) / 1000
    parts.push({ startSec: start, endSec: cut })
    start = cut
  }
  parts.push({ startSec: start, endSec: span.endSec })
  return parts
}

/** Textos de uma parte da série. */
export function seriesTexts(k: number, n: number, title: string): { title: string; overlay: string; cta: string } {
  return {
    title: `${title.replace(/\s*[—-]\s*parte \d+\/\d+$/i, '')} — Parte ${k}/${n}`.slice(0, 80),
    overlay: `PARTE ${k}/${n}`,
    cta: k < n ? `PARTE ${k + 1} NO PERFIL` : ''
  }
}
