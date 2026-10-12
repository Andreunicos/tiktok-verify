import { createHash, randomBytes } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

/**
 * YouTube Shorts pela API oficial (YouTube Data API v3).
 * - Login: OAuth 2.0 para app de computador (cliente "Desktop" criado pela pessoa no Google Cloud),
 *   com PKCE e retorno em http://127.0.0.1:<porta>/callback (o Google aceita loopback direto).
 * - Envio: upload "resumable" em partes; vídeo vertical de até 3 min vira Short automaticamente.
 * - Agendar: privacyStatus=private + publishAt — o próprio YouTube publica na hora (o app pode estar fechado).
 * - Métricas: videos.list?part=statistics (visualizações, curtidas, comentários).
 */
export const YOUTUBE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/youtube/v3',
  upload: 'https://www.googleapis.com/upload/youtube/v3/videos'
}

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

export interface YouTubeTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface YouTubeAppConfig {
  clientId: string
  clientSecret: string
  port: number
  urls?: Partial<typeof YOUTUBE>
  fetchImpl?: typeof fetch
}

export class YouTubeError extends Error {}

const url = (cfg: YouTubeAppConfig, k: keyof typeof YOUTUBE) => cfg.urls?.[k] ?? YOUTUBE[k]
export const redirectUri = (port: number) => `http://127.0.0.1:${port}/callback`

/** PKCE padrão (S256, base64url), como o Google pede. */
export function youtubePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function buildYouTubeAuthUrl(cfg: YouTubeAppConfig, state: string, challenge: string): string {
  const u = new URL(url(cfg, 'authorize'))
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri(cfg.port))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', YOUTUBE_SCOPES.join(' '))
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

async function tokenRequest(cfg: YouTubeAppConfig, params: Record<string, string>, keepRefresh?: string): Promise<YouTubeTokens> {
  const f = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await f(url(cfg, 'token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params })
    })
  } catch (err) {
    throw new YouTubeError(`Sem conexão com o Google (${(err as Error).message}).`)
  }
  const d = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!res.ok || !d.access_token) {
    const why = d.error === 'invalid_grant' ? 'a autorização expirou ou foi revogada — conecte de novo' : d.error_description ?? d.error ?? `erro ${res.status}`
    throw new YouTubeError(`O Google recusou o login: ${why}.`)
  }
  return { accessToken: d.access_token, refreshToken: d.refresh_token ?? keepRefresh ?? '', expiresAt: Date.now() + Number(d.expires_in ?? 3600) * 1000 }
}

export function exchangeYouTubeCode(cfg: YouTubeAppConfig, code: string, verifier: string): Promise<YouTubeTokens> {
  return tokenRequest(cfg, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(cfg.port), code_verifier: verifier })
}

export function refreshYouTube(cfg: YouTubeAppConfig, refreshToken: string): Promise<YouTubeTokens> {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken)
}

export interface YouTubeUpload {
  title: string
  description: string
  tags: string[]
  privacy: 'public' | 'unlisted' | 'private'
  /** ISO 8601: publica sozinho nessa hora (o vídeo fica privado até lá). */
  publishAt?: string
}

