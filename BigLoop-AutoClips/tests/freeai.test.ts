import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { blendScore, buildPlanPrompt, normalizePlan, planClips, type PlanCandidate } from '../src/main/brain'
import { chooseModel, extractJson, FREE_PROVIDERS, FreeAi } from '../src/main/freeai'

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown }
function fakeFetch(h: Handler) {
  const calls: { url: string; body: any; auth: string }[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, auth: String((init.headers as Record<string, string>).Authorization) })
    const r = h(url, init)
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { f, calls }
}
const chat = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } })
const models = (...ids: string[]) => ({ status: 200, body: { data: ids.map((id) => ({ id })) } })
const Schema = z.object({ ok: z.boolean() })

describe('IA grátis (Groq / Cerebras / OpenRouter)', () => {
  it('escolhe o melhor modelo de texto disponível', () => {
    expect(chooseModel(['whisper-large-v3', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b'], FREE_PROVIDERS.groq)).toBe('openai/gpt-oss-120b')
    expect(chooseModel(['whisper-large-v3', 'llama-3.1-8b-instant'], FREE_PROVIDERS.groq)).toBe('llama-3.1-8b-instant')
    expect(chooseModel(['meta-llama/llama-3.3-70b-instruct', 'qwen/qwen3-32b:free'], FREE_PROVIDERS.openrouter)).toBe('qwen/qwen3-32b:free')
    expect(chooseModel(['whisper-large-v3', 'llama-guard-4'], FREE_PROVIDERS.groq)).toBeNull()
  })

  it('lê JSON mesmo com ``` ou texto em volta', () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(extractJson('Claro! Aqui está: {"ok": true} Espero ter ajudado')).toEqual({ ok: true })
    expect(() => extractJson('não sei')).toThrow(/resposta válida/)
  })

  it('usa o Groq com a chave do usuário e pede JSON', async () => {
    const { f, calls } = fakeFetch((url) => (url.endsWith('/models') ? models('llama-3.3-70b-versatile') : chat('{"ok":true}')))
    const ai = new FreeAi({ keys: { groq: ' gsk_abc ' }, fetchImpl: f })
    const r = await ai.json('sys', 'user', Schema)
    expect(r).toEqual({ data: { ok: true }, provider: 'groq', model: 'llama-3.3-70b-versatile' })
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/models')
    expect(calls[1].url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(calls[1].auth).toBe('Bearer gsk_abc')
    expect(calls[1].body.response_format).toEqual({ type: 'json_object' })
    expect(calls[1].body.messages[0].content).toMatch(/SOMENTE com um objeto JSON/)
    // modelo fica guardado: segundo pedido não lista de novo
    await ai.json('sys', 'user', Schema)
    expect(calls.filter((c) => c.url.endsWith('/models'))).toHaveLength(1)
  })

  it('limite do Groq → passa sozinho para a reserva (Cerebras)', async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.endsWith('/models')) return models(url.includes('groq') ? 'llama-3.3-70b-versatile' : 'gpt-oss-120b')
      return url.includes('groq') ? { status: 429, body: { error: 'rate' } } : chat('{"ok":true}')
    })
    const logs: string[] = []
    const ai = new FreeAi({ keys: { groq: 'g', cerebras: 'c' }, fetchImpl: f, log: (_l, m, e) => logs.push(`${m} ${e}`) })
    const r = await ai.json('s', 'u', Schema)
    expect(r.provider).toBe('cerebras')
    expect(r.model).toBe('gpt-oss-120b')
    expect(calls.some((c) => c.url === 'https://api.cerebras.ai/v1/chat/completions')).toBe(true)
    expect(logs.join()).toMatch(/Limite grátis do Groq/)
  })

  it('modelo que não aceita json_object: tenta de novo sem', async () => {
    let n = 0
    const { f, calls } = fakeFetch((url) => {
      if (url.endsWith('/models')) return models('qwen/qwen3-32b')
      return ++n === 1 ? { status: 400, body: { error: 'response_format not supported' } } : chat('{"ok": true}')
    })
    const r = await new FreeAi({ keys: { groq: 'g' }, fetchImpl: f }).json('s', 'u', Schema)
    expect(r.data.ok).toBe(true)
    expect(calls[2].body.response_format).toBeUndefined()
  })

  it('erros claros: sem chave, chave inválida, todos falharam', async () => {
    await expect(new FreeAi({ keys: {} }).json('s', 'u', Schema)).rejects.toThrow(/Cole uma chave grátis/)
    const bad = fakeFetch(() => ({ status: 401, body: {} }))
    await expect(new FreeAi({ keys: { groq: 'x' }, fetchImpl: bad.f }).json('s', 'u', Schema)).rejects.toThrow(/Chave do Groq inválida/)
    const junk = fakeFetch((url) => (url.endsWith('/models') ? models('llama-3.3-70b') : chat('{"outra":"coisa"}')))
    await expect(new FreeAi({ keys: { groq: 'x', openrouter: 'y' }, fetchImpl: junk.f }).json('s', 'u', Schema)).rejects.toThrow(/formato inesperado/)
  })

  it('OpenRouter manda os cabeçalhos de identificação e usa só modelos :free', async () => {
    let headers: Record<string, string> = {}
    const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
      headers = init.headers as Record<string, string>
      const url = String(input)
      const body = url.endsWith('/models') ? { data: [{ id: 'openai/gpt-4o' }, { id: 'meta-llama/llama-3.3-70b-instruct:free' }] } : { choices: [{ message: { content: '{"ok":true}' } }] }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch
    const r = await new FreeAi({ keys: { openrouter: 'k' }, fetchImpl: f }).json('s', 'u', Schema)
    expect(r.model).toBe('meta-llama/llama-3.3-70b-instruct:free')
    expect(headers['X-Title']).toBe('BigLoop AutoClips')
  })
})

