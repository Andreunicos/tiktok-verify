import type { Cue, Range, Word } from './types'

/**
 * Edição inteligente (lógica pura, testável): ajuste de cortes para frases inteiras, gancho no
 * começo ("teaser"), efeitos sonoros no momento certo e zooms nos picos.
 * Todos os tempos de saída são no tempo do corte final (velocidade 1).
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Converte um tempo da origem para o tempo do corte (null se cair fora dos intervalos). */
export function toOutputTime(t: number, ranges: Range[]): number | null {
  let offset = 0
  for (const r of ranges) {
    if (t >= r.startSec && t <= r.endSec) return r3(offset + t - r.startSec)
    offset += r.endSec - r.startSec
  }
  return null
}

export const totalLength = (ranges: Range[]) => ranges.reduce((s, r) => s + r.endSec - r.startSec, 0)

/**
 * Não corta no meio da frase: puxa o início para o começo da frase mais próxima e o fim para o
 * fim da frase (pontuação final ou pausa longa depois). Limites para não mudar demais o corte.
 */
export function snapToSentences(range: Range, cues: Cue[], durationSec: number, opts = { maxBefore: 2.5, maxAfter: 3.5, maxLength: Infinity }): Range {
  const spoken = cues.filter((c) => c.text.trim())
  if (spoken.length === 0) return range
  let { startSec, endSec } = range
  // Início: frase que está em andamento no começo do corte
  const atStart = spoken.find((c) => c.startSec < startSec - 0.05 && c.endSec > startSec + 0.05)
  if (atStart && startSec - atStart.startSec <= opts.maxBefore) startSec = atStart.startSec
  else if (atStart) {
    // Longe demais para voltar: pula para a próxima frase
    const next = spoken.find((c) => c.startSec >= startSec)
    if (next && next.startSec - startSec <= opts.maxBefore) startSec = next.startSec
  }
  // Fim: termina no fim da frase em andamento (de preferência numa com pontuação final)
  const atEnd = spoken.find((c) => c.startSec < endSec - 0.05 && c.endSec > endSec + 0.05)
  if (atEnd && atEnd.endSec - endSec <= opts.maxAfter) endSec = atEnd.endSec
  else if (atEnd) {
    const prev = [...spoken].reverse().find((c) => c.endSec <= endSec)
    if (prev && endSec - prev.endSec <= opts.maxAfter) endSec = prev.endSec
  }
  if (endSec - startSec > opts.maxLength) return range
  return { startSec: r3(Math.max(0, startSec - 0.12)), endSec: r3(Math.min(durationSec, endSec + 0.25)) }
}

const norm = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')

/** Acha a frase do gancho nas palavras (com tempo) dentro dos intervalos. */
export function findPhrase(phrase: string, words: Word[], within: Range[]): Range | null {
  const target = phrase.split(/\s+/).map(norm).filter(Boolean)
  if (target.length < 2) return null
  const ws = words.filter((w) => within.some((r) => w.startSec >= r.startSec - 0.05 && w.endSec <= r.endSec + 0.05))
  const keys = ws.map((w) => norm(w.text))
  for (let i = 0; i + target.length <= ws.length; i++) {
    let hits = 0
    for (let k = 0; k < target.length; k++) if (keys[i + k] === target[k]) hits++
    if (hits / target.length >= 0.8) return { startSec: ws[i].startSec, endSec: ws[i + target.length - 1].endSec }
  }
  return null
}

/**
 * Gancho no começo: repete a frase mais forte (que acontece mais para frente) nos primeiros
 * segundos e depois segue o corte normal — o truque mais usado em vídeos curtos.
 */
export function withTeaser(ranges: Range[], hook: Range | null, opts = { minLen: 1.2, maxLen: 5, minDelay: 4 }): { ranges: Range[]; teaserSec: number } {
  if (!hook || ranges.length === 0) return { ranges, teaserSec: 0 }
  const len = hook.endSec - hook.startSec
  const out = toOutputTime(hook.startSec, ranges)
  if (len < opts.minLen || len > opts.maxLen || out === null || out < opts.minDelay) return { ranges, teaserSec: 0 }
  const teaser = { startSec: r3(hook.startSec - 0.08), endSec: r3(hook.endSec + 0.15) }
  return { ranges: [teaser, ...ranges], teaserSec: r3(teaser.endSec - teaser.startSec) }
}

export interface PlannedEffect {
  key: string
  atSec: number
  volume: number
}

export interface PlannedZoom {
  atSec: number
  durSec: number
  scale: number
}

