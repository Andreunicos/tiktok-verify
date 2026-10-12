import { describe, expect, it } from 'vitest'
import { concatToSource, mergeRanges, promisingRegions, remapTranscript } from '../src/shared/regions'
import { alternateText, seriesSpan, seriesTexts, splitIntoParts, wantsAbTest, wantsSeries } from '../src/shared/variants'
import { pickLearning } from '../src/shared/performance'
import { PostScheduler, seriesTimes } from '../src/main/scheduler'
import type { AnalysisResult, Cue, ScheduledPost } from '../src/shared/types'

/** Live de `min` minutos, calma, com picos de som e ação em `hot` (segundos). */
function live(min: number, hot: number[]): AnalysisResult {
  const D = min * 60
  const rmsDb = Array.from({ length: D }, (_, i) => (hot.some((h) => i >= h && i < h + 20) ? -8 : -30 + (i % 7)))
  const motion = rmsDb.map((db) => (db > -12 ? 30 : 3))
  return { durationSec: D, peaks: [], bucketSec: 1, rmsDb, motion, silences: [], scenes: [], hasAudio: true, createdAt: 0, reactions: [], gameEvents: [] }
}

describe('transcrever só as partes promissoras', () => {
  it('vídeo curto: transcreve tudo', () => {
    expect(promisingRegions(live(10, [100]))).toBeNull()
  })

  it('live de 1 h: cobre os picos com folga, ~35% do vídeo, sem trechos sobrepostos', () => {
    const hot = [300, 1200, 2500, 3300]
    const r = promisingRegions(live(60, hot))!
    expect(r).not.toBeNull()
    const covered = r.reduce((t, x) => t + x.endSec - x.startSec, 0)
    expect(covered).toBeGreaterThanOrEqual(600)
    expect(covered).toBeLessThan(3600 * 0.5)
    for (const h of hot) expect(r.some((x) => x.startSec <= h && x.endSec >= h + 20)).toBe(true)
    for (let i = 1; i < r.length; i++) expect(r[i].startSec).toBeGreaterThan(r[i - 1].endSec)
  })

  it('junta trechos próximos', () => {
    expect(mergeRanges([{ startSec: 50, endSec: 60 }, { startSec: 0, endSec: 10 }, { startSec: 15, endSec: 20 }], 5)).toEqual([
      { startSec: 0, endSec: 20 },
      { startSec: 50, endSec: 60 }
    ])
  })

  it('tempo no áudio colado → tempo no vídeo', () => {
    const ranges = [{ startSec: 100, endSec: 130 }, { startSec: 500, endSec: 520 }]
    expect(concatToSource(0, ranges)).toBe(100)
    expect(concatToSource(29.5, ranges)).toBe(129.5)
    expect(concatToSource(31, ranges)).toBe(501)
    expect(concatToSource(99, ranges)).toBe(520)
  })

  it('falas não atravessam o pulo entre dois trechos', () => {
    const ranges = [{ startSec: 100, endSec: 102 }, { startSec: 500, endSec: 505 }]
    const words = [
      { startSec: 0.2, endSec: 0.6, text: 'olha' },
      { startSec: 0.6, endSec: 1.0, text: 'isso' },
      { startSec: 2.1, endSec: 2.5, text: 'caramba' }
    ]
    const t = remapTranscript({ language: 'pt', engine: 'whisper.cpp', createdAt: 0, cues: [{ id: 'c1', startSec: 0.2, endSec: 2.5, text: 'olha isso caramba', words }] }, ranges)
    expect(t.cues.map((c) => c.text)).toEqual(['olha isso', 'caramba'])
    expect(t.cues[1].startSec).toBeCloseTo(500.1)
    expect(t.engine).toBe('whisper.cpp (trechos)')
  })
})

