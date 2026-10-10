import type { AudioStreamInfo, CutRequest, MediaMetadata, VideoStreamInfo } from './types'

/** Monta os argumentos do FFmpeg para um corte. Não toca no disco. */
export function buildCutArgs(req: CutRequest, outputPath: string): string[] {
  const duration = (req.endSec - req.startSec).toFixed(3)
  const args = ['-hide_banner', '-nostdin', '-n', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats']
  // -ss antes de -i: busca rápida; com reencode o FFmpeg moderno ainda corta no frame exato.
  args.push('-ss', req.startSec.toFixed(3), '-i', req.inputPath, '-t', duration)
  args.push('-map', '0:v:0?')
  if (req.includeAudio) args.push('-map', '0:a:0?')
  else args.push('-an')
  if (req.mode === 'precise') {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')
    if (req.includeAudio) args.push('-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
  }
  args.push('-movflags', '+faststart', '-sn', '-dn', outputPath)
  return args
}

export const FFPROBE_ARGS = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams']

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n : null
}

/** Converte "30000/1001" em 29.97. */
export function parseFrameRate(rate: unknown): number | null {
  if (typeof rate !== 'string') return null
  const [a, b] = rate.split('/').map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0 || a === 0) return null
  return Math.round((a / b) * 100) / 100
}

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  sample_rate?: string
  channels?: number
  duration?: string
  disposition?: { attached_pic?: number }
}

/** Interpreta a saída JSON do ffprobe. Lança erro se não houver vídeo nem áudio. */
export function parseProbeOutput(json: string, path: string, fileName: string, sizeBytes: number): MediaMetadata {
  let data: { format?: Record<string, unknown>; streams?: ProbeStream[] }
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('O ffprobe retornou uma resposta inválida.')
  }
  const streams = data.streams ?? []
  const format = data.format ?? {}
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = streams.find((s) => s.codec_type === 'audio')
  if (!v && !a) throw new Error('O arquivo não contém faixas de vídeo nem de áudio reconhecíveis.')

  const video: VideoStreamInfo | null = v
    ? {
        codec: v.codec_name ?? 'desconhecido',
        width: v.width ?? 0,
        height: v.height ?? 0,
        fps: parseFrameRate(v.avg_frame_rate) ?? parseFrameRate(v.r_frame_rate)
      }
    : null
  const audio: AudioStreamInfo | null = a
    ? { codec: a.codec_name ?? 'desconhecido', sampleRate: num(a.sample_rate), channels: a.channels ?? null }
    : null

  const durationSec = num(format.duration) ?? num(v?.duration) ?? num(a?.duration) ?? 0
  return {
    path,
    fileName,
    sizeBytes,
    durationSec,
    formatName: typeof format.format_long_name === 'string' ? format.format_long_name : String(format.format_name ?? ''),
    bitRate: num(format.bit_rate),
    video,
    audio
  }
}

/**
 * Lê um bloco da saída de "-progress pipe:1" e devolve os segundos processados
 * (último out_time_us/out_time_ms encontrado), ou null.
 */
export function parseProgressChunk(chunk: string): number | null {
  let latest: number | null = null
  for (const line of chunk.split(/\r?\n/)) {
    const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim())
    if (m) latest = Number(m[1]) / 1_000_000 // ambos são microssegundos no FFmpeg
  }
  return latest
}

/** Remove caracteres inválidos em nomes de arquivo do Windows. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i
  const safe = cleaned === '' || reserved.test(cleaned) ? `_${cleaned}` : cleaned
  return safe.slice(0, 150)
}
