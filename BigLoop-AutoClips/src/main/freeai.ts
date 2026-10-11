import type { z } from 'zod'
import { AiError } from './ai'

/**
 * IA grátis na nuvem: serviços que rodam modelos abertos (Llama, Qwen, GPT-OSS…) com plano gratuito.
 * Todos falam o formato "OpenAI-compatible", então um cliente só serve para os três.
 * O usuário cria a própria chave grátis; o app tenta um serviço e, se falhar ou bater o limite,
 * passa para o próximo. Envia só TEXTO da transcrição — nunca vídeo ou áudio.
 */
export type FreeProviderId = 'groq' | 'cerebras' | 'openrouter'

export interface FreeProvider {
  id: FreeProviderId
  label: string
  base: string
  keyUrl: string
  /** Modelos preferidos, em ordem (expressões aplicadas ao id do modelo). */
  prefer: RegExp[]
  /** Só aceita modelos que passem aqui (ex.: OpenRouter só os ":free"). */
  accept?: (id: string) => boolean
}

const PREFER = [/gpt-oss-120b/i, /llama-?3\.3-70b/i, /qwen-?3.*(32b|235b)/i, /llama.*70b/i, /gpt-oss-20b/i, /qwen/i, /llama/i]

export const FREE_PROVIDERS: Record<FreeProviderId, FreeProvider> = {
  groq: { id: 'groq', label: 'Groq', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', prefer: PREFER },
  cerebras: { id: 'cerebras', label: 'Cerebras', base: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/', prefer: PREFER },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    prefer: PREFER,
    accept: (id) => id.endsWith(':free')
  }
}

export const FREE_ORDER: FreeProviderId[] = ['groq', 'cerebras', 'openrouter']

/** Modelos que não servem para texto (voz, moderação, embeddings…). */
const NOT_CHAT = /whisper|tts|guard|embed|moderation|vision-preview|playai|orpheus|distil|prompt-guard|compound/i

export function chooseModel(ids: string[], p: FreeProvider): string | null {
  const ok = ids.filter((id) => !NOT_CHAT.test(id) && (!p.accept || p.accept(id)))
  for (const re of p.prefer) {
    const hit = ok.find((id) => re.test(id))
    if (hit) return hit
  }
  return ok[0] ?? null
}

/** Pega o JSON de uma resposta (aceita ```json … ``` ou texto em volta). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1))
      } catch {
        /* cai no erro abaixo */
      }
    }
    throw new AiError('A IA não retornou uma resposta válida.')
  }
}

export interface FreeAiOptions {
  keys: Partial<Record<FreeProviderId, string>>
  fetchImpl?: typeof fetch
  /** Para testes: troca o endereço base de todos os serviços. */
  baseOverride?: string
  timeoutMs?: number
  log?: (level: 'info' | 'warn', msg: string, extra?: unknown) => void
}

export interface FreeAiAnswer<T> {
  data: T
  provider: FreeProviderId
  model: string
}

export class FreeAi {
  private models = new Map<FreeProviderId, string>()

  constructor(private readonly o: FreeAiOptions) {}

  configured(): FreeProviderId[] {
    return FREE_ORDER.filter((id) => !!this.o.keys[id]?.trim())
  }

  private base(p: FreeProvider): string {
    return this.o.baseOverride ? `${this.o.baseOverride.replace(/\/$/, '')}/${p.id}` : p.base
  }

  private async call(p: FreeProvider, path: string, init: RequestInit): Promise<Response> {
    const f = this.o.fetchImpl ?? fetch
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.o.keys[p.id]!.trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (p.id === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://andreunicos.github.io/tiktok-verify/', 'X-Title': 'BigLoop AutoClips' })
    try {
      return await f(`${this.base(p)}${path}`, { ...init, headers, signal: AbortSignal.timeout(this.o.timeoutMs ?? 90_000) })
    } catch (err) {
      throw new AiError(`Sem conexão com ${p.label} (${(err as Error).message}).`)
    }
  }

  private async model(p: FreeProvider): Promise<string> {
    const cached = this.models.get(p.id)
    if (cached) return cached
    const res = await this.call(p, '/models', { method: 'GET' })
    if (res.status === 401 || res.status === 403) throw new AiError(`Chave do ${p.label} inválida.`)
    if (!res.ok) throw new AiError(`${p.label} respondeu ${res.status} ao listar modelos.`)
    const body = (await res.json()) as { data?: { id?: string }[] }
    const id = chooseModel((body.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean), p)
    if (!id) throw new AiError(`Nenhum modelo de texto grátis disponível no ${p.label}.`)
    this.models.set(p.id, id)
    return id
  }

  private async askOne<T>(p: FreeProvider, system: string, user: string, schema: z.ZodType<T>): Promise<FreeAiAnswer<T>> {
    const model = await this.model(p)
    const send = (jsonMode: boolean) =>
      this.call(p, '/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 4000,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: `${system}\nResponda SOMENTE com um objeto JSON válido, sem texto antes ou depois.` },
            { role: 'user', content: user }
          ]
        })
      })
    let res = await send(true)
    // Alguns modelos não aceitam "json_object": tenta de novo sem ele
    if (res.status === 400) res = await send(false)
    if (res.status === 401 || res.status === 403) throw new AiError(`Chave do ${p.label} inválida.`)
    if (res.status === 429) throw new AiError(`Limite grátis do ${p.label} atingido por agora.`)
    if (!res.ok) throw new AiError(`${p.label} respondeu ${res.status}.`)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = body.choices?.[0]?.message?.content ?? ''
    const parsed = schema.safeParse(extractJson(text))
    if (!parsed.success) throw new AiError(`${p.label} retornou um formato inesperado.`)
    return { data: parsed.data, provider: p.id, model }
  }

  /** Tenta cada serviço configurado, em ordem, até um responder certo. */
  async json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<FreeAiAnswer<T>> {
    const list = this.configured()
    if (list.length === 0) throw new AiError('Cole uma chave grátis (Groq, Cerebras ou OpenRouter) em Configurações → IA.')
    const errors: string[] = []
    for (const id of list) {
      try {
        return await this.askOne(FREE_PROVIDERS[id], system, user, schema)
      } catch (err) {
        const msg = (err as Error).message
        errors.push(msg)
        this.o.log?.('warn', `IA grátis: ${FREE_PROVIDERS[id].label} falhou, tentando o próximo`, msg)
        if (/formato inesperado|não retornou/.test(msg)) this.models.delete(id)
      }
    }
    throw new AiError(errors.join(' · '))
  }
}