describe('IA grátis sem chave (Pollinations)', () => {
  it('sem chave nenhuma usa a Pollinations, sem cabeçalho de autorização', async () => {
    const calls: { url: string; auth?: string; model?: string }[] = []
    const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const h = init.headers as Record<string, string>
      calls.push({ url: String(input), auth: h.Authorization, model: JSON.parse(String(init.body)).model })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as typeof fetch
    const r = await new FreeAi({ keys: {}, allowKeyless: true, fetchImpl: f }).json('s', 'u', Schema)
    expect(r.provider).toBe('pollinations')
    expect(calls[0]).toEqual({ url: 'https://gen.pollinations.ai/v1/chat/completions', auth: undefined, model: 'openai' })
  })
  it('se a nova falhar, tenta o endereço antigo; desligada, pede chave', async () => {
    const urls: string[] = []
    const f = (async (input: string | URL | Request) => {
      urls.push(String(input))
      return String(input).includes('gen.') ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as typeof fetch
    const r = await new FreeAi({ keys: {}, allowKeyless: true, fetchImpl: f }).json('s', 'u', Schema)
    expect(r.provider).toBe('pollinationsLegacy')
    expect(urls).toEqual(['https://gen.pollinations.ai/v1/chat/completions', 'https://text.pollinations.ai/openai'])
    await expect(new FreeAi({ keys: {}, allowKeyless: false }).json('s', 'u', Schema)).rejects.toThrow(/Cole uma chave grátis/)
  })
  it('com chave do Groq, a Pollinations fica por último', () => {
    expect(new FreeAi({ keys: { groq: 'g' }, allowKeyless: true }).configured()).toEqual(['groq', 'pollinations', 'pollinationsLegacy'])
  })
  it('o pedido escrito vai para a IA', () => {
    expect(buildPlanPrompt('TikTok', 2, [], 'só os momentos engraçados')).toContain('Pedido de quem gravou (siga com prioridade ao dar as notas): "só os momentos engraçados"')
  })
})

describe('cérebro do modo automático (plano da IA)', () => {
  const cands: PlanCandidate[] = [
    { id: 's1', startSec: 0, endSec: 30, ruleScore: 70, text: 'Olha só essa jogada absurda que eu fiz.' },
    { id: 's2', startSec: 40, endSec: 70, ruleScore: 60, text: 'Agora vou explicar a estratégia.' }
  ]
  it('prompt traz os candidatos e pede o formato certo', () => {
    const p = buildPlanPrompt('TikTok', 1, cands)
    expect(p).toContain('### s1 (30 s)')
    expect(p).toContain('Olha só essa jogada absurda')
    expect(p).toContain('"clips"')
  })
  it('limpa a resposta: ids desconhecidos, notas fora da faixa, hashtags e palavras', () => {
    const out = normalizePlan(
      {
        clips: [
          { id: 's2', score: 140, title: '  Estratégia  ', description: 'd', hashtags: ['estrategia', '#game play', '#game play'], hook: '', keywords: ['a', 'estratégia'] },
          { id: 'zz', score: 99, title: 'x', description: '', hashtags: [], hook: '', keywords: [] },
          { id: 's2', score: 10, title: 'dup', description: '', hashtags: [], hook: '', keywords: [] }
        ]
      },
      cands
    )
    expect(out).toEqual([{ id: 's2', aiScore: 100, title: 'Estratégia', description: 'd', hashtags: ['#estrategia', '#gameplay'], hook: '', keywords: ['estratégia'] }])
  })
  it('planClips usa qualquer IA com a mesma assinatura e aceita nota como texto', async () => {
    const ask = (async (_s: string, _u: string, schema: z.ZodTypeAny) =>
      schema.parse({ clips: [{ id: 's1', score: '88', title: 'Jogada absurda', description: 'Que jogada!', hashtags: ['#jogo'], hook: 'essa jogada absurda', keywords: ['absurda'] }] })) as any
    const out = await planClips(ask, 'TikTok', 1, cands)
    expect(out[0]).toMatchObject({ id: 's1', aiScore: 88, hook: 'essa jogada absurda', keywords: ['absurda'] })
  })
  it('nota final mistura IA e regras', () => {
    expect(blendScore(50, 100)).toBe(80)
    expect(blendScore(50, undefined)).toBe(50)
  })
})
