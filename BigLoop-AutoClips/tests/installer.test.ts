import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadFile, installFfmpeg, installWhisper, installWhisperGpu, type InstallUrls } from '../src/main/installer'

const dir = join(__dirname, '.tmp-installer')
const files = new Map<string, { body: Buffer; headers?: Record<string, string>; status?: number; truncate?: boolean }>()
let server: Server
let base = ''

function zipWith(name: string, entries: Record<string, string>): Buffer {
  const src = join(dir, `src-${name}`)
  rmSync(src, { recursive: true, force: true })
  for (const [p, content] of Object.entries(entries)) {
    mkdirSync(join(src, p, '..'), { recursive: true })
    writeFileSync(join(src, p), content)
    chmodSync(join(src, p), 0o755)
  }
  const out = join(dir, `${name}.zip`)
  rmSync(out, { force: true })
  spawnSync('zip', ['-q', '-r', out, '.'], { cwd: src })
  return readFileSync(out)
}

const urls = (): InstallUrls => ({
  whisperReleaseApi: `${base}/api/latest`,
  whisperZipFallback: `${base}/fallback.zip`,
  modelBase: `${base}/models`,
  ffmpegZip: `${base}/ffmpeg.zip`,
  whisperGpuZipFallback: `${base}/gpu-quebrado.zip`
})

describe.skipIf(process.platform === 'win32' || spawnSync('zip', ['-v']).status !== 0)('Instalação automática (servidor local)', () => {
  beforeAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const fakeCli = '#!/bin/sh\necho "usage: whisper-cli [options] file0.wav"\n'
    files.set('/whisper-bin-x64.zip', { body: zipWith('w', { 'Release/whisper-cli': fakeCli, 'Release/ggml.dll': 'x' }) })
    files.set('/api/latest', {
      body: Buffer.from(
        JSON.stringify({
          assets: [
            { name: 'whisper-bin-x64.zip', browser_download_url: '__BASE__/whisper-bin-x64.zip' },
            { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: '__BASE__/whisper-cublas.zip' }
          ]
        })
      )
    })
    files.set('/whisper-cublas.zip', { body: zipWith('g', { 'Release/whisper-cli': fakeCli, 'Release/cublas64_12.dll': 'x' }) })
    files.set('/gpu-quebrado.zip', { body: zipWith('q', { 'Release/whisper-cli': '#!/bin/sh\necho "CUDA driver version is insufficient" >&2\nexit 1\n' }) })
    const model = Buffer.alloc(300_000, 7)
    files.set('/models/ggml-base.bin', { body: model, headers: { 'x-linked-etag': `"${createHash('sha256').update(model).digest('hex')}"` } })
    files.set('/models/ggml-small.bin', { body: Buffer.alloc(1000, 1), headers: { 'x-linked-etag': `"${'0'.repeat(64)}"` } })
    files.set('/ffmpeg.zip', { body: zipWith('f', { 'ffmpeg-7.1-essentials_build/bin/ffmpeg': '#!/bin/sh\necho ffmpeg version 7.1\n', 'ffmpeg-7.1-essentials_build/bin/ffprobe': '#!/bin/sh\necho ok\n' }) })
    files.set('/curto', { body: Buffer.alloc(100, 1), headers: { 'content-length': '5000' }, truncate: true })
    server = createServer((req, res) => {
      const f = files.get(req.url ?? '')
      if (!f) return res.writeHead(404).end('não achei')
      const body = Buffer.from(f.body.toString('latin1').replaceAll('__BASE__', base), 'latin1')
      const real = req.url === '/api/latest' ? body : f.body
      res.writeHead(f.status ?? 200, { 'content-length': String(real.length), ...f.headers })
      if (f.truncate) {
        res.write(real)
        return setTimeout(() => res.destroy(), 50)
      }
      res.end(real)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('instala whisper.cpp (achando o zip pela API) e o modelo, conferindo o SHA-256', async () => {
    const labels: string[] = []
    const r = await installWhisper('base', { baseDir: join(dir, 'app'), urls: urls(), platform: 'linux', onProgress: (l) => labels.push(l) })
    expect(r.whisperPath).toMatch(/whisper-cli$/)
    expect(existsSync(r.modelPath)).toBe(true)
    expect(labels.some((l) => l.startsWith('Baixando o whisper'))).toBe(true)
    expect(labels.at(-1)).toBe('Pronto')
    // segunda vez não baixa o binário de novo
    rmSync(join(dir, 'app', 'whisper', 'models'), { recursive: true })
    const again = await installWhisper('base', { baseDir: join(dir, 'app'), urls: urls(), platform: 'linux' })
    expect(again.whisperPath).toBe(r.whisperPath)
  })

  it('recusa modelo com SHA-256 diferente', async () => {
    await expect(installWhisper('small', { baseDir: join(dir, 'app'), urls: urls(), platform: 'linux' })).rejects.toThrow(/não confere/)
    expect(existsSync(join(dir, 'app', 'whisper', 'models', 'ggml-small.bin'))).toBe(false)
  })

  it('download incompleto e 404 dão erro claro e não deixam lixo', async () => {
    await expect(downloadFile(`${base}/curto`, join(dir, 'x.bin'))).rejects.toThrow(/interrompido|incompleto/)
    expect(existsSync(join(dir, 'x.bin.part'))).toBe(false)
    await expect(downloadFile(`${base}/nao-existe`, join(dir, 'y.bin'))).rejects.toThrow(/404/)
  })

  it('instala o FFmpeg', async () => {
    const r = await installFfmpeg({ baseDir: join(dir, 'app'), urls: urls(), platform: 'linux' })
    expect(r.ffmpegPath).toMatch(/bin\/ffmpeg$/)
    expect(r.ffprobePath).toMatch(/bin\/ffprobe$/)
  })

  it('versão para placa de vídeo: acha o zip CUDA pela API e instala em pasta separada', async () => {
    const exe = await installWhisperGpu({ baseDir: join(dir, 'gpu'), urls: urls(), platform: 'linux' })
    expect(exe).toMatch(/bin-gpu.*whisper-cli$/)
    expect(existsSync(join(dir, 'gpu', 'whisper', 'bin-gpu', 'Release', 'cublas64_12.dll'))).toBe(true)
  })

  it('versão para placa de vídeo que não abre: erro claro e apaga a pasta', async () => {
    const api = files.get('/api/latest')!
    files.set('/api/latest', { body: Buffer.from('{"assets":[]}') })
    try {
      await expect(installWhisperGpu({ baseDir: join(dir, 'gpu2'), urls: urls(), platform: 'linux' })).rejects.toThrow(/placa de vídeo não abriu/)
      expect(existsSync(join(dir, 'gpu2', 'whisper', 'bin-gpu'))).toBe(false)
    } finally {
      files.set('/api/latest', api)
    }
  })

  it('fora do Windows sem URLs de teste explica que é só para Windows', async () => {
    await expect(installWhisper('base', { baseDir: dir, platform: 'linux' })).rejects.toThrow(/só para Windows/)
  })
})
