import { createHash, randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AnalysisResult, MediaMetadata, Project, ProjectSummary } from '../shared/types'
import { readJson, writeJsonAtomic } from './jsonFile'

/** Biblioteca de vídeos importados. Remover um projeto nunca apaga o vídeo original. */
export class ProjectStore {
  private index: Omit<ProjectSummary, 'segments' | 'missing'>[]
  private readonly indexFile: string

  constructor(private readonly dir: string) {
    this.indexFile = join(dir, 'biblioteca.json')
    this.index = readJson(this.indexFile, [])
  }

  static idFor(path: string): string {
    return createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)
  }

  private file(id: string) {
    return join(this.dir, `${id}.json`)
  }

  cacheDir(id: string): string {
    return join(this.dir, 'cache', id)
  }

  list(): ProjectSummary[] {
    return this.index
      .map((p) => ({ ...p, segments: this.get(p.id)?.segments.length ?? 0, missing: !existsSync(p.path) }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  findByPath(path: string): Project | null {
    return this.get(ProjectStore.idFor(path))
  }

  get(id: string): Project | null {
    if (!/^[0-9a-f]{16}$/.test(id)) return null
    const p = readJson<Partial<Project> | null>(this.file(id), null)
    return p ? ({ markers: [], suggestions: [], transcript: null, segments: [], hasAnalysis: false, ...p } as Project) : null
  }

  /** Cria (ou reabre) o projeto de um vídeo. */
  open(meta: MediaMetadata, origin: Project['origin']): Project {
    const id = ProjectStore.idFor(meta.path)
    const existing = this.get(id)
    const now = Date.now()
    const project: Project = existing
      ? { ...existing, durationSec: meta.durationSec, updatedAt: now }
      : { id, path: meta.path, fileName: meta.fileName, durationSec: meta.durationSec, addedAt: now, updatedAt: now, origin, segments: [], markers: [], transcript: null, suggestions: [], hasAnalysis: false }
    this.save(project)
    return project
  }

  update(id: string, patch: Partial<Omit<Project, 'id' | 'path'>>): Project | null {
    const p = this.get(id)
    if (!p) return null
    const next = { ...p, ...patch, id: p.id, path: p.path, updatedAt: Date.now() }
    this.save(next)
    return next
  }

  addMarkers(id: string, markers: { timeSec: number; label: string; source: 'obs' | 'manual' }[]): Project | null {
    const p = this.get(id)
    if (!p) return null
    return this.update(id, { markers: [...p.markers, ...markers.map((m) => ({ ...m, id: randomUUID() }))].sort((a, b) => a.timeSec - b.timeSec) })
  }

  remove(id: string): void {
    this.index = this.index.filter((p) => p.id !== id)
    writeJsonAtomic(this.indexFile, this.index)
    rmSync(this.file(id), { force: true })
    rmSync(join(this.dir, `${id}.analysis.json`), { force: true })
    rmSync(this.cacheDir(id), { recursive: true, force: true })
  }

  getAnalysis(id: string): AnalysisResult | null {
    return readJson<AnalysisResult | null>(join(this.dir, `${id}.analysis.json`), null)
  }

  saveAnalysis(id: string, analysis: AnalysisResult): void {
    writeJsonAtomic(join(this.dir, `${id}.analysis.json`), analysis)
    this.update(id, { hasAnalysis: true })
  }

  private save(p: Project): void {
    writeJsonAtomic(this.file(p.id), p)
    const summary = { id: p.id, path: p.path, fileName: p.fileName, durationSec: p.durationSec, addedAt: p.addedAt, updatedAt: p.updatedAt, origin: p.origin }
    const i = this.index.findIndex((x) => x.id === p.id)
    if (i >= 0) this.index[i] = summary
    else this.index.push(summary)
    writeJsonAtomic(this.indexFile, this.index)
  }
}
