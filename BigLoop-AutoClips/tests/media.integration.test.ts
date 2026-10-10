import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CutCancelledError, startCut } from '../src/main/media/cut'
import { probeMedia } from '../src/main/media/probe'
import { resolveTool } from '../src/main/media/tools'

const ffmpeg = resolveTool('ffmpeg', '')
const ffprobe = resolveTool('ffprobe', '')
const dir = join(__dirname, '.tmp')
const source = join(dir, 'fonte de teste.mp4')
const longSource = join(dir, 'longo.mp4')

/** Gera vídeo sintético com imagem e som (testsrc + seno). */
function makeVideo(path: string, seconds: number, size = '640x360') {
  const r = spawnSync(ffmpeg!, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path
  ])
  if (r.status !== 0) throw new Error(r.stderr.toString())
}

describe.skipIf(!ffmpeg || !ffprobe)('FFmpeg real (integração)', () => {
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    makeVideo(source, 8)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lê metadados via ffprobe', async () => {
    const m = await probeMedia(ffprobe!, source)
    expect(m.fileName).toBe('fonte de teste.mp4')
    expect(m.durationSec).toBeGreaterThan(7.9)
    expect(m.video).toMatchObject({ codec: 'h264', width: 640, height: 360, fps: 30 })
    expect(m.audio).toMatchObject({ codec: 'aac', sampleRate: 48000 })
  })

  it('rejeita arquivo corrompido com mensagem clara', async () => {
    const bad = join(dir, 'corrompido.mp4')
    writeFileSync(bad, Buffer.from('isto não é um vídeo'.repeat(50)))
    await expect(probeMedia(ffprobe!, bad)).rejects.toThrow(/não conseguiu ler/)
    await expect(probeMedia(ffprobe!, join(dir, 'inexistente.mp4'))).rejects.toThrow(/não encontrado/)
  })

  it.each(['precise', 'fast'] as const)('gera MP4 reproduzível com áudio e vídeo (modo %s)', async (mode) => {
    const progress: number[] = []
    const out = join(dir, `saida-${mode}`)
    const handle = await startCut(
      { inputPath: source, outputDir: out, startSec: 2, endSec: 5.5, mode, includeAudio: true },
      { ffmpegPath: ffmpeg!, sourceDurationSec: 8, onProgress: (_s, r) => progress.push(r) }
    )
    const { outputPath } = await handle.done
    expect(existsSync(outputPath)).toBe(true)
    expect(outputPath).toMatch(/fonte de teste_corte_00h00m02s000-00h00m05s500\.mp4$/)

    const m = await probeMedia(ffprobe!, outputPath)
    expect(m.video?.codec).toBe('h264')
    expect(m.audio?.codec).toBe('aac')
    // Preciso: ±0.1s. Rápido: corta no keyframe (GOP de 2s), então a tolerância é maior.
    expect(Math.abs(m.durationSec - 3.5)).toBeLessThan(mode === 'precise' ? 0.1 : 2.1)
    expect(progress.at(-1)).toBe(1)

    // Decodifica o arquivo inteiro para garantir que é reproduzível.
    const decode = spawnSync(ffmpeg!, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'])
    expect(decode.status).toBe(0)
    expect(decode.stderr.toString().trim()).toBe('')
  })

  it('nunca sobrescreve: segundo corte igual ganha sufixo', async () => {
    const out = join(dir, 'duplicado')
    const req = { inputPath: source, outputDir: out, startSec: 0, endSec: 1, mode: 'fast' as const, includeAudio: true }
    const a = await (await startCut(req, { ffmpegPath: ffmpeg!, sourceDurationSec: 8 })).done
    const b = await (await startCut(req, { ffmpegPath: ffmpeg!, sourceDurationSec: 8 })).done
    expect(a.outputPath).not.toBe(b.outputPath)
    expect(b.outputPath).toMatch(/\(2\)\.mp4$/)
  })

  it('sem áudio gera arquivo só com vídeo', async () => {
    const handle = await startCut(
      { inputPath: source, outputDir: join(dir, 'mudo'), startSec: 1, endSec: 2, mode: 'precise', includeAudio: false, baseName: 'mudo' },
      { ffmpegPath: ffmpeg!, sourceDurationSec: 8 }
    )
    const m = await probeMedia(ffprobe!, (await handle.done).outputPath)
    expect(m.audio).toBeNull()
    expect(m.fileName).toBe('mudo.mp4')
  })

  it('rejeita intervalo inválido antes de chamar o FFmpeg', async () => {
    await expect(
      startCut({ inputPath: source, outputDir: dir, startSec: 5, endSec: 9, mode: 'fast', includeAudio: true }, { ffmpegPath: ffmpeg!, sourceDurationSec: 8 })
    ).rejects.toThrow(/depois do fim/)
  })

  it('cancelamento encerra o FFmpeg e apaga o arquivo parcial', async () => {
    makeVideo(longSource, 30, '1280x720')
    const out = join(dir, 'cancelado')
    const handle = await startCut(
      { inputPath: longSource, outputDir: out, startSec: 0, endSec: 30, mode: 'precise', includeAudio: true },
      { ffmpegPath: ffmpeg!, sourceDurationSec: 30 }
    )
    setTimeout(() => handle.cancel(), 300)
    await expect(handle.done).rejects.toBeInstanceOf(CutCancelledError)
    expect(existsSync(handle.outputPath)).toBe(false)
  })
})
