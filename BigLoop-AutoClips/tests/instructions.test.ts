import { describe, expect, it } from 'vitest'
import { parseInstructions } from '../src/shared/instructions'

describe('pedido escrito do jeito que a pessoa fala', () => {
  it('quantidade, duração e clima', () => {
    expect(parseInstructions('faz 5 cortes de 30 segundos dos momentos mais engraçados')).toEqual({ count: 5, durationSec: { min: 26, max: 33 }, music: 'engracada' })
  })
  it('números por extenso, minutos e plataforma', () => {
    expect(parseInstructions('Três clipes de 1 minuto pro Reels')).toEqual({ count: 3, durationSec: { min: 51, max: 66 }, platform: 'reels' })
    expect(parseInstructions('dois cortes de um minuto e meio')).toMatchObject({ count: 2, durationSec: { min: 77, max: 99 } })
  })
  it('faixa de duração e formatos curtos', () => {
    expect(parseInstructions('corta entre 20 e 40 segundos').durationSec).toEqual({ min: 20, max: 40 })
    expect(parseInstructions('de 15 a 25s, sem música').durationSec).toEqual({ min: 15, max: 25 })
    expect(parseInstructions('de 15 a 25s, sem música').music).toBe('nenhuma')
    expect(parseInstructions('clipes de 0:45 pro shorts')).toMatchObject({ durationSec: { min: 38, max: 50 }, platform: 'shorts' })
    expect(parseInstructions('10 cortes de 30s com música épica')).toMatchObject({ count: 10, durationSec: { min: 26, max: 33 }, music: 'epica' })
  })
  it('texto sem números não muda nada além do que foi dito', () => {
    expect(parseInstructions('pega as jogadas mais insanas')).toEqual({ music: 'epica' })
    expect(parseInstructions('')).toEqual({})
    expect(parseInstructions('quero 99 cortes').count).toBeUndefined()
  })
})
