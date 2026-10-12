import { createHash, randomBytes } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'

/**
 * Integração com a API oficial do TikTok (Login Kit + Content Posting API).
 * - Rascunhos (inbox): o vídeo vai para a caixa de entrada do app TikTok; a pessoa termina e posta pelo celular.
 * - Postagem direta: exige mostrar ao usuário as opções de privacidade e obter consentimento a cada post
 *   (regras de UX do TikTok). Apps não auditados pelo TikTok só conseguem postar como privado (SELF_ONLY).
 */
export const TIKTOK = {
  authorize: 'https://www.tiktok.com/v2/auth/authorize/',
  api: 'https://open.tiktokapis.com'
}

export const TIKTOK_SCOPES = ['user.info.basic', 'video.upload', 'video.publish']

export interface TikTokTokens {
  accessToken: string
  refreshToken: string
  openId: string
  scope: string
  /** epoch ms */
  expiresAt: number
  refreshExpiresAt: number
}

export interface TikTokAppConfig {
  /** Pede também o escopo video.list (visualizações dos vídeos) — precisa estar aprovado no app do TikTok. */
  withStats?: boolean
  clientKey: string
  clientSecret: string
  redirectUri: string
  api?: string
  authorizeUrl?: string
  fetchImpl?: typeof fetch
}

export class TikTokError extends Error {
  constructor(
    message: string,
    readonly code: string = 'erro'
  ) {
    super(message)
  }
}

/** PKCE do Login Kit para desktop: o TikTok usa o SHA-256 em hexadecimal como code_challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = randomBytes(64)
  const verifier = Array.from(bytes, (b) => chars[b % chars.length]).join('')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('hex') }
}

export function buildAuthUrl(cfg: TikTokAppConfig, state: string, challenge: string): string {
  const u = new URL(cfg.authorizeUrl ?? TIKTOK.authorize)
  u.searchParams.set('client_key', cfg.clientKey)
  u.searchParams.set('scope', [...TIKTOK_SCOPES, ...(cfg.withStats ? ['video.list'] : [])].join(','))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

const FRIENDLY: Record<string, string> = {
  access_token_invalid: 'A conexão com o TikTok expirou. Conecte de novo em Configurações → Contas.',
  scope_not_authorized: 'Faltou permissão no TikTok. Conecte de novo e aceite todas as permissões.',
  rate_limit_exceeded: 'O TikTok limitou os envios por agora. Tente mais tarde.',
  spam_risk_too_many_posts: 'O TikTok bloqueou por excesso de posts hoje. Tente amanhã.',
  spam_risk_too_many_pending_share: 'Há rascunhos demais pendentes no TikTok. Poste ou apague alguns no app e tente de novo.',
  spam_risk_user_banned_from_posting: 'Esta conta está impedida de postar pelo TikTok.',
  reached_active_user_cap: 'O app atingiu o limite diário de usuários da API do TikTok.',
  unaudited_client_can_only_post_to_private_accounts:
    'Seu app no TikTok ainda não foi auditado: só dá para postar como “Somente eu” (privado), ou enviar para rascunhos.',
  privacy_level_option_mismatch: 'A opção de privacidade escolhida não está disponível para esta conta.',
  url_ownership_unverified: 'Domínio não verificado no TikTok.',
  duration_check_failed: 'O vídeo passou do tempo máximo permitido para esta conta.',
  invalid_file_upload: 'O TikTok recusou o arquivo (formato, tamanho ou partes).'
}

async function json(res: Response): Promise<Record<string, any>> {
  try {
    return (await res.json()) as Record<string, any>
  } catch {
    return {}
  }
}

function apiError(body: Record<string, any>, status: number): TikTokError {
  const code = String(body?.error?.code ?? body?.error ?? `http_${status}`)
  const msg = FRIENDLY[code] ?? body?.error?.message ?? body?.error_description ?? `O TikTok respondeu ${status}.`
  return new TikTokError(String(msg), code)
}

async function tokenRequest(cfg: TikTokAppConfig, params: Record<string, string>): Promise<TikTokTokens> {
  const f = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await f(`${cfg.api ?? TIKTOK.api}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret, ...params })
    })
  } catch (err) {
    throw new TikTokError(`Sem conexão com o TikTok (${(err as Error).message}).`, 'rede')
  }
  const body = await json(res)
  if (!res.ok || !body.access_token) throw apiError(body, res.status)
  const now = Date.now()
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    openId: body.open_id,
    scope: body.scope ?? '',
    expiresAt: now + Number(body.expires_in ?? 0) * 1000,
    refreshExpiresAt: now + Number(body.refresh_expires_in ?? 0) * 1000
  }
}

export function exchangeCode(cfg: TikTokAppConfig, code: string, verifier: string): Promise<TikTokTokens> {
  return tokenRequest(cfg, { code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code_verifier: verifier })
}

export function refreshTokens(cfg: TikTokAppConfig, refreshToken: string): Promise<TikTokTokens> {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/**
 * Abre um servidor local para receber o retorno do login (direto ou via página de retorno que
 * repassa ?code&state para http://127.0.0.1:<porta>/callback). Resolve com o code.
 */
