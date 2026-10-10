import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { ObsClient, ObsManager, obsAuth } from '../src/main/obs'

/** Servidor obs-websocket v5 simulado. */
function fakeObs(password: string | null) {
  const wss = new WebSocketServer({ port: 0 })
  const salt = 'c2FsdA=='
  const challenge = 'Y2hhbGxlbmdl'
  const sockets: WebSocket[] = []
  let recording = false
  let duration = 0
  wss.on('connection', (ws) => {
    sockets.push(ws)
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, ...(password ? { authentication: { salt, challenge } } : {}) } }))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.op === 1) {
        if (password) {
          const secret = createHash('sha256').update(password + salt).digest('base64')
          const expected = createHash('sha256').update(secret + challenge).digest('base64')
          if (msg.d.authentication !== expected) return ws.close(4009, 'Authentication failed.')
        }
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
      } else if (msg.op === 6) {
        const data: Record<string, unknown> = {
          GetVersion: { obsVersion: '31.0.0', obsWebSocketVersion: '5.5.0' },
          GetRecordStatus: { outputActive: recording, outputDuration: duration },
          GetRecordDirectory: { recordDirectory: 'C:/Videos' }
        }
        const ok = msg.d.requestType in data
        ws.send(JSON.stringify({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: ok, code: ok ? 100 : 204 }, responseData: data[msg.d.requestType] } }))
      }
    })
  })
  const port = () => (wss.address() as { port: number }).port
  const emit = (eventType: string, eventData: unknown) => sockets.forEach((s) => s.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 64, eventData } })))
  return {
    wss, port, emit,
    startRecording(d = 0) { recording = true; duration = d; emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: null }) },
    setDuration(d: number) { duration = d },
    stopRecording(path: string) { recording = false; emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: path }) },
    close: () => new Promise<void>((r) => { sockets.forEach((s) => s.terminate()); wss.close(() => r()) })
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const servers: ReturnType<typeof fakeObs>[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close()
})

describe('OBS WebSocket', () => {
  it('autenticação conforme o protocolo', () => {
    const secret = createHash('sha256').update('senha' + 'sal').digest('base64')
    expect(obsAuth('senha', 'sal', 'desafio')).toBe(createHash('sha256').update(secret + 'desafio').digest('base64'))
  })

  it('conecta com senha e faz requisições', async () => {
    const s = fakeObs('segredo')
    servers.push(s)
    await new Promise((r) => s.wss.once('listening', r))
    const c = new ObsClient()
    const v = await c.connect('127.0.0.1', s.port(), 'segredo')
    expect(v).toEqual({ obsVersion: '31.0.0', wsVersion: '5.5.0' })
    expect(await c.request('GetRecordDirectory')).toEqual({ recordDirectory: 'C:/Videos' })
    await expect(c.request('Inexistente')).rejects.toThrow(/recusou/)
    c.disconnect()
  })

  it('senha errada, sem senha e servidor fora do ar', async () => {
    const s = fakeObs('segredo')
    servers.push(s)
    await new Promise((r) => s.wss.once('listening', r))
    await expect(new ObsClient().connect('127.0.0.1', s.port(), 'errada')).rejects.toThrow(/Senha do OBS incorreta/)
    await expect(new ObsClient().connect('127.0.0.1', s.port(), '')).rejects.toThrow(/exige senha/)
    await expect(new ObsClient().connect('127.0.0.1', 1, 'x', 1000)).rejects.toThrow(/Não foi possível conectar|Tempo esgotado/)
    await expect(ObsManager.test('127.0.0.1', s.port(), 'segredo')).resolves.toBe('OBS 31.0.0 · obs-websocket 5.5.0')
  })

  it('acompanha gravação, marcadores e fim da gravação', async () => {
    const s = fakeObs(null)
    servers.push(s)
    await new Promise((r) => s.wss.once('listening', r))
    const m = new ObsManager(() => ({ host: '127.0.0.1', port: s.port(), password: '' }))
    const finished: { path: string; markers: { timeSec: number }[] }[] = []
    m.on('recordingFinished', (f) => finished.push(f))
    m.start()
    await wait(150)
    expect(m.status).toMatchObject({ state: 'conectado', version: '31.0.0', recordDir: 'C:/Videos', recording: false })
    await expect(m.addMarker()).rejects.toThrow(/não está gravando/)
    s.startRecording()
    await wait(50)
    expect(m.status.recording).toBe(true)
    s.setDuration(65_000)
    expect(await m.addMarker('gol')).toBe(64)
    expect(m.status.pendingMarkers).toBe(1)
    s.stopRecording('C:/Videos/live.mkv')
    await wait(50)
    expect(finished).toEqual([{ path: 'C:/Videos/live.mkv', markers: [{ timeSec: 64, label: 'gol' }] }])
    m.stop()
    expect(m.status.state).toBe('desligado')
  })

  it('reconecta quando o OBS volta', async () => {
    const s = fakeObs(null)
    servers.push(s)
    await new Promise((r) => s.wss.once('listening', r))
    const port = s.port()
    const m = new ObsManager(() => ({ host: '127.0.0.1', port, password: '' }))
    m.start()
    await wait(150)
    expect(m.status.state).toBe('conectado')
    await s.close()
    servers.pop()
    await wait(100)
    expect(m.status.state).toBe('erro')
    // OBS "volta" na mesma porta
    const again = new WebSocketServer({ port })
    again.on('connection', (ws) => {
      ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1 } }))
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.op === 1) ws.send(JSON.stringify({ op: 2, d: {} }))
        if (msg.op === 6) ws.send(JSON.stringify({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { obsVersion: '31.0.0' } } }))
      })
    })
    await wait(2600)
    expect(m.status.state).toBe('conectado')
    m.stop()
    await new Promise<void>((r) => again.close(() => r()))
  })
})
