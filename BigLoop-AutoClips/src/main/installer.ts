import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type WhisperModel = 'base' | 'small'

export const MODEL_INFO: Record<WhisperModel, { label: string; approxMB: number }> = {
  base: { label: 'Rápido (modelo base, ~150 MB)', approxMB: 148 },
  small: { label: 'Mais preciso (modelo small, ~470 MB)', approxMB: 466 }
}

export interface InstallUrls {
  /** API da última versão do whisper.cpp (para achar o zip do Windows). */
  whisperReleaseApi: string
  /** Zip usado se a API falhar. */
  whisperZipFallback: string
  modelBase: string
  ffmpegZip: string
  /** Zip do whisper.cpp para placa NVIDIA (CUDA), usado se a API falhar. */
  whisperGpuZipFallback?: string
}

export const DEFAULT_URLS: InstallUrls = {
  whisperReleaseApi: 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest',
  whisperZipFallback: 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip',
  modelBase: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main',
  ffmpegZip: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  whisperGpuZipFallback: 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-cublas-12.4.0-bin-x64.zip'
}

export interface InstallProgress {
  (label: string, ratio: number): void
}

export interface InstallContext {
  baseDir: string
  signal?: AbortSignal
  onProgress?: InstallProgress
  urls?: InstallUrls
  /** Permite testar o fluxo do Windows em outros sistemas. */
  platform?: NodeJS.Platform
  fetchImpl?: typeof fetch
}

class InstallError extends Error {}

/**
 * Baixa um arquivo com progresso, para um .part e renomeia no fim.
 * Se o servidor informar o SHA-256 (cabeçalho x-linked-etag do Hugging Face), confere.
 */
export async function downloadFile(
  url: string,
  dest: string,
  opts: { signal?: AbortSignal; onProgress?: (received: number, total: number | null) => void; minBytes?: number; fetchImpl?: typeof fetch } = {}
): Promise<string> {
  const f = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await f(url, { signal: opts.signal, redirect: 'follow', headers: { 'User-Agent': 'BigLoop-AutoClips' } })
  } catch (err) {
    if (opts.signal?.aborted) throw new InstallError('Download cancelado.')
    throw new InstallError(`Sem conexão para baixar ${new URL(url).host} (${(err as Error).message}).`)
  }
  if (!res.ok || !res.body) throw new InstallError(`O servidor respondeu ${res.status} ao baixar ${url}.`)
  const total = Number(res.headers.get('content-length')) || null
  const etag = (res.headers.get('x-linked-etag') ?? '').replace(/"/g, '')
  const expectedSha = /^[0-9a-f]{64}$/i.test(etag) ? etag.toLowerCase() : null
  await mkdir(join(dest, '..'), { recursive: true })
  const part = `${dest}.part`
  const hash = createHash('sha256')
  let received = 0
  let lastReport = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    hash.update(chunk)
    if (Date.now() - lastReport > 200) {
      lastReport = Date.now()
      opts.onProgress?.(received, total)
    }
  })
  try {
    await pipeline(body, createWriteStream(part), { signal: opts.signal })
  } catch (err) {
    await rm(part, { force: true })
    if (opts.signal?.aborted) throw new InstallError('Download cancelado.')
    throw new InstallError(`O download foi interrompido (${(err as Error).message}).`)
  }
  opts.onProgress?.(received, total)
  if (total !== null && received !== total) {
    await rm(part, { force: true })
    throw new InstallError('O download veio incompleto. Tente de novo.')
  }
  if (opts.minBytes && received < opts.minBytes) {
    await rm(part, { force: true })
    throw new InstallError('O arquivo baixado é pequeno demais (o servidor pode ter mandado uma página de erro).')
  }
  if (expectedSha && hash.digest('hex') !== expectedSha) {
    await rm(part, { force: true })
    throw new InstallError('O arquivo baixado não confere (SHA-256 diferente). Tente de novo.')
  }
  await rm(dest, { force: true })
  await rename(part, dest)
  return dest
}

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out = (out + d).slice(-4000)))
    child.stderr.on('data', (d) => (out = (out + d).slice(-4000)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
  })
}

/** Extrai um .zip (Windows 10+: tar.exe embutido; outros: unzip). */
export async function extractZip(zip: string, destDir: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  const r = platform === 'win32' ? await run('tar', ['-xf', zip, '-C', destDir]) : await run('unzip', ['-q', '-o', zip, '-d', destDir])
  if (r.code !== 0) throw new InstallError(`Não foi possível extrair ${zip}: ${r.out.trim().split('\n').pop()}`)
}

