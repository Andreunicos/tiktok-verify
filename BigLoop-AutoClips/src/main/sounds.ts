import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, normalize, sep } from 'node:path'
import { encodeWav, generatedMusicTitle, renderMusic } from '../shared/music'
import type { Mood, SoundItem, SoundKind } from '../shared/types'
import { readJson, writeJsonAtomic } from './jsonFile'
import { runSimple } from './media/export'
import { probeMedia } from './media/probe'

/**
 * Efeitos sonoros criados pelo próprio app (síntese com FFmpeg). Por serem gerados aqui, não têm
 * direitos de terceiros: uso livre (CC0).
 */
export const GENERATED_EFFECTS: { key: string; title: string; tags: string[]; lavfi: string; post?: string }[] = [
  { key: 'whoosh', title: 'Whoosh (passagem)', tags: ['transição', 'entrada'], lavfi: 'anoisesrc=color=pink:d=0.9:a=0.6', post: 'bandpass=f=1400:width_type=h:w=2400,afade=t=in:d=0.4,afade=t=out:st=0.45:d=0.45' },
  { key: 'pop', title: 'Pop', tags: ['legenda', 'destaque'], lavfi: "aevalsrc='0.8*sin(2*PI*(380+900*exp(-28*t))*t)*exp(-22*t)':d=0.3" },
  { key: 'ding', title: 'Ding (acerto)', tags: ['destaque', 'acerto'], lavfi: "aevalsrc='0.55*sin(2*PI*1320*t)*exp(-3.5*t)+0.28*sin(2*PI*2640*t)*exp(-5*t)':d=1.4" },
  { key: 'impacto', title: 'Impacto grave', tags: ['impacto', 'drop'], lavfi: "aevalsrc='0.9*sin(2*PI*(45+140*exp(-7*t))*t)*exp(-2.6*t)':d=1.6", post: 'alimiter=limit=0.9' },
  { key: 'subida', title: 'Subida (riser)', tags: ['tensão', 'transição'], lavfi: "aevalsrc='0.45*sin(2*PI*(180+260*t*t)*t)*(t/2.2)':d=2.2", post: 'afade=t=out:st=2.05:d=0.15' },
  { key: 'clique', title: 'Clique', tags: ['interface'], lavfi: "aevalsrc='0.9*(random(0)*2-1)*exp(-180*t)':d=0.08" },
  { key: 'notificacao', title: 'Notificação', tags: ['interface', 'alerta'], lavfi: "aevalsrc='0.5*sin(2*PI*880*t)*lt(t\\,0.12)*exp(-8*t)+0.5*sin(2*PI*1175*t)*gte(t\\,0.14)*exp(-8*(t-0.14))':d=0.6" },
  { key: 'erro', title: 'Erro (buzina)', tags: ['erro', 'engraçado'], lavfi: "aevalsrc='0.4*sgn(sin(2*PI*110*t))*lt(t\\,0.5)+0.4*sgn(sin(2*PI*92*t))*gte(t\\,0.55)':d=1.1", post: 'lowpass=f=1800,afade=t=out:st=0.95:d=0.15' }
]

export const MOOD_LABEL: Record<Mood, string> = {
  animada: 'Animada',
  calma: 'Calma',
  epica: 'Épica',
  lofi: 'Lo-fi',
  engracada: 'Engraçada'
}

/** Biblioteca local de músicas e efeitos (arquivos ficam dentro da pasta do app). */
export class SoundLibrary {
  private items: SoundItem[]
  private readonly indexFile: string
  readonly filesDir: string

  constructor(private readonly dir: string) {
    this.indexFile = join(dir, 'biblioteca.json')
    this.filesDir = join(dir, 'arquivos')
    this.items = readJson<SoundItem[]>(this.indexFile, []).filter((i) => existsSync(i.file))
  }

  list(kind?: SoundKind): SoundItem[] {
    return this.items.filter((i) => !kind || i.kind === kind).sort((a, b) => b.addedAt - a.addedAt)
  }

  get(id: string): SoundItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  has(sourceUrl: string): boolean {
    return this.items.some((i) => i.sourceUrl === sourceUrl)
  }

  add(item: Omit<SoundItem, 'id' | 'addedAt'>): SoundItem {
    const full: SoundItem = { ...item, id: randomUUID(), addedAt: Date.now() }
    this.items.push(full)
    this.save()
    return full
  }