export function waitForAuthCode(port: number, expectedState: string, timeoutMs = 5 * 60_000): { promise: Promise<string>; close: () => void } {
  let server: Server | null = null
  let timer: NodeJS.Timeout | null = null
  const close = () => {
    if (timer) clearTimeout(timer)
    server?.close()
    server = null
  }
  const promise = new Promise<string>((resolve, reject) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end()
        return
      }
      const page = (title: string, text: string) =>
        `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#111318;color:#e8eaf0;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${title}</h1><p>${text}</p></div></body>`
      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (err || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Não conectado', 'O TikTok não autorizou. Volte ao BigLoop e tente de novo.'))
        reject(new TikTokError(err === 'access_denied' ? 'Você cancelou o login no TikTok.' : `O TikTok recusou o login (${err ?? 'sem código'}).`, err ?? 'sem_codigo'))
        return close()
      }
      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Erro de segurança', 'O retorno do login não confere. Tente de novo pelo BigLoop.'))
        reject(new TikTokError('O retorno do login não confere (state). Tente de novo.', 'state'))
        return close()
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Conectado ✓', 'Pode fechar esta aba e voltar ao BigLoop AutoClips.'))
      resolve(code)
      close()
    })
    server.on('error', (e: NodeJS.ErrnoException) => {
      reject(new TikTokError(e.code === 'EADDRINUSE' ? `A porta ${port} está em uso. Feche outros programas ou mude a porta.` : e.message, 'porta'))
      close()
    })
    server.listen(port, '127.0.0.1')
    timer = setTimeout(() => {
      reject(new TikTokError('O login no TikTok demorou demais. Tente de novo.', 'tempo'))
      close()
    }, timeoutMs)
  })
  // Evita "rejeição não tratada" se o retorno chegar antes de alguém aguardar a promessa
  promise.catch(() => undefined)
  return { promise, close }
}

export interface CreatorInfo {
  username: string
  nickname: string
  avatarUrl: string | null
  privacyOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
}

export interface DirectPostInfo {
  title: string
  privacyLevel: string
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  coverTimestampMs?: number
  brandContent?: boolean
  brandOrganic?: boolean
  isAigc?: boolean
}

export interface PublishStatus {
  status: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED' | string
  failReason: string | null
  postIds: string[]
}

const MB = 1024 * 1024

/** Divide o arquivo em partes como o TikTok exige (5–64 MB; a última absorve o resto; < 5 MB vai inteiro). */
export function chunkPlan(size: number, preferred = 10 * MB, min = 5 * MB): { chunkSize: number; count: number } {
  if (size <= 0) throw new TikTokError('Arquivo vazio.', 'invalid_file_upload')
  if (size < min) return { chunkSize: size, count: 1 }
  const chunkSize = Math.min(Math.max(preferred, min), 64 * MB)
  return { chunkSize, count: Math.max(1, Math.floor(size / chunkSize)) }
}

