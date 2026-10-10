import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

/** Autenticação do obs-websocket v5: base64(sha256(base64(sha256(senha + salt)) + challenge)). */
export function obsAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64')
  return createHash('sha256').update(secret + challenge).digest('base64')
}

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 } as const
/** EventSubscription.General (1) | Outputs (64) */
const SUBSCRIPTIONS = 1 | 64

interface Pending {
  resolve: (v: Record<string, unknown>) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** Cliente mínimo do protocolo obs-websocket 5.x (OBS 28+). */
export class ObsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private pending = new Map<string, Pending>()

  connect(host: string, port: number, password: string, timeoutMs = 5000): Promise<{ obsVersion: string; wsVersion: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}:${port}`, 'obswebsocket.json')
      this.ws = ws
      let settled = false
      const fail = (msg: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ws.terminate()
        reject(new Error(msg))
      }
      const timer = setTimeout(() => fail('Tempo esgotado ao conectar no OBS. O servidor WebSocket está ativado?'), timeoutMs)
      let versions = { obsVersion: '', wsVersion: '' }
      ws.on('error', (err) => fail(`Não foi possível conectar no OBS em ${host}:${port} (${err.message}).`))
      ws.on('close', (code) => {
        if (!settled) fail(code === 4009 ? 'Senha do OBS incorreta.' : `Conexão com o OBS fechada (código ${code}).`)
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error('Conexão com o OBS perdida.'))
        }
        this.pending.clear()
        this.emit('close', code)
      })
      ws.on('message', (raw) => {
        let msg: { op: number; d: Record<string, any> }
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (msg.op === OP.Hello) {
          versions = { obsVersion: '', wsVersion: String(msg.d.obsWebSocketVersion ?? '') }
          const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: SUBSCRIPTIONS }
          if (msg.d.authentication) {
            if (!password) return fail('O OBS exige senha. Configure em Configurações → OBS.')
            identify.authentication = obsAuth(password, msg.d.authentication.salt, msg.d.authentication.challenge)
          }
          ws.send(JSON.stringify({ op: OP.Identify, d: identify }))
        } else if (msg.op === OP.Identified) {
          settled = true
          clearTimeout(timer)
          this.request('GetVersion')
            .then((v) => resolve({ ...versions, obsVersion: String(v.obsVersion ?? '') }))
            .catch(() => resolve(versions))
        } else if (msg.op === OP.Event) {
          this.emit('event', msg.d.eventType, msg.d.eventData ?? {})
        } else if (msg.op === OP.RequestResponse) {
          const p = this.pending.get(msg.d.requestId)
          if (!p) return
          clearTimeout(p.timer)
          this.pending.delete(msg.d.requestId)
          if (msg.d.requestStatus?.result) p.resolve(msg.d.responseData ?? {})
          else p.reject(new Error(`OBS recusou ${msg.d.requestType}: ${msg.d.requestStatus?.comment ?? msg.d.requestStatus?.code}`))
        }
      })
    })
  }

  request(requestType: string, requestData?: Record<string, unknown>, timeoutMs = 5000): Promise<Record<string, any>> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('OBS não está conectado.'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`OBS não respondeu a ${requestType}.`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      ws.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, requestData } }))
    })
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}

export interface ObsState {
  state: 'desligado' | 'conectando' | 'conectado' | 'erro'
  version: string | null
  recording: boolean
  recordDir: string | null
  error: string | null
  pendingMarkers: number
}

/**
 * Mantém a conexão com o OBS (reconecta sozinho), acompanha a gravação e guarda
 * marcadores feitos durante a live. Ao parar de gravar emite 'recordingFinished' com o caminho e os marcadores.
 */
export class ObsManager extends EventEmitter {
  private client: ObsClient | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private retryDelay = 2000
  private wanted = false
  private markers: { timeSec: number; label: string }[] = []
  status: ObsState = { state: 'desligado', version: null, recording: false, recordDir: null, error: null, pendingMarkers: 0 }

  constructor(private readonly config: () => { host: string; port: number; password: string }) {
    super()
  }

  start(): void {
    this.wanted = true
    void this.connect()
  }

  stop(): void {
    this.wanted = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.client?.removeAllListeners()
    this.client?.disconnect()
    this.client = null
    this.set({ state: 'desligado', error: null, recording: false })
  }

  /** Testa a conexão uma vez, sem manter. */
  static async test(host: string, port: number, password: string): Promise<string> {
    const c = new ObsClient()
    try {
      const v = await c.connect(host, port, password)
      return `OBS ${v.obsVersion || '?'} · obs-websocket ${v.wsVersion || '?'}`
    } finally {
      c.disconnect()
    }
  }

  async addMarker(label = ''): Promise<number> {
    if (!this.client || this.status.state !== 'conectado') throw new Error('OBS não está conectado.')
    const rec = await this.client.request('GetRecordStatus')
    if (!rec.outputActive) throw new Error('O OBS não está gravando.')
    const timeSec = Math.max(0, Number(rec.outputDuration ?? 0) / 1000 - 1)
    this.markers.push({ timeSec, label: label || `Marcador ${this.markers.length + 1}` })
    this.set({ pendingMarkers: this.markers.length })
    return timeSec
  }

  private set(patch: Partial<ObsState>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  private async connect(): Promise<void> {
    if (!this.wanted) return
    const { host, port, password } = this.config()
    this.set({ state: 'conectando', error: null })
    const client = new ObsClient()
    this.client = client
    client.on('event', (type: string, data: Record<string, any>) => this.onEvent(type, data))
    client.on('close', () => {
      if (this.client !== client) return
      this.set({ state: this.wanted ? 'erro' : 'desligado', recording: false, error: this.wanted ? 'Conexão perdida; tentando de novo…' : null })
      this.scheduleRetry()
    })
    try {
      const v = await client.connect(host, port, password)
      this.retryDelay = 2000
      const [rec, dir] = await Promise.all([
        client.request('GetRecordStatus').catch(() => ({ outputActive: false })),
        client.request('GetRecordDirectory').catch(() => ({ recordDirectory: null }))
      ])
      this.set({ state: 'conectado', version: v.obsVersion || null, recording: !!rec.outputActive, recordDir: dir.recordDirectory ?? null, error: null })
    } catch (err) {
      if (this.client !== client) return
      this.set({ state: 'erro', error: (err as Error).message })
      // Senha errada não adianta repetir sem parar.
      if (!/Senha/.test((err as Error).message)) this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, this.retryDelay)
    this.retryDelay = Math.min(30_000, this.retryDelay * 2)
  }

  private onEvent(type: string, data: Record<string, any>): void {
    if (type === 'RecordStateChanged') {
      if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
        this.markers = []
        this.set({ recording: true, pendingMarkers: 0 })
      } else if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        const markers = this.markers
        this.markers = []
        this.set({ recording: false, pendingMarkers: 0 })
        if (data.outputPath) this.emit('recordingFinished', { path: String(data.outputPath), markers })
      }
    } else if (type === 'ExitStarted') {
      this.set({ state: 'erro', error: 'O OBS foi fechado.' })
    }
  }
}
