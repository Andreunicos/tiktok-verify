import { outputSize } from './presets'
import { trackExpr, zoomExpr } from './smart'
import type { AudioStreamInfo, CutRequest, ExportOptions, MediaMetadata, Quality, VideoEncoder, VideoStreamInfo } from './types'

export const OUTPUT_EXT: Record<ExportOptions['format'], string> = { mp4: 'mp4', mp3: 'mp3', wav: 'wav', gif: 'gif' }

/** Duração final do corte em segundos (soma dos intervalos ÷ velocidade). */
export function clipDuration(req: Pick<CutRequest, 'ranges' | 'options'>): number {
  return req.ranges.reduce((s, r) => s + (r.endSec - r.startSec), 0) / req.options.speed
}

const n3 = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3)

/** Cadeia de atempo (cada filtro aceita 0,5–2). */
export function atempoChain(speed: number): string[] {
  const out: string[] = []
  let s = speed
  while (s > 2) {
    out.push('atempo=2')
    s /= 2
  }
  while (s < 0.5) {
    out.push('atempo=0.5')
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${+s.toFixed(4)}`)
  return out
}

const QUALITY_LEVEL: Record<Quality, number> = { high: 0, medium: 1, small: 2 }
const AUDIO_KBPS: Record<Quality, number> = { high: 192, medium: 160, small: 128 }

/** Bitrate de vídeo (kbit/s) para caber em maxSizeMB, ou null. */
export function targetVideoKbps(maxSizeMB: number | null, durationSec: number, audioKbps: number): number | null {
  if (!maxSizeMB || durationSec <= 0) return null
  const totalKbits = maxSizeMB * 8 * 1024 * 0.95 // 5% de margem para o contêiner
  return Math.max(150, Math.floor(totalKbits / durationSec - audioKbps))
}

/** Argumentos de codificação de vídeo para cada encoder (software ou placa de vídeo). */
export function videoCodecArgs(encoder: VideoEncoder, quality: Quality, kbps: number | null): string[] {
  const q = QUALITY_LEVEL[quality]
  const rate = kbps ? ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.2)}k`, '-bufsize', `${kbps * 2}k`] : []
  switch (encoder) {
    case 'libx264':
      return ['-c:v', 'libx264', '-preset', 'veryfast', ...(kbps ? rate : ['-crf', String([18, 23, 28][q])])]
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', 'fast', '-tag:v', 'hvc1', ...(kbps ? rate : ['-crf', String([22, 27, 32][q])])]
    case 'h264_nvenc':
    case 'hevc_nvenc':
      return [
        '-c:v', encoder, '-preset', 'p5', '-rc', 'vbr',
        ...(kbps ? rate : ['-cq', String([19, 25, 30][q]), '-b:v', '0']),
        ...(encoder === 'hevc_nvenc' ? ['-tag:v', 'hvc1'] : [])
      ]
    case 'h264_qsv':
    case 'hevc_qsv':
      return ['-c:v', encoder, '-preset', 'faster', ...(kbps ? rate : ['-global_quality', String([20, 25, 30][q])]), ...(encoder === 'hevc_qsv' ? ['-tag:v', 'hvc1'] : [])]
    case 'h264_amf':
    case 'hevc_amf': {
      const qp = String([18, 23, 28][q])
      return ['-c:v', encoder, ...(kbps ? ['-rc', 'vbr_peak', ...rate] : ['-rc', 'cqp', '-qp_i', qp, '-qp_p', qp])]
    }
  }
}

