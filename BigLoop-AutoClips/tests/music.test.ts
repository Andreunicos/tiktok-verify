import { describe, expect, it } from 'vitest'
import { encodeWav, generatedMusicTitle, MUSIC_MOODS, renderMusic } from '../src/shared/music'

const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / (to - from))
}

describe('trilhas geradas pelo app', () => {
  it.each(MUSIC_MOODS)('%s: tem som de verdade, sem estourar, do começo ao fim', (mood) => {
    const m = renderMusic(mood, 16000)
    expect(m.durationSec).toBeGreaterThan(12)
    expect(m.durationSec).toBeLessThan(40)
    expect(generatedMusicTitle(mood).length).toBeGreaterThan(3)
    let peak = 0
    for (const ch of [m.left, m.right]) for (const v of ch) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(0.8001)
    expect(peak).toBeGreaterThan(0.5)
    // cada quarto da trilha tem áudio (nada de trechos mudos)
    const q = Math.floor(m.left.length / 4)
    for (let i = 0; i < 4; i++) expect(rms(m.left, i * q, (i + 1) * q)).toBeGreaterThan(0.03)
  })

  it('cada clima soa diferente e o resultado é sempre igual (determinístico)', () => {
    const a = renderMusic('animada', 8000)
    const b = renderMusic('animada', 8000)
    expect(Array.from(a.left.slice(1000, 1100))).toEqual(Array.from(b.left.slice(1000, 1100)))
    const durations = new Set(MUSIC_MOODS.map((m) => renderMusic(m, 8000).durationSec))
    expect(durations.size).toBeGreaterThan(3)
  })

  it('emenda do loop não dá estalo (fim e começo próximos)', () => {
    for (const mood of MUSIC_MOODS) {
      const m = renderMusic(mood, 16000)
      const n = m.left.length
      const jump = Math.abs(m.left[n - 1] - m.left[0])
      let typical = 0
      for (let i = 1; i < n; i++) typical = Math.max(typical, Math.abs(m.left[i] - m.left[i - 1]))
      expect(jump).toBeLessThanOrEqual(typical)
    }
  })

  it('gera WAV PCM 16 bits estéreo válido', () => {
    const m = renderMusic('calma', 8000)
    const wav = encodeWav(m)
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint32(40, true)).toBe(m.left.length * 4)
    expect(wav.length).toBe(44 + m.left.length * 4)
  })
})
