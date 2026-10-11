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

const SocialSchema = z.object({
  title: z.string(),
  description: z.string(),
  hashtags: z.array(z.string())
})
export type SocialCopy = z.infer<typeof SocialSchema>

const TranslationSchema = z.object({ lines: z.array(z.object({ id: z.string(), text: z.string() })) })

export class AiError extends Error {}

function client(apiKey: string, fetchImpl?: typeof fetch): Anthropic {
  if (!apiKey) throw new AiError('Configure sua chave da API Anthropic em Configurações → IA.')
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
}

async function ask<T>(
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

export function generateSocialCopy(apiKey: string, model: string, transcript: string, platform: string, fetchImpl?: typeof fetch): Promise<SocialCopy> {
  return ask(
    apiKey,
    model,
    'Você escreve textos para vídeos curtos em redes sociais, em português do Brasil. Seja fiel ao que é dito na transcrição; não invente fatos.',
    `Plataforma: ${platform}\n\nTranscrição do corte:\n"""\n${transcript}\n"""\n\nCrie um título curto e chamativo (até 70 caracteres), uma descrição de 1 a 3 frases e de 3 a 8 hashtags relevantes (com #, sem espaços).`,
    SocialSchema,
    fetchImpl
  )
}

/** Traduz legendas mantendo os ids (os tempos ficam iguais). */
export async function translateCues(apiKey: string, model: string, cues: Cue[], targetLanguage: string, fetchImpl?: typeof fetch): Promise<Cue[]> {
  const out: Cue[] = []
  for (let i = 0; i < cues.length; i += 150) {
    const batch = cues.slice(i, i + 150)
    const res = await ask(
      apiKey,
      model,
      'Você traduz legendas de vídeo. Mantenha o tom falado, frases curtas e o mesmo id em cada linha.',
      `Traduza para ${targetLanguage}. Responda com todas as linhas, na mesma ordem.\n\n${JSON.stringify(batch.map((c) => ({ id: c.id, text: c.text })))}`,
      TranslationSchema,
      fetchImpl
    )
    const byId = new Map(res.lines.map((l) => [l.id, l.text]))
    // Palavras perdem o tempo exato após tradução: mantém só o tempo da frase.
    for (const c of batch) out.push({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: byId.get(c.id) ?? c.text })
  }
  return out
}