/** Filtros de vídeo que ajustam a proporção (recorte, barras ou fundo desfocado). Retorna subgrafo. */
export function aspectGraph(inLabel: string, outLabel: string, o: ExportOptions, srcW: number, srcH: number, track?: { t: number; x: number }[]): string {
  if (o.aspect === 'original') return `${inLabel}scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1${outLabel}`
  const [W, H] = outputSize(o.aspect, srcW, srcH)
  // Recorte que acompanha a pessoa: posição muda ao longo do tempo (expressão avaliada a cada quadro)
  const cy = Math.min(1, Math.max(0, o.cropY)).toFixed(3)
  const cx = Math.min(1, Math.max(0, o.cropX)).toFixed(3)
  const xPos = track && track.length > 0 ? `'(iw-${W})*(${trackExpr(track)})'` : `(iw-${W})*${cx}`
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:${xPos}:(ih-${H})*${cy}`
  if (o.fit === 'crop') return `${inLabel}${cover},setsar=1${outLabel}`
  if (o.fit === 'game') {
    // Jogo em destaque: faixa ampliada 1,5× no meio (mostra ~67% da largura) sobre fundo desfocado e escurecido
    const zoom = 1.5
    const bandW = Math.round((W * zoom) / 2) * 2
    const bandH = Math.min(H, Math.round((srcH * bandW) / srcW / 2) * 2)
    return [
      `${inLabel}split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:3,eq=brightness=-0.18:saturation=1.3[bg]`,
      `[fgsrc]scale=${bandW}:${bandH},crop=${W}:${bandH}:(iw-${W})*${cx}:0[fg]`,
      `[bg][fg]overlay=0:(H-h)/2,setsar=1${outLabel}`
    ].join(';')
  }
  if (o.fit === 'pad')
    return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1${outLabel}`
  // blur: fundo ampliado e desfocado + vídeo inteiro centralizado
  return [
    `${inLabel}split=2[bgsrc][fgsrc]`,
    `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=-0.08[bg]`,
    `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${outLabel}`
  ].join(';')
}

export interface ExportCommand {
  args: string[]
  durationSec: number
}

/**
 * Monta o comando FFmpeg completo de exportação.
 * @param assFileName nome (relativo ao cwd do processo) do arquivo .ass, quando há legenda gravada.
 */
