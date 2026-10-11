import { z } from 'zod'
import type { AskJson } from './ai'

/**
 * "Cérebro" do modo automático: a IA (grátis ou Claude) lê só o TEXTO dos melhores candidatos
 * que as regras locais acharam e decide quais têm história completa, qual frase é o gancho,
 * quais palavras merecem destaque e escreve título/descrição/hashtags.
 * Se a IA falhar, o app segue só com as regras (nada quebra).
 */
export interface PlanCandidate {
  id: string
  startSec: number
  endSec: number
  ruleScore: number
  text: string
}

const PlanSchema = z.object({
  clips: z.array(
    z.object({
      id: z.string(),
      score: z.coerce.number(),
      title: z.string().default(''),
      description: z.string().default(''),
      hashtags: z.array(z.string()).default([]),
      hook: z.string().default(''),
      overlay: z.string().default(''),
      keywords: z.array(z.string()).default([])
    })
  )
})

export interface PlannedClip {
  id: string
  aiScore: number
  title: string
  description: string
  hashtags: string[]
  hook: string
  /** Texto curto de gancho para a tela (CAIXA ALTA, até ~6 palavras). */
  overlay: string
  keywords: string[]
}

const SYSTEM =
  'Você é um editor de vídeos curtos (TikTok, Reels, Shorts) em português do Brasil. Avalia trechos de lives e gravações ' +
  'pelo potencial de prender a atenção: gancho forte no começo, história com começo/meio/fim, emoção (risada, surpresa, ' +
  'polêmica, dica útil) e final satisfatório. Seja fiel ao texto; não invente fatos.'

/** O que a pessoa gostou/não gostou antes (botões 👍/👎), para a IA pegar o estilo. */
export interface TasteMemory {
  liked: string[]
  disliked: string[]
}

const tasteText = (t?: TasteMemory) =>
  t && (t.liked.length || t.disliked.length)
    ? `Gosto de quem gravou (aprendido com cortes anteriores):\n${t.liked.length ? `- Gostou de: ${t.liked.slice(-6).map((x) => `"${x}"`).join('; ')}\n` : ''}${t.disliked.length ? `- Não gostou de: ${t.disliked.slice(-6).map((x) => `"${x}"`).join('; ')}\n` : ''}`
    : ''

export function buildPlanPrompt(platform: string, count: number, candidates: PlanCandidate[], request?: string, taste?: TasteMemory): string {
  const list = candidates
    .map((c) => `### ${c.id} (${Math.round(c.endSec - c.startSec)} s)\n${c.text.slice(0, 1800) || '(sem fala)'}`)
    .join('\n\n')
  return (
    `Plataforma: ${platform}. Preciso dos ${count} melhores cortes entre os candidatos abaixo.\n` +
    (request ? `Pedido de quem gravou (siga com prioridade ao dar as notas): "${request.slice(0, 400)}"\n` : '') +
    tasteText(taste) +
    `\n${list}\n\n` +
    'Para CADA candidato devolva: id (igual ao de cima), score de 0 a 100, title (até 70 caracteres, chamativo), ' +
    'description (1 a 2 frases), hashtags (3 a 8, com #), hook (a frase mais forte do trecho, copiada EXATAMENTE como está no texto, ' +
    'curta — até 15 palavras — ou "" se não houver), overlay (texto de gancho para aparecer na tela nos 3 primeiros segundos: ' +
    'até 6 palavras, em CAIXA ALTA, que gere curiosidade sem mentir, ex.: "ELE NÃO ESPERAVA ISSO") e keywords (até 5 palavras do texto que merecem destaque na legenda). ' +
    'Formato: {"clips":[{"id":"…","score":0,"title":"…","description":"…","hashtags":["#…"],"hook":"…","overlay":"…","keywords":["…"]}]}'
  )
}

