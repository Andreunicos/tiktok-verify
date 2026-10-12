import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAuthUrl, chunkPlan, createPkce, exchangeCode, TikTokSession, waitForAuthCode, type TikTokAppConfig } from '../src/main/tiktok'

const dir = join(__dirname, '.tmp-tiktok')

interface Upload {
  size: number
  parts: Buffer[]
  ranges: string[]
  kind: 'inbox' | 'direct'
  post?: Record<string, unknown>
}

const st = { challenge: '', audited: false, tokensIssued: 0, expiresIn: 1, uploads: new Map<string, Upload>(), statusCalls: 0 }
let base = ''

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

/** Imita a API do TikTok (OAuth, user info, creator info, init, upload em partes, status). */
async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, base)
  const raw = await body(req)
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/upload/')) {
    const up = st.uploads.get(url.pathname.split('/').pop()!)!
    up.parts.push(raw)
    up.ranges.push(String(req.headers['content-range']))
    return res.writeHead(Buffer.concat(up.parts).length === up.size ? 201 : 206).end()
  }
  if (url.pathname === '/v2/oauth/token/') {
    const p = new URLSearchParams(raw.toString())
    if (p.get('client_secret') !== 'segredo') return send(400, { error: 'invalid_client', error_description: 'Client secret inválido' })
    if (p.get('grant_type') === 'authorization_code') {
      const ok = p.get('code') === 'codigo-123' && createHash('sha256').update(p.get('code_verifier') ?? '').digest('hex') === st.challenge && p.get('redirect_uri') === `${base}/cb`
      if (!ok) return send(400, { error: 'invalid_grant', error_description: 'PKCE inválido' })
    } else if (p.get('refresh_token') !== `refresh-${st.tokensIssued}`) return send(400, { error: 'invalid_grant', error_description: 'refresh inválido' })
    st.tokensIssued++
    return send(200, { access_token: `token-${st.tokensIssued}`, refresh_token: `refresh-${st.tokensIssued}`, open_id: 'u1', scope: 'user.info.basic,video.upload,video.publish', expires_in: st.expiresIn, refresh_expires_in: 31536000, token_type: 'Bearer' })
  }
  if (req.headers.authorization !== `Bearer token-${st.tokensIssued}`) return send(401, { error: { code: 'access_token_invalid', message: 'expirou' } })
  if (url.pathname === '/v2/user/info/') return send(200, { data: { user: { open_id: 'u1', display_name: 'André', avatar_url: 'https://x/a.jpg' } }, error: { code: 'ok' } })
  if (url.pathname === '/v2/post/publish/creator_info/query/')
    return send(200, { data: { creator_username: 'andre', creator_nickname: 'André', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: 'ok' } })
  if (url.pathname === '/v2/post/publish/inbox/video/init/' || url.pathname === '/v2/post/publish/video/init/') {
    const b = JSON.parse(raw.toString())
    const direct = url.pathname === '/v2/post/publish/video/init/'
    if (direct && !st.audited && b.post_info.privacy_level !== 'SELF_ONLY') return send(403, { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'x' } })
    const si = b.source_info
    if (si.source !== 'FILE_UPLOAD' || !si.video_size || !si.chunk_size || !si.total_chunk_count) return send(400, { error: { code: 'invalid_params', message: 'x' } })
    const id = `pub-${st.uploads.size + 1}`
    st.uploads.set(id, { size: si.video_size, parts: [], ranges: [], kind: direct ? 'direct' : 'inbox', post: b.post_info })
    return send(200, { data: { publish_id: id, upload_url: `${base}/upload/${id}` }, error: { code: 'ok' } })
  }
  if (url.pathname === '/v2/video/query/') {
    const ids = JSON.parse(raw.toString()).filters.video_ids as string[]
    return send(200, { data: { videos: ids.map((id) => ({ id, view_count: 4321, like_count: 210, comment_count: 12, share_count: 5 })) }, error: { code: 'ok' } })
  }
  if (url.pathname === '/v2/post/publish/status/fetch/') {
    st.statusCalls++
    const up = st.uploads.get(JSON.parse(raw.toString()).publish_id)!
    const complete = Buffer.concat(up.parts).length === up.size
    const status = !complete ? 'PROCESSING_UPLOAD' : st.statusCalls % 2 === 1 ? 'PROCESSING_DOWNLOAD' : up.kind === 'inbox' ? 'SEND_TO_USER_INBOX' : 'PUBLISH_COMPLETE'
    return send(200, { data: { status, publicaly_available_post_id: status === 'PUBLISH_COMPLETE' ? [7123] : [] }, error: { code: 'ok' } })
  }
  send(404, { error: { code: 'not_found', message: url.pathname } })
}

