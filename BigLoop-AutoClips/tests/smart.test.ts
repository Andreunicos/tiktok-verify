import { describe, expect, it } from 'vitest'
import { detectReactions, PcmAnalyzer } from '../src/shared/analysis'
import { findPhrase, planEffects, planZooms, snapToSentences, strongMoments, toOutputTime, trackExpr, withTeaser, zoomExpr } from '../src/shared/smart'
import { analyzeFrame, centerToCropX, decideTrack, type FrameSample } from '../src/shared/track'
import { buildAss } from '../src/shared/subtitles'
import { DEFAULT_EXPORT } from '../src/shared/presets'
import { suggestClips } from '../src/shared/suggest'
import type { AnalysisResult, Cue, Word } from '../src/shared/types'

const cue = (id: string, startSec: number, endSec: number, text: string): Cue => ({ id, startSec, endSec, text })

describe('não corta no meio da frase', () => {
  const cues = [cue('a', 0, 4, 'Primeira frase aqui.'), cue('b', 4.2, 9, 'Segunda frase bem longa.'), cue('c', 9.3, 14, 'Terceira e última.')]
  it('puxa o início para o começo da frase e o fim para o fim da frase', () => {
    const r = snapToSentences({ startSec: 5.5, endSec: 12 }, cues, 60)
    expect(r.startSec).toBeCloseTo(4.08, 2)
    expect(r.endSec).toBeCloseTo(14.25, 2)
  })
  it('não estica demais: se a frase começa longe, pula para a próxima', () => {
    const r = snapToSentences({ startSec: 8, endSec: 20 }, cues, 60, { maxBefore: 2.5, maxAfter: 3.5, maxLength: Infinity })
    expect(r.startSec).toBeCloseTo(9.18, 2)
  })
  it('sem transcrição não mexe', () => {
    expect(snapToSentences({ startSec: 1, endSec: 2 }, [], 10)).toEqual({ startSec: 1, endSec: 2 })
  })
})

describe('gancho no começo (teaser)', () => {
  const words: Word[] = 'eu nunca vi uma jogada dessas na minha vida'.split(' ').map((t, i) => ({ text: t, startSec: 20 + i * 0.4, endSec: 20.35 + i * 0.4 }))
  it('acha a frase mesmo com pontuação/maiúsculas diferentes', () => {
    const r = findPhrase('Nunca vi uma jogada DESSAS!', words, [{ startSec: 10, endSec: 40 }])
    expect(r).toEqual({ startSec: 20.4, endSec: 22.35 })
  })
  it('coloca o gancho antes do corte quando ele acontece depois de 4 s', () => {
    const ranges = [{ startSec: 10, endSec: 40 }]
    const t = withTeaser(ranges, { startSec: 20.4, endSec: 22.35 })
    expect(t.ranges).toHaveLength(2)
    expect(t.ranges[0]).toEqual({ startSec: 20.32, endSec: 22.5 })
    expect(t.teaserSec).toBeCloseTo(2.18, 2)
  })
  it('não repete gancho que já está no começo ou que é longo demais', () => {
    const ranges = [{ startSec: 10, endSec: 40 }]
    expect(withTeaser(ranges, { startSec: 11, endSec: 13 }).teaserSec).toBe(0)
    expect(withTeaser(ranges, { startSec: 20, endSec: 30 }).teaserSec).toBe(0)
    expect(withTeaser(ranges, null).ranges).toBe(ranges)
  })
  it('tempo da origem → tempo do corte com vários trechos', () => {
    const ranges = [{ startSec: 50, endSec: 52 }, { startSec: 10, endSec: 20 }]
    expect(toOutputTime(51, ranges)).toBe(1)
    expect(toOutputTime(15, ranges)).toBe(7)
    expect(toOutputTime(30, ranges)).toBeNull()
  })
})

