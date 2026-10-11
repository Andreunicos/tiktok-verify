import { describe, expect, it } from 'vitest'
import { detectSilences, downsamplePeaks, parseScenesAndMotion, parseShowinfoTimes, PcmAnalyzer, percentile, perSecondDb, toDb } from '../src/shared/analysis'
import { removeFillers } from '../src/shared/fillers'
import { hashtags, keywords, localTitle } from '../src/shared/social'
import { DEFAULT_WEIGHTS, learnWeights, suggestClips } from '../src/shared/suggest'
import type { AnalysisResult } from '../src/shared/types'

function pcm(samples: number[]): Uint8Array {
  const b = new Uint8Array(samples.length * 2)
  const v = new DataView(b.buffer)
  samples.forEach((s, i) => v.setInt16(i * 2, s, true))
  return b
}

describe('PcmAnalyzer', () => {
  it('calcula RMS e pico por janela, mesmo com blocos ímpares', () => {
    const a = new PcmAnalyzer(100, 0.05) // 5 amostras por janela
    const bytes = pcm([16384, -16384, 16384, -16384, 16384, 0, 0, 0, 0, 0])
    a.push(bytes.subarray(0, 3))
    a.push(bytes.subarray(3))
    a.flush()
    expect(a.rmsDb).toHaveLength(2)
    expect(a.rmsDb[0]).toBeCloseTo(toDb(0.5), 1)
    expect(a.peak[0]).toBeCloseTo(0.5)
    expect(a.rmsDb[1]).toBe(-90)
  })
  it('downsample e média por segundo', () => {
    expect(downsamplePeaks([0.1, 0.5, 0.2, 0.9], 2)).toEqual([0.5, 0.9])
    expect(perSecondDb(Array(40).fill(-20), 0.05)).toEqual([-20, -20])
    expect(percentile([5, 1, 3], 50)).toBe(3)
  })
})

describe('detectSilences', () => {
  it('encontra pausas longas e ignora curtas', () => {
    const w = [...Array(20).fill(-20), ...Array(20).fill(-70), ...Array(5).fill(-20), ...Array(4).fill(-70), ...Array(10).fill(-20)]
    expect(detectSilences(w, 0.05, -45, 0.5)).toEqual([{ startSec: 1, endSec: 2 }])
  })
  it('silêncio no fim', () => expect(detectSilences([...Array(10).fill(-20), ...Array(20).fill(-90)])).toEqual([{ startSec: 0.5, endSec: 1.5 }]))
})

it('parseShowinfoTimes', () => {
  expect(parseShowinfoTimes('[Parsed_showinfo_1] n:0 pts:1 pts_time:3.4667 duration\n... pts_time:10.1 x')).toEqual([3.47, 10.1])
})

function fakeAnalysis(): AnalysisResult {
  // 120 s: barulho alto entre 60–80 s, pausas a cada 10 s
  const rmsDb = Array.from({ length: 120 }, (_, i) => (i >= 60 && i < 80 ? -12 : -30))
  const silences = Array.from({ length: 11 }, (_, k) => ({ startSec: (k + 1) * 10 - 0.6, endSec: (k + 1) * 10 }))
  return { durationSec: 120, peaks: [], bucketSec: 0.05, rmsDb, silences, scenes: [62, 65, 70, 75], hasAudio: true, createdAt: 0 }
}

describe('suggestClips', () => {
  it('prefere o trecho mais intenso, explica e não sobrepõe', () => {
    const out = suggestClips({ analysis: fakeAnalysis(), options: { minSec: 15, maxSec: 30, count: 3 } })
    expect(out.length).toBeGreaterThan(0)
    const best = out[0]
    expect(best.startSec).toBeGreaterThanOrEqual(55)
    expect(best.endSec).toBeLessThanOrEqual(85)
    expect(best.reasons.join(' ')).toMatch(/Energia|Pico/)
    expect(best.reasons.join(' ')).toMatch(/mudanças de cena/)
    for (const s of out) expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(15)
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const ov = Math.max(0, Math.min(out[i].endSec, out[j].endSec) - Math.max(out[i].startSec, out[j].startSec))
        expect(ov / Math.min(out[i].endSec - out[i].startSec, out[j].endSec - out[j].startSec)).toBeLessThanOrEqual(0.3)
      }
  })
  it('usa transcrição para gancho e título', () => {
    const cues = [
      { id: 'a', startSec: 40, endSec: 43, text: 'Vocês sabiam disso?' },
      { id: 'b', startSec: 43, endSec: 58, text: 'Explicação longa aqui.' }
    ]
    const out = suggestClips({ analysis: { ...fakeAnalysis(), rmsDb: Array(120).fill(-30), scenes: [] }, cues, options: { minSec: 15, maxSec: 20, count: 5 } })
    const s = out.find((x) => x.startSec === 40)!
    expect(s).toBeDefined()
    expect(s.title).toBe('Vocês sabiam disso?')
    expect(s.reasons.join(' ')).toMatch(/gancho/)
  })
  it('vídeo menor que o mínimo não gera sugestões', () =>
    expect(suggestClips({ analysis: { ...fakeAnalysis(), durationSec: 5 }, options: { minSec: 15, maxSec: 30, count: 3 } })).toEqual([]))
})