  update(id: string, patch: Partial<Pick<SoundItem, 'title' | 'mood' | 'tags'>>): SoundItem | undefined {
    const it = this.get(id)
    if (!it) return undefined
    Object.assign(it, patch)
    this.save()
    return it
  }

  /** Remove da biblioteca; apaga o arquivo só se ele estiver dentro da pasta do app. */
  async remove(id: string): Promise<void> {
    const it = this.get(id)
    if (!it) return
    this.items = this.items.filter((i) => i.id !== id)
    this.save()
    const inside = normalize(it.file).startsWith(normalize(this.filesDir) + sep)
    if (inside) await rm(it.file, { force: true })
  }

  /** Sorteia um item (opcionalmente do clima pedido). */
  pick(kind: SoundKind, mood?: Mood | null, random = Math.random): SoundItem | null {
    const pool = this.items.filter((i) => i.kind === kind && (!mood || i.mood === mood))
    return pool.length ? pool[Math.floor(random() * pool.length)] : null
  }

  /** Gera os efeitos que ainda não existem. Retorna quantos foram criados. */
  async ensureGeneratedEffects(ffmpeg: string): Promise<number> {
    await mkdir(this.filesDir, { recursive: true })
    let created = 0
    for (const fx of GENERATED_EFFECTS) {
      const file = join(this.filesDir, `efeito-${fx.key}.wav`)
      if (this.items.some((i) => i.file === file)) continue
      const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', fx.lavfi]
      args.push('-af', [fx.post, 'aformat=sample_rates=48000:channel_layouts=stereo'].filter(Boolean).join(','), '-c:a', 'pcm_s16le', file)
      await runSimple(ffmpeg, args)
      const d = GENERATED_EFFECTS.find((g) => g.key === fx.key)!
      this.add({
        kind: 'efeito',
        title: d.title,
        file,
        durationSec: await wavDuration(file),
        mood: null,
        tags: [...d.tags, fx.key],
        license: 'Gerado pelo app (CC0)',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        creator: 'BigLoop AutoClips',
        sourceUrl: null,
        attribution: null,
        origin: 'gerado'
      })
      created++
    }
    return created
  }

  /**
   * Garante a trilha gerada pelo app para um clima (funciona sem internet). Retorna o item
   * existente ou cria o WAV na hora.
   */
  async ensureGeneratedMusic(mood: Mood): Promise<SoundItem> {
    const file = join(this.filesDir, `musica-gerada-${mood}.wav`)
    const existing = this.items.find((i) => i.file === file)
    if (existing) return existing
    await mkdir(this.filesDir, { recursive: true })
    const m = renderMusic(mood)
    const tmp = `${file}.part`
    await writeFile(tmp, encodeWav(m))
    await rename(tmp, file)
    return this.add({
      kind: 'musica',
      title: generatedMusicTitle(mood),
      file,
      durationSec: Math.round(m.durationSec * 1000) / 1000,
      mood,
      tags: ['gerada', 'loop'],
      license: 'Gerado pelo app (CC0)',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      creator: 'BigLoop AutoClips',
      sourceUrl: null,
      attribution: null,
      origin: 'gerado'
    })
  }

  /** Copia um arquivo do usuário para a biblioteca. */
  async importFile(ffprobe: string, path: string, kind: SoundKind, mood: Mood | null): Promise<SoundItem> {
    const meta = await probeMedia(ffprobe, path)
    if (meta.audioTracks.length === 0) throw new Error('Esse arquivo não tem áudio.')
    await mkdir(this.filesDir, { recursive: true })
    const dest = join(this.filesDir, `${randomUUID()}${extname(path).toLowerCase() || '.mp3'}`)
    await copyFile(path, dest)
    return this.add({
      kind,
      title: basename(path, extname(path)),
      file: dest,
      durationSec: meta.durationSec,
      mood,
      tags: [],
      license: 'Arquivo próprio',
      licenseUrl: null,
      creator: null,
      sourceUrl: null,
      attribution: null,
      origin: 'importado'
    })
  }

  private save(): void {
    writeJsonAtomic(this.indexFile, this.items)
  }
}

/** Duração de um WAV PCM 48 kHz, 16 bits, estéreo (formato dos efeitos gerados). */
async function wavDuration(file: string): Promise<number> {
  const s = await stat(file)
  return Math.round(((s.size - 44) / (48000 * 2 * 2)) * 1000) / 1000
}