describe('efeitos e zooms nos momentos certos', () => {
  const rmsDb = Array.from({ length: 60 }, (_, i) => (i === 25 ? -6 : i === 40 ? -8 : -26))
  const words: Word[] = [
    { text: 'olha', startSec: 12, endSec: 12.4 },
    { text: 'isso', startSec: 12.4, endSec: 12.8 },
    { text: 'absurdo!', startSec: 30, endSec: 30.6 }
  ]
  const base = { ranges: [{ startSec: 10, endSec: 50 }], rmsDb, words, keywords: ['absurdo'] }

  it('acha picos, reações e palavras-chave no tempo do corte', () => {
    const m = strongMoments({ ...base, reactions: [{ startSec: 35, endSec: 37, kind: 'risada' }] })
    expect(m.map((x) => x.kind)).toEqual(['pico', 'palavra', 'reação', 'pico'])
    expect(m[0].atSec).toBe(15.5)
    expect(m[1].atSec).toBe(20)
  })
  it('planeja whoosh na entrada, impacto no maior pico e ding na palavra', () => {
    const fx = planEffects({ ...base, teaserSec: 2 }, () => true)
    expect(fx.map((f) => f.key)).toEqual(['whoosh', 'rebobinar', 'impacto', 'ding'])
    expect(fx.find((f) => f.key === 'impacto')!.atSec).toBeCloseTo(15.45, 2)
    expect(fx.find((f) => f.key === 'ding')!.atSec).toBe(20)
  })
  it('só usa efeitos que existem', () => {
    expect(planEffects(base, (k) => k === 'whoosh').map((f) => f.key)).toEqual(['whoosh'])
  })
  it('zooms com distância mínima, fora do gancho e do finalzinho', () => {
    const z = planZooms({ ...base, teaserSec: 2 }, 40)
    expect(z.length).toBeGreaterThan(0)
    for (let i = 1; i < z.length; i++) expect(z[i].atSec - z[i - 1].atSec).toBeGreaterThanOrEqual(6)
    expect(z.every((x) => x.atSec >= 2.3 && x.atSec + x.durSec <= 39.7)).toBe(true)
    expect(zoomExpr(z)).toMatch(/^if\(between\(it,/)
    expect(zoomExpr([])).toBe('1')
  })
  it('expressão do recorte que acompanha', () => {
    expect(trackExpr([])).toBe('0.5')
    expect(trackExpr([{ t: 0, x: 0.3 }])).toBe('0.3')
    const e = trackExpr([{ t: 0, x: 0.2 }, { t: 2, x: 0.2 }, { t: 2.6, x: 0.8 }])
    expect(e).toContain('if(lt(t,2.6),0.2+(0.6)*(t-2)/0.6')
  })
})

describe('risadas e gritos (só áudio)', () => {
  const SR = 8000
  /** Gera PCM com envelope e "aspereza" (ruído) controlados. */
  function pcm(seconds: number, fn: (t: number, rnd: () => number) => number): Uint8Array {
    let s = 1
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff)
    const buf = new Uint8Array(seconds * SR * 2)
    const v = new DataView(buf.buffer)
    for (let i = 0; i < seconds * SR; i++) v.setInt16(i * 2, Math.max(-1, Math.min(1, fn(i / SR, rnd))) * 32767, true)
    return buf
  }
  const analyze = (data: Uint8Array) => {
    const a = new PcmAnalyzer(SR)
    a.push(data)
    a.flush()
    return detectReactions(a.rmsDb, a.zcr)
  }
  // fala "normal": tom de 200 Hz com volume que varia devagar
  const speech = (t: number) => 0.08 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t)) * Math.sin(2 * Math.PI * 200 * t)

  it('acha a risada (ha-ha-ha alto e ritmado) no meio da fala', () => {
    const r = analyze(pcm(30, (t, rnd) => (t >= 12 && t < 15 ? 0.35 * Math.max(0, Math.sin(2 * Math.PI * 4.5 * t)) ** 2 * (rnd() * 2 - 1) : speech(t))))
    expect(r.some((x) => x.kind === 'risada' && x.startSec >= 11 && x.endSec <= 16.5)).toBe(true)
  })
  it('acha o grito (alto, contínuo e áspero)', () => {
    const r = analyze(pcm(30, (t, rnd) => (t >= 20 && t < 22.5 ? 0.6 * (rnd() * 2 - 1) : speech(t))))
    expect(r.some((x) => x.kind === 'grito' && x.startSec >= 19 && x.endSec <= 23.5)).toBe(true)
  })
  it('fala comum não vira reação', () => {
    expect(analyze(pcm(30, speech))).toEqual([])
  })
  it('reação vira ponto a favor do trecho na sugestão', () => {
    const analysis: AnalysisResult = {
      durationSec: 120, peaks: [], bucketSec: 1, rmsDb: Array(120).fill(-25), silences: [], scenes: [], hasAudio: true, createdAt: 0,
      reactions: [{ startSec: 80, endSec: 83, kind: 'risada' }]
    }
    const s = suggestClips({ analysis, options: { minSec: 20, maxSec: 30, count: 1 } })
    const overlap = Math.min(s[0].endSec, 83) - Math.max(s[0].startSec, 80)
    expect(overlap).toBeGreaterThanOrEqual(1.5)
    expect(s[0].reasons.join(' ')).toMatch(/risada/)
  })
})

