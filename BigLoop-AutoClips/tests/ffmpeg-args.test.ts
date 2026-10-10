import { describe, expect, it } from 'vitest'
import {
  aspectGraph,
  atempoChain,
  buildExportArgs,
  clipDuration,
  estimateOutputBytes,
  parseFrameRate,
  parseProbeOutput,
  parseProgressChunk,
  sanitizeFileName,
  targetVideoKbps,
  videoCodecArgs
} from '../src/shared/ffmpeg'
import { DEFAULT_EXPORT } from '../src/shared/presets'
import { fastModeBlocker, validateRequest } from '../src/shared/validation'
import { req } from './helpers'

const graphOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1]

describe('buildExportArgs', () => {
  it('modo preciso: busca, reencode, nunca sobrescreve', () => {
    const { args, durationSec } = buildExportArgs(req(), '/out/x.mp4')
    expect(durationSec).toBe(2.5)
    expect(args).toContain('-n')
    expect(args).not.toContain('-y')
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '1.500', '-t', '2.500'])
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args.at(-1)).toBe('/out/x.mp4')
  })

  it('modo rápido copia streams', () => {
    const { args } = buildExportArgs(req({}, { mode: 'fast' }), 'o.mp4')
    expect(args.join(' ')).toContain('-c copy')
    expect(args).not.toContain('-filter_complex')
  })

  it('vários intervalos usam trim + concat', () => {
    const r = req({ ranges: [{ startSec: 2, endSec: 4 }, { startSec: 6, endSec: 7 }] })
    const { args, durationSec } = buildExportArgs(r, 'o.mp4')
    const g = graphOf(args)
    expect(durationSec).toBe(3)
    expect(g).toContain('split=2')
    expect(g).toContain('[vs1]trim=start=4.000:end=5.000')
    expect(g).toContain('concat=n=2:v=1:a=1[vcat][acat]')
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '2.000', '-t', '5.000'])
  })

  it('velocidade ajusta vídeo e áudio', () => {
    const { args, durationSec } = buildExportArgs(req({}, { speed: 1.5 }), 'o.mp4')
    expect(durationSec).toBeCloseTo(2.5 / 1.5)
    expect(graphOf(args)).toContain('setpts=PTS/1.5')
    expect(graphOf(args)).toContain('atempo=1.5')
  })

  it('fades, normalização e legendas gravadas', () => {
    const { args } = buildExportArgs(req({}, { fadeInSec: 0.5, fadeOutSec: 1, normalizeAudio: true }), 'o.mp4', 'legendas.ass')
    const g = graphOf(args)
    expect(g).toContain('fade=t=in:st=0:d=0.500')
    expect(g).toContain('fade=t=out:st=1.500:d=1.000')
    expect(g).toContain('afade=t=out')
    expect(g).toContain('loudnorm=I=-14')
    expect(g).toContain('ass=legendas.ass')
  })

  it('mistura faixas de áudio', () => {
    const r = req({ source: { durationSec: 10, width: 1920, height: 1080, fps: 30, audioTracks: 2 } }, { audioTrack: 'mix' })
    expect(graphOf(buildExportArgs(r, 'o.mp4').args)).toContain('[0:a:0][0:a:1]amix=inputs=2')
  })

  it('escolhe faixa de áudio específica', () => {
    const r = req({ source: { durationSec: 10, width: 1920, height: 1080, fps: 30, audioTracks: 2 } }, { audioTrack: 1 })
    expect(graphOf(buildExportArgs(r, 'o.mp4').args)).toContain('[0:a:1]')
  })

  it('MP3 sem vídeo, GIF sem áudio', () => {
    const mp3 = buildExportArgs(req({}, { format: 'mp3' }), 'o.mp3').args
    expect(mp3).toContain('libmp3lame')
    expect(mp3).not.toContain('[vout]')
    const gif = buildExportArgs(req({}, { format: 'gif' }), 'o.gif').args
    expect(graphOf(gif)).toContain('palettegen')
    expect(gif).not.toContain('[aout]')
  })

  it('limite de tamanho vira bitrate', () => {
    const { args } = buildExportArgs(req({}, { maxSizeMB: 8 }), 'o.mp4')
    expect(args).toContain('-b:v')
    expect(args).not.toContain('-crf')
  })
})

describe('aspectGraph', () => {
  const o = DEFAULT_EXPORT
  it('9:16 com recorte e posição', () => {
    expect(aspectGraph('[i]', '[o]', { ...o, aspect: '9:16', fit: 'crop', cropX: 0.25 }, 1920, 1080)).toBe(
      '[i]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*0.250:(ih-1920)*0.500,setsar=1[o]'
    )
  })
  it('fundo desfocado usa split + overlay', () => {
    const g = aspectGraph('[i]', '[o]', { ...o, aspect: '1:1', fit: 'blur' }, 1920, 1080)
    expect(g).toContain('boxblur')
    expect(g).toContain('overlay=(W-w)/2:(H-h)/2')
  })
  it('barras pretas', () => expect(aspectGraph('[i]', '[o]', { ...o, aspect: '4:5', fit: 'pad' }, 1920, 1080)).toContain('pad=1080:1350'))
})