export class TikTokClient {
  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly opts: { api?: string; fetchImpl?: typeof fetch; chunkSize?: number; minChunk?: number } = {}
  ) {}

  private async call(path: string, body?: unknown, method = 'POST'): Promise<Record<string, any>> {
    const f = this.opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await f(`${this.opts.api ?? TIKTOK.api}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.getAccessToken()}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch (err) {
      throw new TikTokError(`Sem conexão com o TikTok (${(err as Error).message}).`, 'rede')
    }
    const data = await json(res)
    const code = data?.error?.code
    if (!res.ok || (code && code !== 'ok')) throw apiError(data, res.status)
    return data.data ?? {}
  }

  async userInfo(): Promise<{ openId: string; displayName: string; avatarUrl: string | null }> {
    const d = await this.call('/v2/user/info/?fields=open_id,display_name,avatar_url', undefined, 'GET')
    return { openId: d.user?.open_id ?? '', displayName: d.user?.display_name ?? '', avatarUrl: d.user?.avatar_url ?? null }
  }

  async creatorInfo(): Promise<CreatorInfo> {
    const d = await this.call('/v2/post/publish/creator_info/query/', {})
    return {
      username: d.creator_username ?? '',
      nickname: d.creator_nickname ?? '',
      avatarUrl: d.creator_avatar_url ?? null,
      privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [],
      commentDisabled: !!d.comment_disabled,
      duetDisabled: !!d.duet_disabled,
      stitchDisabled: !!d.stitch_disabled,
      maxDurationSec: Number(d.max_video_post_duration_sec ?? 600)
    }
  }

  private async upload(uploadUrl: string, file: string, size: number, plan: { chunkSize: number; count: number }, onProgress?: (r: number) => void): Promise<void> {
    const f = this.opts.fetchImpl ?? fetch
    const fh = await open(file, 'r')
    try {
      for (let i = 0; i < plan.count; i++) {
        const start = i * plan.chunkSize
        const end = i === plan.count - 1 ? size - 1 : start + plan.chunkSize - 1
        const buf = Buffer.alloc(end - start + 1)
        await fh.read(buf, 0, buf.length, start)
        let res: Response
        try {
          res = await f(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
            body: buf
          })
        } catch (err) {
          throw new TikTokError(`O envio para o TikTok caiu (${(err as Error).message}).`, 'rede')
        }
        if (![200, 201, 206].includes(res.status)) throw new TikTokError(`O TikTok recusou a parte ${i + 1} do vídeo (${res.status}).`, 'invalid_file_upload')
        onProgress?.((end + 1) / size)
      }
    } finally {
      await fh.close()
    }
  }

  private async sourceInfo(file: string) {
    const size = (await stat(file)).size
    const plan = chunkPlan(size, this.opts.chunkSize, this.opts.minChunk)
    return { size, plan, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count } }
  }

  /** Envia para os rascunhos (caixa de entrada) do TikTok. */
  async uploadToInbox(file: string, onProgress?: (r: number) => void): Promise<string> {
    const { size, plan, source_info } = await this.sourceInfo(file)
    const d = await this.call('/v2/post/publish/inbox/video/init/', { source_info })
    await this.upload(d.upload_url, file, size, plan, onProgress)
    return d.publish_id
  }

  /** Postagem direta (exige consentimento explícito do usuário na interface, a cada post). */
  async directPost(file: string, info: DirectPostInfo, onProgress?: (r: number) => void): Promise<string> {
    if (!info.privacyLevel) throw new TikTokError('Escolha quem pode ver o vídeo.', 'privacidade')
    const { size, plan, source_info } = await this.sourceInfo(file)
    const d = await this.call('/v2/post/publish/video/init/', {
      post_info: {
        title: info.title.slice(0, 2200),
        privacy_level: info.privacyLevel,
        disable_comment: info.disableComment,
        disable_duet: info.disableDuet,
        disable_stitch: info.disableStitch,
        video_cover_timestamp_ms: info.coverTimestampMs ?? 1000,
        brand_content_toggle: !!info.brandContent,
        brand_organic_toggle: !!info.brandOrganic,
        is_aigc: !!info.isAigc
      },
      source_info
    })
    await this.upload(d.upload_url, file, size, plan, onProgress)
    return d.publish_id
  }

  async status(publishId: string): Promise<PublishStatus> {
    const d = await this.call('/v2/post/publish/status/fetch/', { publish_id: publishId })
    return {
      status: d.status ?? 'PROCESSING_UPLOAD',
      failReason: d.fail_reason ?? null,
      postIds: Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id.map(String) : []
    }
  }

  /** Visualizações/curtidas/comentários/compartilhamentos (escopo video.list). */
  async videoStats(ids: string[]): Promise<Record<string, { views: number; likes: number; comments: number; shares: number }>> {
    if (!ids.length) return {}
    const d = await this.call('/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count', { filters: { video_ids: ids.slice(0, 20) } })
    const out: Record<string, { views: number; likes: number; comments: number; shares: number }> = {}
    for (const v of d.videos ?? []) out[String(v.id)] = { views: Number(v.view_count ?? 0), likes: Number(v.like_count ?? 0), comments: Number(v.comment_count ?? 0), shares: Number(v.share_count ?? 0) }
    return out
  }

  /** Espera o TikTok terminar de processar (ou falhar). */
  async waitDone(publishId: string, opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PublishStatus> {
    const until = Date.now() + (opts.timeoutMs ?? 5 * 60_000)
    for (;;) {
      const st = await this.status(publishId)
      if (st.status === 'FAILED') throw new TikTokError(FRIENDLY[st.failReason ?? ''] ?? `O TikTok não aceitou o vídeo (${st.failReason ?? 'sem motivo'}).`, st.failReason ?? 'FAILED')
      if (st.status === 'SEND_TO_USER_INBOX' || st.status === 'PUBLISH_COMPLETE') return st
      if (Date.now() > until || opts.signal?.aborted) return st
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 3000))
    }
  }
}

/** Mantém os tokens válidos (renova antes de expirar) e avisa quando mudam, para salvar. */
export class TikTokSession {
  constructor(
    private cfg: TikTokAppConfig,
    private tokens: TikTokTokens | null,
    private readonly onTokens: (t: TikTokTokens | null) => void
  ) {}

  get connected(): boolean {
    return !!this.tokens && this.tokens.refreshExpiresAt > Date.now()
  }

  setConfig(cfg: TikTokAppConfig): void {
    this.cfg = cfg
  }

  setTokens(t: TikTokTokens | null): void {
    this.tokens = t
    this.onTokens(t)
  }

  async accessToken(): Promise<string> {
    if (!this.tokens) throw new TikTokError('Conecte sua conta do TikTok em Configurações → Contas.', 'desconectado')
    if (this.tokens.expiresAt - 60_000 > Date.now()) return this.tokens.accessToken
    if (this.tokens.refreshExpiresAt < Date.now()) {
      this.setTokens(null)
      throw new TikTokError('A conexão com o TikTok expirou. Conecte de novo.', 'access_token_invalid')
    }
    this.setTokens(await refreshTokens(this.cfg, this.tokens.refreshToken))
    return this.tokens!.accessToken
  }

  client(opts: ConstructorParameters<typeof TikTokClient>[1] = {}): TikTokClient {
    return new TikTokClient(() => this.accessToken(), { api: this.cfg.api, fetchImpl: this.cfg.fetchImpl, ...opts })
  }
}