export function buildExportArgs(req: CutRequest, outputPath: string, assFileName?: string): ExportCommand {
  const o = req.options
  const duration = clipDuration(req)
  const head = ['-hide_banner', '-nostdin', '-n', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats']
  const spanStart = Math.min(...req.ranges.map((r) => r.startSec))
  const spanEnd = Math.max(...req.ranges.map((r) => r.endSec))
  const input = ['-ss', n3(spanStart), '-t', n3(spanEnd - spanStart), '-i', req.inputPath]

  const wantVideo = (o.format === 'mp4' || o.format === 'gif') && req.source.width > 0
  const hasVoice = o.includeAudio && req.source.audioTracks > 0 && o.format !== 'gif'
  const extras = o.format === 'gif' ? undefined : req.audioExtras
  const music = extras?.music
  const effects = (extras?.effects ?? []).filter((e) => e.atSec >= 0 && e.atSec < duration)
  const wantAudio = hasVoice || !!music || effects.length > 0
  // Entradas extras (depois do vídeo): música em loop e efeitos
  const extraInputs: string[] = []
  let nextInput = 1
  const musicIdx = music ? nextInput++ : -1
  if (music) extraInputs.push('-stream_loop', '-1', '-i', music.file)
  const fxIdx = effects.map((e) => {
    extraInputs.push('-i', e.file)
    return nextInput++
  })
  const trackIdx = typeof o.audioTrack === 'number' ? Math.min(Math.max(0, o.audioTrack), req.source.audioTracks - 1) : 0

  // Modo rápido: cópia de streams, um intervalo.
  if (o.mode === 'fast') {
    const r = req.ranges[0]
    const args = [...head, '-ss', n3(r.startSec), '-i', req.inputPath, '-t', n3(r.endSec - r.startSec)]
    args.push('-map', '0:v:0?')
    if (hasVoice) args.push('-map', `0:a:${trackIdx}?`)
    else args.push('-an')
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', ...metadataArgs(req), '-sn', '-dn', outputPath)
    return { args, durationSec: duration }
  }

  const graph: string[] = []
  let audioSrc = `[0:a:${trackIdx}]`
  if (hasVoice && o.audioTrack === 'mix' && req.source.audioTracks > 1) {
    const ins = Array.from({ length: req.source.audioTracks }, (_, i) => `[0:a:${i}]`).join('')
    graph.push(`${ins}amix=inputs=${req.source.audioTracks}:duration=longest:normalize=0[amix]`)
    audioSrc = '[amix]'
  }

  let vLabel = '[0:v:0]'
  let aLabel = audioSrc
  const n = req.ranges.length
  if (n > 1) {
    const rel = req.ranges.map((r) => [n3(r.startSec - spanStart), n3(r.endSec - spanStart)])
    if (wantVideo) {
      graph.push(`[0:v:0]split=${n}${rel.map((_, i) => `[vs${i}]`).join('')}`)
      rel.forEach(([a, b], i) => graph.push(`[vs${i}]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`))
    }
    if (hasVoice) {
      graph.push(`${audioSrc}asplit=${n}${rel.map((_, i) => `[as${i}]`).join('')}`)
      rel.forEach(([a, b], i) => graph.push(`[as${i}]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`))
    }
    const pads = rel.map((_, i) => `${wantVideo ? `[v${i}]` : ''}${hasVoice ? `[a${i}]` : ''}`).join('')
    graph.push(`${pads}concat=n=${n}:v=${wantVideo ? 1 : 0}:a=${hasVoice ? 1 : 0}${wantVideo ? '[vcat]' : ''}${hasVoice ? '[acat]' : ''}`)
    vLabel = '[vcat]'
    aLabel = '[acat]'
  }

  if (wantVideo) {
    const pre: string[] = []
    if (o.speed !== 1) pre.push(`setpts=PTS/${+o.speed.toFixed(4)}`)
    const aspectIn = pre.length ? '[vpre]' : vLabel
    if (pre.length) graph.push(`${vLabel}${pre.join(',')}[vpre]`)
    const visual = o.format === 'mp4' ? req.visual : undefined
    graph.push(aspectGraph(aspectIn, '[vasp]', o, req.source.width, req.source.height, o.fit === 'crop' ? visual?.track : undefined))
    const post: string[] = []
    let vNow = '[vasp]'
    const [OW, OH] = outputSize(o.aspect, req.source.width, req.source.height)
    const fps = Math.min(60, Math.max(10, Math.round(req.source.fps ?? 30)))
    if (visual?.zooms?.length && o.aspect !== 'original') {
      // Punch-in: zoom no centro em degrau (sem animação = sem tremedeira)
      graph.push(`${vNow}fps=${fps},zoompan=z='${zoomExpr(visual.zooms)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OW}x${OH}:fps=${fps}[vzoom]`)
      vNow = '[vzoom]'
    }
    if (visual?.progressBar && o.aspect !== 'original') {
      const barH = Math.max(4, Math.round(OH * 0.004))
      graph.push(`color=c=0xFFD400@0.95:s=${OW}x${barH}:r=${fps}:d=${n3(duration)},format=rgba[pbar]`, `${vNow}[pbar]overlay=x='-w+w*t/${n3(duration)}':y=H-${barH}:eof_action=pass[vbar]`)
      vNow = '[vbar]'
    }
    if (o.fadeInSec > 0) post.push(`fade=t=in:st=0:d=${n3(o.fadeInSec)}`)
    if (o.fadeOutSec > 0) post.push(`fade=t=out:st=${n3(Math.max(0, duration - o.fadeOutSec))}:d=${n3(o.fadeOutSec)}`)
    if (assFileName && o.format === 'mp4') post.push(`ass=${assFileName}`)
    if (o.format === 'gif') {
      const gifW = o.aspect === 'original' ? 'min(480\\,iw)' : '480'
      post.push('fps=12', `scale=${gifW}:-2:flags=lanczos`)
      graph.push(`${vNow}${post.join(',')},split[g1][g2]`, '[g1]palettegen=stats_mode=diff[pal]', '[g2][pal]paletteuse=dither=bayer:bayer_scale=4[vout]')
    } else {
      post.push('format=yuv420p')
      graph.push(`${vNow}${post.join(',')}[vout]`)
    }
  }

  if (wantAudio) {
    const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
    const layers: string[] = []
    if (hasVoice) {
      graph.push(`${aLabel}${[...atempoChain(o.speed), fmt].join(',')}[avoice]`)
    }
    if (music) {
      const vol = Math.min(1, Math.max(0, music.volume)).toFixed(3)
      const fadeOut = Math.min(1.5, duration / 3)
      graph.push(
        `[${musicIdx}:a:0]${fmt},atrim=duration=${n3(duration)},volume=${vol},afade=t=in:st=0:d=${n3(Math.min(1, duration / 4))},afade=t=out:st=${n3(Math.max(0, duration - fadeOut))}:d=${n3(fadeOut)}[mus]`
      )
      if (hasVoice && music.duck) {
        // Música abaixa sozinha quando há voz (a voz é a "chave" do compressor). Ratio moderado: com
        // ratio alto a música some em lives com voz alta, onde quase sempre tem alguém falando.
        graph.push('[avoice]asplit=2[vmain][vkey]', '[mus][vkey]sidechaincompress=threshold=0.01:ratio=4:attack=20:release=400:makeup=1[musd]')
        layers.push('[vmain]', '[musd]')
      } else {
        if (hasVoice) layers.push('[avoice]')
        layers.push('[mus]')
      }
    } else if (hasVoice) layers.push('[avoice]')
    effects.forEach((e, i) => {
      const ms = Math.round(e.atSec * 1000)
      graph.push(`[${fxIdx[i]}:a:0]${fmt},volume=${Math.min(2, Math.max(0, e.volume)).toFixed(3)},adelay=${ms}|${ms}[fx${i}]`)
      layers.push(`[fx${i}]`)
    })
    let mixed = layers[0]
    if (layers.length > 1) {
      // apad/atrim abaixo garantem a duração exata do corte
      graph.push(`${layers.join('')}amix=inputs=${layers.length}:duration=longest:normalize=0:dropout_transition=0[amixed]`)
      mixed = '[amixed]'
    }
    const post: string[] = [`apad=whole_dur=${n3(duration)}`, `atrim=duration=${n3(duration)}`]
    if (o.fadeInSec > 0) post.push(`afade=t=in:st=0:d=${n3(o.fadeInSec)}`)
    if (o.fadeOutSec > 0) post.push(`afade=t=out:st=${n3(Math.max(0, duration - o.fadeOutSec))}:d=${n3(o.fadeOutSec)}`)
    if (o.normalizeAudio) post.push('loudnorm=I=-14:TP=-1.5:LRA=11')
    if (layers.length > 1) post.push('alimiter=limit=0.95:level=disabled')
    post.push('aresample=48000')
    graph.push(`${mixed}${post.join(',')}[aout]`)
  }

  const args = [...head, ...input, ...extraInputs, '-filter_complex', graph.join(';')]
  if (wantVideo) args.push('-map', '[vout]')
  if (wantAudio) args.push('-map', '[aout]')
  args.push('-t', n3(duration))

  const audioKbps = AUDIO_KBPS[o.quality]
  if (o.format === 'mp4') {
    if (wantVideo) args.push(...videoCodecArgs(o.encoder, o.quality, targetVideoKbps(o.maxSizeMB, duration, wantAudio ? audioKbps : 0)))
    if (wantAudio) args.push('-c:a', 'aac', '-b:a', `${o.maxSizeMB ? 128 : audioKbps}k`)
    else args.push('-an')
    args.push('-movflags', '+faststart')
  } else if (o.format === 'mp3') {
    args.push('-vn', '-c:a', 'libmp3lame', '-b:a', `${Math.max(audioKbps, 192)}k`)
  } else if (o.format === 'wav') {
    args.push('-vn', '-c:a', 'pcm_s16le')
  } else {
    args.push('-an', '-loop', '0')
  }
  if (o.format !== 'gif') args.push(...metadataArgs(req))
  args.push('-sn', '-dn', outputPath)
  return { args, durationSec: duration }
}

/** Título (nome do trecho) e comentário gravados dentro do arquivo. */
export function metadataArgs(req: Pick<CutRequest, 'segmentName'>): string[] {
  const out = ['-metadata', 'comment=Criado com BigLoop AutoClips']
  if (req.segmentName?.trim()) out.push('-metadata', `title=${req.segmentName.trim().slice(0, 200)}`)
  return out
}

/** Extrai um quadro JPEG (capa) do arquivo exportado. */
export function buildThumbnailArgs(videoPath: string, atSec: number, jpgPath: string, width = 0): string[] {
  return [
    '-hide_banner', '-nostdin', '-n', '-loglevel', 'error',
    '-ss', n3(Math.max(0, atSec)), '-i', videoPath, '-frames:v', '1',
    ...(width > 0 ? ['-vf', `scale=${width}:-2`] : []),
    '-q:v', '3', jpgPath
  ]
}

// ───────────── ffprobe ─────────────

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
  tags?: { title?: string; language?: string; handler_name?: string }
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
  const audioStreams = streams.filter((s) => s.codec_type === 'audio')
  if (!v && audioStreams.length === 0) throw new Error('O arquivo não contém faixas de vídeo nem de áudio reconhecíveis.')

  const video: VideoStreamInfo | null = v
    ? {
        codec: v.codec_name ?? 'desconhecido',
        width: v.width ?? 0,
        height: v.height ?? 0,
        fps: parseFrameRate(v.avg_frame_rate) ?? parseFrameRate(v.r_frame_rate)
      }
    : null
  const audioTracks: AudioStreamInfo[] = audioStreams.map((a, index) => ({
    index,
    codec: a.codec_name ?? 'desconhecido',
    sampleRate: num(a.sample_rate),
    channels: a.channels ?? null,
    title: a.tags?.title ?? (a.tags?.handler_name && !/^SoundHandler$/i.test(a.tags.handler_name) ? a.tags.handler_name : null),
    language: a.tags?.language && a.tags.language !== 'und' ? a.tags.language : null
  }))

  const durationSec = num(format.duration) ?? num(v?.duration) ?? num(audioStreams[0]?.duration) ?? 0
  return {
    path,
    fileName,
    sizeBytes,
    durationSec,
    formatName: typeof format.format_long_name === 'string' ? format.format_long_name : String(format.format_name ?? ''),
    bitRate: num(format.bit_rate),
    video,
    audio: audioTracks[0] ?? null,
    audioTracks
  }
}

/** Último out_time (em segundos) num bloco de "-progress pipe:1", ou null. */
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

/** Estimativa grosseira do tamanho do arquivo final, para checar espaço em disco. */
export function estimateOutputBytes(req: Pick<CutRequest, 'ranges' | 'options' | 'source'>): number {
  const d = clipDuration(req)
  const o = req.options
  if (o.format === 'wav') return d * 48000 * 2 * 2
  if (o.format === 'mp3') return (d * 192_000) / 8
  if (o.format === 'gif') return d * 1_500_000
  if (o.maxSizeMB) return o.maxSizeMB * 1024 * 1024
  const pixels = o.aspect === 'original' ? Math.max(1, req.source.width * req.source.height) : 1080 * 1920
  const mbpsAt1080 = { high: 14, medium: 7, small: 3.5 }[o.quality]
  const videoBps = (mbpsAt1080 * 1_000_000 * pixels) / (1920 * 1080)
  return (d * (videoBps + 192_000)) / 8
}
