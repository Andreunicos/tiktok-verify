import type { AutoOptions, Mood } from './types'

/**
 * Entende pedidos escritos do jeito que a pessoa fala, por exemplo:
 * "faz 5 cortes de 30 segundos dos momentos engraçados" ou "3 clipes de 1 minuto pro reels".
 * O texto também vai para a IA (se ativa), que usa o resto do pedido para escolher os trechos.
 */
export interface ParsedInstructions {
  count?: number
  durationSec?: { min: number; max: number }
  music?: Mood | 'nenhuma'
  platform?: AutoOptions['platform']
}

const NUMBERS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90
}

const norm = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const num = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : (NUMBERS[w] ?? null))

/** Tempo em segundos de "30 segundos", "30s", "1 minuto", "1min", "1:30", "um minuto e meio". */
function seconds(n: number, unit: string): number {
  return /^m/.test(unit) ? n * 60 : n
}

export function parseInstructions(text: string): ParsedInstructions {
  const t = ` ${norm(text)} `
  const out: ParsedInstructions = {}
  const W = '(\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|noventa)'
  const UNIT = '(segundos?|seg|s|minutos?|min|m)\\b'

  // Quantidade: "5 cortes", "tres clipes", "10 videos"
  const c = new RegExp(`${W}\\s+(cortes?|clipes?|clips?|videos?|partes?|shorts?|reels?)\\b`).exec(t)
  if (c) {
    const n = num(c[1])
    if (n && n >= 1 && n <= 20) out.count = n
  }

  // Duração: "entre 20 e 40 segundos", "de 20 a 40s", "de 30 segundos", "1 minuto e meio", "1:30"
  const range = new RegExp(`(?:entre|de)\\s+${W}\\s*(?:${UNIT})?\\s*(?:e|a|ate)\\s+${W}\\s*${UNIT}`).exec(t)
  const mmss = /\b(\d{1,2}):([0-5]\d)\b/.exec(t)
  const single = new RegExp(`${W}\\s*${UNIT}(\\s+e\\s+meio)?`).exec(t)
  if (range) {
    const a = num(range[1])
    const b = num(range[3])
    if (a && b) {
      const unitB = range[4]
      const unitA = range[2] ?? unitB
      const lo = seconds(a, unitA)
      const hi = seconds(b, unitB)
      out.durationSec = { min: Math.min(lo, hi), max: Math.max(lo, hi) }
    }
  } else if (mmss) {
    const s = Number(mmss[1]) * 60 + Number(mmss[2])
    out.durationSec = { min: Math.round(s * 0.85), max: Math.round(s * 1.1) }
  } else if (single) {
    const n = num(single[1])
    if (n) {
      let s = seconds(n, single[2])
      if (single[3]) s += /^m/.test(single[2]) ? 30 : n / 2
      out.durationSec = { min: Math.round(s * 0.85), max: Math.round(s * 1.1) }
    }
  }
  if (out.durationSec) {
    out.durationSec.min = Math.max(5, Math.min(out.durationSec.min, 170))
    out.durationSec.max = Math.max(out.durationSec.min + 3, Math.min(out.durationSec.max, 180))
  }

  // Música pelo clima
  if (/\bsem musica\b/.test(t)) out.music = 'nenhuma'
  else if (/\b(engracad|engracado|comedia|risada|zoeira|meme)/.test(t)) out.music = 'engracada'
  else if (/\b(epic|epico|epica|hype|insano|clutch|jogada)/.test(t)) out.music = 'epica'
  else if (/\b(lofi|lo-fi|tranquil)/.test(t)) out.music = 'lofi'
  else if (/\b(calm|calmo|calma|relax)/.test(t)) out.music = 'calma'
  else if (/\b(animad|energia|agitad)/.test(t)) out.music = 'animada'

  // Plataforma
  if (/\btik ?tok\b/.test(t)) out.platform = 'tiktok'
  else if (/\breels?\b|\binstagram\b/.test(t)) out.platform = 'reels'
  else if (/\bshorts?\b/.test(t)) out.platform = 'shorts'
  else if (/\byoutube\b/.test(t) && !/\bshorts?\b/.test(t)) out.platform = 'youtube'
  return out
}
