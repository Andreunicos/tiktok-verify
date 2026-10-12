import type { Cue, Range, SubtitleStyle, Word } from './types'

// ───────────── Leitura e escrita SRT / VTT ─────────────

function parseTs(ts: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(ts.trim())
  if (!m) return null
  const [, h, mm, ss, ms] = m
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, '0')) / 1000
}

/** Lê SRT ou WebVTT. Blocos inválidos são ignorados. */
export function parseSubtitles(text: string): Cue[] {
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const timeIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeIdx === -1) continue
    const [a, b] = lines[timeIdx].split('-->')
    const start = parseTs(a)
    const end = parseTs(b.trim().split(/\s+/)[0])
    if (start === null || end === null || end <= start) continue
    const body = lines
      .slice(timeIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!body) continue
    cues.push({ id: `c${cues.length + 1}`, startSec: round3(start), endSec: round3(end), text: body })
  }
  return cues.sort((x, y) => x.startSec - y.startSec)
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function fmtTs(sec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms % 1000, 3)}`
}

export function formatSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${fmtTs(c.startSec, ',')} --> ${fmtTs(c.endSec, ',')}\n${c.text}\n`).join('\n')
}

export function formatVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${fmtTs(c.startSec, '.')} --> ${fmtTs(c.endSec, '.')}\n${c.text}\n`).join('\n')}`
}

// ───────────── Mapeamento para o tempo do corte ─────────────

/**
 * Converte legendas do tempo da origem para o tempo do corte (vários intervalos
 * unidos na ordem e velocidade alterada). Partes fora dos intervalos são descartadas.
 */
export function mapCuesToClip(cues: Cue[], ranges: Range[], speed = 1): Cue[] {
  const out: Cue[] = []
  let offset = 0
  for (const r of ranges) {
    const map = (t: number) => round3((offset + (t - r.startSec)) / speed)
    for (const c of cues) {
      const s = Math.max(c.startSec, r.startSec)
      const e = Math.min(c.endSec, r.endSec)
      if (e - s < 0.05) continue
      const words = c.words
        ?.filter((w) => w.endSec > r.startSec && w.startSec < r.endSec)
        .map((w) => ({ ...w, startSec: map(Math.max(w.startSec, r.startSec)), endSec: map(Math.min(w.endSec, r.endSec)) }))
      const text = words && words.length > 0 && (s > c.startSec || e < c.endSec) ? words.map((w) => w.text).join(' ') : c.text
      out.push({ id: `${c.id}@${out.length}`, startSec: map(s), endSec: map(e), text, words })
    }
    offset += r.endSec - r.startSec
  }
  return out
}

// ───────────── Quebra de linhas e divisão para exibição ─────────────

