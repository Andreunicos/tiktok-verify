import { join } from 'node:path'
import type { Mood, OpenverseResult, SoundItem, SoundKind } from '../shared/types'
import { downloadFile } from './installer'
import type { SoundLibrary } from './sounds'

/** Openverse: catálogo aberto (WordPress) de áudio com licenças Creative Commons e domínio público. */
export const OPENVERSE_API = 'https://api.openverse.org/v1/audio/'

/** Buscas usadas para cada clima de música (tenta na ordem até achar faixas suficientes). */
export const MOOD_QUERIES: Record<Mood, string[]> = {
  animada: ['upbeat electronic', 'energetic', 'dance', 'electronic'],
  calma: ['calm ambient', 'chill', 'ambient', 'piano'],
  epica: ['epic cinematic', 'epic', 'cinematic', 'trailer'],
  lofi: ['lofi', 'lo-fi hip hop', 'chillhop', 'hip hop beat'],
  engracada: ['funny', 'comedy', 'quirky', 'ukulele']
}
export const MOOD_QUERY: Record<Mood, string> = Object.fromEntries(Object.entries(MOOD_QUERIES).map(([k, v]) => [k, v[0]])) as Record<Mood, string>

export interface SearchOptions {
  query: string
  kind: SoundKind
  /** Por padrão só CC0 e domínio público (uso comercial sem crédito). */
  allowAttribution?: boolean
  page?: number
  pageSize?: number
  api?: string
  fetchImpl?: typeof fetch
}

const LICENSE_NAMES: Record<string, string> = { cc0: 'CC0', pdm: 'Domínio público', by: 'CC BY', 'by-sa': 'CC BY-SA' }

export function normalizeOpenverse(raw: Record<string, any>): OpenverseResult | null {
  if (!raw || typeof raw.url !== 'string' || !/^https?:\/\//.test(raw.url)) return null
  const license = String(raw.license ?? '').toLowerCase()
  const version = raw.license_version ? String(raw.license_version) : null
  return {
    id: String(raw.id ?? raw.url),
    title: String(raw.title ?? 'Sem título').slice(0, 120),
    creator: raw.creator ? String(raw.creator) : null,
    license: `${LICENSE_NAMES[license] ?? license.toUpperCase()}${version && license !== 'cc0' && license !== 'pdm' ? ` ${version}` : ''}`,
    licenseVersion: version,
    licenseUrl: raw.license_url ? String(raw.license_url) : null,
    url: raw.url,
    landingUrl: raw.foreign_landing_url ? String(raw.foreign_landing_url) : null,
    durationSec: typeof raw.duration === 'number' ? Math.round(raw.duration / 100) / 10 : null,
    filetype: raw.filetype ? String(raw.filetype) : null,
    attribution: license === 'cc0' || license === 'pdm' ? null : raw.attribution ? String(raw.attribution) : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t: { name?: string }) => String(t?.name ?? '')).filter(Boolean).slice(0, 8) : [],
    provider: raw.provider ? String(raw.provider) : null
  }
}

/** Busca músicas ou efeitos com licença livre para uso comercial. */
export async function searchOpenverse(opts: SearchOptions): Promise<OpenverseResult[]> {
  const f = opts.fetchImpl ?? fetch
  const url = new URL(opts.api ?? OPENVERSE_API)
  url.searchParams.set('q', opts.query)
  url.searchParams.set('category', opts.kind === 'musica' ? 'music' : 'sound_effect')
  url.searchParams.set('license', opts.allowAttribution ? 'cc0,pdm,by' : 'cc0,pdm')
  url.searchParams.set('license_type', 'commercial')
  url.searchParams.set('mature', 'false')
  url.searchParams.set('page_size', String(opts.pageSize ?? 20))
  url.searchParams.set('page', String(opts.page ?? 1))
  let res: Response
  try {
    res = await f(url, { headers: { Accept: 'application/json', 'User-Agent': 'BigLoop-AutoClips' } })
  } catch (err) {
    throw new Error(`Sem conexão com o Openverse (${(err as Error).message}).`)
  }
  if (res.status === 429) throw new Error('O Openverse limitou as buscas por agora. Tente de novo em alguns minutos.')
  if (!res.ok) throw new Error(`O Openverse respondeu ${res.status}.`)
  const data = (await res.json()) as { results?: Record<string, any>[] }
  return (data.results ?? []).map(normalizeOpenverse).filter((r): r is OpenverseResult => r !== null)
}

/** Baixa um resultado para a biblioteca, guardando licença e crédito. */
export async function downloadToLibrary(
  r: OpenverseResult,
  kind: SoundKind,
  mood: Mood | null,
  lib: SoundLibrary,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; onProgress?: (ratio: number) => void } = {}
): Promise<SoundItem> {
  if (lib.has(r.url)) return lib.list().find((i) => i.sourceUrl === r.url)!
  const ext = (r.filetype && /^[a-z0-9]{2,4}$/i.test(r.filetype) ? r.filetype : r.url.split('?')[0].split('.').pop() ?? 'mp3').toLowerCase()
  const dest = join(lib.filesDir, `openverse-${r.id.replace(/[^a-z0-9-]/gi, '').slice(0, 40)}.${ext}`)
  await downloadFile(r.url, dest, { fetchImpl: opts.fetchImpl, signal: opts.signal, minBytes: 1000, onProgress: (rec, tot) => opts.onProgress?.(tot ? rec / tot : 0) })
  return lib.add({
    kind,
    title: r.title,
    file: dest,
    durationSec: r.durationSec ?? 0,
    mood,
    tags: r.tags,
    license: r.license,
    licenseUrl: r.licenseUrl,
    creator: r.creator,
    sourceUrl: r.url,
    attribution: r.attribution ?? (r.license.startsWith('CC BY') ? `"${r.title}" por ${r.creator ?? 'autor desconhecido'} — ${r.license}` : null),
    origin: 'openverse'
  })
}
