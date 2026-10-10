import { useEffect, useState } from 'react'
import { formatTimecode } from '@shared/time'
import type { AppSettings, AutoOptions, AutoRun, MediaMetadata, ToolStatus } from '@shared/types'
import { SetupCard } from '../components/SetupCard'
import { useToast } from '../lib/ui'
import { RunView } from './RunView'

interface Props {
  settings: AppSettings
  tools: ToolStatus | null
  runs: AutoRun[]
  /** Arquivo vindo de arrastar e soltar em qualquer tela. */
  droppedPath: string | null
  onConsumeDrop: () => void
  activeRunId: string | null
  setActiveRunId: (id: string | null) => void
  onRefreshTools: () => Promise<void>
  onAdjust: (projectId: string, segmentId: string) => void
  onOpenRuns: () => void
}

const PLATFORMS: [AutoOptions['platform'], string, string][] = [
  ['tiktok', 'TikTok', '9:16'],
  ['reels', 'Reels', '9:16'],
  ['shorts', 'Shorts', '9:16'],
  ['youtube', 'YouTube', '16:9']
]
const LENGTHS: [AutoOptions['length'], string, string][] = [
  ['curto', 'Curtos', '15–35 s'],
  ['medio', 'Médios', '30–60 s'],
  ['longo', 'Longos', '1–2 min']
]

function Choice<T extends string | number>({ value, current, onPick, title, sub }: { value: T; current: T; onPick: (v: T) => void; title: string; sub?: string }) {
  return (
    <button type="button" className={`choice ${value === current ? 'on' : ''}`} aria-pressed={value === current} onClick={() => onPick(value)}>
      <strong>{title}</strong>
      {sub && <small>{sub}</small>}
    </button>
  )
}

