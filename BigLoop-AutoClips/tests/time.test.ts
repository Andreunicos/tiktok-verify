import { describe, expect, it } from 'vitest'
import { formatBytes, formatTimecode, parseTimecode, timecodeForFileName } from '../src/shared/time'
import { validateCutRange } from '../src/shared/validation'

describe('parseTimecode', () => {
  it.each([
    ['0', 0],
    ['12.5', 12.5],
    ['12,5', 12.5],
    ['01:05', 65],
    ['1:02:03.250', 3723.25],
    [' 00:00:10.000 ', 10]
  ])('%s → %d', (input, expected) => expect(parseTimecode(input)).toBe(expected))

  it.each(['', 'abc', '1:60', '1:2:3:4', '-5', '1:-2', '00:aa'])('rejeita "%s"', (input) =>
    expect(parseTimecode(input)).toBeNull()
  )
})

describe('formatTimecode', () => {
  it('formata com e sem horas', () => {
    expect(formatTimecode(65.5)).toBe('01:05.500')
    expect(formatTimecode(3723.25)).toBe('01:02:03.250')
    expect(formatTimecode(5, true)).toBe('00:00:05.000')
    expect(formatTimecode(-3)).toBe('00:00.000')
  })
  it('é inverso de parseTimecode', () => {
    for (const s of [0, 1.001, 59.999, 3599.5, 7322.123]) expect(parseTimecode(formatTimecode(s))).toBe(s)
  })
  it('gera nome de arquivo seguro', () => expect(timecodeForFileName(65.2)).toBe('00h01m05s200'))
})

describe('formatBytes', () => {
  it('usa unidades binárias', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })
})

describe('validateCutRange', () => {
  it('aceita intervalo válido', () => expect(validateCutRange(1, 5, 10)).toBeNull())
  it('rejeita fim antes do início', () => expect(validateCutRange(5, 5, 10)).toMatch(/maior/))
  it('rejeita negativo', () => expect(validateCutRange(-1, 5, 10)).toMatch(/negativo/))
  it('rejeita além da duração', () => expect(validateCutRange(1, 11, 10)).toMatch(/depois do fim/))
  it('rejeita corte curto demais', () => expect(validateCutRange(1, 1.05, 10)).toMatch(/pelo menos/))
  it('ignora duração desconhecida', () => expect(validateCutRange(1, 500, 0)).toBeNull())
})
