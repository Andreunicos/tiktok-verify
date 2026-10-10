import { describe, expect, it } from 'vitest'
import { generateSocialCopy, translateCues } from '../src/main/ai'

/** fetch falso que imita a API de mensagens e registra o corpo enviado. */
function fakeFetch(reply: (body: any) => { status?: number; json: unknown }) {
  const calls: any[] = []
  const f = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    calls.push(body)
    const r = reply(body)
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
  }) as typeof fetch
  return { f, calls }
}

const message = (text: string, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 }
})

describe('IA opcional', () => {
  it('gera título, descrição e hashtags com saída estruturada', async () => {
    const { f, calls } = fakeFetch(() => ({ json: message(JSON.stringify({ title: 'Jogada absurda!', description: 'Veja.', hashtags: ['#gol'] })) }))
    const out = await generateSocialCopy('sk-test', '', 'Olha essa jogada', 'TikTok', f)
    expect(out).toEqual({ title: 'Jogada absurda!', description: 'Veja.', hashtags: ['#gol'] })
    expect(calls[0].model).toBe('claude-opus-5-5')
    expect(calls[0].fallbacks).toBe('default')
    expect(calls[0].output_config.format.type).toBe('json_schema')
    expect(calls[0].messages[0].content).toContain('Olha essa jogada')
  })

  it('traduz mantendo tempos e ids', async () => {
    const { f } = fakeFetch((body) => {
      const lines = JSON.parse(body.messages[0].content.split('\n\n').pop()).map((l: any) => ({ id: l.id, text: `EN:${l.text}` }))
      return { json: message(JSON.stringify({ lines })) }
    })
    const out = await translateCues('sk', '', [{ id: 'a', startSec: 1, endSec: 2, text: 'oi' }], 'inglês', f)
    expect(out).toEqual([{ id: 'a', startSec: 1, endSec: 2, text: 'EN:oi' }])
  })

  it('erros claros: sem chave, chave inválida, recusa', async () => {
    await expect(generateSocialCopy('', '', 'x', 'TikTok')).rejects.toThrow(/Configure sua chave/)
    const bad = fakeFetch(() => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }))
    await expect(generateSocialCopy('sk', '', 'x', 'TikTok', bad.f)).rejects.toThrow(/inválida/)
    const refusal = fakeFetch(() => ({ json: message('', 'refusal') }))
    await expect(generateSocialCopy('sk', '', 'x', 'TikTok', refusal.f)).rejects.toThrow(/recusou/)
  })
})