export function Create(p: Props) {
  const toast = useToast()
  const api = window.bigloop
  const [file, setFile] = useState<{ path: string; meta: MediaMetadata; thumb: string | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [opts, setOpts] = useState<AutoOptions>(p.settings.auto)
  const set = (patch: Partial<AutoOptions>) => setOpts((o) => ({ ...o, ...patch }))
  const subtitlesReady = !!p.tools && !p.tools.whisper.error
  const run = p.runs.find((r) => r.id === p.activeRunId) ?? null

  const choose = async (path: string | null) => {
    if (!path) return
    setLoading(true)
    const res = await api.openMedia(path)
    setLoading(false)
    if (!res.ok) return toast(res.error, 'erro')
    if (!res.value.meta.video) return toast('Esse arquivo não tem vídeo.', 'erro')
    p.setActiveRunId(null)
    setFile({ path, meta: res.value.meta, thumb: null })
    const t = await api.thumbnails(res.value.project.id, 1)
    if (t.ok && t.value[0]) setFile((f) => (f && f.path === path ? { ...f, thumb: t.value[0].url } : f))
  }

  useEffect(() => {
    if (p.droppedPath) {
      void choose(p.droppedPath)
      p.onConsumeDrop()
    }
  }, [p.droppedPath])

  const generate = async () => {
    if (!file) return
    const res = await api.autoStart(file.path, opts)
    if (!res.ok) return toast(res.error, 'erro')
    p.setActiveRunId(res.value.id)
    setFile(null)
  }

  if (run)
    return (
      <main className="create">
        <RunView
          run={run}
          onNew={() => p.setActiveRunId(null)}
          onRetry={async (r) => {
            const res = await api.autoStart(r.path, r.options)
            if (res.ok) p.setActiveRunId(res.value.id)
            else toast(res.error, 'erro')
          }}
          onAdjust={p.onAdjust}
          onEnableSubtitles={() => p.setActiveRunId(null)}
        />
      </main>
    )

  const recent = p.runs.slice(0, 3)
  return (
    <main className="create">
      <SetupCard tools={p.tools} onInstalled={p.onRefreshTools} compact />
      {!file ? (
        <>
          <button className="hero-drop" onClick={async () => choose(await api.pickFile('video'))} disabled={loading}>
            <span className="hero-icon">{loading ? '◌' : '🎬'}</span>
            <span className="hero-title">{loading ? 'Abrindo o vídeo…' : 'Arraste seu vídeo aqui'}</span>
            <span className="hero-sub">ou clique para escolher · o app acha as melhores partes, corta e legenda sozinho</span>
          </button>
          {recent.length > 0 && (
            <section className="recent">
              <div className="row between">
                <h2>Últimos cortes</h2>
                <button className="link" onClick={p.onOpenRuns}>
                  ver todos
                </button>
              </div>
              <ul>
                {recent.map((r) => (
                  <li key={r.id}>
                    <button className="recent-item" onClick={() => p.setActiveRunId(r.id)}>
                      <span className={`dot ${r.state}`} />
                      <span className="grow">{r.fileName}</span>
                      <span className="muted small">
                        {r.state === 'rodando' ? 'gerando…' : r.state === 'concluído' ? `${r.clips.filter((c) => c.status === 'concluído').length} cortes` : r.state}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <section className="card ready-card">
          <div className="file-row">
            {file.thumb ? <img className="file-thumb" src={file.thumb} alt="" /> : <div className="file-thumb placeholder">🎬</div>}
            <div className="grow">
              <h1 title={file.path}>{file.meta.fileName}</h1>
              <span className="muted">
                {formatTimecode(file.meta.durationSec, true).replace(/\.\d+$/, '')} · {file.meta.video?.width}×{file.meta.video?.height}
              </span>
            </div>
            <button className="ghost" onClick={() => setFile(null)}>
              Trocar vídeo
            </button>
          </div>

          <div className="choices-group">
            <span className="group-label">Para onde?</span>
            <div className="choices">
              {PLATFORMS.map(([v, t, s]) => (
                <Choice key={v} value={v} current={opts.platform} onPick={(platform) => set({ platform })} title={t} sub={s} />
              ))}
            </div>
          </div>
          <div className="choices-group">
            <span className="group-label">Quantos cortes?</span>
            <div className="choices">
              {[3, 5, 8, 10].map((n) => (
                <Choice key={n} value={n} current={opts.count} onPick={(count) => set({ count })} title={String(n)} />
              ))}
            </div>
          </div>
          <div className="choices-group">
            <span className="group-label">Tamanho de cada corte</span>
            <div className="choices">
              {LENGTHS.map(([v, t, s]) => (
                <Choice key={v} value={v} current={opts.length} onPick={(length) => set({ length })} title={t} sub={s} />
              ))}
            </div>
          </div>
          {opts.platform !== 'youtube' && (
            <div className="choices-group">
              <span className="group-label">Enquadramento</span>
              <div className="choices">
                <Choice value="blur" current={opts.framing} onPick={(framing) => set({ framing })} title="Vídeo inteiro" sub="fundo desfocado" />
                <Choice value="crop" current={opts.framing} onPick={(framing) => set({ framing })} title="Preencher a tela" sub="corta as laterais" />
              </div>
            </div>
          )}
          <div className="toggles">
            <label className={`switch ${!subtitlesReady ? 'disabled' : ''}`} title={subtitlesReady ? '' : 'Ative as legendas automáticas acima'}>
              <input type="checkbox" checked={opts.subtitles && subtitlesReady} disabled={!subtitlesReady} onChange={(e) => set({ subtitles: e.target.checked })} />
              <span>Legendas {subtitlesReady ? 'estilo TikTok' : '(ative as legendas automáticas)'}</span>
            </label>
            <label className={`switch ${!subtitlesReady ? 'disabled' : ''}`}>
              <input type="checkbox" checked={opts.cleanSpeech && subtitlesReady} disabled={!subtitlesReady} onChange={(e) => set({ cleanSpeech: e.target.checked })} />
              <span>Tirar “éé”, “hum” e pausas</span>
            </label>
          </div>
          <button className="cta" onClick={generate}>
            ✨ Gerar cortes
          </button>
        </section>
      )}
    </main>
  )
}