describe('helpers de codificação', () => {
  it('atempo encadeia fora de 0,5–2', () => {
    expect(atempoChain(1)).toEqual([])
    expect(atempoChain(3)).toEqual(['atempo=2', 'atempo=1.5'])
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5'])
  })
  it('bitrate alvo cabe no tamanho', () => {
    const k = targetVideoKbps(10, 60, 128)!
    expect(((k + 128) * 60) / 8 / 1024).toBeLessThan(10)
    expect(targetVideoKbps(null, 60, 128)).toBeNull()
  })
  it('encoders de placa de vídeo', () => {
    expect(videoCodecArgs('h264_nvenc', 'high', null)).toEqual(expect.arrayContaining(['-c:v', 'h264_nvenc', '-cq', '19']))
    expect(videoCodecArgs('libx265', 'medium', null)).toEqual(expect.arrayContaining(['-tag:v', 'hvc1', '-crf', '27']))
    expect(videoCodecArgs('h264_amf', 'small', 2000)).toEqual(expect.arrayContaining(['-b:v', '2000k']))
  })
  it('estimativa de tamanho', () => {
    expect(estimateOutputBytes(req({}, { maxSizeMB: 16 }))).toBe(16 * 1024 * 1024)
    expect(estimateOutputBytes(req())).toBeGreaterThan(1_000_000)
  })
  it('clipDuration soma intervalos', () =>
    expect(clipDuration(req({ ranges: [{ startSec: 0, endSec: 2 }, { startSec: 5, endSec: 6 }] }, { speed: 2 }))).toBe(1.5))
})

describe('validação', () => {
  it('bloqueia modo rápido com filtros', () => {
    expect(fastModeBlocker(req({}, { mode: 'fast' }))).toBeNull()
    expect(fastModeBlocker(req({}, { mode: 'fast', aspect: '9:16' }))).toMatch(/formato/)
    expect(fastModeBlocker(req({ ranges: [{ startSec: 0, endSec: 1 }, { startSec: 2, endSec: 3 }] }, { mode: 'fast' }))).toMatch(/vários/)
  })
  it('valida velocidade, fades e formatos', () => {
    expect(validateRequest(req({}, { speed: 10 }))).toMatch(/velocidade/)
    expect(validateRequest(req({}, { fadeInSec: 2, fadeOutSec: 2 }))).toMatch(/fades/)
    expect(validateRequest(req({ source: { durationSec: 10, width: 0, height: 0, fps: null, audioTracks: 1 } }))).toMatch(/MP3/)
    expect(validateRequest(req({ ranges: [{ startSec: 1, endSec: 2 }, { startSec: 9, endSec: 12 }] }))).toMatch(/Intervalo 2/)
    expect(validateRequest(req())).toBeNull()
  })
})

describe('parseProbeOutput', () => {
  const json = JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, tags: { title: 'Microfone', language: 'por' } },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, tags: { handler_name: 'SoundHandler' } }
    ],
    format: { duration: '125.40', format_long_name: 'QuickTime / MOV', bit_rate: '8000000' }
  })
  it('extrai vídeo, faixas de áudio e duração', () => {
    const m = parseProbeOutput(json, '/a.mp4', 'a.mp4', 100)
    expect(m.durationSec).toBe(125.4)
    expect(m.video).toEqual({ codec: 'h264', width: 1920, height: 1080, fps: 29.97 })
    expect(m.audioTracks).toHaveLength(2)
    expect(m.audioTracks[0]).toMatchObject({ index: 0, title: 'Microfone', language: 'por' })
    expect(m.audioTracks[1].title).toBeNull()
    expect(m.audio?.sampleRate).toBe(48000)
  })
  it('ignora capa (attached_pic) como vídeo', () => {
    const m = parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }, { codec_type: 'audio', codec_name: 'mp3' }],
        format: { duration: '10' }
      }),
      '/a.mp3', 'a.mp3', 1
    )
    expect(m.video).toBeNull()
  })
  it('falha sem streams ou JSON inválido', () => {
    expect(() => parseProbeOutput('{"streams":[],"format":{}}', '/x', 'x', 1)).toThrow()
    expect(() => parseProbeOutput('nope', '/x', 'x', 1)).toThrow(/inválida/)
  })
})

describe('helpers', () => {
  it('parseFrameRate', () => {
    expect(parseFrameRate('60/1')).toBe(60)
    expect(parseFrameRate('0/0')).toBeNull()
  })
  it('parseProgressChunk pega o último out_time', () => {
    expect(parseProgressChunk('frame=10\nout_time_us=1000000\nout_time_ms=2500000\n')).toBe(2.5)
    expect(parseProgressChunk('frame=1\n')).toBeNull()
  })
  it('sanitizeFileName', () => {
    expect(sanitizeFileName('a:b/c*?.')).toBe('a_b_c__')
    expect(sanitizeFileName('CON')).toBe('_CON')
  })
})