/** Procura um arquivo (por nome, sem diferenciar maiúsculas) dentro de uma pasta. */
export async function findFile(dir: string, names: string[]): Promise<string | null> {
  const wanted = names.map((n) => n.toLowerCase())
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const n of wanted) {
    const e = entries.find((x) => x.isFile() && x.name.toLowerCase() === n)
    if (e) return join(e.parentPath ?? (e as unknown as { path: string }).path, e.name)
  }
  return null
}

async function whisperZipUrl(urls: InstallUrls, f: typeof fetch, name = /^whisper-bin-x64\.zip$/i, fallback = urls.whisperZipFallback): Promise<string> {
  try {
    const res = await f(urls.whisperReleaseApi, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BigLoop-AutoClips' } })
    if (res.ok) {
      const data = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] }
      const asset = data.assets?.find((a) => name.test(a.name))
      if (asset) return asset.browser_download_url
    }
  } catch {
    // usa o link fixo
  }
  return fallback
}

/**
 * Instala o whisper.cpp + modelo dentro da pasta do app. Retorna os caminhos para salvar nas configurações.
 * Só baixa o que falta; pode ser chamado de novo para trocar de modelo.
 */
export async function installWhisper(model: WhisperModel, ctx: InstallContext): Promise<{ whisperPath: string; modelPath: string }> {
  const platform = ctx.platform ?? process.platform
  if (platform !== 'win32' && !ctx.urls) throw new InstallError('A instalação automática do whisper.cpp é só para Windows. Em outros sistemas, instale e aponte o caminho.')
  const urls = ctx.urls ?? DEFAULT_URLS
  const f = ctx.fetchImpl ?? fetch
  const dir = join(ctx.baseDir, 'whisper')
  const exeNames = platform === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'main']
  const p = ctx.onProgress ?? (() => undefined)

  let whisperPath = existsSync(join(dir, 'bin')) ? await findFile(join(dir, 'bin'), exeNames) : null
  if (!whisperPath) {
    const zipUrl = await whisperZipUrl(urls, f)
    const zip = join(dir, 'whisper.zip')
    await downloadFile(zipUrl, zip, { signal: ctx.signal, fetchImpl: f, minBytes: ctx.urls ? 1 : 100_000, onProgress: (r, t) => p('Baixando o whisper.cpp', t ? r / t : 0) })
    p('Extraindo o whisper.cpp', 1)
    await extractZip(zip, join(dir, 'bin'), platform)
    await rm(zip, { force: true })
    whisperPath = await findFile(join(dir, 'bin'), exeNames)
    if (!whisperPath) throw new InstallError('O pacote do whisper.cpp não tem o whisper-cli. Talvez o formato da versão mudou; instale manualmente.')
    if (platform !== 'win32') await chmod(whisperPath, 0o755)
  }
  const check = await run(whisperPath, ['-h']).catch((e: Error) => ({ code: -1, out: e.message }))
  if (!/usage|options/i.test(check.out))
    throw new InstallError(
      `O whisper.cpp foi baixado mas não abriu (${check.out.trim().split('\n').pop() ?? check.code}). No Windows pode faltar o “Microsoft Visual C++ Redistributable”.`
    )

  const modelPath = join(dir, 'models', `ggml-${model}.bin`)
  const known = await stat(modelPath).catch(() => null)
  if (!known || known.size < MODEL_INFO[model].approxMB * 0.9 * 1024 * 1024) {
    await downloadFile(`${urls.modelBase}/ggml-${model}.bin`, modelPath, {
      signal: ctx.signal,
      fetchImpl: f,
      minBytes: ctx.urls ? 1 : 50 * 1024 * 1024,
      onProgress: (r, t) => p(`Baixando o modelo de fala (${Math.round(r / 1024 / 1024)} MB${t ? ` de ${Math.round(t / 1024 / 1024)} MB` : ''})`, t ? r / t : 0)
    })
  }
  p('Pronto', 1)
  return { whisperPath, modelPath }
}

/**
 * Versão do whisper.cpp que usa a placa de vídeo NVIDIA (CUDA): transcreve várias vezes mais rápido.
 * Download grande (~500 MB, inclui as bibliotecas da NVIDIA). Se não abrir, apaga e devolve erro
 * (o app continua com a versão para processador).
 */
