import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { Cue } from '../shared/types'

/**
 * IA opcional (Claude). Desligada por padrão; só roda quando o usuário ativa e informa
 * a própria chave. Envia apenas o TEXTO da transcrição do trecho — nunca o vídeo ou o áudio.
 * Cada chamada gera custo na conta Anthropic do usuário.
 */
export const DEFAULT_AI_MODEL = 'claude-opus-5-5'

export const SocialSchema = z.object({
  title: z.string(),
  description: z.string(),
  hashtags: z.array(z.string())
})
export type SocialCopy = z.infer<typeof SocialSchema>

export const TranslationSchema = z.object({ lines: z.array(z.object({ id: z.string(), text: z.string() })) })

export class AiError extends Error {}

function client(apiKey: string, fetchImpl?: typeof fetch): Anthropic {
  if (!apiKey) throw new AiError('Configure sua chave da API Anthropic em Configurações → IA.')
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
}

export async function ask<T>(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  fetchImpl?: typeof fetch
): Promise<T> {
  try {
    // create() + validação própria: assim a recusa é detectada antes de tentar ler o JSON.
    const format = betaZodOutputFormat(schema)
    const res = await client(apiKey, fetchImpl).beta.messages.create({
      model: model || DEFAULT_AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: format.schema } },
      system,
      messages: [{ role: 'user', content: user }]
    })
    if (res.stop_reason === 'refusal') throw new AiError('A IA recusou este pedido.')
    if (res.stop_reason === 'max_tokens') throw new AiError('Resposta da IA cortada (texto longo demais).')
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new AiError('A IA não retornou uma resposta válida.')
    }
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new AiError('A IA não retornou uma resposta válida.')
    return parsed.data
  } catch (err) {
    if (err instanceof AiError) throw err
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('Chave da API Anthropic inválida.')
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Limite de uso da API atingido. Tente mais tarde.')
    if (err instanceof Anthropic.APIConnectionError) throw new AiError('Sem conexão com a API da Anthropic.')
    if (err instanceof Anthropic.APIError) throw new AiError(`Erro da API (${err.status}): ${err.message}`)
    throw err
  }
}

/** Pedido de JSON validado: a mesma assinatura serve para o Claude e para a IA grátis. */
export type AskJson = <T>(system: string, user: string, schema: z.ZodType<T>) => Promise<T>

export const claudeAsk =
  (apiKey: string, model: string, fetchImpl?: typeof fetch): AskJson =>
  (system, user, schema) =>
    ask(apiKey, model, system, user, schema, fetchImpl)

export const SOCIAL_SYSTEM =
  'Você escreve textos para vídeos curtos em redes sociais, em português do Brasil. Seja fiel ao que é dito na transcrição; não invente fatos.'
export const socialPrompt = (transcript: string, platform: string) =>
  `Plataforma: ${platform}\n\nTranscrição do corte:\n"""\n${transcript}\n"""\n\nCrie um título curto e chamativo (até 70 caracteres), uma descrição de 1 a 3 frases e de 3 a 8 hashtags relevantes (com #, sem espaços). Campos: title, description, hashtags.`

export function socialCopyWith(askJson: AskJson, transcript: string, platform: string): Promise<SocialCopy> {
  return askJson(SOCIAL_SYSTEM, socialPrompt(transcript, platform), SocialSchema)
}

export function generateSocialCopy(apiKey: string, model: string, transcript: string, platform: string, fetchImpl?: typeof fetch): Promise<SocialCopy> {
  return socialCopyWith(claudeAsk(apiKey, model, fetchImpl), transcript, platform)
}

/** Traduz legendas mantendo os ids (os tempos ficam iguais). */
export function translateCues(apiKey: string, model: string, cues: Cue[], targetLanguage: string, fetchImpl?: typeof fetch): Promise<Cue[]> {
  return translateCuesWith(claudeAsk(apiKey, model, fetchImpl), cues, targetLanguage)
}

export async function translateCuesWith(askJson: AskJson, cues: Cue[], targetLanguage: string): Promise<Cue[]> {
  const out: Cue[] = []
  for (let i = 0; i < cues.length; i += 150) {
    const batch = cues.slice(i, i + 150)
    const res = await askJson(
      'Você traduz legendas de vídeo. Mantenha o tom falado, frases curtas e o mesmo id em cada linha.',
      `Traduza para ${targetLanguage}. Responda com todas as linhas, na mesma ordem, no formato {"lines":[{"id":"…","text":"…"}]}.\n\n${JSON.stringify(batch.map((c) => ({ id: c.id, text: c.text })))}`,
      TranslationSchema
    )
    const byId = new Map(res.lines.map((l) => [l.id, l.text]))
    // Palavras perdem o tempo exato após tradução: mantém só o tempo da frase.
    for (const c of batch) out.push({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: byId.get(c.id) ?? c.text })
  }
  return out
}