describe('enquadramento que acompanha a pessoa', () => {
  const W = 96
  const H = 54
  /** Quadro cinza com um "rosto" cor de pele na coluna indicada. */
  const frame = (cx: number, size = 14) => {
    const rgb = new Uint8Array(W * H * 3).fill(60)
    for (let y = 8; y < 8 + size * 1.3; y++)
      for (let x = Math.round(cx * W - size / 2); x < Math.round(cx * W + size / 2); x++) {
        const i = (y * W + x) * 3
        rgb[i] = 210
        rgb[i + 1] = 150
        rgb[i + 2] = 120
      }
    return rgb
  }
  const cropFrac = 0.316
  it('acha o centro da pessoa', () => {
    const { sample } = analyzeFrame(frame(0.75), W, H, cropFrac, null)
    expect(sample.center!).toBeGreaterThan(0.7)
    expect(sample.center!).toBeLessThan(0.8)
    expect(sample.skin).toBeGreaterThan(0.012)
  })
  it('centro → posição do recorte (com limites)', () => {
    expect(centerToCropX(0.5, cropFrac)).toBe(0.5)
    expect(centerToCropX(0.05, cropFrac)).toBe(0)
    expect(centerToCropX(0.98, cropFrac)).toBe(1)
  })
  it('suaviza e só move quando a pessoa realmente muda de lugar', () => {
    const centers = [0.3, 0.31, 0.29, 0.33, 0.3, 0.7, 0.71, 0.7, 0.69, 0.7, 0.7, 0.7]
    const samples: FrameSample[] = centers.map((c, i) => ({ t: i * 0.5, center: c, skin: 0.03, confidence: 0.8 }))
    const d = decideTrack(samples, cropFrac)
    expect(d.follow).toBe(true)
    expect(d.points[0].x).toBe(centerToCropX(0.3, cropFrac))
    expect(d.points[d.points.length - 1].x).toBe(centerToCropX(0.7, cropFrac))
    expect(d.points.length).toBeLessThanOrEqual(4)
  })
  it('webcam pequena no canto (gameplay): não recorta, mostra o vídeo inteiro', () => {
    const samples: FrameSample[] = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.5, center: 0.9, skin: 0.004, confidence: 0.9 }))
    expect(decideTrack(samples, cropFrac).follow).toBe(false)
    expect(decideTrack([], cropFrac).follow).toBe(false)
  })
})

describe('título na tela e palavras-chave na legenda', () => {
  it('gera evento de título e destaca palavra-chave', () => {
    const ass = buildAss([cue('a', 0, 3, 'isso foi absurdo demais')], { ...DEFAULT_EXPORT.subtitleStyle, wordHighlight: false }, 1080, 1920, {
      title: 'A jogada mais absurda',
      keywords: ['Absurdo']
    })
    expect(ass).toContain('Style: Title,')
    expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:03\.20,Title,,0,0,0,,\{\\fad\(150,250\)\}A JOGADA MAIS ABSURDA/)
    expect(ass).toMatch(/\{\\c&H0088FF4D\\fscx115\\fscy115\}ABSURDO\{\\r\}/)
  })
})