describe('learnWeights', () => {
  it('aprovar reforça características altas; rejeitar enfraquece', () => {
    const f = { energy: 1, peak: 0, speech: 0.5, scenes: 0.5, hook: 0.5, cleanStart: 0.5, cleanEnd: 0.5 }
    const up = learnWeights(null, f, true)
    expect(up.energy).toBeGreaterThan(DEFAULT_WEIGHTS.energy)
    expect(up.peak).toBeLessThan(DEFAULT_WEIGHTS.peak)
    expect(up.speech).toBe(DEFAULT_WEIGHTS.speech)
    expect(learnWeights(null, f, false).energy).toBeLessThan(DEFAULT_WEIGHTS.energy)
  })
})

describe('removeFillers', () => {
  const words = [
    { startSec: 0.0, endSec: 0.4, text: 'Então' },
    { startSec: 0.5, endSec: 0.9, text: 'éé' },
    { startSec: 1.0, endSec: 1.4, text: 'hoje' },
    { startSec: 3.0, endSec: 3.4, text: 'vamos' },
    { startSec: 3.5, endSec: 3.9, text: 'jogar.' }
  ]
  it('remove vícios e encurta pausas longas', () => {
    const { ranges, removedWords, removedSec } = removeFillers({ startSec: 0, endSec: 4 }, words)
    expect(removedWords).toBe(1)
    expect(ranges).toEqual([
      { startSec: 0, endSec: 0.475 },
      { startSec: 0.925, endSec: 1.475 },
      { startSec: 2.925, endSec: 4 }
    ])
    expect(removedSec).toBeCloseTo(1.9)
  })
  it('sem palavras mantém o intervalo', () => expect(removeFillers({ startSec: 5, endSec: 6 }, words).ranges).toEqual([{ startSec: 5, endSec: 6 }]))
})

describe('social (local)', () => {
  const text = 'Vocês não vão acreditar nessa jogada! A jogada mais insana do campeonato. Campeonato decidido.'
  it('palavras-chave e hashtags sem acento', () => {
    expect(keywords(text, 2)).toEqual(['campeonato', 'jogada'])
    expect(hashtags('Ação incrível')).toEqual(expect.arrayContaining(['#acao', '#incrivel', '#cortes']))
  })
  it('título prefere exclamação/pergunta', () => expect(localTitle(text)).toBe('Vocês não vão acreditar nessa jogada!'))
})

describe('removeFillers com canCutPause', () => {
  it('não corta pausa de fala quando o áudio não é silêncio (gameplay)', () => {
    const words = [
      { startSec: 0, endSec: 0.5, text: 'olha' },
      { startSec: 5, endSec: 5.5, text: 'isso!' }
    ]
    const keepAll = removeFillers({ startSec: 0, endSec: 10 }, words, { fillers: [], maxPauseSec: 0.6, keepPauseSec: 0.15, canCutPause: () => false })
    expect(keepAll.ranges).toEqual([{ startSec: 0, endSec: 10 }])
    const cutAll = removeFillers({ startSec: 0, endSec: 10 }, words, { fillers: [], maxPauseSec: 0.6, keepPauseSec: 0.15 })
    expect(cutAll.removedSec).toBeGreaterThan(8)
  })
})

it('parseScenesAndMotion separa cenas (showinfo) e movimento por segundo (YDIF)', () => {
  const log = [
    '[Parsed_metadata_3 @ 0x1] frame:0    pts:0       pts_time:0',
    '[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YDIF=0',
    '[Parsed_metadata_3 @ 0x1] frame:1    pts:1       pts_time:0.6',
    '[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YDIF=4',
    '[Parsed_metadata_3 @ 0x1] frame:2    pts:2       pts_time:1.2',
    '[Parsed_metadata_3 @ 0x1] lavfi.signalstats.YDIF=10',
    '[Parsed_showinfo_5 @ 0x2] n:0 pts:6 pts_time:1.2 duration:1'
  ].join('\n')
  expect(parseScenesAndMotion(log)).toEqual({ scenes: [1.2], motion: [2, 10] })
})
