import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { AppSettings, AutoRun, ObsStatus, QueueState, ToolStatus, WatchStatus } from '@shared/types'
import { UpdateBanner } from './components/UpdateBanner'
import { SHORTCUTS, typingTarget } from './lib/keys'
import { Modal, ToastProvider, useToast } from './lib/ui'
import { Create } from './views/Create'
import { Editor } from './views/Editor'
import { History } from './views/History'
import { Library } from './views/Library'

const QueueView = lazy(() => import('./views/QueueView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const About = lazy(() => import('./views/About'))

type View = 'criar' | 'cortes' | 'avancado' | 'fila' | 'config' | 'sobre'

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
  const [view, setView] = useState<View>('criar')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [tools, setTools] = useState<ToolStatus | null>(null)
  const [queue, setQueue] = useState<QueueState>({ jobs: [], paused: false, concurrency: 1 })
  const [obs, setObs] = useState<ObsStatus | null>(null)
  const [watch, setWatch] = useState<WatchStatus | null>(null)
  const [runs, setRuns] = useState<AutoRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [focusSegment, setFocusSegment] = useState<string | null>(null)
  const [section, setSection] = useState<string | undefined>()
  const [dragging, setDragging] = useState(false)
  const [dropped, setDropped] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [libraryKey, setLibraryKey] = useState(0)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.toolStatus().then(setTools)
    void api.queueState().then(setQueue)
    void api.obsStatus().then(setObs)
    void api.watchStatus().then(setWatch)
    void api.autoList().then(setRuns)
    const offs = [
      api.onQueue(setQueue),
      api.onJobProgress((j) => setQueue((q) => ({ ...q, jobs: q.jobs.map((x) => (x.id === j.id ? j : x)) }))),
      api.onObsStatus(setObs),
      api.onWatchStatus(setWatch),
      api.onAuto((run) =>
        setRuns((list) => {
          const i = list.findIndex((r) => r.id === run.id)
          if (i === -1) {
            // Execução nova vinda de gravação do OBS/pasta
            if (run.origin !== 'manual') toast(`Gerando cortes da gravação nova: ${run.fileName}`, 'info', { label: 'Ver', run: () => openRun(run.id) })
            return [run, ...list]
          }
          const next = [...list]
          next[i] = run
          return next
        })
      ),
      api.onLibraryChanged((info) => {
        setLibraryKey((k) => k + 1)
        if (info.reason !== 'marcador') toast(info.reason === 'obs' ? 'Nova gravação do OBS importada.' : 'Nova gravação importada da pasta.', 'ok')
      }),
      api.onShortcut(() => toast('Marcador criado no OBS.', 'ok')),
      api.onNotice(async (n) => {
        toast(n.text, n.kind)
        setSettings(await api.getSettings())
      })
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
    if (['ffmpegPath', 'ffprobePath', 'whisperPath', 'whisperModelPath'].some((k) => k in patch)) setTools(await api.toolStatus(true))
  }, [])
  const refreshTools = useCallback(async () => {
    setTools(await api.toolStatus(true))
    setSettings(await api.getSettings())
  }, [])

  const openRun = (id: string) => {
    setActiveRunId(id)
    setView('criar')
  }
  const openProject = (id: string, segmentId: string | null = null) => {
    setProjectId(id)
    setFocusSegment(segmentId)
    setView('avancado')
  }
  const openInEditor = async (path: string | null) => {
    if (!path) return
    const res = await api.openMedia(path)
    if (!res.ok) return toast(res.error, 'erro')
    setLibraryKey((k) => k + 1)
    openProject(res.value.project.id)
  }
  const openSettings = (s?: string) => {
    setSection(s)
    setView('config')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void api.pickFile('video').then((p) => {
          if (p) {
            setDropped(p)
            setView('criar')
          }
        })
      } else if (e.key === '?' && !typingTarget(e)) setHelp((h) => !h)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!settings) return <div className="center-msg muted">Carregando…</div>
  const working = runs.filter((r) => r.state === 'rodando').length

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
        if (!file) return
        const path = api.pathForFile(file)
        if (view === 'avancado' && !projectId) void openInEditor(path)
        else {
          setActiveRunId(null)
          setDropped(path)
          setView('criar')
        }
      }}
    >
      <header className="topbar">
        <button className="brand ghost" onClick={() => (setActiveRunId(null), setView('criar'))}>
          <span className="logo">◎</span> BigLoop <strong>AutoClips</strong>
        </button>
        <nav aria-label="Principal">
          <button className={view === 'criar' ? 'active' : ''} onClick={() => (setActiveRunId(null), setView('criar'))}>
            ✨ Criar cortes
          </button>
          <button className={view === 'cortes' ? 'active' : ''} onClick={() => setView('cortes')}>
            Meus cortes{working > 0 ? <span className="pill">{working}</span> : null}
          </button>
          <button className={view === 'avancado' ? 'active' : ''} onClick={() => setView('avancado')}>
            Editor avançado
          </button>
        </nav>
        <span className="chips">
          {settings.obsEnabled && (
            <span className={`chip ${obs?.state === 'conectado' ? 'ok' : obs?.state === 'erro' ? 'err' : ''}`} title={obs?.error ?? ''}>
              OBS {obs?.recording ? '● gravando' : obs?.state === 'aguardando' ? 'aguardando' : (obs?.state ?? '')}
            </span>
          )}
          {watch?.enabled && <span className={`chip ${watch.error ? 'err' : 'ok'}`}>pasta</span>}
        </span>
        <button className={`ghost icon ${view === 'config' || view === 'sobre' ? 'active' : ''}`} onClick={() => openSettings()} title="Configurações" aria-label="Configurações">
          ⚙
        </button>
      </header>

      <UpdateBanner autoRestart={settings.autoUpdate} busy={queue.jobs.some((j) => j.status === 'processando' || j.status === 'aguardando') || working > 0} />

      <Suspense fallback={<div className="center-msg muted">Carregando…</div>}>
        {view === 'criar' && (
          <Create
            settings={settings}
            tools={tools}
            runs={runs}
            droppedPath={dropped}
            onConsumeDrop={() => setDropped(null)}
            activeRunId={activeRunId}
            setActiveRunId={setActiveRunId}
            onRefreshTools={refreshTools}
            onAdjust={(pid, sid) => openProject(pid, sid)}
            onOpenRuns={() => setView('cortes')}
          />
        )}
        {view === 'cortes' && (
          <History
            runs={runs}
            onOpen={openRun}
            onQueue={() => setView('fila')}
            onRemove={async (id) => {
              await api.autoRemove(id)
              setRuns((l) => l.filter((r) => r.id !== id))
              if (activeRunId === id) setActiveRunId(null)
            }}
          />
        )}
        {view === 'avancado' && !projectId && <Library libraryKey={libraryKey} onOpen={(id) => openProject(id)} onImport={async () => openInEditor(await api.pickFile('video'))} />}
        {view === 'avancado' && projectId && (
          <Editor
            key={projectId}
            projectId={projectId}
            focusSegmentId={focusSegment}
            settings={settings}
            tools={tools}
            onSettings={updateSettings}
            onOpenSettings={openSettings}
            onGoQueue={() => setView('fila')}
            onClose={() => setProjectId(null)}
            reloadKey={0}
          />
        )}
        {view === 'fila' && <QueueView queue={queue} settings={settings} onSettings={updateSettings} />}
        {view === 'config' && (
          <SettingsView
            settings={settings}
            tools={tools}
            obs={obs}
            watch={watch}
            section={section}
            onSettings={updateSettings}
            onRefreshTools={refreshTools}
            onAbout={() => setView('sobre')}
          />
        )}
        {view === 'sobre' && <About tools={tools} autoUpdate={settings.autoUpdate} onSettings={updateSettings} />}
      </Suspense>

      {help && (
        <Modal title="Atalhos de teclado (editor avançado)" onClose={() => setHelp(false)}>
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
