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
export function buildAss(cues: Cue[], style: SubtitleStyle, width: number, height: number): string {
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
    `Style: Default,${style.font},${fontSize},${assColor(style.textColor)},${assColor(style.highlightColor)},${assColor(style.outlineColor)},&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(style.outline * scale)},0,${alignment},${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const transform = (t: string) => (style.uppercase ? t.toLocaleUpperCase('pt-BR') : t)
  const blocks = splitCuesForDisplay(cues, style.maxCharsPerLine, style.maxLines)
  const events: string[] = []
  const hl = assColor(style.highlightColor)
  for (const cue of blocks) {
    const display = (words: string[], active: number) => {
      const lines = wrapText(words.join(' '), style.maxCharsPerLine)
      let idx = 0
      const rendered = lines.map((line) =>
        line
          .split(' ')
          .map((w) => {
            const out = idx === active ? `{\\c${hl}}${escapeAss(transform(w))}{\\r}` : escapeAss(transform(w))
            idx++
            return out
          })
          .join(' ')
      )
      return rendered.join('\\N')
    }
    const emojiSuffix = style.emojis ? addEmoji(cue.text).slice(cue.text.length) : ''
    if (style.wordHighlight && cue.words && cue.words.length > 1) {
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
