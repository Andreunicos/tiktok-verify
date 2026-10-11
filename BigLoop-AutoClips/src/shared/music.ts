import type { Mood } from './types'

/**
 * Trilhas geradas pelo próprio app (síntese aditiva simples). Como são criadas aqui, não têm
 * direitos de terceiros: uso livre (CC0) e funcionam sem internet. Cada trilha é um loop
 * perfeito (as caudas das notas dão a volta no começo), então o FFmpeg pode repetir com
 * `-stream_loop -1` sem emenda audível.
 */

type Pattern = string // 16 passos por compasso: '.' = nada, 'x' = forte, 'o' = médio, 's' = suave

interface Style {
  title: string
  bpm: number
  /** Acordes (notas MIDI), um por compasso. */
  chords: number[][]
  kick: Pattern
  snare: Pattern
  hat: Pattern
  bass: Pattern
  /** Nota do baixo em cada passo: 'r' raiz, 'f' quinta (mesmo comprimento do padrão do baixo). */
  bassNotes?: string
  arp: Pattern
  stab: Pattern
  pad: number
  swing?: number
  lowpassHz?: number
  crackle?: number
}

const STYLES: Record<Mood, Style> = {
  animada: {
    title: 'Pulso Animado',
    bpm: 120,
    chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    bass: 'o.o.o.o.o.o.o.o.',
    arp: 'sosososososososo',
    stab: '................',
    pad: 0.22
  },
  calma: {
    title: 'Manhã Calma',
    bpm: 76,
    chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]],
    kick: '................',
    snare: '................',
    hat: 's.s.s.s.s.s.s.s.',
    bass: 'o...............',
    arp: 'o.s.o.s.o.s.o.s.',
    stab: '................',
    pad: 0.4
  },
  epica: {
    title: 'Horizonte Épico',
    bpm: 84,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    kick: 'x.......x.....oo',
    snare: '....x.......x...',
    hat: '................',
    bass: 'x.o.x.o.x.o.x.o.',
    arp: '................',
    stab: 'x.......x.......',
    pad: 0.45
  },
  lofi: {
    title: 'Tarde Lo-fi',
    bpm: 78,
    chords: [[62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71], [57, 60, 64, 67]],
    kick: 'x......x..x.....',
    snare: '....x.......x...',
    hat: 'o.s.o.s.o.s.o.s.',
    bass: 'o......o..o.....',
    arp: '................',
    stab: 'o.....s.........',
    pad: 0.18,
    swing: 0.58,
    lowpassHz: 2600,
    crackle: 0.012
  },
  engracada: {
    title: 'Passinho Engraçado',
    bpm: 132,
    chords: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]],
    kick: 'o.......o.......',
    snare: '................',
    hat: 's.s.s.s.s.s.s.s.',
    bass: 'x...x...x...x...',
    bassNotes: 'r...f...r...f...',
    arp: '................',
    stab: '..o...o...o...o.',
    pad: 0
  }
}

export const MUSIC_MOODS = Object.keys(STYLES) as Mood[]

/** Quantas variações de cada clima o app gera (tom, andamento e ordem dos acordes diferentes). */
export const MUSIC_VARIANTS = 3

export function generatedMusicTitle(mood: Mood, variant = 0): string {
  return `${STYLES[mood].title}${['', ' II', ' III'][variant] ?? ` ${variant + 1}`}`
}

/** Aplica a variação: transpõe, muda o andamento e gira a progressão de acordes. */
function variantStyle(base: Style, variant: number): Style {
  if (!variant) return base
  const shift = [0, 5, -3][variant % 3]
  const rot = variant % base.chords.length
  const chords = [...base.chords.slice(rot), ...base.chords.slice(0, rot)].map((c) => c.map((n) => n + shift))
  const rotate = (p: string, k: number) => (p.length === 16 ? p.slice(k) + p.slice(0, k) : p)
  return { ...base, chords, bpm: base.bpm + [0, -6, 6][variant % 3], arp: rotate(base.arp, variant * 2), hat: variant === 2 ? base.hat.replace(/\./g, (m, i: number) => (i % 4 === 3 ? 's' : m)) : base.hat }
}

const vel = (c: string | undefined): number => (c === 'x' ? 1 : c === 'o' ? 0.6 : c === 's' ? 0.3 : 0)
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

/** Gerador pseudoaleatório com semente (resultado sempre igual, bom para testes). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Tabela de uma onda (soma de harmônicos) para tocar notas rápido. */
function table(harmonics: number[], size = 2048): Float32Array {
  const t = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    let v = 0
    for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin((2 * Math.PI * (h + 1) * i) / size)
    t[i] = v
  }
  let peak = 0
  for (const v of t) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < size; i++) t[i] /= peak || 1
  return t
}

const PAD = table([1, 0.5, 0.33, 0.25, 0.2, 0.16])
const PLUCK = table([1, 0, 0.11, 0, 0.04])
const BASS = table([1, 0.35, 0.1])

export interface RenderedMusic {
  sampleRate: number
  left: Float32Array
  right: Float32Array
  durationSec: number
}

