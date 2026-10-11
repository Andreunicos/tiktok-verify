import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadToLibrary, normalizeOpenverse, searchOpenverse } from '../src/main/openverse'
import { resolveTool } from '../src/main/media/tools'
import { GENERATED_EFFECTS, SoundLibrary } from '../src/main/sounds'

const ffmpeg = resolveTool('ffmpeg', '')
const ffprobe = resolveTool('ffprobe', '')
const dir = join(__dirname, '.tmp-sounds')

describe('normalizeOpenverse', () => {
  it('converte o formato da API e calcula licença e crédito', () => {
    const cc0 = normalizeOpenverse({ id: 'a1', title: 'Beat', creator: 'Ana', license: 'cc0', license_version: '1.0', url: 'https://x/a.mp3', duration: 125300, filetype: 'mp3', tags: [{ name: 'lofi' }] })!
    expect(cc0).toMatchObject({ license: 'CC0', attribution: null, durationSec: 125.3, tags: ['lofi'] })
    const by = normalizeOpenverse({ id: 'b', title: 'Song', creator: 'Bo', license: 'by', license_version: '4.0', url: 'https://x/b.ogg', attribution: '"Song" by Bo is licensed under CC BY 4.0.' })!
    expect(by.license).toBe('CC BY 4.0')
    expect(by.attribution).toMatch(/CC BY 4\.0/)
    expect(normalizeOpenverse({ id: 'c', url: 'javascript:alert(1)' })).toBeNull()
  })
})

describe.skipIf(!ffmpeg || !ffprobe)('Biblioteca de sons', () => {
  let server: Server
  let base = ''
  const requests: URL[] = []
  beforeAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const mp3 = join(dir, 'musica.mp3')
    spawnSync(ffmpeg!, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:a', 'libmp3lame', mp3])
    const audio = require('node:fs').readFileSync(mp3)
    server = createServer((req, res) => {
      const url = new URL(req.url!, base)
      if (url.pathname === '/v1/audio/') {
        requests.push(url)
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(
          JSON.stringify({
            result_count: 2,
            results: [
              { id: 'm1', title: 'Calm Loop', creator: 'Ana', license: 'cc0', url: `${base}/f/m1.mp3`, foreign_landing_url: 'https://freesound.org/s/1', duration: 6000, filetype: 'mp3', tags: [{ name: 'calm' }] },
              { id: 'bad', title: 'x', license: 'cc0', url: 'ftp://nope' }
            ]
          })
        )
      }
      if (url.pathname === '/f/m1.mp3') {
        res.writeHead(200, { 'content-length': String(audio.length) })
        return res.end(audio)
      }
      res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('gera o pacote de efeitos (áudio válido) só uma vez', async () => {
    const lib = new SoundLibrary(join(dir, 'lib'))
    expect(await lib.ensureGeneratedEffects(ffmpeg!)).toBe(GENERATED_EFFECTS.length)
    expect(await lib.ensureGeneratedEffects(ffmpeg!)).toBe(0)
    const fx = lib.list('efeito')
    expect(fx).toHaveLength(GENERATED_EFFECTS.length)
    for (const f of fx) {
      const r = spawnSync(ffprobe!, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', f.file])
      expect(r.stdout.toString().trim()).toBe('pcm_s16le,48000,2')
      expect(f.durationSec).toBeGreaterThan(0.05)
      expect(f.license).toMatch(/CC0/)
    }
    // recarrega do disco
    expect(new SoundLibrary(join(dir, 'lib')).list('efeito')).toHaveLength(GENERATED_EFFECTS.length)
  })

  it('gera a trilha do clima sem internet (WAV válido, CC0) e reaproveita depois', async () => {
    const lib = new SoundLibrary(join(dir, 'lib-musica'))
    const a = await lib.ensureGeneratedMusic('lofi')
    const b = await lib.ensureGeneratedMusic('lofi')
    expect(b.id).toBe(a.id)
    expect(a.kind).toBe('musica')
    expect(a.mood).toBe('lofi')
    expect(a.origin).toBe('gerado')
    expect(a.license).toMatch(/CC0/)
    const r = spawnSync(ffprobe!, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'csv=p=0', a.file])
    const out = r.stdout.toString()
    expect(out).toContain('pcm_s16le,48000,2')
    expect(Math.abs(Number(out.trim().split('\n').pop()) - a.durationSec)).toBeLessThan(0.05)
    expect(lib.pick('musica', 'lofi')?.id).toBe(a.id)
    expect(new SoundLibrary(join(dir, 'lib-musica')).list('musica')).toHaveLength(1)
  })

  it('busca no Openverse só CC0/domínio público e baixa com metadados', async () => {
    const lib = new SoundLibrary(join(dir, 'lib'))
    const results = await searchOpenverse({ query: 'calm', kind: 'musica', api: `${base}/v1/audio/` })
    expect(results).toHaveLength(1)
    const q = requests.at(-1)!
    expect(q.searchParams.get('license')).toBe('cc0,pdm')
    expect(q.searchParams.get('license_type')).toBe('commercial')
    expect(q.searchParams.get('category')).toBe('music')
    const item = await downloadToLibrary(results[0], 'musica', 'calma', lib)
    expect(existsSync(item.file)).toBe(true)
    expect(item).toMatchObject({ kind: 'musica', mood: 'calma', license: 'CC0', origin: 'openverse', creator: 'Ana' })
    // não baixa duas vezes
    expect((await downloadToLibrary(results[0], 'musica', 'calma', lib)).id).toBe(item.id)
    expect(lib.pick('musica', 'calma')!.id).toBe(item.id)
    expect(lib.pick('musica', 'epica')).toBeNull()
  })

  it('importa arquivo próprio e remove sem apagar o original', async () => {
    const lib = new SoundLibrary(join(dir, 'lib'))
    const own = join(dir, 'musica.mp3')
    const item = await lib.importFile(ffprobe!, own, 'musica', 'animada')
    expect(item.durationSec).toBeGreaterThan(5)
    expect(item.file).not.toBe(own)
    await lib.remove(item.id)
    expect(existsSync(item.file)).toBe(false)
    expect(existsSync(own)).toBe(true)
  })

  it('erros do Openverse viram mensagens claras', async () => {
    const f = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    await expect(searchOpenverse({ query: 'x', kind: 'efeito', fetchImpl: f })).rejects.toThrow(/limitou/)
    const off = (async () => {
      throw new Error('ENOTFOUND')
    }) as unknown as typeof fetch
    await expect(searchOpenverse({ query: 'x', kind: 'efeito', fetchImpl: off })).rejects.toThrow(/Sem conexão/)
  })
})