const tag = (h: string) => {
  const t = h.trim().replace(/^#+/, '').replace(/\s+/g, '')
  return t ? `#${t}` : ''
}

/** Valida e limpa a resposta (ids desconhecidos são ignorados). */
export function normalizePlan(raw: z.infer<typeof PlanSchema>, candidates: PlanCandidate[]): PlannedClip[] {
  const known = new Set(candidates.map((c) => c.id))
  const seen = new Set<string>()
  const out: PlannedClip[] = []
  for (const c of raw.clips) {
    if (!known.has(c.id) || seen.has(c.id)) continue
    seen.add(c.id)
    out.push({
      id: c.id,
      aiScore: Math.max(0, Math.min(100, Number.isFinite(c.score) ? c.score : 0)),
      title: c.title.trim().slice(0, 80),
      description: c.description.trim().slice(0, 400),
      hashtags: [...new Set(c.hashtags.map(tag).filter(Boolean))].slice(0, 8),
      hook: c.hook.trim().slice(0, 160),
      overlay: c.overlay.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ').slice(0, 48).toLocaleUpperCase('pt-BR'),
      keywords: [...new Set(c.keywords.map((k) => k.trim()).filter((k) => k.length >= 3 && k.length <= 30))].slice(0, 5)
    })
  }
  return out
}

export async function planClips(ask: AskJson, platform: string, count: number, candidates: PlanCandidate[], request?: string, taste?: TasteMemory): Promise<PlannedClip[]> {
  const raw = await ask(SYSTEM, buildPlanPrompt(platform, count, candidates, request, taste), PlanSchema)
  return normalizePlan(raw, candidates)
}

/** Nota final: mistura a opinião da IA (60%) com as regras locais (40%). */
export function blendScore(ruleScore: number, aiScore: number | undefined): number {
  return aiScore === undefined ? ruleScore : Math.round(aiScore * 0.6 + ruleScore * 0.4)
}

// ───────────── A IA lendo a transcrição inteira ─────────────

const MomentsSchema = z.object({
  moments: z.array(z.object({ start: z.coerce.number(), end: z.coerce.number(), reason: z.string().default('') })).default([])
})

export interface Moment {
  startSec: number
  endSec: number
  reason: string
}

/** Junta as falas em linhas "[segundo] texto" e divide em blocos que cabem num pedido. */
export function transcriptChunks(cues: { startSec: number; endSec: number; text: string }[], maxChars = 9000): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = []
  let cur: string[] = []
  let size = 0
  let from = 0
  let to = 0
  for (const c of cues) {
    const t = c.text.trim()
    if (!t) continue
    const line = `[${Math.round(c.startSec)}] ${t}`
    if (size + line.length > maxChars && cur.length) {
      out.push({ text: cur.join('\n'), from, to })
      cur = []
      size = 0
    }
    if (!cur.length) from = c.startSec
    cur.push(line)
    size += line.length + 1
    to = c.endSec
  }
  if (cur.length) out.push({ text: cur.join('\n'), from, to })
  return out
}

export function buildMomentsPrompt(chunk: string, minSec: number, maxSec: number, howMany: number, request?: string, taste?: TasteMemory): string {
  return (
    `Abaixo está a transcrição de um trecho de uma live/gravação. Cada linha começa com o segundo em que a fala começa.\n` +
    (request ? `Pedido de quem gravou: "${request.slice(0, 400)}"\n` : '') +
    tasteText(taste) +
    `\n${chunk}\n\n` +
    `Ache até ${howMany} momentos que funcionariam SOZINHOS como vídeo curto (quem não viu a live entende): com gancho no começo, ` +
    `algo acontecendo (história, piada, reação, dica, polêmica, jogada) e um final que fecha a ideia. Cada momento deve ter entre ` +
    `${minSec} e ${maxSec} segundos, começar no início de uma fala e terminar no fim de uma fala. Use os segundos das linhas. ` +
    'Se não houver nenhum bom, devolva lista vazia. Formato: {"moments":[{"start":0,"end":0,"reason":"por que é bom, curto"}]}'
  )
}

/**
 * A IA lê a transcrição inteira (em blocos) e aponta momentos que fazem sentido sozinhos.
 * Tempos inválidos são descartados; durações são ajustadas para a faixa pedida.
 */
export async function discoverMoments(
  ask: AskJson,
  cues: { startSec: number; endSec: number; text: string }[],
  opts: { minSec: number; maxSec: number; count: number; durationSec: number; request?: string; taste?: TasteMemory; maxChunks?: number; signal?: AbortSignal }
): Promise<Moment[]> {
  const chunks = transcriptChunks(cues).slice(0, opts.maxChunks ?? 12)
  if (chunks.length === 0) return []
  const per = Math.max(2, Math.ceil((opts.count * 2) / chunks.length))
  const out: Moment[] = []
  let failures = 0
  for (const ch of chunks) {
    if (opts.signal?.aborted) break
    try {
      const raw = await ask(SYSTEM, buildMomentsPrompt(ch.text, opts.minSec, opts.maxSec, per, opts.request, opts.taste), MomentsSchema)
      for (const m of raw.moments) {
        let start = Math.max(0, Math.min(m.start, m.end))
        let end = Math.min(opts.durationSec, Math.max(m.start, m.end))
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < ch.from - 5 || end > ch.to + 30) continue
        if (end - start < opts.minSec) end = Math.min(opts.durationSec, start + opts.minSec)
        if (end - start > opts.maxSec) end = start + opts.maxSec
        if (end - start < opts.minSec * 0.8) continue
        out.push({ startSec: Math.round(start * 100) / 100, endSec: Math.round(end * 100) / 100, reason: m.reason.trim().slice(0, 140) })
      }
    } catch (err) {
      failures++
      // Sem nenhum bloco respondido, deixa o erro subir (o app avisa e usa só as regras)
      if (failures === chunks.length) throw err
    }
  }
  return out
}
