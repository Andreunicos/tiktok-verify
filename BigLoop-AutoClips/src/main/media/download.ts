import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/**
 * Baixa lives/vídeos por link com o yt-dlp (Twitch, YouTube, Kick e centenas de outros sites),
 * já pedindo o chat junto quando o site oferece (Twitch "rechat", YouTube "live_chat").
 * Não importa `electron`: testável com Vitest.
 */

const CHAT_SUFFIXES = ['.rechat.json', '.live_chat.json', '.chat.json', '.chat.txt']

/** Acha o arquivo de chat salvo ao lado do vídeo (mesmo nome + sufixo conhecido). */
export function findChatFile(videoPath: string): string | null {
  const dir = dirname(videoPath)
  const base = basename(videoPath, extname(videoPath))
  for (const suf of CHAT_SUFFIXES) {
    const p = join(dir, base + suf)
    if (existsSync(p)) return p
  }
  // yt-dlp às vezes inclui o idioma: "nome.rechat.json" ou "nome.pt.live_chat.json"
  try {
    const hit = readdirSync(dir).find((f) => f.startsWith(`${base}.`) && /(rechat|live_chat|chat)\.(json|txt)$/i.test(f))
    return hit ? join(dir, hit) : null
  } catch {
    return null
  }
}

export function isLikelyUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(s.trim())
}

export interface DownloadOptions {
  ytdlp: string
  /** Pasta do FFmpeg (o yt-dlp usa para juntar vídeo e áudio). */
  ffmpegDir?: string
  outDir: string
  signal?: AbortSignal
  onProgress?: (label: string, ratio: number) => void
  /** Altura máxima do vídeo (padrão 1080). */
  maxHeight?: number
}

export function buildDownloadArgs(url: string, o: Pick<DownloadOptions, 'ffmpegDir' | 'outDir' | 'maxHeight'>): string[] {
  const h = o.maxHeight ?? 1080
  return [
    '--newline',
    '--progress', // o --print abaixo liga o modo silencioso; isto mantém o progresso
    '--no-playlist',
    '--no-mtime',
    '--no-part',
    '-f', `bv*[height<=${h}]+ba/b[height<=${h}]/b`,
    '--merge-output-format', 'mp4',
    ...(o.ffmpegDir ? ['--ffmpeg-location', o.ffmpegDir] : []),
    '--write-subs', '--sub-langs', 'rechat,live_chat',
    '-o', join(o.outDir, '%(title).80B [%(id)s].%(ext)s'),
    '--print', 'after_move:filepath',
    url.trim()
  ]
}

/** Lê o progresso do yt-dlp ("[download]  42.0% of ..."). */
export function parseYtDlpProgress(line: string): number | null {
  const m = /\[download\]\s+([\d.]+)%/.exec(line)
  return m ? Math.min(1, Number(m[1]) / 100) : null
}

export class DownloadError extends Error {}

/** Baixa e devolve o caminho do vídeo e do chat (se veio). */
export async function downloadVideo(url: string, o: DownloadOptions): Promise<{ videoPath: string; chatPath: string | null }> {
  if (!isLikelyUrl(url)) throw new DownloadError('Isso não parece um link. Cole o endereço completo (começando com https://).')
  await mkdir(o.outDir, { recursive: true })
  const args = buildDownloadArgs(url, o)
  return new Promise((resolve, reject) => {
    const child = spawn(o.ytdlp, args, { windowsHide: true })
    const onAbort = () => child.kill()
    o.signal?.addEventListener('abort', onAbort, { once: true })
    let partial = ''
    let lastPath = ''
    let errTail = ''
    let parts = 0
    const onLine = (line: string) => {
      const p = parseYtDlpProgress(line)
      if (p !== null) {
        if (p < 0.01) parts++
        o.onProgress?.(parts > 1 ? 'Baixando o áudio' : 'Baixando a live', p)
      } else if (/\[Merger\]|Merging formats/.test(line)) o.onProgress?.('Juntando vídeo e áudio', 1)
      else if (/\.(mp4|mkv|webm|mov)$/i.test(line.trim()) && existsSync(line.trim())) lastPath = line.trim()
    }
    child.stdout.on('data', (d: Buffer) => {
      const lines = (partial + d.toString()).split(/\r?\n/)
      partial = lines.pop() ?? ''
      lines.forEach(onLine)
    })
    child.stderr.on('data', (d: Buffer) => (errTail = (errTail + d.toString()).slice(-1500)))
    child.on('error', (err) => reject(new DownloadError(`Não deu para abrir o baixador (yt-dlp): ${err.message}`)))
    child.on('close', (code) => {
      o.signal?.removeEventListener('abort', onAbort)
      if (partial) onLine(partial)
      if (o.signal?.aborted) return reject(new DownloadError('Download cancelado.'))
      if (code !== 0 || !lastPath) {
        const last = errTail.trim().split('\n').filter((l) => /ERROR/.test(l)).pop() ?? errTail.trim().split('\n').pop() ?? `código ${code}`
        const friendly = /Private|members|subscriber/i.test(last)
          ? 'Esse vídeo é privado ou só para membros/inscritos.'
          : /Unsupported URL/i.test(last)
            ? 'Esse site não é suportado.'
            : /not available|removed|404/i.test(last)
              ? 'O vídeo não está disponível (apagado ou ainda processando).'
              : last.replace(/^ERROR:\s*/, '')
        return reject(new DownloadError(`Não deu para baixar: ${friendly}`))
      }
      resolve({ videoPath: lastPath, chatPath: findChatFile(lastPath) })
    })
  })
}
