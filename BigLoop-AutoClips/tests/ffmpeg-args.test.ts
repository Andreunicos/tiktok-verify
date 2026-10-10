import { describe, expect, it } from 'vitest'
import { buildCutArgs, parseFrameRate, parseProbeOutput, parseProgressChunk, sanitizeFileName } from '../src/shared/ffmpeg'
import type { CutRequest } from '../src/shared/types'

const req: CutRequest = { inputPath: 'C:\\in.mp4', outputDir: 'C:\\out', startSec: 1.5, endSec: 4, mode: 'precise', includeAudio: true }

describe('buildCutArgs', () => {
  it('modo preciso reencoda e nunca sobrescreve', () => {
    const args = buildCutArgs(req, 'C:\\out\\x.mp4')
    expect(args).toContain('-n')
    expect(args).not.toContain('-y')
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '1.500'])
    expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '2.500'])
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args.at(-1)).toBe('C:\\out\\x.mp4')
  })
  it('modo rápido copia streams', () => {
    const args = buildCutArgs({ ...req, mode: 'fast' }, 'o.mp4')
    expect(args.join(' ')).toContain('-c copy')
    expect(args).not.toContain('libx264')
  })
  it('sem áudio usa -an', () => {
    const args = buildCutArgs({ ...req, includeAudio: false }, 'o.mp4')
    expect(args).toContain('-an')
    expect(args).not.toContain('0:a:0?')
  })
})

describe('parseProbeOutput', () => {
  const json = JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }
    ],
    format: { duration: '125.40', format_long_name: 'QuickTime / MOV', bit_rate: '8000000' }
  })
  it('extrai vídeo, áudio e duração', () => {
    const m = parseProbeOutput(json, '/a.mp4', 'a.mp4', 100)
    expect(m.durationSec).toBe(125.4)
    expect(m.video).toEqual({ codec: 'h264', width: 1920, height: 1080, fps: 29.97 })
    expect(m.audio).toEqual({ codec: 'aac', sampleRate: 48000, channels: 2 })
    expect(m.bitRate).toBe(8_000_000)
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
  it('falha sem streams', () => expect(() => parseProbeOutput('{"streams":[],"format":{}}', '/x', 'x', 1)).toThrow())
  it('falha com JSON inválido', () => expect(() => parseProbeOutput('nope', '/x', 'x', 1)).toThrow(/inválida/))
})

describe('helpers', () => {
  it('parseFrameRate', () => {
    expect(parseFrameRate('60/1')).toBe(60)
    expect(parseFrameRate('0/0')).toBeNull()
    expect(parseFrameRate(undefined)).toBeNull()
  })
  it('parseProgressChunk pega o último out_time', () => {
    expect(parseProgressChunk('frame=10\nout_time_us=1000000\nout_time_ms=2500000\nprogress=continue\n')).toBe(2.5)
    expect(parseProgressChunk('frame=1\n')).toBeNull()
  })
  it('sanitizeFileName remove caracteres inválidos do Windows', () => {
    expect(sanitizeFileName('a:b/c*?.')).toBe('a_b_c__')
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('')).toBe('_')
  })
})
