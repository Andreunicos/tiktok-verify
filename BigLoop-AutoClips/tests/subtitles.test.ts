import { describe, expect, it } from 'vitest'
import { renderName } from '../src/shared/naming'
import { applyPreset, DEFAULT_EXPORT, DEFAULT_SUBTITLE_STYLE, outputSize, PRESETS } from '../src/shared/presets'
import {
  addEmoji,
  assColor,
  buildAss,
  formatSrt,
  formatVtt,
  groupWordsIntoCues,
  mapCuesToClip,
  parseSubtitles,
  splitCuesForDisplay,
  wrapText
} from '../src/shared/subtitles'
import type { Cue } from '../src/shared/types'

const SRT = `1
00:00:01,000 --> 00:00:03,500
Olá pessoal

2
00:00:04,000 --> 00:00:06,000
<i>bem-vindos</i> ao canal
`

describe('SRT/VTT', () => {
  it('lê SRT e remove tags', () => {
    const cues = parseSubtitles(SRT)
    expect(cues).toHaveLength(2)
    expect(cues[1]).toMatchObject({ startSec: 4, endSec: 6, text: 'bem-vindos ao canal' })
  })
  it('lê VTT com horas omitidas', () => {
    const cues = parseSubtitles('WEBVTT\n\n00:01.500 --> 00:02.000 align:start\nOi\n')
    expect(cues[0]).toMatchObject({ startSec: 1.5, endSec: 2, text: 'Oi' })
  })
  it('ida e volta SRT', () => {
    const cues = parseSubtitles(SRT)
    expect(parseSubtitles(formatSrt(cues)).map((c) => c.text)).toEqual(cues.map((c) => c.text))
    expect(formatVtt(cues)).toMatch(/^WEBVTT/)
    expect(formatSrt(cues)).toContain('00:00:01,000 --> 00:00:03,500')
  })
})

describe('mapCuesToClip', () => {
  const cues: Cue[] = [
    { id: 'a', startSec: 1, endSec: 3, text: 'um' },
    { id: 'b', startSec: 10, endSec: 12, text: 'dois' },
    { id: 'c', startSec: 20, endSec: 22, text: 'fora' }
  ]
  it('desloca para o tempo do corte e une intervalos', () => {
    const out = mapCuesToClip(cues, [{ startSec: 0, endSec: 4 }, { startSec: 9, endSec: 11 }])
    expect(out.map((c) => [c.text, c.startSec, c.endSec])).toEqual([
      ['um', 1, 3],
      ['dois', 5, 6]
    ])
  })
  it('aplica velocidade', () => {
    expect(mapCuesToClip(cues, [{ startSec: 0, endSec: 4 }], 2)[0]).toMatchObject({ startSec: 0.5, endSec: 1.5 })
  })
})

describe('quebra e divisão', () => {
  it('wrapText', () => expect(wrapText('um dois três quatro cinco', 9)).toEqual(['um dois', 'três', 'quatro', 'cinco']))
  it('divide legenda longa em blocos', () => {
    const out = splitCuesForDisplay([{ id: 'x', startSec: 0, endSec: 4, text: 'aaaa bbbb cccc dddd eeee ffff' }], 9, 1)
    expect(out.length).toBe(3)
    expect(out[0].startSec).toBe(0)
    expect(out.at(-1)!.endSec).toBe(4)
    for (let i = 1; i < out.length; i++) expect(out[i].startSec).toBeGreaterThanOrEqual(out[i - 1].endSec)
  })
  it('agrupa palavras em frases', () => {
    const words = [
      { startSec: 0, endSec: 0.3, text: 'Oi' },
      { startSec: 0.3, endSec: 0.6, text: 'gente.' },
      { startSec: 0.7, endSec: 1, text: 'Hoje' },
      { startSec: 3, endSec: 3.4, text: 'depois' }
    ]
    const cues = groupWordsIntoCues(words)
    expect(cues.map((c) => c.text)).toEqual(['Oi gente.', 'Hoje', 'depois'])
    expect(cues[0].words).toHaveLength(2)
  })
})

describe('ASS', () => {
  it('cores no formato BGR', () => expect(assColor('#FFD400')).toBe('&H0000D4FF'))
  it('gera eventos com destaque por palavra', () => {
    const ass = buildAss(
      [{ id: 'x', startSec: 0, endSec: 1, text: 'oi gente', words: [{ startSec: 0, endSec: 0.5, text: 'oi' }, { startSec: 0.5, endSec: 1, text: 'gente' }] }],
      DEFAULT_SUBTITLE_STYLE,
      1080,
      1920
    )
    expect(ass).toContain('PlayResY: 1920')
    expect(ass.match(/^Dialogue/gm)).toHaveLength(2)
    expect(ass).toContain('{\\c&H0000D4FF}')
    expect(ass).toContain('OI')
  })
  it('escapa chaves do texto', () => {
    const ass = buildAss([{ id: 'x', startSec: 0, endSec: 1, text: 'a {b}' }], { ...DEFAULT_SUBTITLE_STYLE, uppercase: false }, 1920, 1080)
    expect(ass).toContain('a (b)')
  })
  it('emoji por palavra-chave', () => {
    expect(addEmoji('ganhei a partida')).toBe('ganhei a partida 🎮')
    expect(addEmoji('nada aqui')).toBe('nada aqui')
  })
})

describe('presets e nomes', () => {
  it('aplica preset TikTok', () => {
    const o = applyPreset(DEFAULT_EXPORT, 'tiktok')
    expect(o).toMatchObject({ aspect: '9:16', normalizeAudio: true, subtitles: 'burn', format: 'mp4' })
    expect(applyPreset(o, 'original')).toMatchObject({ aspect: 'original', subtitles: 'none' })
    expect(PRESETS.length).toBeGreaterThanOrEqual(8)
  })
  it('tamanhos de saída pares', () => {
    expect(outputSize('original', 1279, 721)).toEqual([1278, 720])
    expect(outputSize('9:16', 1920, 1080)).toEqual([1080, 1920])
  })
  it('modelo de nome', () => {
    const d = new Date(2026, 9, 10, 14, 5, 9)
    const vars = { nome: 'live', inicio: 65, fim: 90, duracao: 25, formato: 'mp4', data: d }
    expect(renderName('{nome}_corte_{inicio}-{fim}', vars)).toBe('live_corte_00h01m05s000-00h01m30s000')
    expect(renderName('{nome}_{trecho}_{n}', { ...vars, n: 3 })).toBe('live_003')
    expect(renderName('{data}_{hora}_{duracao}_{x}', vars)).toBe('2026-10-10_14h05m09s_25s_{x}')
  })
})