/** Renderiza a trilha de um clima: 8 compassos (a progressão de 4 acordes duas vezes). */
export function renderMusic(mood: Mood, sampleRate = 48000, variant = 0): RenderedMusic {
  const st = variantStyle(STYLES[mood], variant)
  const bars = st.chords.length * 2
  const stepSec = 60 / st.bpm / 4
  const n = Math.round(bars * 16 * stepSec * sampleRate)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const rand = rng(0xb16 + mood.length * 7919 + variant * 104729)

  /** Soma uma voz no buffer, dando a volta no fim para o loop ficar perfeito. */
  const voice = (startSec: number, durSec: number, gainL: number, gainR: number, sample: (t: number) => number): void => {
    const s0 = Math.round(startSec * sampleRate)
    const len = Math.round(durSec * sampleRate)
    for (let i = 0; i < len; i++) {
      const v = sample(i / sampleRate)
      const k = (s0 + i) % n
      L[k] += v * gainL
      R[k] += v * gainR
    }
  }
  const tone = (tab: Float32Array, f: number) => (t: number) => tab[Math.floor(t * f * tab.length) % tab.length]

  for (let bar = 0; bar < bars; bar++) {
    const chord = st.chords[bar % st.chords.length]
    const barStart = bar * 16 * stepSec
    const barLen = 16 * stepSec

    // Pad: acordes longos com ataque e soltura suaves (dois lados levemente desafinados = estéreo)
    if (st.pad > 0) {
      for (const note of chord) {
        const f = hz(note)
        const a = Math.min(0.4, barLen / 4)
        const env = (t: number) => Math.min(1, t / a) * Math.min(1, Math.max(0, (barLen + 0.3 - t) / 0.5))
        const g = st.pad / chord.length
        voice(barStart, barLen + 0.3, g, 0, (t) => tone(PAD, f * 1.003)(t) * env(t))
        voice(barStart, barLen + 0.3, 0, g, (t) => tone(PAD, f * 0.997)(t) * env(t))
      }
    }

    for (let step = 0; step < 16; step++) {
      const swing = st.swing && step % 2 === 1 ? (st.swing - 0.5) * 2 * stepSec : 0
      const at = barStart + step * stepSec + swing

      const k = vel(st.kick[step])
      if (k) voice(at, 0.45, 0.9 * k, 0.9 * k, (t) => Math.sin(2 * Math.PI * (45 * t + (105 / 18) * (1 - Math.exp(-18 * t)))) * Math.exp(-7 * t))

      const s = vel(st.snare[step])
      if (s) voice(at, 0.25, 0.3 * s, 0.3 * s, (t) => ((rand() * 2 - 1) * 0.7 + 0.5 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-22 * t))

      const h = vel(st.hat[step])
      if (h) {
        let prev = 0
        voice(at, 0.06, 0.1 * h, 0.16 * h, (t) => {
          const x = rand() * 2 - 1
          const y = x - prev // agudo: diferença de ruído
          prev = x
          return y * Math.exp(-70 * t)
        })
      }

      const b = vel(st.bass[step])
      if (b) {
        const which = st.bassNotes?.[step] === 'f' ? chord[0] + 7 : chord[0]
        const f = hz(which - 24)
        const dur = st.bassNotes ? stepSec * 2.5 : Math.min(barLen, stepSec * (st.bass.slice(step + 1).search(/[xos]/) + 1 || 16 - step))
        voice(at, dur, 0.38 * b, 0.38 * b, (t) => tone(BASS, f)(t) * Math.min(1, t / 0.005) * Math.min(1, (dur - t) / 0.03))
      }

      const a = vel(st.arp[step])
      if (a) {
        const note = chord[step % chord.length] + 12
        const pan = step % 2 ? 0.7 : 1
        voice(at, 0.5, 0.14 * a * pan, 0.14 * a * (1.7 - pan), (t) => tone(PLUCK, hz(note))(t) * Math.exp(-7 * t))
      }

      const c = vel(st.stab[step])
      if (c) {
        for (const note of chord) {
          const f = hz(note + (mood === 'epica' ? -12 : 0))
          const dur = mood === 'engracada' ? 0.12 : 0.6
          voice(at, dur, (0.2 * c) / chord.length, (0.2 * c) / chord.length, (t) => tone(mood === 'epica' ? PAD : PLUCK, f)(t) * Math.exp(-(mood === 'engracada' ? 25 : 4) * t))
        }
      }
    }
  }

  if (st.crackle) {
    for (let i = 0; i < n; i++) {
      if (rand() < 0.0007) {
        const v = (rand() * 2 - 1) * st.crackle * 20
        L[i] += v
        R[(i + 7) % n] += v
      }
    }
  }

  if (st.lowpassHz) {
    // Passa-baixa de um polo, rodado duas vezes para o começo também sair filtrado no loop
    const alpha = 1 - Math.exp((-2 * Math.PI * st.lowpassHz) / sampleRate)
    for (const ch of [L, R]) {
      let y = 0
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          y += alpha * (ch[i] - y)
          if (pass === 1) ch[i] = y
        }
      }
    }
  }

  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  const g = peak > 0 ? 0.8 / peak : 1
  for (let i = 0; i < n; i++) {
    L[i] *= g
    R[i] *= g
  }
  return { sampleRate, left: L, right: R, durationSec: n / sampleRate }
}

/** Codifica em WAV PCM 16 bits estéreo. */
export function encodeWav(m: RenderedMusic): Uint8Array {
  const n = m.left.length
  const buf = new ArrayBuffer(44 + n * 4)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 4, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, m.sampleRate, true)
  v.setUint32(28, m.sampleRate * 4, true)
  v.setUint16(32, 4, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 4, true)
  const clamp = (x: number) => Math.max(-1, Math.min(1, x)) * 32767
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, clamp(m.left[i]), true)
    v.setInt16(46 + i * 4, clamp(m.right[i]), true)
  }
  return new Uint8Array(buf)
}
