const STOPWORDS = new Set(
  `a o as os um uma uns umas de do da dos das no na nos nas em por para pra pro com sem que se e é ou mas mais menos
  muito muita muitos muitas eu tu ele ela nós vós eles elas você vocês me te lhe nos vos meu minha seu sua isso isto
  aquilo esse essa este esta aquele aquela aí ali aqui lá então tipo né já não sim só também foi ser ter tem tá tô
  vai vou era está estou estava como quando onde porque por que qual quem ao à às pelo pela pelos pelas até sobre
  depois antes agora ainda bem gente cara mano assim coisa coisas fazer faz fiz vamos lo la le the and to of`.split(/\s+/)
)

const strip = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Palavras mais frequentes (sem stopwords), para títulos e hashtags locais — sem IA, sem custo. */
export function keywords(text: string, max = 5): string[] {
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().match(/[\p{L}\d]+/gu) ?? []) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w)
}

export function hashtags(text: string, extra: string[] = ['cortes', 'shorts']): string[] {
  const tags = [...keywords(text, 5), ...extra].map((w) => `#${strip(w).replace(/[^a-z0-9]/gi, '').toLowerCase()}`)
  return [...new Set(tags)].filter((t) => t.length > 2)
}

/** Título curto: primeira pergunta/exclamação, senão a primeira frase. */
export function localTitle(text: string, max = 70): string {
  const sentences = text.match(/[^.!?…]+[.!?…]?/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  const pick = sentences.find((s) => /[?!]$/.test(s)) ?? sentences[0] ?? ''
  return pick.length > max ? `${pick.slice(0, max - 1).trimEnd()}…` : pick
}

export function localDescription(text: string): string {
  const title = localTitle(text)
  return [title, '', hashtags(text).join(' ')].join('\n').trim()
}
