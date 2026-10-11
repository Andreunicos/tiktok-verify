import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkWritableDir, CutCancelledError, moveNoOverwrite, startExport } from '../src/main/media/export'
import { probeMedia } from '../src/main/media/probe'
import { detectHardwareEncoders, resolveTool } from '../src/main/media/tools'
import type { CutRequest, ExportOptions } from '../src/shared/types'
import { makeVideo, req } from './helpers'

const ffmpeg = resolveTool('ffmpeg', '')
const ffprobe = resolveTool('ffprobe', '')
const dir = join(__dirname, '.tmp-export')
const source = join(dir, 'fonte de teste.mp4')
const twoTracks = join(dir, 'duas faixas.mp4')

function make(options: Partial<ExportOptions>, partial: Partial<CutRequest> = {}): CutRequest {
  return req(
    {
      inputPath: source,
      outputDir: join(dir, 'saida'),
      ranges: [{ startSec: 2, endSec: 5.5 }],
      source: { durationSec: 8, width: 640, height: 360, fps: 30, audioTracks: 1 },
      ...partial
    },
    options
  )
}

async function exportOk(r: CutRequest) {
  const progress: number[] = []
  const handle = await startExport(r, { ffmpegPath: ffmpeg!, onProgress: (_s, ratio) => progress.push(ratio), lowPriority: true })
  const result = await handle.done
  expect(existsSync(result.outputPath)).toBe(true)
  expect(progress.at(-1)).toBe(1)
  return { ...result, meta: await probeMedia(ffprobe!, result.outputPath) }
}

function decodesCleanly(path: string) {
  const r = spawnSync(ffmpeg!, ['-v', 'error', '-i', path, '-f', 'null', '-'])
  expect(r.status).toBe(0)
  expect(r.stderr.toString().trim()).toBe('')
}

