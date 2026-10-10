import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { transcribe } from '../src/main/media/transcribe'
import { resolveTool } from '../src/main/media/tools'
import { parseWhisperJson, parseWhisperProgress, searchCues } from '../src/shared/whisper'
import { makeVideo } from './helpers'

describe('parseWhisperJson', () => {
  it('modo palavra: junta pontuação, remove marcadores e agrupa frases', () => {
    const json = JSON.stringify({
      result: { language: 'pt' },
      transcription: [
        { offsets: { from: 0, to: 300 }, text: ' Oi' },
        { offsets: { from: 300, to: 320 }, text: ',' },
        { offsets: { from: 320, to: 700 }, text: ' gente!' },
        { offsets: { from: 700, to: 900 }, text: ' [BLANK_AUDIO]' },
        { offsets: { from: 2000, to: 2400 }, text: ' Tchau' }
      ]
    })
    const t = parseWhisperJson(json)
    expect(t.language).toBe('pt')
    expect(t.cues.map((c) => c.text)).toEqual(['Oi, gente!', 'Tchau'])
    expect(t.cues[0].words).toHaveLength(2)
    expect(t.cues[0].words![0]).toMatchObject({ startSec: 0, endSec: 0.32, text: 'Oi,' })
  })
  it('modo frase: estima tempos das palavras', () => {
    const t = parseWhisperJson(JSON.stringify({ transcription: [{ offsets: { from: 1000, to: 3000 }, text: ' Uma frase inteira aqui.' }] }))
    expect(t.cues).toHaveLength(1)
    expect(t.cues[0].words).toHaveLength(4)
    expect(t.cues[0].words![3].endSec).toBeCloseTo(3)
  })
  it('JSON inválido', () => expect(() => parseWhisperJson('x')).toThrow(/inválida/))
  it('progresso e busca sem acento', () => {
    expect(parseWhisperProgress('progress = 10%\nprogress = 35%')).toBe(0.35)
    const cues = [{ id: 'a', startSec: 0, endSec: 1, text: 'Jogada INCRÍVEL' }]
    expect(searchCues(cues, 'incrivel')).toHaveLength(1)
    expect(searchCues(cues, '')).toHaveLength(0)
  })
})

const ffmpeg = resolveTool('ffmpeg', '')
const dir = join(__dirname, '.tmp-whisper')
const fake = join(__dirname, 'fixtures', 'fake-whisper.mjs')

describe.skipIf(!ffmpeg || process.platform === 'win32')('transcribe() com whisper-cli simulado', () => {
  const video = join(dir, 'v.mp4')
  const model = join(dir, 'ggml-fake.bin')
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    makeVideo(ffmpeg!, video, 6)
    writeFileSync(model, 'x')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const base = () => ({ ffmpegPath: ffmpeg!, whisperPath: fake, modelPath: model, language: 'auto', threads: 2 })

  it('extrai áudio, roda o whisper e devolve frases com palavras', async () => {
    const stages: string[] = []
    const t = await transcribe(video, { ...base(), onProgress: (s, r) => stages.push(`${s}:${r}`) })
    expect(t.cues.map((c) => c.text)).toEqual(['Olá pessoal, tudo bem?', 'Hoje vamos jogar.'])
    expect(t.cues[1].startSec).toBeCloseTo(2.6)
    expect(stages).toContain('transcrevendo:0.5')
    expect(stages.at(-1)).toBe('transcrevendo:1')
  })

  it('desloca tempos quando transcreve só um trecho', async () => {
    const t = await transcribe(video, { ...base(), range: { startSec: 2, endSec: 6 } })
    expect(t.cues[0].startSec).toBeCloseTo(2)
  })

  it('erros claros: sem whisper, sem modelo, falha do processo', async () => {
    await expect(transcribe(video, { ...base(), whisperPath: '/nao/existe' })).rejects.toThrow(/whisper.cpp não encontrado/)
    await expect(transcribe(video, { ...base(), modelPath: '/nao/existe.bin' })).rejects.toThrow(/Modelo/)
    process.env.FAKE_WHISPER_FAIL = '1'
    try {
      await expect(transcribe(video, base())).rejects.toThrow(/failed to load model/)
    } finally {
      delete process.env.FAKE_WHISPER_FAIL
    }
  })
})