export async function installWhisperGpu(ctx: InstallContext): Promise<string> {
  const platform = ctx.platform ?? process.platform
  if (platform !== 'win32' && !ctx.urls) throw new InstallError('A versão para placa de vídeo é só para Windows.')
  const urls = ctx.urls ?? DEFAULT_URLS
  const f = ctx.fetchImpl ?? fetch
  const dir = join(ctx.baseDir, 'whisper', 'bin-gpu')
  const exeNames = platform === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'main']
  const p = ctx.onProgress ?? (() => undefined)
  let exe = existsSync(dir) ? await findFile(dir, exeNames) : null
  if (!exe) {
    const zipUrl = await whisperZipUrl(urls, f, /^whisper-cublas-12[\d.]*-bin-x64\.zip$/i, urls.whisperGpuZipFallback ?? DEFAULT_URLS.whisperGpuZipFallback!)
    const zip = join(ctx.baseDir, 'whisper', 'whisper-gpu.zip')
    await downloadFile(zipUrl, zip, {
      signal: ctx.signal,
      fetchImpl: f,
      minBytes: ctx.urls ? 1 : 1_000_000,
      onProgress: (r, t) => p(`Baixando a versão para placa de vídeo (${Math.round(r / 1024 / 1024)} MB${t ? ` de ${Math.round(t / 1024 / 1024)} MB` : ''})`, t ? r / t : 0)
    })
    p('Extraindo', 1)
    await extractZip(zip, dir, platform)
    await rm(zip, { force: true })
    exe = await findFile(dir, exeNames)
    if (!exe) throw new InstallError('O pacote para placa de vídeo não tem o whisper-cli.')
    if (platform !== 'win32') await chmod(exe, 0o755)
  }
  const check = await run(exe, ['-h']).catch((e: Error) => ({ code: -1, out: e.message }))
  if (!/usage|options/i.test(check.out)) {
    await rm(dir, { recursive: true, force: true })
    throw new InstallError('A versão para placa de vídeo não abriu neste PC (driver da NVIDIA antigo?). O app continua usando o processador.')
  }
  p('Pronto', 1)
  return exe
}

/** Baixa o FFmpeg (build “essentials” do gyan.dev, GPL) para a pasta do app. */
export async function installFfmpeg(ctx: InstallContext): Promise<{ ffmpegPath: string; ffprobePath: string }> {
  const platform = ctx.platform ?? process.platform
  if (platform !== 'win32' && !ctx.urls) throw new InstallError('A instalação automática do FFmpeg é só para Windows.')
  const urls = ctx.urls ?? DEFAULT_URLS
  const dir = join(ctx.baseDir, 'ffmpeg')
  const p = ctx.onProgress ?? (() => undefined)
  const zip = join(dir, 'ffmpeg.zip')
  await downloadFile(urls.ffmpegZip, zip, { signal: ctx.signal, fetchImpl: ctx.fetchImpl, minBytes: ctx.urls ? 1 : 100_000, onProgress: (r, t) => p('Baixando o FFmpeg', t ? r / t : 0) })
  p('Extraindo o FFmpeg', 1)
  await extractZip(zip, join(dir, 'bin'), platform)
  await rm(zip, { force: true })
  const ext = platform === 'win32' ? '.exe' : ''
  const ffmpegPath = await findFile(join(dir, 'bin'), [`ffmpeg${ext}`])
  const ffprobePath = await findFile(join(dir, 'bin'), [`ffprobe${ext}`])
  if (!ffmpegPath || !ffprobePath) throw new InstallError('O pacote baixado não tem ffmpeg/ffprobe.')
  if (platform !== 'win32') await Promise.all([chmod(ffmpegPath, 0o755), chmod(ffprobePath, 0o755)])
  const check = await run(ffmpegPath, ['-version']).catch((e: Error) => ({ code: -1, out: e.message }))
  if (check.code !== 0) throw new InstallError(`O FFmpeg foi baixado mas não abriu: ${check.out.trim().split('\n').pop()}`)
  p('Pronto', 1)
  return { ffmpegPath, ffprobePath }
}

/** Baixa o yt-dlp (baixador de vídeos por link, livre) para a pasta do app. Só Windows. */
export async function installYtDlp(ctx: InstallContext & { url?: string }): Promise<string> {
  const platform = ctx.platform ?? process.platform
  if (platform !== 'win32' && !ctx.url) throw new InstallError('A instalação automática do yt-dlp é só para Windows. Em outros sistemas, instale o yt-dlp.')
  const dest = join(ctx.baseDir, 'yt-dlp', platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (existsSync(dest)) return dest
  await downloadFile(ctx.url ?? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', dest, {
    signal: ctx.signal,
    fetchImpl: ctx.fetchImpl,
    minBytes: ctx.url ? 1 : 1_000_000,
    onProgress: (r, t) => ctx.onProgress?.('Baixando o baixador de vídeos (yt-dlp, só na 1ª vez)', t ? r / t : 0)
  })
  if (platform !== 'win32') await chmod(dest, 0o755)
  return dest
}
