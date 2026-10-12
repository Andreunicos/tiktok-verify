/**
 * Chat da live como sinal de "momento bom": quando o chat explode (KKKK, CLIP, emotes, "??"),
 * algo aconteceu. Lê os formatos mais comuns:
 *  - YouTube (yt-dlp `live_chat.json`): uma linha JSON por ação, com `videoOffsetTimeMsec`;
 *  - Twitch (yt-dlp `rechat`, TwitchDownloader, Chat Downloader): objetos com
 *    `content_offset_seconds`/`contentOffsetSeconds` e o texto em `message.body` ou `fragments`;
 *  - texto simples: linhas "[1:02:03] nome: mensagem" ou "01:02:03 nome: mensagem".
 */
export interface ChatMessage {
  t: number
  text: string
}

/** O chat chega alguns segundos depois do que aconteceu. */
export const CHAT_DELAY_SEC = 4

const HYPE = /k{3,}|ha(ha)+|rs(rs)+|lol|lmao|kekw|lul|omegalul|pog|poggers|pogchamp|clip|clipa|clipou|wtf|omg|caraca|mds|meu deus|nossa|absurdo|insano|\?{2,}|!{2,}|monkas|pepelaugh|jebaited|gg\b/i

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const o = node as Record<string, unknown>
  if (typeof o.body === 'string') return o.body
  if (Array.isArray(o.fragments)) return o.fragments.map((f) => (f && typeof f === 'object' ? String((f as Record<string, unknown>).text ?? '') : '')).join('')
  if (Array.isArray(o.runs))
    return o.runs
      .map((r) => {
        const x = r as Record<string, unknown>
        if (typeof x.text === 'string') return x.text
        const emoji = x.emoji as Record<string, unknown> | undefined
        const sc = emoji && Array.isArray(emoji.shortcuts) ? String(emoji.shortcuts[0] ?? '') : ''
        return sc || ''
      })
      .join('')
  return ''
}

/** Percorre o JSON achando mensagens com tempo (formatos Twitch). */
function walkTwitch(node: unknown, out: ChatMessage[], depth = 0): void {
  if (depth > 8 || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const x of node) walkTwitch(x, out, depth + 1)
    return
  }
  const o = node as Record<string, unknown>
  const t = typeof o.content_offset_seconds === 'number' ? o.content_offset_seconds : typeof o.contentOffsetSeconds === 'number' ? o.contentOffsetSeconds : null
  if (t !== null) {
    const text = textOf(o.message) || (typeof o.body === 'string' ? o.body : '')
    if (text) out.push({ t, text })
    return
  }
  for (const v of Object.values(o)) if (v && typeof v === 'object') walkTwitch(v, out, depth + 1)
}

function parseYouTubeLine(line: string): ChatMessage[] {
  let obj: Record<string, any>
  try {
    obj = JSON.parse(line)
  } catch {
    return []
  }
  const replay = obj.replayChatItemAction ?? obj
  const ms = Number(replay.videoOffsetTimeMsec ?? obj.videoOffsetTimeMsec)
  if (!Number.isFinite(ms)) return []
  const out: ChatMessage[] = []
  for (const a of replay.actions ?? []) {
    const item = a?.addChatItemAction?.item
    const r = item?.liveChatTextMessageRenderer ?? item?.liveChatPaidMessageRenderer
    const text = r ? textOf(r.message) : ''
    if (text) out.push({ t: ms / 1000, text })
  }
  return out
}

const TS_LINE = /^\s*\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s+(?:[^:]{1,40}:\s*)?(.+)$/

export function parseChat(raw: string): ChatMessage[] {
  const text = raw.replace(/^﻿/, '').trim()
  if (!text) return []
  let out: ChatMessage[] = []
  // JSON inteiro (Twitch)
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      walkTwitch(JSON.parse(text), out)
    } catch {
      /* pode ser JSON por linha (YouTube) */
    }
  }
  if (out.length === 0) {
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim()
      if (!l) continue
      if (l.startsWith('{')) {
        const yt = parseYouTubeLine(l)
        if (yt.length) out.push(...yt)
        else walkTwitch(safeJson(l), out)
        continue
      }
      const m = TS_LINE.exec(l)
      if (m) {
        const [a, b, c] = [Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : null]
        const t = c === null ? a * 60 + b : a * 3600 + b * 60 + c
        out.push({ t, text: m[4] })
      }
    }
  }
  out = out.filter((m) => Number.isFinite(m.t) && m.t >= 0).sort((x, y) => x.t - y.t)
  return out
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * "Hype" do chat por segundo (0..1): mensagens por segundo, com peso maior para risadas, CLIP,
 * emotes e "??", suavizado em ~4 s e comparado com o normal da própria live.
 */
export function chatHype(messages: ChatMessage[], durationSec: number, delaySec = CHAT_DELAY_SEC): number[] {
  const n = Math.max(0, Math.ceil(durationSec))
  const raw = new Array<number>(n).fill(0)
  for (const m of messages) {
    // o chat reage alguns segundos depois: conta no momento em que aconteceu
    const i = Math.floor(m.t - delaySec)
    if (i < 0 || i >= n) continue
    raw[i] += HYPE.test(m.text) ? 2.5 : 1
  }
  // suaviza (chat reage com atraso de alguns segundos)
  const smooth = raw.map((_, i) => {
    let s = 0
    for (let k = -1; k <= 3; k++) s += raw[i + k] ?? 0
    return s / 5
  })
  const nz = smooth.filter((v) => v > 0).sort((a, b) => a - b)
  if (nz.length < 5) return smooth.map(() => 0)
  const med = nz[Math.floor(nz.length / 2)]
  const p95 = nz[Math.floor(nz.length * 0.95)]
  const span = Math.max(p95 - med, med * 0.5, 0.1)
  return smooth.map((v) => Math.round(Math.max(0, Math.min(1, (v - med) / span)) * 100) / 100)
}

