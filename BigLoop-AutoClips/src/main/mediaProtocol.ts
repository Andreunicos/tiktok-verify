import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

export const MEDIA_SCHEME = 'bigloop-media'

/** Somente arquivos importados pelo usuário podem ser servidos ao renderer. */
const allowed = new Set<string>()
export const allowMediaPath = (p: string) => allowed.add(p)

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } }
  ])
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4'
}

/** Serve arquivos locais com suporte a Range (necessário para o player buscar posições). */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = new URL(request.url).searchParams.get('p') ?? ''
    if (!allowed.has(filePath)) return new Response('Proibido', { status: 403 })
    const info = await stat(filePath).catch(() => null)
    if (!info) return new Response('Não encontrado', { status: 404 })

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (!range) {
      const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': String(info.size), 'Accept-Ranges': 'bytes' }
      })
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } })
    }
    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
