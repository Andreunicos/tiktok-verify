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
  keywords: string[]
}

const SYSTEM =
  'Você é um editor de vídeos curtos (TikTok, Reels, Shorts) em português do Brasil. Avalia trechos de lives e gravações ' +
  'pelo potencial de prender a atenção: gancho forte no começo, história com começo/meio/fim, emoção (risada, surpresa, ' +
  'polêmica, dica útil) e final satisfatório. Seja fiel ao texto; não invente fatos.'

export function buildPlanPrompt(platform: string, count: number, candidates: PlanCandidate[], request?: string): string {
  const list = candidates
    .map((c) => `### ${c.id} (${Math.round(c.endSec - c.startSec)} s)\n${c.text.slice(0, 1800) || '(sem fala)'}`)
    .join('\n\n')
  return (
    `Plataforma: ${platform}. Preciso dos ${count} melhores cortes entre os candidatos abaixo.\n` +
    (request ? `Pedido de quem gravou (siga com prioridade ao dar as notas): "${request.slice(0, 400)}"\n` : '') +
    `\n${list}\n\n` +
    'Para CADA candidato devolva: id (igual ao de cima), score de 0 a 100, title (até 70 caracteres, chamativo), ' +
    'description (1 a 2 frases), hashtags (3 a 8, com #), hook (a frase mais forte do trecho, copiada EXATAMENTE como está no texto, ' +
    'curta — até 15 palavras — ou "" se não houver) e keywords (até 5 palavras do texto que merecem destaque na legenda). ' +
    'Formato: {"clips":[{"id":"…","score":0,"title":"…","description":"…","hashtags":["#…"],"hook":"…","keywords":["…"]}]}'
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
      keywords: [...new Set(c.keywords.map((k) => k.trim()).filter((k) => k.length >= 3 && k.length <= 30))].slice(0, 5)
    })
  }
  return out
}

export async function planClips(ask: AskJson, platform: string, count: number, candidates: PlanCandidate[], request?: string): Promise<PlannedClip[]> {
  const raw = await ask(SYSTEM, buildPlanPrompt(platform, count, candidates, request), PlanSchema)
  return normalizePlan(raw, candidates)
}

/** Nota final: mistura a opinião da IA (60%) com as regras locais (40%). */
export function blendScore(ruleScore: number, aiScore: number | undefined): number {
  return aiScore === undefined ? ruleScore : Math.round(aiScore * 0.6 + ruleScore * 0.4)
}