/** Quebra o texto em linhas com no máximo maxChars (palavras longas ficam inteiras). */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) {
      lines.push(line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Divide legendas longas em blocos que cabem em maxLines × maxChars.
 * Usa os tempos das palavras quando existem; senão divide proporcionalmente ao texto.
 */
export function splitCuesForDisplay(cues: Cue[], maxChars: number, maxLines: number): Cue[] {
  const out: Cue[] = []
  for (const cue of cues) {
    const words: Word[] =
      cue.words && cue.words.length > 0 ? cue.words : estimateWordTimes(cue.text, cue.startSec, cue.endSec)
    let chunk: Word[] = []
    const flush = () => {
      if (chunk.length === 0) return
      out.push({
        id: `${cue.id}.${out.length}`,
        startSec: chunk[0].startSec,
        endSec: chunk[chunk.length - 1].endSec,
        text: chunk.map((w) => w.text).join(' '),
        words: cue.words ? chunk : undefined
      })
      chunk = []
    }
    for (const w of words) {
      const candidate = [...chunk, w].map((x) => x.text).join(' ')
      if (chunk.length > 0 && wrapText(candidate, maxChars).length > maxLines) flush()
      chunk.push(w)
    }
    flush()
  }
  // Garante que os blocos não se sobreponham.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endSec > out[i + 1].startSec) out[i].endSec = out[i + 1].startSec
  }
  return out
}

/** Distribui o tempo da legenda entre as palavras, proporcional ao tamanho. */
export function estimateWordTimes(text: string, start: number, end: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const total = tokens.reduce((s, t) => s + t.length + 1, 0)
  let t = start
  return tokens.map((tok) => {
    const d = ((tok.length + 1) / total) * (end - start)
    const w = { startSec: round3(t), endSec: round3(t + d), text: tok }
    t += d
    return w
  })
}

// ───────────── Agrupar palavras (transcrição) em frases ─────────────

export function groupWordsIntoCues(words: Word[], opts = { maxChars: 80, maxGapSec: 0.8, maxDurSec: 7 }): Cue[] {
  const cues: Cue[] = []
  let cur: Word[] = []
  const flush = () => {
    if (cur.length === 0) return
    cues.push({
      id: `c${cues.length + 1}`,
      startSec: cur[0].startSec,
      endSec: cur[cur.length - 1].endSec,
      text: cur.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'),
      words: cur
    })
    cur = []
  }
  for (const w of words) {
    const text = w.text.trim()
    if (!text) continue
    const word = { ...w, text }
    if (cur.length > 0) {
      const last = cur[cur.length - 1]
      const gap = word.startSec - last.endSec
      const len = cur.map((x) => x.text).join(' ').length + text.length + 1
      if (gap > opts.maxGapSec || len > opts.maxChars || word.endSec - cur[0].startSec > opts.maxDurSec) flush()
    }
    cur.push(word)
    if (/[.!?…]$/.test(text)) flush()
  }
  flush()
  return cues
}

// ───────────── Emojis ─────────────

const EMOJI_RULES: [RegExp, string][] = [
  [/\b(dinheiro|grana|reais|lucro)\b/i, '💰'],
  [/\b(fogo|brabo|insano)\b/i, '🔥'],
  [/\b(amor|amo|coração)\b/i, '❤️'],
  [/\b(kkk+|haha+|rs+|risada|engraçado)\b/i, '😂'],
  [/\b(incrível|inacreditável|absurdo|chocado)\b/i, '🤯'],
  [/\b(cuidado|atenção|perigo)\b/i, '⚠️'],
  [/\b(dica|ideia|segredo)\b/i, '💡'],
  [/\b(jogo|game|partida)\b/i, '🎮'],
  [/\b(ganhei|ganhamos|vitória|venci|campeão)\b/i, '🏆'],
  [/\b(música|som|batida)\b/i, '🎵'],
  [/\b(olha|olhem|veja|vejam)\b/i, '👀'],
  [/\b(rápido|velocidade|corre)\b/i, '⚡'],
  [/\b(perdi|perdemos|triste)\b/i, '😢']
]

/** Acrescenta no máximo um emoji ao fim da legenda, conforme palavras-chave. */
export function addEmoji(text: string): string {
  for (const [re, emoji] of EMOJI_RULES) if (re.test(text)) return `${text} ${emoji}`
  return text
}

// ───────────── ASS (legendas gravadas no vídeo) ─────────────

/** "#RRGGBB" → "&H00BBGGRR" */
export function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return '&H00FFFFFF'
  return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase()
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor(cs / 6000) % 60
  const s = Math.floor(cs / 100) % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`
}

const escapeAss = (t: string) => t.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')')

/**
 * Gera um script ASS. Com wordHighlight e tempos por palavra, cria um evento por
 * palavra com a palavra atual colorida (estilo TikTok).
 * O tamanho da fonte é relativo a uma tela de 1080 de largura.
 */
export interface AssExtras {
  /** Título grande no topo nos primeiros segundos (texto branco com contorno preto). */
  title?: string
  titleSec?: number
  /** Palavras com destaque permanente (amarelo e um pouco maiores). */
  keywords?: string[]
  /** @ do canal no canto de cima, o vídeo todo. */
  handle?: string
  /** Lado do @ (o oposto da logo, para não ficar um em cima do outro). */
  handleSide?: 'left' | 'right'
  /** Chamada no final (ex.: "SEGUE PRA PARTE 2") e duração total do corte. */
  cta?: string
  durationSec?: number
}

const keyOf = (w: string) =>
  w
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')

export function buildAss(cues: Cue[], style: SubtitleStyle, width: number, height: number, extras: AssExtras = {}): string {
  const scale = Math.min(width, height) / 1080
  const fontSize = Math.max(12, Math.round(style.fontSize * scale))
  const alignment = style.position === 'top' ? 8 : style.position === 'middle' ? 5 : 2
  const marginV = style.position === 'middle' ? 0 : Math.round(height * (style.position === 'bottom' ? 0.14 : 0.08))
  const marginH = Math.round(width * 0.06)
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Karaokê: o texto começa na cor normal (secundária) e "enche" com a cor de destaque (primária)
    `Style: Default,${style.font},${fontSize},${style.karaoke ? assColor(style.highlightColor) : assColor(style.textColor)},${style.karaoke ? assColor(style.textColor) : assColor(style.highlightColor)},${style.box ? '&H40000000' : assColor(style.outlineColor)},&H80000000,-1,0,0,0,100,100,0,0,${style.box ? 3 : 1},${Math.round(style.outline * scale)},0,${alignment},${marginH},${marginH},${marginV},1`,
    `Style: Handle,${style.font},${Math.max(12, Math.round(fontSize * 0.42))},&H30FFFFFF,&H30FFFFFF,&H60000000,&H00000000,-1,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(2 * scale))},0,9,${marginH},${marginH},${Math.round(height * 0.04)},1`,
    `Style: Cta,${style.font},${Math.round(fontSize * 0.95)},&H00111111,&H00111111,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,${Math.max(6, Math.round(16 * scale))},0,5,${marginH},${marginH},0,1`,
    `Style: Title,${style.font},${Math.round(fontSize * 1.05)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(6 * scale))},${Math.max(1, Math.round(3 * scale))},8,${marginH},${marginH},${Math.round(height * 0.1)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const transform = (t: string) => (style.uppercase ? t.toLocaleUpperCase('pt-BR') : t)
  const blocks = splitCuesForDisplay(cues, style.maxCharsPerLine, style.maxLines)
  const events: string[] = []
  const hl = assColor(style.highlightColor)
  // Palavra-chave em verde (a palavra falada já usa a cor de destaque, normalmente amarela)
  const keyColor = assColor('#4DFF88')
  const keywords = new Set((extras.keywords ?? []).map(keyOf).filter(Boolean))
  if (extras.handle?.trim() && extras.durationSec) {
    const h = extras.handle.trim()
    const align = extras.handleSide === 'left' ? '{\\an7}' : ''
    events.push(`Dialogue: 2,${assTime(0)},${assTime(extras.durationSec)},Handle,,0,0,0,,${align}${escapeAss(h.startsWith('@') ? h : `@${h}`)}`)
  }
  if (extras.cta?.trim() && extras.durationSec && extras.durationSec >= 5) {
    const from = Math.max(0, extras.durationSec - 2.6)
    events.push(`Dialogue: 3,${assTime(from)},${assTime(extras.durationSec)},Cta,,0,0,0,,{\\fad(200,0)}${escapeAss(transform(extras.cta.trim()))}`)
  }
  if (extras.title?.trim()) {
    const lines = wrapText(extras.title.trim(), Math.max(14, Math.round(style.maxCharsPerLine * 1.1))).slice(0, 3)
    events.push(`Dialogue: 1,${assTime(0)},${assTime(extras.titleSec ?? 3.2)},Title,,0,0,0,,{\\fad(150,250)}${lines.map((l) => escapeAss(transform(l))).join('\\N')}`)
  }
  for (const cue of blocks) {
    const display = (words: string[], active: number) => {
      const lines = wrapText(words.join(' '), style.maxCharsPerLine)
      let idx = 0
      const rendered = lines.map((line) =>
        line
          .split(' ')
          .map((w) => {
            const isKey = keywords.size > 0 && keywords.has(keyOf(w))
            const out =
              idx === active
                ? `{\\c${hl}${isKey ? '\\fscx115\\fscy115' : ''}}${escapeAss(transform(w))}{\\r}`
                : isKey
                  ? `{\\c${keyColor}\\fscx115\\fscy115}${escapeAss(transform(w))}{\\r}`
                  : escapeAss(transform(w))
            idx++
            return out
          })
          .join(' ')
      )
      return rendered.join('\\N')
    }
    const emojiSuffix = style.emojis ? addEmoji(cue.text).slice(cue.text.length) : ''
    if (style.karaoke && cue.words && cue.words.length > 1) {
      // Um evento por bloco, cada palavra "enche" no tempo em que é dita (\kf em centésimos)
      const parts: string[] = []
      let cursor = cue.startSec
      // quebra de linha nos mesmos pontos do texto normal
      const breaks = new Set<number>()
      let count = 0
      for (const line of wrapText(cue.words.map((w) => w.text).join(' '), style.maxCharsPerLine).slice(0, -1)) {
        count += line.split(' ').length
        breaks.add(count)
      }
      cue.words.forEach((w, i) => {
        if (breaks.has(i)) parts.push('\\N')
        const gap = Math.max(0, w.startSec - cursor)
        if (gap > 0.01) parts.push(`{\\k${Math.round(gap * 100)}}`)
        const end = i < cue.words!.length - 1 ? Math.max(w.endSec, cue.words![i + 1].startSec) : Math.max(w.endSec, cue.endSec)
        parts.push(`{\\kf${Math.max(1, Math.round((end - Math.max(cursor, w.startSec)) * 100))}}${escapeAss(transform(w.text))}${i < cue.words!.length - 1 && !breaks.has(i + 1) ? ' ' : ''}`)
        cursor = end
      })
      events.push(`Dialogue: 0,${assTime(cue.startSec)},${assTime(cue.endSec)},Default,,0,0,0,,${parts.join('')}${emojiSuffix}`)
    } else if (style.wordHighlight && cue.words && cue.words.length > 1) {
      const words = cue.words.map((w) => w.text)
      cue.words.forEach((w, i) => {
        const end = i < cue.words!.length - 1 ? cue.words![i + 1].startSec : cue.endSec
        if (end - w.startSec < 0.01) return
        events.push(`Dialogue: 0,${assTime(w.startSec)},${assTime(end)},Default,,0,0,0,,${display(words, i)}${emojiSuffix}`)
      })
    } else {
      events.push(
        `Dialogue: 0,${assTime(cue.startSec)},${assTime(cue.endSec)},Default,,0,0,0,,${display(cue.text.split(/\s+/), -1)}${emojiSuffix}`
      )
    }
  }
  return [...header, ...events, ''].join('\n')
}
