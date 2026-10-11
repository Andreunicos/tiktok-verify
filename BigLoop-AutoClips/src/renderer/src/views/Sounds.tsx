import { useEffect, useRef, useState } from 'react'
import { formatTimecode } from '@shared/time'
import type { Mood, OpenverseResult, SoundItem, SoundKind } from '@shared/types'
import { useToast } from '../lib/ui'

const MOODS: [Mood, string][] = [
  ['animada', 'Animada'],
  ['epica', 'Épica'],
  ['lofi', 'Lo-fi'],
  ['calma', 'Calma'],
  ['engracada', 'Engraçada']
]
const SUGGESTED = { musica: ['lofi', 'upbeat', 'epic', 'chill', 'electronic', 'piano'], efeito: ['whoosh', 'pop', 'swoosh', 'impact', 'click', 'laugh'] }

/** Biblioteca de músicas e efeitos: busca no Openverse (licenças livres), importa arquivos e organiza por clima. */
export function Sounds() {
  const api = window.bigloop
  const toast = useToast()
  const [kind, setKind] = useState<SoundKind>('musica')
  const [items, setItems] = useState<SoundItem[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<OpenverseResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [allowBy, setAllowBy] = useState(false)
  const [mood, setMood] = useState<Mood>('animada')
  const [playing, setPlaying] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const audio = useRef<HTMLAudioElement>(null)

  const reload = async () => setItems(await api.soundsList())
  useEffect(() => {
    void reload()
  }, [])

  const play = (src: string) => {
    const a = audio.current
    if (!a) return
    if (playing === src) {
      a.pause()
      setPlaying(null)
      return
    }
    a.src = src
    void a.play()
    setPlaying(src)
  }

  const search = async (term = q) => {
    if (!term.trim()) return
    setQ(term)
    setSearching(true)
    const res = await api.soundsSearch(term, kind, allowBy)
    setSearching(false)
    if (!res.ok) return toast(res.error, 'erro')
    setResults(res.value)
  }

  const shown = items.filter((i) => i.kind === kind)
  return (
    <main className="sounds">
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      <div className="row between">
        <div>
          <h1>Sons</h1>
          <p className="muted small">Músicas e efeitos para os cortes. Por padrão só licenças livres para uso comercial, sem precisar dar crédito (CC0 e domínio público).</p>
        </div>
        <div className="seg">
          <button className={kind === 'musica' ? 'on' : ''} onClick={() => (setKind('musica'), setResults(null))}>
            🎵 Músicas
          </button>
          <button className={kind === 'efeito' ? 'on' : ''} onClick={() => (setKind('efeito'), setResults(null))}>
            💥 Efeitos
          </button>
        </div>
      </div>

      <section className="card">
        <h2>Buscar no Openverse</h2>
        <div className="row">
          <input type="search" placeholder={kind === 'musica' ? 'ex.: lofi, epic, upbeat…' : 'ex.: whoosh, pop, impact…'} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button className="primary" onClick={() => search()} disabled={searching}>
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        <div className="row wrap small">
          {SUGGESTED[kind].map((t) => (
            <button key={t} className="ghost small" onClick={() => search(t)}>
              {t}
            </button>
          ))}
          <label className="check">
            <input type="checkbox" checked={allowBy} onChange={(e) => setAllowBy(e.target.checked)} />
            <span>Incluir CC BY (exige crédito — o app coloca no texto do post)</span>
          </label>
        </div>
        {kind === 'musica' && (
          <div className="row wrap small">
            <span className="muted">Guardar como:</span>
            {MOODS.map(([m, t]) => (
              <button key={m} className={`choice mini ${mood === m ? 'on' : ''}`} onClick={() => setMood(m)}>
                {t}
              </button>
            ))}
          </div>
        )}
        {results && results.length === 0 && <p className="muted">Nada encontrado com licença livre. Tente outra palavra (em inglês costuma achar mais).</p>}
        {results && results.length > 0 && (
          <ul className="sound-list">
            {results.map((r) => {
              const have = items.some((i) => i.sourceUrl === r.url)
              return (
                <li key={r.id}>
                  <button className="ghost icon" onClick={() => play(r.url)} aria-label="Ouvir">
                    {playing === r.url ? '⏸' : '▶'}
                  </button>
                  <div className="grow">
                    <strong>{r.title}</strong>
                    <span className="muted small block">
                      {r.creator ?? 'autor desconhecido'} · {r.license}
                      {r.durationSec ? ` · ${formatTimecode(r.durationSec).replace(/\.\d+$/, '')}` : ''}
                      {r.provider ? ` · ${r.provider}` : ''}
                    </span>
                  </div>
                  <button
                    className="small"
                    disabled={have || downloading.has(r.id)}
                    onClick={async () => {
                      setDownloading((d) => new Set(d).add(r.id))
                      const res = await api.soundsDownload(r, kind, kind === 'musica' ? mood : null)
                      setDownloading((d) => {
                        const n = new Set(d)
                        n.delete(r.id)
                        return n
                      })
                      if (!res.ok) return toast(res.error, 'erro')
                      toast('Adicionado à biblioteca.', 'ok')
                      await reload()
                    }}
                  >
                    {have ? '✓ Na biblioteca' : downloading.has(r.id) ? 'Baixando…' : '+ Adicionar'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Minha biblioteca ({shown.length})</h2>
          <button
            className="small"
            onClick={async () => {
              const res = await api.soundsImport(kind, kind === 'musica' ? mood : null)
              if (!res.ok) return toast(res.error, 'erro')
              if (res.value) {
                toast('Arquivo importado.', 'ok')
                await reload()
              }
            }}
          >
            Importar arquivo meu…
          </button>
        </div>
        {kind === 'musica' && shown.length === 0 && (
          <p className="muted small">Vazia por enquanto. Ao gerar cortes com música, o app baixa algumas músicas livres do clima escolhido automaticamente.</p>
        )}
        <ul className="sound-list">
          {shown.map((i) => (
            <li key={i.id}>
              <button className="ghost icon" onClick={() => play(api.mediaUrl(i.file))} aria-label="Ouvir">
                {playing === api.mediaUrl(i.file) ? '⏸' : '▶'}
              </button>
              <div className="grow">
                <strong>{i.title}</strong>
                <span className="muted small block">
                  {i.license}
                  {i.creator ? ` · ${i.creator}` : ''}
                  {i.durationSec ? ` · ${formatTimecode(i.durationSec).replace(/\.\d+$/, '')}` : ''}
                </span>
              </div>
              {i.kind === 'musica' && (
                <select value={i.mood ?? ''} aria-label="Clima" onChange={async (e) => (await api.soundsUpdate(i.id, { mood: (e.target.value || null) as Mood | null }), reload())}>
                  <option value="">sem clima</option>
                  {MOODS.map(([m, t]) => (
                    <option key={m} value={m}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              {i.origin !== 'gerado' && (
                <button className="ghost small" aria-label="Remover" onClick={async () => (await api.soundsRemove(i.id), reload())}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