describe.skipIf(!ffmpeg || !ffprobe)('Exportação com FFmpeg real', () => {
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    makeVideo(ffmpeg!, source, 8)
    makeVideo(ffmpeg!, twoTracks, 4, { tracks: 2 })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lê metadados e faixas de áudio', async () => {
    const m = await probeMedia(ffprobe!, twoTracks)
    expect(m.video).toMatchObject({ codec: 'h264', width: 640, height: 360, fps: 30 })
    expect(m.audioTracks).toHaveLength(2)
  })

  it('rejeita arquivo corrompido e inexistente', async () => {
    const bad = join(dir, 'corrompido.mp4')
    writeFileSync(bad, Buffer.from('isto não é um vídeo'.repeat(50)))
    await expect(probeMedia(ffprobe!, bad)).rejects.toThrow(/não conseguiu ler/)
    await expect(probeMedia(ffprobe!, join(dir, 'nada.mp4'))).rejects.toThrow(/não encontrado/)
  })

  it.each(['precise', 'fast'] as const)('corte MP4 reproduzível (modo %s)', async (mode) => {
    const { outputPath, meta } = await exportOk(make({ mode }, { outputDir: join(dir, mode) }))
    expect(outputPath).toMatch(/fonte de teste_corte_00h00m02s000-00h00m05s500\.mp4$/)
    expect(meta.video?.codec).toBe('h264')
    expect(meta.audio?.codec).toBe('aac')
    expect(Math.abs(meta.durationSec - 3.5)).toBeLessThan(mode === 'precise' ? 0.1 : 2.1)
    decodesCleanly(outputPath)
  })

  it.each([
    ['9:16', 'crop', 1080, 1920],
    ['1:1', 'blur', 1080, 1080],
    ['4:5', 'pad', 1080, 1350],
    ['16:9', 'crop', 1920, 1080]
  ] as const)('formato %s (%s) gera %ix%i', async (aspect, fit, w, h) => {
    const { meta, outputPath } = await exportOk(make({ aspect, fit, quality: 'small' }, { outputDir: join(dir, `asp-${aspect.replace(':', 'x')}`) }))
    expect(meta.video).toMatchObject({ width: w, height: h })
    decodesCleanly(outputPath)
  })

  it('une vários intervalos, muda velocidade e aplica fades + normalização', async () => {
    const { meta } = await exportOk(
      make(
        { speed: 2, fadeInSec: 0.3, fadeOutSec: 0.3, normalizeAudio: true },
        { ranges: [{ startSec: 0, endSec: 2 }, { startSec: 4, endSec: 6 }], outputDir: join(dir, 'multi') }
      )
    )
    expect(Math.abs(meta.durationSec - 2)).toBeLessThan(0.1)
    expect(meta.audio?.sampleRate).toBe(48000)
  })

  it('mistura duas faixas de áudio ou escolhe a segunda', async () => {
    const base = { source: { durationSec: 4, width: 640, height: 360, fps: 30, audioTracks: 2 }, inputPath: twoTracks, ranges: [{ startSec: 0, endSec: 2 }] }
    const mix = await exportOk(make({ audioTrack: 'mix' }, { ...base, outputDir: join(dir, 'mix') }))
    expect(mix.meta.audioTracks).toHaveLength(1)
    const second = await exportOk(make({ audioTrack: 1 }, { ...base, outputDir: join(dir, 'faixa2') }))
    expect(second.meta.audioTracks).toHaveLength(1)
  })

  it('grava legendas no vídeo e gera SRT + capa', async () => {
    const cues = [
      { id: 'a', startSec: 2, endSec: 3.5, text: 'Olá pessoal', words: [{ startSec: 2, endSec: 2.6, text: 'Olá' }, { startSec: 2.6, endSec: 3.5, text: 'pessoal' }] },
      { id: 'b', startSec: 4, endSec: 5, text: 'segunda {fala}' }
    ]
    const { outputPath, extraFiles, meta } = await exportOk(
      make({ aspect: '9:16', subtitles: 'both', thumbnail: true, quality: 'small' }, { cues, outputDir: join(dir, 'legendas') })
    )
    expect(meta.video).toMatchObject({ width: 1080, height: 1920 })
    const srt = extraFiles.find((f) => f.endsWith('.srt'))!
    expect(readFileSync(srt, 'utf8')).toContain('00:00:00,000 --> 00:00:01,500\nOlá pessoal')
    const jpg = extraFiles.find((f) => f.endsWith('.jpg'))!
    expect(existsSync(jpg)).toBe(true)
    decodesCleanly(outputPath)
  })

  it.each(['mp3', 'wav', 'gif'] as const)('exporta %s', async (format) => {
    const { outputPath, meta } = await exportOk(make({ format, includeAudio: format !== 'gif' }, { outputDir: join(dir, format) }))
    expect(outputPath.endsWith(`.${format}`)).toBe(true)
    if (format === 'gif') {
      expect(meta.video?.codec).toBe('gif')
      expect(meta.audio).toBeNull()
    } else {
      expect(meta.video).toBeNull()
      expect(meta.audio?.codec).toBe(format === 'mp3' ? 'mp3' : 'pcm_s16le')
    }
  })

  it('música de fundo abaixa quando há voz (ducking) e efeito entra no tempo certo', async () => {
    const voiced = join(dir, 'voz-alternada.mp4')
    makeVideo(ffmpeg!, voiced, 8, { silenceEvery: 2 }) // voz 440 Hz: 0–2 s, silêncio 2–4 s, …
    const music = join(dir, 'musica-220.wav')
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', music])
    const fx = join(dir, 'fx-1000.wav')
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.3', fx])
    const { outputPath, meta } = await exportOk(
      make(
        { fadeInSec: 0, fadeOutSec: 0 },
        {
          inputPath: voiced,
          ranges: [{ startSec: 0, endSec: 8 }],
          outputDir: join(dir, 'musica'),
          audioExtras: { music: { file: music, volume: 0.5, duck: true }, effects: [{ file: fx, atSec: 5, volume: 1 }] }
        }
      )
    )
    expect(Math.abs(meta.durationSec - 8)).toBeLessThan(0.1)
    // nível RMS (dB) de uma faixa de frequência num trecho
    const band = (f: number, from: number, to: number) => {
      const r = spawnSync(ffmpeg!, ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', outputPath, '-af', `bandpass=f=${f}:width_type=h:w=60,astats=metadata=0:measure_overall=RMS_level`, '-f', 'null', '-'])
      const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(r.stderr.toString())
      return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : NaN
    }
    const musicWithVoice = band(220, 0.6, 1.6)
    const musicAlone = band(220, 2.6, 3.6) // loop da música (3 s) continua depois de acabar
    expect(musicAlone - musicWithVoice).toBeGreaterThan(6)
    expect(band(1000, 5.0, 5.3)).toBeGreaterThan(band(1000, 6.5, 7.5) + 20)
    expect(band(220, 6.6, 7.4)).toBeGreaterThan(-60) // música em loop até o fim
  })

  it('respeita limite de tamanho', async () => {
    makeVideo(ffmpeg!, join(dir, 'grande.mp4'), 6, { size: '1280x720' })
    const { outputPath } = await exportOk(
      make({ maxSizeMB: 0.5 }, { inputPath: join(dir, 'grande.mp4'), ranges: [{ startSec: 0, endSec: 6 }], source: { durationSec: 6, width: 1280, height: 720, fps: 30, audioTracks: 1 }, outputDir: join(dir, 'limite') })
    )
    const size = readFileSync(outputPath).length
    expect(size).toBeLessThan(0.5 * 1024 * 1024 * 1.15)
  })

  it('modelo de nome, subpasta e sufixo para não sobrescrever', async () => {
    const r = make({ mode: 'fast', nameTemplate: '{trecho}_{n}', subfolderPerSource: true }, { segmentName: 'Gol', sequence: 1, outputDir: join(dir, 'nomes') })
    const a = await exportOk(r)
    const b = await exportOk(r)
    const tags = JSON.parse(spawnSync(resolveTool('ffprobe', '')!, ['-v', 'error', '-print_format', 'json', '-show_format', a.outputPath]).stdout.toString()).format.tags
    expect(tags.title).toBe('Gol')
    expect(tags.comment).toBe('Criado com BigLoop AutoClips')
    expect(a.outputPath).toBe(join(dir, 'nomes', 'fonte de teste', 'Gol_001.mp4'))
    expect(b.outputPath).toBe(join(dir, 'nomes', 'fonte de teste', 'Gol_001 (2).mp4'))
  })

  it('sem áudio gera arquivo só com vídeo', async () => {
    const { meta } = await exportOk(make({ includeAudio: false }, { baseName: 'mudo', outputDir: join(dir, 'mudo') }))
    expect(meta.audio).toBeNull()
    expect(meta.fileName).toBe('mudo.mp4')
  })

  it('rejeita pedido inválido antes de chamar o FFmpeg', async () => {
    await expect(startExport(make({}, { ranges: [{ startSec: 5, endSec: 9 }] }), { ffmpegPath: ffmpeg! })).rejects.toThrow(/depois do fim/)
    await expect(startExport(make({ mode: 'fast', aspect: '9:16' }), { ffmpegPath: ffmpeg! })).rejects.toThrow(/modo rápido/)
  })

  it('pasta de saída bloqueada dá mensagem clara antes de rodar o FFmpeg', async () => {
    const file = join(dir, 'sou-um-arquivo')
    writeFileSync(file, 'x')
    const blockedDir = join(file, 'saida')
    expect(await checkWritableDir(blockedDir)).toMatch(/O Windows não deixou gravar/)
    expect(await checkWritableDir(join(dir, 'pasta-ok'))).toBeNull()
    await expect(startExport(make({}, { outputDir: blockedDir }), { ffmpegPath: ffmpeg! })).rejects.toThrow(/Acesso controlado a pastas/)
  })

  it('move do temporário sem sobrescrever', async () => {
    const a = join(dir, 'a.tmp')
    const target = join(dir, 'destino.mp4')
    writeFileSync(target, 'existente')
    writeFileSync(a, 'novo')
    const moved = await moveNoOverwrite(a, target)
    expect(moved).toBe(join(dir, 'destino (2).mp4'))
    expect(readFileSync(target, 'utf8')).toBe('existente')
    expect(readFileSync(moved, 'utf8')).toBe('novo')
    expect(existsSync(a)).toBe(false)
  })

  it('recusa quando falta espaço em disco', async () => {
    await expect(startExport(make({}), { ffmpegPath: ffmpeg!, minFreeBytes: 1e18 })).rejects.toThrow(/Pouco espaço/)
  })

  it('encoder indisponível gera mensagem clara', async () => {
    const hw = await detectHardwareEncoders(ffmpeg!)
    const missing = (['h264_nvenc', 'h264_qsv', 'h264_amf'] as const).find((e) => !hw.includes(e))
    if (!missing) return
    const handle = await startExport(make({ encoder: missing }, { outputDir: join(dir, 'hw') }), { ffmpegPath: ffmpeg! })
    await expect(handle.done).rejects.toThrow(/encoder|FFmpeg falhou/)
  })

  it('cancelamento encerra o FFmpeg e apaga o arquivo parcial', async () => {
    const long = join(dir, 'longo.mp4')
    makeVideo(ffmpeg!, long, 30, { size: '1280x720' })
    const handle = await startExport(
      make({ aspect: '9:16', fit: 'blur' }, { inputPath: long, ranges: [{ startSec: 0, endSec: 30 }], source: { durationSec: 30, width: 1280, height: 720, fps: 30, audioTracks: 1 }, outputDir: join(dir, 'cancel') }),
      { ffmpegPath: ffmpeg! }
    )
    setTimeout(() => handle.cancel(), 300)
    await expect(handle.done).rejects.toBeInstanceOf(CutCancelledError)
    expect(existsSync(handle.outputPath)).toBe(false)
  })
})