describe('TikTok (API simulada)', () => {
  let server: Server
  let cfg: TikTokAppConfig
  let session: TikTokSession
  let saved: unknown = null
  const video = join(dir, 'corte.mp4')
  beforeAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(video, randomBytes(2_500_000))
    server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    cfg = { clientKey: 'chave', clientSecret: 'segredo', redirectUri: `${base}/cb`, api: base, authorizeUrl: `${base}/auth` }
  })
  afterAll(() => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('plano de partes segue as regras do TikTok', () => {
    const MB = 1024 * 1024
    expect(chunkPlan(3 * MB)).toEqual({ chunkSize: 3 * MB, count: 1 })
    expect(chunkPlan(25 * MB)).toEqual({ chunkSize: 10 * MB, count: 2 }) // última parte leva 15 MB
    expect(() => chunkPlan(0)).toThrow()
  })

  it('login: URL com PKCE, retorno local, troca do código', async () => {
    const pk = createPkce()
    expect(pk.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(pk.challenge).toBe(createHash('sha256').update(pk.verifier).digest('hex'))
    st.challenge = pk.challenge
    const auth = new URL(buildAuthUrl(cfg, 'estado-xyz', pk.challenge))
    expect(auth.searchParams.get('scope')).toBe('user.info.basic,video.upload,video.publish')
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    // servidor local recebe o retorno (como faria o navegador)
    const port = 53000 + Math.floor(Math.random() * 1000)
    const wait = waitForAuthCode(port, 'estado-xyz', 5000)
    const codeP = wait.promise
    const page = await fetch(`http://127.0.0.1:${port}/callback/?code=codigo-123&state=estado-xyz`)
    expect(await page.text()).toContain('Conectado')
    const code = await codeP
    const tokens = await exchangeCode(cfg, code, pk.verifier)
    expect(tokens).toMatchObject({ accessToken: 'token-1', openId: 'u1' })
    session = new TikTokSession(cfg, tokens, (t) => (saved = t))
  })

  it('retorno com state errado ou cancelado é recusado', async () => {
    const port = 54100 + Math.floor(Math.random() * 500)
    const w1 = waitForAuthCode(port, 'certo', 5000)
    const e1 = expect(w1.promise).rejects.toThrow(/não confere/)
    await fetch(`http://127.0.0.1:${port}/callback?code=x&state=errado`)
    await e1
    const w2 = waitForAuthCode(port + 1, 's', 5000)
    const e2 = expect(w2.promise).rejects.toThrow(/cancelou/)
    await fetch(`http://127.0.0.1:${port + 1}/callback?error=access_denied&state=s`)
    await e2
  })

  it('token expirado é renovado sozinho e salvo', async () => {
    st.expiresIn = 86400
    await new Promise((r) => setTimeout(r, 50)) // o token de login dura 1 s (60 s de margem → já "expirado")
    const info = await session.client().userInfo()
    expect(info.displayName).toBe('André')
    expect(st.tokensIssued).toBe(2)
    expect((saved as { accessToken: string }).accessToken).toBe('token-2')
  })

  it('envia para os rascunhos em partes e o arquivo chega idêntico', async () => {
    const client = session.client({ chunkSize: 1_000_000, minChunk: 1_000_000 })
    const progress: number[] = []
    const id = await client.uploadToInbox(video, (r) => progress.push(r))
    const up = st.uploads.get(id)!
    expect(up.kind).toBe('inbox')
    expect(up.ranges).toEqual(['bytes 0-999999/2500000', 'bytes 1000000-2499999/2500000'])
    expect(Buffer.concat(up.parts).equals(readFileSync(video))).toBe(true)
    expect(progress.at(-1)).toBe(1)
    const done = await client.waitDone(id, { intervalMs: 10 })
    expect(done.status).toBe('SEND_TO_USER_INBOX')
  })

  it('postagem direta: app não auditado só posta privado; com privado funciona', async () => {
    const client = session.client({ chunkSize: 5_000_000 })
    const creator = await client.creatorInfo()
    expect(creator).toMatchObject({ nickname: 'André', duetDisabled: true, maxDurationSec: 600 })
    expect(creator.privacyOptions).toContain('SELF_ONLY')
    const info = { title: 'Jogada absurda #cortes', disableComment: false, disableDuet: true, disableStitch: false }
    await expect(client.directPost(video, { ...info, privacyLevel: 'PUBLIC_TO_EVERYONE' })).rejects.toThrow(/não foi auditado/)
    await expect(client.directPost(video, { ...info, privacyLevel: '' })).rejects.toThrow(/Escolha quem pode ver/)
    const id = await client.directPost(video, { ...info, privacyLevel: 'SELF_ONLY' })
    expect(st.uploads.get(id)!.post).toMatchObject({ title: 'Jogada absurda #cortes', privacy_level: 'SELF_ONLY', disable_duet: true })
    const done = await client.waitDone(id, { intervalMs: 10 })
    expect(done).toMatchObject({ status: 'PUBLISH_COMPLETE', postIds: ['7123'] })
  })

  it('métricas dos posts (visualizações, curtidas…)', async () => {
    const stats = await session.client().videoStats(['7123'])
    expect(stats).toEqual({ '7123': { views: 4321, likes: 210, comments: 12, shares: 5 } })
    expect(await session.client().videoStats([])).toEqual({})
  })

  it('erros de login com mensagens claras', async () => {
    await expect(exchangeCode({ ...cfg, clientSecret: 'errado' }, 'x', 'y')).rejects.toThrow(/Client secret inválido/)
    const off = new TikTokSession(cfg, null, () => undefined)
    await expect(off.client().userInfo()).rejects.toThrow(/Conecte sua conta/)
  })
})