export interface MomentInput {
  ranges: Range[]
  /** Energia por segundo da origem (dBFS). */
  rmsDb: number[]
  /** Risadas/gritos detectados (tempo da origem). */
  reactions?: { startSec: number; endSec: number; kind: string }[]
  words?: Word[]
  keywords?: string[]
  teaserSec?: number
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => x > -80).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : -90
}

/** Momentos fortes do corte (tempo de saída): picos de energia, reações e palavras-chave. */
export function strongMoments(m: MomentInput): { atSec: number; kind: 'pico' | 'reação' | 'palavra'; strength: number }[] {
  const out: { atSec: number; kind: 'pico' | 'reação' | 'palavra'; strength: number }[] = []
  const all: number[] = []
  for (const r of m.ranges) for (let s = Math.floor(r.startSec); s < Math.ceil(r.endSec); s++) if (m.rmsDb[s] !== undefined) all.push(m.rmsDb[s])
  const med = median(all)
  for (const r of m.ranges) {
    for (let s = Math.ceil(r.startSec); s < Math.floor(r.endSec); s++) {
      const db = m.rmsDb[s]
      if (db === undefined || db - med < 8) continue
      const isPeak = (m.rmsDb[s - 1] ?? -90) <= db && (m.rmsDb[s + 1] ?? -90) <= db
      const t = toOutputTime(s + 0.5, m.ranges)
      if (isPeak && t !== null) out.push({ atSec: t, kind: 'pico', strength: Math.min(1, (db - med) / 16) })
    }
  }
  for (const re of m.reactions ?? []) {
    const t = toOutputTime(re.startSec, m.ranges)
    if (t !== null) out.push({ atSec: t, kind: 'reação', strength: 0.9 })
  }
  if (m.words && m.keywords?.length) {
    const keys = new Set(m.keywords.map(norm))
    const used = new Set<string>()
    for (const w of m.words) {
      const k = norm(w.text)
      if (!keys.has(k) || used.has(k)) continue
      const t = toOutputTime(w.startSec, m.ranges)
      if (t === null) continue
      used.add(k)
      out.push({ atSec: t, kind: 'palavra', strength: 0.6 })
    }
  }
  return out.sort((a, b) => a.atSec - b.atSec)
}

/** Escolhe os efeitos sonoros: entrada, transição do gancho, "ding" em palavras e impacto no pico. */
export function planEffects(m: MomentInput, available: (key: string) => boolean, maxPerClip = 4): PlannedEffect[] {
  const fx: PlannedEffect[] = []
  const add = (key: string, atSec: number, volume: number, gap = 2.5) => {
    if (!available(key) || fx.length >= maxPerClip) return
    if (fx.some((f) => Math.abs(f.atSec - atSec) < gap)) return
    fx.push({ key, atSec: r3(Math.max(0, atSec)), volume })
  }
  add('whoosh', 0, 0.22, 0)
  if (m.teaserSec && m.teaserSec > 0) add('rebobinar', m.teaserSec - 0.15, 0.3, 0.5)
  const moments = strongMoments(m)
  const peaks = moments.filter((x) => x.kind === 'pico').sort((a, b) => b.strength - a.strength)
  if (peaks[0] && peaks[0].strength >= 0.75) add('impacto', peaks[0].atSec - 0.05, 0.35)
  let dings = 0
  for (const w of moments.filter((x) => x.kind === 'palavra')) {
    if (dings >= 2 || w.atSec < 1) continue
    const before = fx.length
    add(dings % 2 ? 'pop' : 'ding', w.atSec, 0.2, 5)
    if (fx.length > before) dings++
  }
  return fx.sort((a, b) => a.atSec - b.atSec)
}

/** Zooms rápidos ("punch-in") nos momentos fortes, no máximo um a cada ~6 s. */
export function planZooms(m: MomentInput, clipSec: number, opts = { scale: 1.14, holdSec: 1.6, minGap: 6, max: 4 }): PlannedZoom[] {
  const moments = strongMoments(m).sort((a, b) => b.strength - a.strength)
  const zooms: PlannedZoom[] = []
  for (const mo of moments) {
    if (zooms.length >= opts.max) break
    const at = Math.max(0.5, mo.atSec - 0.1)
    if (at + opts.holdSec > clipSec - 0.3) continue
    if (m.teaserSec && at < m.teaserSec + 0.3) continue
    if (zooms.some((z) => Math.abs(z.atSec - at) < opts.minGap)) continue
    zooms.push({ atSec: r3(at), durSec: opts.holdSec, scale: mo.kind === 'reação' ? opts.scale + 0.04 : opts.scale })
  }
  return zooms.sort((a, b) => a.atSec - b.atSec)
}

