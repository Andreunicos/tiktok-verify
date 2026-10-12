import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildYouTubeAuthUrl, exchangeYouTubeCode, shortsMetadata, YouTubeSession, youtubePkce, type YouTubeAppConfig, type YouTubeTokens } from '../src/main/youtube'

const dir = join(__dirname, '.tmp-youtube')
const video = join(dir, 'corte.mp4')
const SIZE = 9 * 1024 * 1024 // > 1 parte de 8 MB

/** Imita o Google: token (PKCE), upload resumable com 308 e estatísticas. */
function fakeGoogle(opts: { quota?: boolean } = {}) {
  const st = { challenge: '', received: 0, meta: null as any, refreshed: 0, puts: [] as string[] }
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    if (url.pathname === '/token') {
      const p = new URLSearchParams(String(init!.body))
      if (p.get('grant_type') === 'authorization_code') {
        if (createHash('sha256').update(p.get('code_verifier')!).digest('base64url') !== st.challenge) return json(400, { error: 'invalid_grant' })
        return json(200, { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600 })
      }
      st.refreshed++
      return json(200, { access_token: `tok-r${st.refreshed}`, expires_in: 3600 })
    }
    if (!auth?.startsWith('Bearer tok') && !url.pathname.startsWith('/session')) return json(401, { error: { message: 'sem login' } })
    if (url.pathname === '/upload') {
      if (opts.quota) return json(403, { error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } })
      st.meta = JSON.parse(String(init!.body))
      return new Response(null, { status: 200, headers: { location: 'https://fake.google/session/1' } })
    }
    if (url.pathname === '/session/1') {
      const range = (init!.headers as Record<string, string>)['Content-Range']
      st.puts.push(range)
      st.received += (init!.body as Buffer).length
      if (st.received < SIZE) return new Response(null, { status: 308, headers: { range: `bytes=0-${st.received - 1}` } })
      return json(200, { id: 'yt123' })
    }
    if (url.pathname === '/api/channels') return json(200, { items: [{ snippet: { title: 'Canal do André' } }] })
    if (url.pathname === '/api/videos') return json(200, { items: [{ id: 'yt123', statistics: { viewCount: '1500', likeCount: '90', commentCount: '7' } }] })
    return json(404, {})
  }) as typeof fetch
  return { st, f }
}

const cfgFor = (f: typeof fetch): YouTubeAppConfig => ({
  clientId: 'cid',
  clientSecret: 'sec',
  port: 53683,
  fetchImpl: f,
  urls: { authorize: 'https://fake.google/auth', token: 'https://fake.google/token', api: 'https://fake.google/api', upload: 'https://fake.google/upload' }
})

describe('YouTube Shorts (API simulada)', () => {
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(video, randomBytes(SIZE))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('login: URL com PKCE S256, offline e retorno local; troca do código', async () => {
    const { st, f } = fakeGoogle()
    const pk = youtubePkce()
    st.challenge = pk.challenge
    const u = new URL(buildYouTubeAuthUrl(cfgFor(f), 'estado', pk.challenge))
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53683/callback')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('scope')).toContain('youtube.upload')
    const t = await exchangeYouTubeCode(cfgFor(f), 'codigo', pk.verifier)
    expect(t).toMatchObject({ accessToken: 'tok-1', refreshToken: 'ref-1' })
    await expect(exchangeYouTubeCode(cfgFor(f), 'codigo', 'errado')).rejects.toThrow(/recusou o login/)
  })

  it('#Shorts no título e agendamento nativo (privado + publishAt)', () => {
    const m = shortsMetadata({ title: 'Clutch insano', description: 'd', tags: ['#jogo'], privacy: 'public', publishAt: '2026-10-20T21:00:00Z' })
    expect(m.snippet.title).toBe('Clutch insano #Shorts')
    expect(m.snippet.tags).toEqual(['jogo'])
    expect(m.status).toMatchObject({ privacyStatus: 'private', publishAt: '2026-10-20T21:00:00Z' })
  })

  it('envia em partes (308 → continua), renova o token vencido e lê as visualizações', async () => {
    const { st, f } = fakeGoogle()
    let saved: YouTubeTokens | null = null
    const s = new YouTubeSession(cfgFor(f), { accessToken: 'velho', refreshToken: 'ref-1', expiresAt: Date.now() - 1 }, (t) => (saved = t))
    expect(await s.channelTitle()).toBe('Canal do André')
    expect(st.refreshed).toBe(1)
    expect(saved!.refreshToken).toBe('ref-1')
    const progress: number[] = []
    const id = await s.upload(video, { title: 'Corte', description: '', tags: [], privacy: 'unlisted' }, (r) => progress.push(r))
    expect(id).toBe('yt123')
    expect(st.puts).toEqual([`bytes 0-${8 * 1024 * 1024 - 1}/${SIZE}`, `bytes ${8 * 1024 * 1024}-${SIZE - 1}/${SIZE}`])
    expect(st.meta.status.privacyStatus).toBe('unlisted')
    expect(progress.at(-1)).toBe(1)
    expect(await s.stats(['yt123'])).toEqual({ yt123: { views: 1500, likes: 90, comments: 7 } })
  })

  it('cota da API esgotada: mensagem clara', async () => {
    const { f } = fakeGoogle({ quota: true })
    const s = new YouTubeSession(cfgFor(f), { accessToken: 'tok-1', refreshToken: 'ref-1', expiresAt: Date.now() + 3600_000 }, () => undefined)
    await expect(s.upload(video, { title: 'x', description: '', tags: [], privacy: 'public' })).rejects.toThrow(/cota diária/)
  })

  it('sem conta conectada', async () => {
    const s = new YouTubeSession(cfgFor(fakeGoogle().f), null, () => undefined)
    expect(s.connected).toBe(false)
    await expect(s.channelTitle()).rejects.toThrow(/Conecte sua conta/)
  })
})
