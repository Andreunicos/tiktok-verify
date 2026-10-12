import type { Cue, SubtitleStyle } from './types'

/** Estilos de legenda prontos, no jeito dos cortes que mais viralizam. */
export type CaptionPreset = 'tiktok' | 'mrbeast' | 'hormozi' | 'karaoke' | 'caixa' | 'minimal'

export const CAPTION_PRESETS: Record<CaptionPreset, { label: string; sub: string; style: Partial<SubtitleStyle> }> = {
  tiktok: { label: 'TikTok', sub: 'palavra amarela', style: {} },
  mrbeast: {
    label: 'MrBeast',
    sub: 'enorme, 2–3 palavras',
    style: { font: 'Arial Black', fontSize: 96, outline: 8, maxCharsPerLine: 14, maxLines: 1, uppercase: true, wordHighlight: true, highlightColor: '#FFE600' }
  },
  hormozi: {
    label: 'Hormozi',
    sub: 'branco + verde',
    style: { font: 'Arial Black', fontSize: 80, outline: 6, maxCharsPerLine: 18, maxLines: 2, uppercase: true, wordHighlight: true, highlightColor: '#38FF6A' }
  },
  karaoke: { label: 'Karaokê', sub: 'enche ao falar', style: { fontSize: 76, karaoke: true, wordHighlight: false, uppercase: true, highlightColor: '#FFD400' } },
  caixa: { label: 'Caixa', sub: 'fundo escuro', style: { fontSize: 64, box: true, outline: 14, uppercase: false, wordHighlight: true, maxCharsPerLine: 26 } },
  minimal: { label: 'Discreta', sub: 'pequena, limpa', style: { fontSize: 54, outline: 3, uppercase: false, wordHighlight: false, maxCharsPerLine: 30 } }
}

export function applyCaptionPreset(base: SubtitleStyle, preset: CaptionPreset | undefined, brandColor?: string): SubtitleStyle {
  const p = preset && CAPTION_PRESETS[preset] ? CAPTION_PRESETS[preset].style : {}
  const out: SubtitleStyle = { ...base, karaoke: false, box: false, ...p }
  if (brandColor && /^#[0-9a-f]{6}$/i.test(brandColor)) out.highlightColor = brandColor.toUpperCase()
  return out
}

/** Emojis coloridos (imagens Twemoji em resources/emoji/<código>.png) por palavras na fala. */
export const EMOJI_IMAGE_RULES: [RegExp, string][] = [
  [/\b(dinheiro|grana|reais|lucro|pix)\b/i, '1f4b0'],
  [/\b(fogo|brabo|insano|pegando fogo)\b/i, '1f525'],
  [/\b(amor|amo|coração)\b/i, '2764'],
  [/\b(k{3,}|ha(ha)+|rs(rs)+|risada|engraçado|zoeira)\b/i, '1f602'],
  [/\b(incrível|inacreditável|absurdo|chocado|surreal)\b/i, '1f92f'],
  [/\b(meu deus|socorro|caramba|caraca|medo)\b/i, '1f631'],
  [/\b(morri|morreu|morto|morre)\b/i, '1f480'],
  [/\b(headshot|mira|acertei|na mosca|na cabeça)\b/i, '1f3af'],
  [/\b(cuidado|atenção|perigo)\b/i, '26a0'],
  [/\b(dica|ideia|segredo)\b/i, '1f4a1'],
  [/\b(ganhei|ganhamos|vitória|venci|campeão|booyah)\b/i, '1f3c6'],
  [/\b(parabéns|aplausos|boa|mandou bem)\b/i, '1f44f'],
  [/\b(palhaço|vacilo|vacilou)\b/i, '1f921'],
  [/\b(tranquilo|fácil|ez|de boa)\b/i, '1f60e'],
  [/\b(jogo|game|partida)\b/i, '1f3ae'],
  [/\b(música|som|batida)\b/i, '1f3b5'],
  [/\b(olha|olhem|veja|vejam)\b/i, '1f440'],
  [/\b(rápido|velocidade|corre)\b/i, '26a1'],
  [/\b(perdi|perdemos|triste)\b/i, '1f622']
]

export function emojiCodeFor(text: string): string | null {
  for (const [re, code] of EMOJI_IMAGE_RULES) if (re.test(text)) return code
  return null
}

export interface EmojiEvent {
  code: string
  startSec: number
  endSec: number
}

/** Quando mostrar cada emoji (tempo do corte): no máximo um por fala, espaçados, até `max` por corte. */
export function emojiEvents(cues: Cue[], opts = { max: 6, minGapSec: 3, holdSec: 1.6 }): EmojiEvent[] {
  const out: EmojiEvent[] = []
  for (const c of cues) {
    if (out.length >= opts.max) break
    const code = emojiCodeFor(c.text)
    if (!code) continue
    // aparece quando a palavra é dita (se houver tempo por palavra)
    const w = c.words?.find((x) => emojiCodeFor(x.text) === code)
    const start = w ? w.startSec : c.startSec
    const prev = out[out.length - 1]
    if (prev && start - prev.startSec < opts.minGapSec) continue
    out.push({ code, startSec: Math.round(start * 100) / 100, endSec: Math.round(Math.max(start + 0.6, Math.min(start + opts.holdSec, c.endSec + 0.4)) * 100) / 100 })
  }
  return out
}
