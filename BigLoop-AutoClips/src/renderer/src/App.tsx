import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { AppSettings, ObsStatus, QueueState, ToolStatus, WatchStatus } from '@shared/types'
import { SHORTCUTS, typingTarget } from './lib/keys'
import { Modal, ToastProvider, useToast } from './lib/ui'
import { Editor } from './views/Editor'
import { Home } from './views/Home'
import { UpdateBanner } from './components/UpdateBanner'

const QueueView = lazy(() => import('./views/QueueView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const About = lazy(() => import('./views/About'))

type View = 'inicio' | 'editor' | 'fila' | 'config' | 'sobre'

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell() {
  const api = window.bigloop
  const toast = useToast()
  const [view, setView] = useState<View>('inicio')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [tools, setTools] = useState<ToolStatus | null>(null)
  const [queue, setQueue] = useState<QueueState>({ jobs: [], paused: false, concurrency: 1 })
  const [obs, setObs] = useState<ObsStatus | null>(null)
  const [watch, setWatch] = useState<WatchStatus | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [section, setSection] = useState<string | undefined>()
  const [dragging, setDragging] = useState(false)
  const [help, setHelp] = useState(false)
  const [libraryKey, setLibraryKey] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.toolStatus().then(setTools)
    void api.queueState().then(setQueue)
    void api.obsStatus().then(setObs)
    void api.watchStatus().then(setWatch)
    const offs = [
      api.onQueue(setQueue),
      api.onJobProgress((j) => setQueue((q) => ({ ...q, jobs: q.jobs.map((x) => (x.id === j.id ? j : x)) }))),
      api.onObsStatus(setObs),
      api.onWatchStatus(setWatch),
      api.onLibraryChanged((info) => {
        setLibraryKey((k) => k + 1)
        if (info.reason !== 'marcador') toast(info.reason === 'obs' ? 'Nova gravação do OBS importada.' : 'Nova gravação importada da pasta.', 'ok', { label: 'Abrir', run: () => openProject(info.projectId) })
      }),
      api.onShortcut(() => toast('Marcador criado no OBS.', 'ok'))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Tema
  useEffect(() => {
    if (!settings) return
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await api.saveSettings(patch))
    // Caminhos de ferramentas mudaram: reconsulta FFmpeg/whisper
    if (['ffmpegPath', 'ffprobePath', 'whisperPath', 'whisperModelPath'].some((k) => k in patch)) setTools(await api.toolStatus(true))
  }, [])
  const refreshTools = useCallback(async () => setTools(await api.toolStatus(true)), [])

  const openProject = (id: string) => {
    setProjectId(id)
    setView('editor')
  }
  const importPath = async (path: string | null) => {
    if (!path) return
    setBusy(true)
    const res = await api.openMedia(path)
    setBusy(false)
    if (!res.ok) return toast(res.error, 'erro')
    setLibraryKey((k) => k + 1)
    openProject(res.value.project.id)
  }
  const pickAndImport = async () => importPath(await api.pickFile('video'))
  const openSettings = (s?: string) => {
    setSection(s)
    setView('config')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void pickAndImport()
      } else if (e.key === '?' && !typingTarget(e)) setHelp((h) => !h)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!settings) return <div className="center-msg muted">Carregando…</div>
  const running = queue.jobs.filter((j) => j.status === 'processando').length
  const waiting = queue.jobs.filter((j) => j.status === 'aguardando').length

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) void importPath(api.pathForFile(file))
      }}
    >
      <header className="topbar">
        <button className="brand ghost" onClick={() => setView('inicio')}>
          <span className="logo">◎</span> BigLoop <strong>AutoClips</strong>
        </button>
        <nav aria-label="Principal">
          <button className={view === 'inicio' ? 'active' : ''} onClick={() => setView('inicio')}>
            Início
          </button>
          <button className={view === 'editor' ? 'active' : ''} onClick={() => projectId && setView('editor')} disabled={!projectId}>
            Editor
          </button>
          <button className={view === 'fila' ? 'active' : ''} onClick={() => setView('fila')}>
            Fila{running + waiting > 0 ? <span className="pill">{running + waiting}</span> : null}
          </button>
          <button className={view === 'config' ? 'active' : ''} onClick={() => openSettings()}>
            Configurações
          </button>
          <button className={view === 'sobre' ? 'active' : ''} onClick={() => setView('sobre')}>
            Sobre
          </button>
        </nav>
        <span className="chips">
          {settings.obsEnabled && (
            <span className={`chip ${obs?.state === 'conectado' ? 'ok' : obs?.state === 'erro' ? 'err' : ''}`} title={obs?.error ?? ''}>
              OBS {obs?.recording ? '● gravando' : obs?.state ?? ''}
            </span>
          )}
          {watch?.enabled && <span className={`chip ${watch.error ? 'err' : 'ok'}`}>pasta</span>}
          <button className="ghost icon" onClick={() => setHelp(true)} title="Atalhos (?)" aria-label="Atalhos de teclado">
            ⌨
          </button>
        </span>
        <button className="primary" onClick={pickAndImport} disabled={busy}>
          {busy ? 'Lendo…' : 'Importar vídeo'}
        </button>
      </header>

      <UpdateBanner autoRestart={settings.autoUpdate} busy={running + waiting > 0} />

      <Suspense fallback={<div className="center-msg muted">Carregando…</div>}>
        {view === 'inicio' && (
          <Home
            settings={settings}
            tools={tools}
            obs={obs}
            watch={watch}
            libraryKey={libraryKey}
            onOpen={openProject}
            onImport={pickAndImport}
            onOpenSettings={openSettings}
            onDismissOnboarding={() => updateSettings({ onboardingDone: true })}
          />
        )}
        {view === 'editor' && projectId && (
          <Editor
            projectId={projectId}
            settings={settings}
            tools={tools}
            onSettings={updateSettings}
            onOpenSettings={openSettings}
            onGoQueue={() => setView('fila')}
            onClose={() => setView('inicio')}
            reloadKey={0}
          />
        )}
        {view === 'fila' && <QueueView queue={queue} settings={settings} onSettings={updateSettings} />}
        {view === 'config' && <SettingsView settings={settings} tools={tools} obs={obs} watch={watch} section={section} onSettings={updateSettings} onRefreshTools={refreshTools} />}
        {view === 'sobre' && <About tools={tools} autoUpdate={settings.autoUpdate} onSettings={updateSettings} />}
      </Suspense>

      {help && (
        <Modal title="Atalhos de teclado" onClose={() => setHelp(false)}>
          <div className="shortcuts">
            {SHORTCUTS.map((g) => (
              <div key={g.group}>
                <h3>{g.group}</h3>
                <dl>
                  {g.items.map((s) => (
                    <div key={s.keys}>
                      <dt>
                        <kbd>{s.keys}</kbd>
                      </dt>
                      <dd>{s.action}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