/** Expressão FFmpeg do zoom ao longo do tempo (1 = sem zoom). */
export function zoomExpr(zooms: PlannedZoom[], timeVar = 'it'): string {
  if (zooms.length === 0) return '1'
  return zooms
    .map((z) => `if(between(${timeVar},${r3(z.atSec)},${r3(z.atSec + z.durSec)}),${z.scale},`)
    .join('')
    .concat('1', ')'.repeat(zooms.length))
}

/** Expressão FFmpeg (0..1) da posição horizontal do recorte que acompanha a pessoa. */
export function trackExpr(points: { t: number; x: number }[], timeVar = 't'): string {
  if (points.length === 0) return '0.5'
  if (points.length === 1) return String(r3(points[0].x))
  let expr = String(r3(points[points.length - 1].x))
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i]
    const b = points[i + 1]
    const span = Math.max(0.001, b.t - a.t)
    // Desliza suavemente de a até b
    const lerp = `${r3(a.x)}+(${r3(b.x - a.x)})*(${timeVar}-${r3(a.t)})/${r3(span)}`
    expr = `if(lt(${timeVar},${r3(b.t)}),${lerp},${expr})`
  }
  return `if(lt(${timeVar},${r3(points[0].t)}),${r3(points[0].x)},${expr})`
}

/**
 * Tira o "tempo morto" de dentro do corte: trechos em silêncio E com pouca mudança na imagem
 * (ex.: andando no mapa sem nada acontecendo). Sem dados de movimento, só silêncios longos.
 */
export function removeDeadTime(range: Range, silences: Range[], motion: number[] | undefined, opts = { minDead: 1.5, pad: 0.25 }): Range[] {
  const vals = (motion ?? []).filter((m) => m > 0).sort((a, b) => a - b)
  const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0
  const lowMotion = (a: number, b: number) => {
    if (!motion?.length) return b - a >= 2.5
    const xs = motion.slice(Math.floor(a), Math.ceil(b))
    return xs.length > 0 && xs.reduce((x, y) => x + y, 0) / xs.length < med * 0.6
  }
  const dead = silences
    .map((s) => ({ startSec: Math.max(s.startSec, range.startSec), endSec: Math.min(s.endSec, range.endSec) }))
    .filter((s) => s.endSec - s.startSec >= opts.minDead + opts.pad * 2 && lowMotion(s.startSec, s.endSec))
    .map((s) => ({ startSec: s.startSec + opts.pad, endSec: s.endSec - opts.pad }))
  if (dead.length === 0) return [range]
  const out: Range[] = []
  let cur = range.startSec
  for (const d of dead) {
    if (d.startSec - cur >= 0.3) out.push({ startSec: r3(cur), endSec: r3(d.startSec) })
    cur = d.endSec
  }
  if (range.endSec - cur >= 0.3) out.push({ startSec: r3(cur), endSec: r3(range.endSec) })
  return out
}

/**
 * Gancho sem fala: pega o momento mais intenso do corte (som alto + ação na tela), se ele estiver
 * depois dos 6 primeiros segundos, para mostrar 2,5 s dele logo no começo.
 */
export function peakTeaserRange(ranges: Range[], rmsDb: number[], motion: number[] | undefined): Range | null {
  const secs: number[] = []
  for (const r of ranges) for (let s = Math.ceil(r.startSec); s < Math.floor(r.endSec); s++) secs.push(s)
  if (secs.length < 10) return null
  const dbs = secs.map((s) => rmsDb[s] ?? -90)
  const sortedDb = [...dbs].sort((a, b) => a - b)
  const medDb = sortedDb[Math.floor(sortedDb.length / 2)]
  const mos = secs.map((s) => motion?.[s] ?? 0)
  const sortedMo = [...mos].sort((a, b) => a - b)
  const medMo = sortedMo[Math.floor(sortedMo.length / 2)] || 1
  let best = -Infinity
  let bestSec = -1
  secs.forEach((s, i) => {
    const out = toOutputTime(s, ranges)
    if (out === null || out < 6) return
    const score = (dbs[i] - medDb) / 6 + (motion?.length ? (mos[i] / medMo - 1) : 0)
    if (score > best) {
      best = score
      bestSec = s
    }
  })
  if (bestSec < 0 || best < 1) return null
  return { startSec: bestSec - 1.2, endSec: bestSec + 1.3 }
}
