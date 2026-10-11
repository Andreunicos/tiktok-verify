/**
 * Enquadramento que acompanha a pessoa (sem IA): em quadros pequenos (≈96 px), procura onde há
 * pele e movimento e escolhe a faixa vertical que vai virar o vídeo 9:16. Depois suaviza para a
 * "câmera" não ficar tremendo. Lógica pura e testável; a leitura dos quadros fica em main/media/track.ts.
 */

export interface FrameSample {
  /** Tempo do quadro (s, na origem). */
  t: number
  /** Centro horizontal da pessoa (0..1 da largura) ou null se não achou. */
  center: number | null
  /** Fração de pixels de pele no quadro (0..1). */
  skin: number
  /** Quanto da "atenção" (pele+movimento) cabe na faixa escolhida (0..1). */
  confidence: number
}

const isSkin = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b
}

/**
 * Analisa um quadro RGB24. `cropFrac` é a largura da faixa 9:16 em relação à largura do quadro.
 * Retorna também a imagem em tons de cinza para comparar com o próximo quadro (movimento).
 */
export function analyzeFrame(rgb: Uint8Array, w: number, h: number, cropFrac: number, prevGray: Uint8Array | null, t = 0): { sample: FrameSample; gray: Uint8Array } {
  const col = new Float64Array(w)
  const gray = new Uint8Array(w * h)
  let skinCount = 0
  for (let y = 0; y < h; y++) {
    // Rostos costumam ficar nos 2/3 de cima: pesa mais
    const rowWeight = y < (h * 2) / 3 ? 1 : 0.5
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const r = rgb[i]
      const g = rgb[i + 1]
      const b = rgb[i + 2]
      const gv = (r * 77 + g * 150 + b * 29) >> 8
      gray[y * w + x] = gv
      if (isSkin(r, g, b)) {
        skinCount++
        col[x] += rowWeight
      }
      if (prevGray) {
        const diff = Math.abs(gv - prevGray[y * w + x])
        if (diff > 25) col[x] += 0.35 * rowWeight
      }
    }
  }
  const total = col.reduce((a, b) => a + b, 0)
  const win = Math.max(1, Math.round(w * cropFrac))
  if (total < w * h * 0.004) return { sample: { t, center: null, skin: skinCount / (w * h), confidence: 0 }, gray }
  let best = 0
  let bestX = 0
  let sum = 0
  for (let x = 0; x < w; x++) {
    sum += col[x]
    if (x >= win) sum -= col[x - win]
    if (x >= win - 1 && sum > best) {
      best = sum
      bestX = x - win + 1
    }
  }
  // Centro de massa dentro da faixa (mais estável que o meio da janela)
  let m = 0
  let mw = 0
  for (let x = bestX; x < bestX + win; x++) {
    m += col[x] * (x + 0.5)
    mw += col[x]
  }
  const center = mw > 0 ? m / mw / w : (bestX + win / 2) / w
  return { sample: { t, center, skin: skinCount / (w * h), confidence: best / total }, gray }
}

/** Converte o centro da pessoa (0..1) na posição do recorte usada pelo FFmpeg (0 = esquerda, 1 = direita). */
export function centerToCropX(center: number, cropFrac: number): number {
  if (cropFrac >= 1) return 0.5
  const left = Math.min(1 - cropFrac, Math.max(0, center - cropFrac / 2))
  return Math.round((left / (1 - cropFrac)) * 1000) / 1000
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export interface TrackDecision {
  /** true = vale recortar seguindo a pessoa; false = melhor mostrar o vídeo inteiro (fundo desfocado). */
  follow: boolean
  /** Pontos {t (origem), x (posição do recorte 0..1)} já suavizados. */
  points: { t: number; x: number }[]
  reason: string
}

/**
 * Suaviza (mediana + zona morta) e decide se compensa recortar: só quando há uma pessoa grande
 * na imagem (pele em ≥1,2% dos pixels na maioria dos quadros). Webcam pequena num canto de
 * gameplay → mostra o vídeo inteiro para não perder o jogo.
 */
export function decideTrack(samples: FrameSample[], cropFrac: number, opts = { deadzone: 0.08, holdSamples: 2, moveSec: 0.6 }): TrackDecision {
  const found = samples.filter((s) => s.center !== null)
  if (samples.length === 0 || found.length < samples.length * 0.5) return { follow: false, points: [], reason: 'Nenhuma pessoa clara na imagem' }
  const bigPerson = samples.filter((s) => s.skin >= 0.012).length >= samples.length * 0.6
  if (!bigPerson) return { follow: false, points: [], reason: 'Pessoa pequena na imagem (ex.: webcam no canto)' }
  // Preenche buracos com o último centro conhecido e aplica mediana de 5
  let last = found[0].center!
  const filled = samples.map((s) => (s.center === null ? last : (last = s.center)))
  const med = filled.map((_, i) => medianOf(filled.slice(Math.max(0, i - 2), i + 3)))
  const points: { t: number; x: number }[] = []
  let current = med[0]
  let pending = 0
  points.push({ t: samples[0].t, x: centerToCropX(current, cropFrac) })
  for (let i = 1; i < med.length; i++) {
    if (Math.abs(med[i] - current) > opts.deadzone) {
      pending++
      if (pending >= opts.holdSamples) {
        const t = samples[i].t
        points.push({ t, x: centerToCropX(current, cropFrac) })
        current = med[i]
        points.push({ t: t + opts.moveSec, x: centerToCropX(current, cropFrac) })
        pending = 0
      }
    } else pending = 0
  }
  // Tira pontos repetidos seguidos
  const out = points.filter((p, i) => i === 0 || i === points.length - 1 || Math.abs(p.x - points[i - 1].x) > 1e-3 || Math.abs(p.x - points[i + 1].x) > 1e-3)
  return { follow: true, points: out.slice(0, 40), reason: 'Pessoa em destaque: recorte acompanha' }
}
