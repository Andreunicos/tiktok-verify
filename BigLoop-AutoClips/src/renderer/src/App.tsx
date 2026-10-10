import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, CutMode, MediaMetadata } from '@shared/types'
import { formatTimecode, parseTimecode } from '@shared/time'
import { validateCutRange } from '@shared/validation'
import { JobList } from './components/JobList'
import { MetadataCard } from './components/MetadataCard'
import { ModeSelector, SettingsPanel } from './components/SettingsPanel'
import { Timeline } from './components/Timeline'
import { useJobs } from './useJobs'

type Tab = 'cortar' | 'config'

export function App() {
  const [tab, setTab] = useState<Tab>('cortar')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [meta, setMeta] = useState<MediaMetadata | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')
  const [mode, setMode] = useState<CutMode>('precise')
  const [includeAudio, setIncludeAudio] = useState(true)
  const [baseName, setBaseName] = useState('')
  const [current, setCurrent] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewEnd = useRef<number | null>(null)
  const { jobs, add, clearFinished } = useJobs()

  useEffect(() => {
    void window.bigloop.getSettings().then((s) => {
      setSettings(s)
      setMode(s.defaultMode)
    })
  }, [])

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setSettings(await window.bigloop.saveSettings(patch))
    if (patch.defaultMode) setMode(patch.defaultMode)
  }

  const importPath = useCallback(async (path: string | null) => {
    if (!path) return
    setLoading(true)
    setError(null)
    const res = await window.bigloop.probe(path)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMeta(res.value)
    setStartText(formatTimecode(0))
    setEndText(formatTimecode(Math.min(res.value.durationSec, 30)))
    setBaseName('')
    setCurrent(0)
    setTab('cortar')
  }, [])

  const start = parseTimecode(startText)
  const end = parseTimecode(endText)
  const rangeError =
    meta && (start === null || end === null)
      ? 'Use o formato hh:mm:ss.mmm, mm:ss ou segundos.'
      : meta && start !== null && end !== null
        ? validateCutRange(start, end, meta.durationSec)
        : null

  const seek = (sec: number) => {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(sec, meta?.durationSec ?? sec))
  }

  const markStart = () => setStartText(formatTimecode(videoRef.current?.currentTime ?? 0))
  const markEnd = () => setEndText(formatTimecode(videoRef.current?.currentTime ?? 0))
  const previewCut = () => {
    if (start === null || end === null || !videoRef.current) return
    previewEnd.current = end
    seek(start)
    void videoRef.current.play()
  }

  const submit = async () => {
    if (!meta || !settings || start === null || end === null || rangeError) return
    const request = { inputPath: meta.path, outputDir: settings.outputDir, startSec: start, endSec: end, mode, includeAudio, baseName }
    const res = await window.bigloop.startCut(request)
    if (res.ok) add(res.value.jobId, request)
    else setError(res.error)
  }

  // Atalhos: I = marcar início, O = marcar fim, espaço = play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== 'cortar' || !meta || (e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'i' || e.key === 'I') markStart()
      else if (e.key === 'o' || e.key === 'O') markEnd()
      else if (e.key === ' ' && videoRef.current) {
        e.preventDefault()
        if (videoRef.current.paused) void videoRef.current.play()
        else videoRef.current.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) void importPath(window.bigloop.pathForFile(file))
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo">◎</span> BigLoop <strong>AutoClips</strong>
        </div>
        <nav>
          <button className={tab === 'cortar' ? 'active' : ''} onClick={() => setTab('cortar')}>
            Cortar
          </button>
          <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>
            Configurações
          </button>
        </nav>
        <button className="primary" onClick={async () => importPath(await window.bigloop.pickVideo())} disabled={loading}>
          {loading ? 'Lendo…' : 'Importar vídeo'}
        </button>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="ghost" onClick={() => setError(null)} aria-label="Fechar">
            ✕
          </button>
        </div>
      )}

      {tab === 'config' && settings && <SettingsPanel settings={settings} onChange={updateSettings} />}

      {tab === 'cortar' && !meta && (
        <div className="empty">
          <div className="dropzone">
            <p className="big">Arraste um vídeo aqui</p>
            <p className="muted">ou use “Importar vídeo”. MP4, MKV, MOV, FLV e outros formatos lidos pelo FFmpeg.</p>
          </div>
        </div>
      )}

      {tab === 'cortar' && meta && settings && (
        <main className="workspace">
          <div className="player-col">
            <div className="player">
              {meta.video ? (
                <video
                  ref={videoRef}
                  src={window.bigloop.mediaUrl(meta.path)}
                  controls
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime
                    setCurrent(t)
                    if (previewEnd.current !== null && t >= previewEnd.current) {
                      e.currentTarget.pause()
                      previewEnd.current = null
                    }
                  }}
                  onPause={() => (previewEnd.current = null)}
                />
              ) : (
                <div className="no-video muted">Arquivo sem faixa de vídeo.</div>
              )}
            </div>
            <Timeline duration={meta.durationSec} current={current} start={start} end={end} onSeek={seek} />
            <div className="row controls">
              <span className="mono">
                {formatTimecode(current)} / {formatTimecode(meta.durationSec)}
              </span>
              <button onClick={markStart} title="Atalho: I">
                Marcar início [I]
              </button>
              <button onClick={markEnd} title="Atalho: O">
                Marcar fim [O]
              </button>
              <button onClick={previewCut} disabled={!!rangeError}>
                ▶ Prévia do trecho
              </button>
            </div>
            <JobList jobs={jobs} outputDir={settings.outputDir} onClear={clearFinished} />
          </div>

          <aside className="side-col">
            <MetadataCard meta={meta} />
            <section className="card">
              <h2>Corte manual</h2>
              <div className="two">
                <label className="field">
                  <span>Início</span>
                  <input className="mono" value={startText} onChange={(e) => setStartText(e.target.value)} />
                </label>
                <label className="field">
                  <span>Fim</span>
                  <input className="mono" value={endText} onChange={(e) => setEndText(e.target.value)} />
                </label>
              </div>
              <p className="muted small">
                Duração do corte:{' '}
                <span className="mono">{start !== null && end !== null && end > start ? formatTimecode(end - start) : '—'}</span>
              </p>
              {rangeError && <p className="error small">{rangeError}</p>}
              <ModeSelector value={mode} onChange={setMode} />
              <label className="check">
                <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} />
                Incluir áudio
              </label>
              <label className="field">
                <span>Nome do arquivo (opcional)</span>
                <input value={baseName} onChange={(e) => setBaseName(e.target.value)} placeholder="gerado automaticamente" />
              </label>
              <p className="muted small" title={settings.outputDir}>
                Saída: <code>{settings.outputDir}</code>
              </p>
              <button className="primary wide" onClick={submit} disabled={!!rangeError}>
                Gerar corte MP4
              </button>
            </section>
          </aside>
        </main>
      )}
    </div>
  )
}