describe('séries (Parte 1, 2, 3)', () => {
  const cues: Cue[] = [
    { id: 'a', startSec: 0, endSec: 28, text: 'Começou a partida.' },
    { id: 'b', startSec: 28, endSec: 33, text: 'Olha ele vindo.' },
    { id: 'c', startSec: 33, endSec: 61, text: 'Agora ficou sério.' },
    { id: 'd', startSec: 61, endSec: 90, text: 'Acabou' }
  ]

  it('divide no fim de uma frase perto da divisão ideal', () => {
    const parts = splitIntoParts({ startSec: 0, endSec: 90 }, 3, cues)
    expect(parts).toEqual([
      { startSec: 0, endSec: 28 },
      { startSec: 28, endSec: 61 },
      { startSec: 61, endSec: 90 }
    ])
  })

  it('sem frase perto: divide em partes iguais', () => {
    expect(splitIntoParts({ startSec: 10, endSec: 70 }, 2, [])).toEqual([
      { startSec: 10, endSec: 40 },
      { startSec: 40, endSec: 70 }
    ])
  })

  it('trecho da série não passa do fim do vídeo', () => {
    expect(seriesSpan(500, 560, 3, 40)).toEqual({ startSec: 440, endSec: 560 })
    expect(seriesSpan(10, 100, 3, 50)).toEqual({ startSec: 0, endSec: 100 })
  })

  it('textos: "Parte k/n" e chamada para a próxima (a última não tem)', () => {
    expect(seriesTexts(1, 3, 'Clutch insano')).toEqual({ title: 'Clutch insano — Parte 1/3', overlay: 'PARTE 1/3', cta: 'PARTE 2 NO PERFIL' })
    expect(seriesTexts(3, 3, 'Clutch insano').cta).toBe('')
  })

  it('entende pedidos escritos', () => {
    expect(wantsSeries('corta em partes a história do boss')).toBe(true)
    expect(wantsSeries('faz uma série com parte 1 e 2')).toBe(true)
    expect(wantsSeries('5 cortes engraçados')).toBe(false)
    expect(wantsAbTest('faz teste A/B')).toBe(true)
    expect(wantsAbTest('quero duas versões de cada')).toBe(true)
    expect(wantsAbTest('cortes de 30 segundos')).toBe(false)
  })
})

describe('teste A/B', () => {
  it('título da versão B é diferente do da A', () => {
    expect(alternateText('ELE NÃO ESPERAVA', ['Ele não esperava!', '', 'QUE JOGADA'])).toBe('QUE JOGADA')
    expect(alternateText('X', [undefined, null])).toBe('')
  })
})

describe('aprender com as visualizações', () => {
  const p = (key: string, views: number, ageHours = 72, learned = false) => ({ key, views, ageHours, learned })

  it('poucos posts ou muito novos: não aprende ainda', () => {
    expect(pickLearning([p('a', 10), p('b', 1000), p('c', 50, 10)])).toEqual({ up: [], down: [] })
  })

  it('o melhor terço ensina "mais assim", o pior "evite"; já aprendidos não contam de novo', () => {
    const r = pickLearning([p('a', 120), p('b', 90_000), p('c', 300), p('d', 15), p('e', 2_000), p('f', 40_000, 80, true)])
    expect(r.up).toEqual(['b'])
    expect(r.down.sort()).toEqual(['a', 'd'])
  })
})

describe('agenda de postagens', () => {
  const entry = (at: number): Omit<ScheduledPost, 'id' | 'status'> => ({ at, platform: 'tiktok', file: `/v/${at}.mp4`, mode: 'rascunho' })

  it('envia só o que passou da hora, na ordem, e registra erros', async () => {
    let now = 1000
    const sent: string[] = []
    const s = new PostScheduler(null, async (p) => {
      if (p.file.includes('3000')) throw new Error('sem internet')
      sent.push(p.file)
    }, () => now)
    const changes: number[] = []
    s.on('change', (l: ScheduledPost[]) => changes.push(l.length))
    s.add([entry(3000), entry(2000), entry(9000)])
    await s.tick()
    expect(sent).toEqual([])
    now = 5000
    await s.tick()
    expect(sent).toEqual(['/v/2000.mp4'])
    expect(s.list().map((x) => x.status)).toEqual(['feito', 'erro', 'aguardando'])
    expect(s.list()[1].error).toBe('sem internet')
    s.remove(s.list()[2].id)
    expect(s.list()).toHaveLength(2)
    expect(changes.length).toBeGreaterThan(3)
  })

  it('horários da série: 1 a cada N horas', () => {
    expect(seriesTimes(0, 3, 24)).toEqual([0, 86_400_000, 172_800_000])
  })
})