/** Título com #Shorts (até 100 caracteres) e descrição com as hashtags. */
export function shortsMetadata(u: YouTubeUpload): { snippet: Record<string, unknown>; status: Record<string, unknown> } {
  const tag = '#Shorts'
  const title = (u.title.includes(tag) ? u.title : `${u.title} ${tag}`).slice(0, 100)
  return {
    snippet: { title, description: u.description.slice(0, 4900), tags: u.tags.map((t) => t.replace(/^#/, '')).slice(0, 15), categoryId: '20' },
    status: u.publishAt
      ? { privacyStatus: 'private', publishAt: u.publishAt, selfDeclaredMadeForKids: false }
      : { privacyStatus: u.privacy, selfDeclaredMadeForKids: false }
  }
}

const CHUNK = 8 * 1024 * 1024 // múltiplo de 256 KB, como o Google exige

export class YouTubeSession {
  constructor(
    private cfg: YouTubeAppConfig,
    private tokens: YouTubeTokens | null,
    private readonly onTokens: (t: YouTubeTokens | null) => void
  ) {}

  get connected(): boolean {
    return !!this.tokens?.refreshToken
  }

  setConfig(cfg: YouTubeAppConfig): void {
    this.cfg = cfg
  }

  setTokens(t: YouTubeTokens | null): void {
    this.tokens = t
    this.onTokens(t)
  }

  async accessToken(): Promise<string> {
    if (!this.tokens) throw new YouTubeError('Conecte sua conta do YouTube em Configurações → Contas.')
    if (this.tokens.expiresAt - 60_000 > Date.now()) return this.tokens.accessToken
    this.setTokens(await refreshYouTube(this.cfg, this.tokens.refreshToken))
    return this.tokens!.accessToken
  }

  private async f(input: string, init: RequestInit): Promise<Response> {
    try {
      return await (this.cfg.fetchImpl ?? fetch)(input, init)
    } catch (err) {
      throw new YouTubeError(`Sem conexão com o YouTube (${(err as Error).message}).`)
    }
  }

  async channelTitle(): Promise<string> {
    const res = await this.f(`${url(this.cfg, 'api')}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${await this.accessToken()}` } })
    const d = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok) throw new YouTubeError(d.error?.message ?? `O YouTube respondeu ${res.status}.`)
    return d.items?.[0]?.snippet?.title ?? 'Seu canal'
  }

  /** Envia o vídeo e devolve o id do YouTube. */
  async upload(file: string, meta: YouTubeUpload, onProgress?: (r: number) => void): Promise<string> {
    const size = (await stat(file)).size
    const init = await this.f(`${url(this.cfg, 'upload')}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4'
      },
      body: JSON.stringify(shortsMetadata(meta))
    })
    if (!init.ok) {
      const d = (await init.json().catch(() => ({}))) as Record<string, any>
      const reason = d.error?.errors?.[0]?.reason
      throw new YouTubeError(
        reason === 'quotaExceeded'
          ? 'A cota diária da API do YouTube acabou (cerca de 6 envios por dia no plano padrão). Tente amanhã.'
          : reason === 'youtubeSignupRequired'
            ? 'Essa conta Google ainda não tem canal no YouTube. Crie o canal e tente de novo.'
            : d.error?.message ?? `O YouTube recusou o envio (${init.status}).`
      )
    }
    const location = init.headers.get('location')
    if (!location) throw new YouTubeError('O YouTube não devolveu o endereço de envio.')
    const fh = await open(file, 'r')
    try {
      let offset = 0
      for (;;) {
        const len = Math.min(CHUNK, size - offset)
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, offset)
        const res = await this.f(location, {
          method: 'PUT',
          headers: { 'Content-Length': String(len), 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
          body: buf
        })
        if (res.status === 308) {
          const range = res.headers.get('range')
          offset = range ? Number(range.split('-')[1]) + 1 : offset + len
          onProgress?.(offset / size)
          continue
        }
        const d = (await res.json().catch(() => ({}))) as Record<string, any>
        if (!res.ok || !d.id) throw new YouTubeError(d.error?.message ?? `Falha no envio para o YouTube (${res.status}).`)
        onProgress?.(1)
        return String(d.id)
      }
    } finally {
      await fh.close()
    }
  }

  /** Visualizações/curtidas/comentários de até 50 vídeos. */
  async stats(ids: string[]): Promise<Record<string, { views: number; likes: number; comments: number }>> {
    if (!ids.length) return {}
    const res = await this.f(`${url(this.cfg, 'api')}/videos?part=statistics&id=${ids.slice(0, 50).map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` }
    })
    const d = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok) throw new YouTubeError(d.error?.message ?? `O YouTube respondeu ${res.status}.`)
    const out: Record<string, { views: number; likes: number; comments: number }> = {}
    for (const it of d.items ?? []) out[it.id] = { views: Number(it.statistics?.viewCount ?? 0), likes: Number(it.statistics?.likeCount ?? 0), comments: Number(it.statistics?.commentCount ?? 0) }
    return out
  }
}
