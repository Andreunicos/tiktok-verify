/**
 * Aprender com os resultados reais: compara as visualizações dos seus próprios posts.
 * Os que foram muito melhor que o normal ensinam "faça mais assim"; os muito piores, "evite".
 * Só usa posts com pelo menos 48 h (antes disso os números ainda estão subindo).
 */
export interface PostPerformance {
  key: string
  views: number
  ageHours: number
  learned: boolean
}

export function pickLearning(posts: PostPerformance[], minPosts = 4): { up: string[]; down: string[] } {
  const mature = posts.filter((p) => p.ageHours >= 48)
  if (mature.length < minPosts) return { up: [], down: [] }
  const score = (v: number) => Math.log10(1 + v)
  const sorted = [...mature].sort((a, b) => score(a.views) - score(b.views))
  const third = Math.max(1, Math.floor(sorted.length / 3))
  const low = new Set(sorted.slice(0, third).map((p) => p.key))
  const high = new Set(sorted.slice(-third).map((p) => p.key))
  const fresh = mature.filter((p) => !p.learned)
  return { up: fresh.filter((p) => high.has(p.key)).map((p) => p.key), down: fresh.filter((p) => low.has(p.key) && !high.has(p.key)).map((p) => p.key) }
}
