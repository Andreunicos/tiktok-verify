import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from 'electron'
import type { FileKind } from '../shared/api'
import { DEFAULT_FILLER_OPTIONS, removeFillers } from '../shared/fillers'
import { buildEdl, buildFcpXml } from '../shared/interchange'
import { IPC } from '../shared/ipc'
import { formatSrt, formatVtt, parseSubtitles } from '../shared/subtitles'
import { learnWeights, suggestClips } from '../shared/suggest'
import type { AppSettings, SecretKind, AutoRun, ClipPost, CutRequest, TikTokPostRequest, TikTokStatus, Job, MediaMetadata, Project, Result, ToolStatus, VideoEncoder, WatchStatus } from '../shared/types'
import { autoUpdater } from 'electron-updater'
import { AutoPilot } from './autopilot'
import { downloadToLibrary, MOOD_QUERY, searchOpenverse } from './openverse'
import { MUSIC_VARIANTS } from '../shared/music'
import { z } from 'zod'
import { FREE_PROVIDERS, FreeAi, type FreeProviderId } from './freeai'
import { planClips } from './brain'
import { trackPerson } from './media/track'
import { SoundLibrary } from './sounds'
import { buildAuthUrl, createPkce, exchangeCode, TIKTOK, TikTokSession, waitForAuthCode, type TikTokAppConfig, type TikTokTokens } from './tiktok'
import { installFfmpeg, installWhisper } from './installer'
import { AiError, claudeAsk, socialCopyWith, translateCuesWith, type AskJson } from './ai'
import { redact } from './diagnostics'
import { readJson, writeJsonAtomic } from './jsonFile'
import { initLogger, log, logPath } from './logger'
import { allowMediaDir, allowMediaPath, handleMediaProtocol, registerMediaSchemePrivileges } from './mediaProtocol'
import { analyzeMedia, generateThumbnails } from './media/analyze'
import { checkWritableDir, moveNoOverwrite, startExport } from './media/export'
import { probeMedia } from './media/probe'
import { detectHardwareEncoders, readVersion, resolveTool } from './media/tools'
import { transcribe } from './media/transcribe'
import { ObsManager } from './obs'
import { ProjectStore } from './projects'
import { JobQueue } from './queue'
import { defaultSettings, SettingsStore } from './settings'
import { UpdateController, type UpdaterLike } from './updater'
import { FolderWatcher, VIDEO_EXTENSIONS } from './watcher'

registerMediaSchemePrivileges()

// Uma instância só: abrir de novo traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) app.quit()

let settings: SettingsStore
let projects: ProjectStore
let queue: JobQueue
let obs: ObsManager
let watcher: FolderWatcher | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let hwEncoders: VideoEncoder[] | null = null
let updates: UpdateController
let autopilot: AutoPilot
let sounds: SoundLibrary
/** Climas em que já tentamos baixar música do Openverse nesta sessão. */
const openverseTried = new Set<string>()
/** Sorteio inicial para a ordem das músicas mudar entre vídeos. */
const musicOffset = Math.floor(Math.random() * 1000)
let tiktok: TikTokSession
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000
const tasks = new Map<string, AbortController>()
const watchState: WatchStatus = { enabled: false, dir: '', pending: [], lastImported: null, error: null }

const bundledBinDir = () => (app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin'))
const ffmpegPath = () => resolveTool('ffmpeg', settings.get().ffmpegPath, bundledBinDir())
const ffprobePath = () => resolveTool('ffprobe', settings.get().ffprobePath, bundledBinDir())
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = (err: unknown): Result<never> => ({ ok: false, error: errorMessage(err) })

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function requireFfmpeg(): string {
  const p = ffmpegPath()
  if (!p) throw new Error('FFmpeg não encontrado. Instale o FFmpeg ou configure o caminho em Configurações.')
  return p
}

function requireProject(id: string): Project {
  const p = projects.get(id)
  if (!p) throw new Error('Projeto não encontrado.')
  return p
}

// ───────────── Segredos (senha do OBS, chave da IA) ─────────────

function decryptSecret(enc: string): string {
  if (!enc) return ''
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : ''
  } catch {
    log('warn', 'Não foi possível ler um segredo salvo; configure de novo.')
    return ''
  }
}

// ───────────── Janela, bandeja e atalhos ─────────────

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function windowStateFile() {
  return join(app.getPath('userData'), 'janela.json')
}

function createWindow(): void {
  const st = readJson<WindowState>(windowStateFile(), { width: 1360, height: 860, maximized: false })
  mainWindow = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    minWidth: 1000,
    minHeight: 660,
    title: 'BigLoop AutoClips',
    backgroundColor: '#111318',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (st.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file:')) e.preventDefault()
  })
  const saveState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const b = mainWindow.getNormalBounds()
    writeJsonAtomic(windowStateFile(), { ...b, maximized: mainWindow.isMaximized() })
  }
  mainWindow.on('close', async (e) => {
    saveState()
    if (quitting) return
    if (settings.get().minimizeToTray && tray) {
      e.preventDefault()
      mainWindow?.hide()
      return
    }
    if (queue.activeCount > 0 || queue.state().jobs.some((j) => j.status === 'aguardando')) {
      e.preventDefault()
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Continuar no app', 'Fechar mesmo assim'],
        defaultId: 0,
        cancelId: 0,
        title: 'Cortes em andamento',
        message: 'Há cortes em andamento ou na fila.',
        detail: 'Se fechar agora, os cortes em andamento são cancelados e refeitos na próxima vez que o app abrir.'
      })
      if (response === 1) {
        quitting = true
        app.quit()
      }
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

const TRAY_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQklEQVR4nGNgGLTg/38GBgYGBob/DAwM/xkYGP4zMDD8Z2Bg+M/AwPCfgYHhPwMDw38GBob/DAwM/xkYGP4zMDAAAKqSB/kxyOw0AAAAAElFTkSuQmCC'

function updateTray(): void {
  if (!tray) return
  const s = queue.state()
  const running = s.jobs.filter((j) => j.status === 'processando').length
  const waiting = s.jobs.filter((j) => j.status === 'aguardando').length
  tray.setToolTip(`BigLoop AutoClips${running || waiting ? ` — ${running} processando, ${waiting} na fila` : ''}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mostrar BigLoop AutoClips', click: showWindow },
      { type: 'separator' },
      s.paused ? { label: 'Retomar fila', click: () => queue.resume() } : { label: 'Pausar fila', click: () => queue.pause() },
      { label: 'Marcar momento no OBS', enabled: obs?.status.state === 'conectado' && obs.status.recording, click: () => void addObsMarker() },
      { type: 'separator' },
      { label: 'Sair', click: () => ((quitting = true), app.quit()) }
    ])
  )
}

function createTray(): void {
  try {
    tray = new Tray(nativeImage.createFromBuffer(Buffer.from(TRAY_ICON, 'base64')))
    tray.on('click', showWindow)
    updateTray()
  } catch (err) {
    log('warn', 'Bandeja do sistema indisponível', err)
  }
}

function registerShortcut(): void {
  globalShortcut.unregisterAll()
  const s = settings.get()
  if (!s.obsEnabled || !s.markerShortcut) return
  try {
    const okReg = globalShortcut.register(s.markerShortcut, () => void addObsMarker())
    if (!okReg) log('warn', `Atalho ${s.markerShortcut} já está em uso por outro programa.`)
  } catch (err) {
    log('warn', 'Atalho de marcador inválido', err)
  }
}

async function addObsMarker(): Promise<Result<number>> {
  try {
    const t = await obs.addMarker()
    send(IPC.evShortcut, 'marker')
    if (Notification.isSupported()) new Notification({ title: 'Marcador criado', body: `Momento marcado em ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, silent: true }).show()
    log('info', 'Marcador OBS', { t })
    return ok(t)
  } catch (err) {
    return fail(err)
  }
}

// ───────────── Fila de exportação ─────────────

const defaultOutputDir = () => join(app.getPath('videos'), 'BigLoop AutoClips')
const fallbackOutputDir = () => join(app.getPath('home'), 'BigLoop AutoClips')

/**
 * A pasta Vídeos pode estar protegida pelo "Acesso controlado a pastas" do Windows.
 * Se a pasta de saída for a padrão e estiver bloqueada, troca para uma pasta liberada e avisa.
 * Retorna a pasta que deve ser usada.
 */
async function ensureOutputDir(dir: string): Promise<string> {
  const blocked = await checkWritableDir(dir)
  if (!blocked) return dir
  log('warn', 'Pasta de saída bloqueada', { dir, blocked })
  if (dir !== defaultOutputDir() || dir !== settings.get().outputDir) throw new Error(blocked)
  const fallback = fallbackOutputDir()
  if (await checkWritableDir(fallback)) throw new Error(blocked)
  settings.update({ outputDir: fallback })
  send(IPC.evNotice, {
    kind: 'info',
    text: `O Windows bloqueou a pasta Vídeos (proteção contra ransomware). Os cortes agora vão para ${fallback}. Dá para trocar em Configurações.`
  })
  log('info', 'Pasta de saída trocada', { fallback })
  return fallback
}

function setupQueue(): void {
  queue = new JobQueue(
    join(app.getPath('userData'), 'fila.json'),
    async (job, report) => {
      const usable = await ensureOutputDir(job.request.outputDir)
      if (usable !== job.request.outputDir) job.request = { ...job.request, outputDir: usable }
      const handle = await startExport(job.request, {
        ffmpegPath: requireFfmpeg(),
        lowPriority: settings.get().lowPriority,
        onProgress: (_s, ratio, eta) => report(ratio, eta)
      })
      return handle
    },
    { concurrency: settings.get().concurrency }
  )
  queue.on('change', (s) => {
    send(IPC.evQueue, s)
    updateTray()
    updateTaskbar()
  })
  queue.on('progress', (j: Job) => {
    autopilot?.jobUpdated(j)
    send(IPC.evJobProgress, j)
    updateTaskbar()
  })
  queue.on('finished', (j: Job) => {
    if (j.status === 'concluído') [j.outputPath!, ...(j.extraFiles ?? [])].forEach(allowMediaPath)
    autopilot?.jobUpdated(j)
    log(j.status === 'concluído' ? 'info' : 'error', `Corte ${j.status}`, { id: j.id, out: j.outputPath, error: j.error })
    const partOfAuto = autopilot?.list().some((r) => r.clips.some((c) => c.jobId === j.id))
    if (!partOfAuto && settings.get().notifyOnDone && Notification.isSupported() && (j.status === 'concluído' || j.status === 'erro')) {
      const n = new Notification({
        title: j.status === 'concluído' ? 'Corte pronto' : 'Corte falhou',
        body: j.status === 'concluído' ? basename(j.outputPath!) : (j.error ?? '').slice(0, 180)
      })
      n.on('click', () => (j.outputPath ? shell.showItemInFolder(j.outputPath) : showWindow()))
      n.show()
    }
  })
  queue.on('error', (err) => log('error', 'Falha ao salvar a fila', err))
  for (const j of queue.state().jobs) [j.outputPath, ...(j.extraFiles ?? [])].forEach((f) => f && allowMediaPath(f))
}

function updateTaskbar(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const running = queue.state().jobs.filter((j) => j.status === 'processando')
  if (running.length === 0) mainWindow.setProgressBar(-1)
  else mainWindow.setProgressBar(running.reduce((s, j) => s + j.ratio, 0) / running.length)
}

// ───────────── Importação (manual, pasta e OBS) ─────────────

async function openMedia(path: string, origin: Project['origin']): Promise<{ meta: MediaMetadata; project: Project }> {
  const probe = ffprobePath()
  if (!probe) throw new Error('ffprobe não encontrado. Instale o FFmpeg ou configure o caminho em Configurações.')
  const meta = await probeMedia(probe, path)
  allowMediaPath(path)
  const project = projects.open(meta, origin)
  allowMediaDir(projects.cacheDir(project.id))
  log('info', 'Mídia aberta', { file: meta.fileName, origin, duration: meta.durationSec })
  return { meta, project }
}

async function importInBackground(path: string, origin: 'pasta' | 'obs', markers: { timeSec: number; label: string }[] = []): Promise<void> {
  if (settings.get().autoOnNewRecording) {
    try {
      const { project } = await openMedia(path, origin)
      if (markers.length) projects.addMarkers(project.id, markers.map((m) => ({ ...m, source: 'obs' as const })))
      autopilot.start(path, settings.get().auto, origin)
      send(IPC.evLibrary, { projectId: project.id, reason: origin })
    } catch (err) {
      log('error', `Falha ao gerar cortes de ${path}`, err)
    }
    return
  }
  try {
    const { meta, project } = await openMedia(path, origin)
    if (markers.length) projects.addMarkers(project.id, markers.map((m) => ({ ...m, source: 'obs' as const })))
    watchState.lastImported = path
    send(IPC.evWatch, { ...watchState, pending: watcher?.pending ?? [] })
    send(IPC.evLibrary, { projectId: project.id, reason: origin })
    if (Notification.isSupported())
      new Notification({ title: 'Nova gravação importada', body: `${meta.fileName}${markers.length ? ` · ${markers.length} marcador(es)` : ''}` }).show()
    if (settings.get().watchAutoAnalyze) {
      const analysis = await analyzeMedia(meta, { ffmpegPath: requireFfmpeg(), detectScenes: true })
      projects.saveAnalysis(project.id, analysis)
      const fresh = projects.get(project.id)!
      const s = settings.get()
      const suggestions = suggestClips({ analysis, cues: fresh.transcript?.cues, options: s.suggestion, weights: s.learnedWeights })
      projects.update(project.id, { suggestions })
      send(IPC.evLibrary, { projectId: project.id, reason: origin })
    }
  } catch (err) {
    log('error', `Falha ao importar ${path}`, err)
    watchState.error = errorMessage(err)
    send(IPC.evWatch, watchState)
  }
}

async function restartWatcher(): Promise<void> {
  watcher?.stop()
  watcher = null
  const s = settings.get()
  const dir = s.watchDir || (obs?.status.recordDir ?? '')
  Object.assign(watchState, { enabled: s.watchEnabled, dir, pending: [], error: null })
  if (s.watchEnabled && dir) {
    if (!existsSync(dir)) watchState.error = 'A pasta monitorada não existe.'
    else {
      watcher = new FolderWatcher({ dir, isKnown: (p) => !!projects.findByPath(p) })
      watcher.on('pending', () => send(IPC.evWatch, { ...watchState, pending: watcher?.pending ?? [] }))
      watcher.on('ready', (file: string) => void importInBackground(file, 'pasta'))
      await watcher.start()
      log('info', 'Monitorando pasta', { dir })
    }
  } else if (s.watchEnabled) watchState.error = 'Escolha a pasta de gravações (ou conecte o OBS para usar a pasta dele).'
  send(IPC.evWatch, watchState)
}

function setupObs(): void {
  obs = new ObsManager(() => {
    const s = settings.get()
    return { host: s.obsHost, port: s.obsPort, password: decryptSecret(s.obsPasswordEnc) }
  })
  obs.on('status', (st) => {
    send(IPC.evObs, st)
    updateTray()
    if (st.state === 'conectado' && settings.get().watchEnabled && !settings.get().watchDir && st.recordDir && watchState.dir !== st.recordDir) void restartWatcher()
  })
  obs.on('recordingFinished', ({ path, markers }: { path: string; markers: { timeSec: number; label: string }[] }) => {
    log('info', 'OBS terminou a gravação', { path, markers: markers.length })
    if (watcher) watcher.markFinished(path)
    // Importa direto: o OBS já informou que o arquivo está fechado. Espera alguns segundos pelo flush do disco.
    setTimeout(() => {
      const existing = projects.findByPath(path)
      if (existing) {
        if (markers.length) projects.addMarkers(existing.id, markers.map((m) => ({ ...m, source: 'obs' as const })))
        send(IPC.evLibrary, { projectId: existing.id, reason: 'marcador' })
      } else void importInBackground(path, 'obs', markers)
    }, 3000)
  })
  if (settings.get().obsEnabled) obs.start()
}

// ───────────── Modo automático (2 cliques) ─────────────

function setupAutopilot(): void {
  autopilot = new AutoPilot(
    {
      probe: (p) => {
        const probe = ffprobePath()
        if (!probe) throw new Error('ffprobe não encontrado. Instale o FFmpeg em Configurações.')
        return probeMedia(probe, p)
      },
      openProject: (meta, origin) => {
        allowMediaPath(meta.path)
        const p = projects.open(meta, origin)
        allowMediaDir(projects.cacheDir(p.id))
        return p
      },
      getProject: (id) => projects.get(id),
      updateProject: (id, patch) => void projects.update(id, patch),
      getAnalysis: (id) => projects.getAnalysis(id),
      saveAnalysis: (id, a) => projects.saveAnalysis(id, a),
      analyze: (meta, signal, onProgress) =>
        analyzeMedia(meta, { ffmpegPath: requireFfmpeg(), detectScenes: meta.durationSec < 3 * 3600, signal, onProgress: (_st, r) => onProgress(r) }),
      transcriber: () => {
        const s = settings.get()
        if (!s.whisperPath || !existsSync(s.whisperPath) || !s.whisperModelPath || !existsSync(s.whisperModelPath)) return null
        return (path, signal, onProgress) =>
          transcribe(path, {
            ffmpegPath: requireFfmpeg(),
            whisperPath: s.whisperPath,
            modelPath: s.whisperModelPath,
            language: s.whisperLanguage,
            threads: s.whisperThreads,
            signal,
            onProgress: (_st, r) => onProgress(r)
          })
      },
      aiPlan: async (platform, count, candidates) => {
        const ai = currentAi()
        if (!ai) return null
        log('info', 'IA: escolhendo os melhores trechos', { candidatos: candidates.length })
        const clips = await planClips(ai.ask, platform, count, candidates)
        return { via: ai.via(), clips }
      },
      track: (path, span, w, h, cropFrac, signal) => trackPerson(requireFfmpeg(), path, span, w, h, cropFrac, signal),
      aiSocial: async (text, platform) => {
        const ai = currentAi()
        if (!ai) return null
        return socialCopyWith(ai.ask, text, platform)
      },
      pickMusic: async (mood, signal, index) => {
        // 1) Músicas baixadas/importadas desse clima; 2) tenta o Openverse uma vez por sessão;
        // 3) sempre sobra a trilha gerada pelo app (funciona sem internet).
        const own = () => sounds.list('musica').filter((i) => i.mood === mood && i.origin !== 'gerado')
        if (own().length === 0 && !openverseTried.has(mood)) {
          openverseTried.add(mood)
          try {
            const timeout = AbortSignal.any([signal, AbortSignal.timeout(45_000)])
            const results = (await searchOpenverse({ query: MOOD_QUERY[mood], kind: 'musica', api: process.env.BIGLOOP_OPENVERSE_API || undefined })).filter((r) => (r.durationSec ?? 60) >= 20)
            for (const r of results.slice(0, 3)) {
              if (timeout.aborted) break
              try {
                await downloadToLibrary(r, 'musica', mood, sounds, { signal: timeout })
              } catch (err) {
                log('warn', 'Falha ao baixar música', err)
              }
            }
          } catch (err) {
            log('warn', 'Openverse indisponível; usando trilha gerada pelo app', err)
          }
        }
        if (signal.aborted) return null
        const pool = own()
        // Cada corte do mesmo vídeo pega uma música diferente (gira pela lista a partir de um sorteio)
        const k = (index ?? 0) + musicOffset
        const item = pool.length ? pool[k % pool.length] : await sounds.ensureGeneratedMusic(mood, k % MUSIC_VARIANTS)
        return { file: item.file, title: item.title, attribution: item.attribution }
      },
      pickEffect: (key) => sounds.list('efeito').find((i) => i.origin === 'gerado' && i.tags.includes(key))?.file ?? null,
      enqueue: (req) => queue.add(req),
      cancelJob: (id) => queue.cancel(id),
      getJob: (id) => queue.state().jobs.find((j) => j.id === id),
      exportDefaults: () => settings.get().exportDefaults,
      outputDir: () => settings.get().outputDir,
      learnedWeights: () => settings.get().learnedWeights,
      writeText: async (path, text) => {
        const tmp = join(app.getPath('temp'), `bigloop-textos-${Date.now()}.txt`)
        await writeFile(tmp, text, 'utf8')
        const final = await moveNoOverwrite(tmp, path)
        allowMediaPath(final)
        return final
      },
      log
    },
    join(app.getPath('userData'), 'cortes-automaticos.json')
  )
  const notified = new Set<string>()
  const drafted = new Set<string>()
  autopilot.on('change', (run: AutoRun) => {
    if (run.state === 'concluído' && !drafted.has(run.id) && run.finishedAt && Date.now() - run.finishedAt < 10_000 && settings.get().tiktokAutoDrafts && tiktok?.connected) {
      drafted.add(run.id)
      void autoSendDrafts(run)
    }
    send(IPC.evAuto, run)
    updateTray()
    for (const c of run.clips) [c.outputPath, c.thumbnail].forEach((f) => f && allowMediaPath(f))
    if (run.textsFile) allowMediaPath(run.textsFile)
    if (run.state !== 'rodando' && !notified.has(run.id) && run.finishedAt && Date.now() - run.finishedAt < 5000) {
      notified.add(run.id)
      log(run.state === 'concluído' ? 'info' : 'warn', `Modo automático ${run.state}`, { file: run.fileName, clips: run.clips.length, error: run.error })
      if (Notification.isSupported() && run.state !== 'cancelado') {
        const ok = run.clips.filter((c) => c.status === 'concluído').length
        const n = new Notification({
          title: run.state === 'concluído' ? `🎬 ${ok} cortes prontos!` : 'Não deu para gerar os cortes',
          body: run.state === 'concluído' ? `${run.fileName} — clique para abrir a pasta.` : (run.error ?? '').slice(0, 180)
        })
        n.on('click', () => (run.outputDir ? void shell.openPath(run.outputDir) : showWindow()))
        n.show()
      }
    }
  })
  // Reconhece arquivos de execuções antigas para mostrar miniaturas e prévias
  for (const r of autopilot.list()) {
    allowMediaPath(r.path)
    for (const c of r.clips) [c.outputPath, c.thumbnail].forEach((f) => f && allowMediaPath(f))
  }
}

// ───────────── TikTok ─────────────

/** IA ativa agora: grátis (Groq/Cerebras/OpenRouter), Claude ou nenhuma. */
function currentAi(): { ask: AskJson; via: () => string } | null {
  const s = settings.get()
  const keys: Partial<Record<FreeProviderId, string>> = {
    groq: decryptSecret(s.groqKeyEnc),
    cerebras: decryptSecret(s.cerebrasKeyEnc),
    openrouter: decryptSecret(s.openrouterKeyEnc)
  }
  const free = new FreeAi({ keys, baseOverride: process.env.BIGLOOP_FREEAI_BASE || undefined, log })
  const claude = s.aiKeyEnc ? claudeAsk(decryptSecret(s.aiKeyEnc), s.aiModel) : null
  if (s.aiProvider === 'gratis' && free.configured().length > 0) {
    let via = ''
    return {
      ask: async (system, user, schema) => {
        const r = await free.json(system, user, schema)
        via = `${FREE_PROVIDERS[r.provider].label} (${r.model})`
        return r.data
      },
      via: () => via
    }
  }
  // Quem já usava o Claude antes da IA grátis continua com ele
  if ((s.aiProvider === 'claude' || (s.aiProvider === 'gratis' && s.aiEnabled)) && claude) return { ask: claude, via: () => 'Claude' }
  return null
}

function encryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece armazenamento seguro; não dá para guardar a conexão.')
  return safeStorage.encryptString(value).toString('base64')
}

function tiktokConfig(): TikTokAppConfig {
  const s = settings.get()
  return {
    clientKey: s.tiktokClientKey,
    clientSecret: decryptSecret(s.tiktokClientSecretEnc),
    redirectUri: s.tiktokRedirectUri,
    // Somente para testes automatizados
    api: process.env.BIGLOOP_TIKTOK_API || TIKTOK.api,
    authorizeUrl: process.env.BIGLOOP_TIKTOK_AUTH || TIKTOK.authorize
  }
}

function setupTikTok(): void {
  let tokens: TikTokTokens | null = null
  try {
    const raw = decryptSecret(settings.get().tiktokTokensEnc)
    tokens = raw ? (JSON.parse(raw) as TikTokTokens) : null
  } catch {
    tokens = null
  }
  tiktok = new TikTokSession(tiktokConfig(), tokens, (t) => {
    settings.update({ tiktokTokensEnc: t ? encryptSecret(JSON.stringify(t)) : '' })
  })
}

function tiktokStatus(): TikTokStatus {
  const s = settings.get()
  return {
    configured: !!s.tiktokClientKey && !!s.tiktokClientSecretEnc,
    connected: tiktok.connected,
    displayName: tiktok.connected ? s.tiktokDisplayName || null : null,
    avatarUrl: null,
    redirectUri: s.tiktokRedirectUri,
    autoDrafts: s.tiktokAutoDrafts
  }
}

/** Envia um arquivo ao TikTok e acompanha até o fim. Atualiza o histórico do corte se houver. */
async function sendToTikTok(req: TikTokPostRequest, onProgress?: (r: number) => void): Promise<{ publishId: string; status: string }> {
  if (!existsSync(req.file)) throw new Error('O arquivo do corte não existe mais.')
  tiktok.setConfig(tiktokConfig())
  const client = tiktok.client()
  const at = Date.now()
  const track = (patch: Partial<ClipPost>) => {
    if (req.runId && req.segmentId) autopilot.setClipPost(req.runId, req.segmentId, { platform: 'tiktok', mode: req.mode, status: 'enviando', at, ...patch })
  }
  track({ status: 'enviando', progress: 0 })
  try {
    const publishId =
      req.mode === 'rascunho'
        ? await client.uploadToInbox(req.file, (r) => (onProgress?.(r), track({ status: 'enviando', progress: r })))
        : await client.directPost(
            req.file,
            {
              title: req.post!.title,
              privacyLevel: req.post!.privacyLevel,
              disableComment: req.post!.disableComment,
              disableDuet: req.post!.disableDuet,
              disableStitch: req.post!.disableStitch,
              brandContent: req.post!.brandContent,
              brandOrganic: req.post!.brandOrganic
            },
            (r) => (onProgress?.(r), track({ status: 'enviando', progress: r }))
          )
    track({ status: 'processando', progress: 1, publishId })
    const st = await client.waitDone(publishId, { intervalMs: 3000, timeoutMs: 3 * 60_000 })
    const final = st.status === 'PUBLISH_COMPLETE' ? 'publicado' : st.status === 'SEND_TO_USER_INBOX' ? 'enviado' : 'processando'
    track({ status: final, progress: 1, publishId })
    log('info', 'TikTok: envio', { mode: req.mode, status: st.status })
    return { publishId, status: st.status }
  } catch (err) {
    track({ status: 'erro', error: errorMessage(err) })
    log('warn', 'TikTok: falha no envio', err)
    throw err
  }
}

/** Rascunhos automáticos: quando os cortes ficam prontos, manda cada um para a caixa de entrada do TikTok. */
async function autoSendDrafts(run: AutoRun): Promise<void> {
  const ready = run.clips.filter((c) => c.status === 'concluído' && c.outputPath && !(c.posts ?? []).some((p) => p.platform === 'tiktok'))
  let sent = 0
  for (const c of ready) {
    try {
      await sendToTikTok({ file: c.outputPath!, mode: 'rascunho', runId: run.id, segmentId: c.segmentId })
      sent++
    } catch {
      // o erro fica registrado no corte
    }
  }
  if (sent > 0 && Notification.isSupported())
    new Notification({ title: `📲 ${sent} cortes nos rascunhos do TikTok`, body: 'Abra o app TikTok no celular (Caixa de entrada) para revisar e postar.' }).show()
}

// ───────────── Atualização automática (GitHub Releases) ─────────────

/** Há trabalho que uma reinicialização interromperia? */
const isBusy = () => queue.activeCount > 0 || queue.state().jobs.some((j) => j.status === 'aguardando') || tasks.size > 0 || !!autopilot?.isBusy()

function setupUpdates(): void {
  const enabled = app.isPackaged && process.env.BIGLOOP_NO_UPDATE !== '1'
  autoUpdater.logger = { info: (m: unknown) => log('info', `[updater] ${String(m)}`), warn: (m: unknown) => log('warn', `[updater] ${String(m)}`), error: (m: unknown) => log('error', `[updater] ${String(m)}`), debug: () => undefined }
  updates = new UpdateController(autoUpdater as unknown as UpdaterLike, { currentVersion: app.getVersion(), enabled, log })
  updates.on('status', (st) => send(IPC.evUpdate, st))
  updates.on('ready', (st) => {
    // A interface mostra a contagem para reiniciar. Se houver cortes rodando, instala ao fechar o app.
    if (isBusy() && Notification.isSupported())
      new Notification({ title: `Atualização ${st.newVersion} pronta`, body: 'Será instalada quando você fechar o app (há cortes em andamento).' }).show()
  })
  if (!enabled || !settings.get().autoUpdate) return
  setTimeout(() => void updates.check(), 4000)
  setInterval(() => settings.get().autoUpdate && void updates.check(), UPDATE_INTERVAL_MS)
}

function installUpdateNow(): boolean {
  if (updates.status.state !== 'pronta') return false
  quitting = true
  queue.flush()
  return updates.install()
}

// ───────────── IPC ─────────────

const FILE_FILTERS: Record<FileKind, Electron.FileFilter[]> = {
  video: [{ name: 'Vídeos', extensions: VIDEO_EXTENSIONS }, { name: 'Todos os arquivos', extensions: ['*'] }],
  subtitle: [{ name: 'Legendas', extensions: ['srt', 'vtt'] }],
  executable: process.platform === 'win32' ? [{ name: 'Programas', extensions: ['exe'] }] : [{ name: 'Todos os arquivos', extensions: ['*'] }],
  model: [{ name: 'Modelos Whisper (ggml)', extensions: ['bin'] }]
}

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown
const handle = (channel: string, fn: Handler) => ipcMain.handle(channel, fn)

function registerIpc(): void {
  handle(IPC.pickFile, async (_e, kind: FileKind) => {
    const s = settings.get()
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: FILE_FILTERS[kind] ?? [],
      defaultPath: kind === 'video' ? s.lastImportDir || undefined : undefined
    })
    if (res.canceled) return null
    if (kind === 'video') settings.update({ lastImportDir: dirname(res.filePaths[0]) })
    return res.filePaths[0]
  })
  handle(IPC.pickDir, async (_e, title: string, current?: string) => {
    const res = await dialog.showOpenDialog(mainWindow!, { title, defaultPath: current, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  handle(IPC.openMedia, async (_e, path: string) => {
    try {
      return ok(await openMedia(path, 'manual'))
    } catch (err) {
      log('error', 'Falha ao abrir mídia', err)
      return fail(err)
    }
  })

  handle(IPC.listProjects, () => projects.list())
  handle(IPC.getProject, (_e, id: string) => {
    const p = projects.get(id)
    if (p) {
      allowMediaPath(p.path)
      allowMediaDir(projects.cacheDir(p.id))
    }
    return p
  })
  handle(IPC.updateProject, (_e, id: string, patch: Partial<Project>) => {
    const allowed: Partial<Project> = {}
    for (const k of ['segments', 'markers', 'transcript', 'suggestions'] as const) if (k in patch) (allowed as any)[k] = patch[k]
    return projects.update(id, allowed)
  })
  handle(IPC.removeProject, (_e, id: string) => projects.remove(id))

  handle(IPC.analyze, async (_e, projectId: string, taskId: string, opts: { audioTrack: number; scenes: boolean }) => {
    const ctrl = new AbortController()
    tasks.set(taskId, ctrl)
    try {
      const p = requireProject(projectId)
      const meta = await probeMedia(ffprobePath()!, p.path)
      const analysis = await analyzeMedia(meta, {
        ffmpegPath: requireFfmpeg(),
        audioTrack: opts.audioTrack,
        detectScenes: opts.scenes,
        signal: ctrl.signal,
        onProgress: (stage, ratio) => send(IPC.evTaskProgress, { taskId, label: `Analisando ${stage}`, ratio })
      })
      projects.saveAnalysis(projectId, analysis)
      return ok(analysis)
    } catch (err) {
      return fail(err)
    } finally {
      tasks.delete(taskId)
    }
  })
  handle(IPC.getAnalysis, (_e, id: string) => projects.getAnalysis(id))
  handle(IPC.thumbnails, async (_e, projectId: string, count: number) => {
    try {
      const p = requireProject(projectId)
      const dir = join(projects.cacheDir(p.id), `thumbs-${count}`)
      allowMediaDir(projects.cacheDir(p.id))
      const list = await generateThumbnails(requireFfmpeg(), p.path, p.durationSec, Math.min(200, Math.max(1, count)), dir)
      return ok(list.map((t) => ({ timeSec: t.timeSec, url: `bigloop-media://local/?p=${encodeURIComponent(t.file)}` })))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.cancelTask, (_e, taskId: string) => tasks.get(taskId)?.abort())

  handle(IPC.suggest, (_e, projectId: string, options) => {
    try {
      const p = requireProject(projectId)
      const analysis = projects.getAnalysis(projectId)
      if (!analysis) throw new Error('Analise o vídeo antes de pedir sugestões.')
      settings.update({ suggestion: options })
      const previous = new Map(p.suggestions.map((s) => [s.id, s.status]))
      const suggestions = suggestClips({ analysis, cues: p.transcript?.cues, options, weights: settings.get().learnedWeights }).map((s) => ({ ...s, status: previous.get(s.id) }))
      projects.update(projectId, { suggestions })
      return ok(suggestions)
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.rateSuggestion, (_e, projectId: string, suggestionId: string, approved: boolean) => {
    try {
      const p = requireProject(projectId)
      const s = p.suggestions.find((x) => x.id === suggestionId)
      if (!s) throw new Error('Sugestão não encontrada.')
      settings.update({ learnedWeights: learnWeights(settings.get().learnedWeights, s.features, approved) })
      return ok(projects.update(projectId, { suggestions: p.suggestions.map((x) => (x.id === suggestionId ? { ...x, status: approved ? 'aprovada' : 'rejeitada' } : x)) })!)
    } catch (err) {
      return fail(err)
    }
  })

  handle(IPC.transcribe, async (_e, projectId: string, taskId: string, opts: { audioTrack: number; range?: { startSec: number; endSec: number } }) => {
    const ctrl = new AbortController()
    tasks.set(taskId, ctrl)
    try {
      const p = requireProject(projectId)
      const s = settings.get()
      const t = await transcribe(p.path, {
        ffmpegPath: requireFfmpeg(),
        whisperPath: s.whisperPath,
        modelPath: s.whisperModelPath,
        language: s.whisperLanguage,
        threads: s.whisperThreads,
        audioTrack: opts.audioTrack,
        range: opts.range,
        signal: ctrl.signal,
        onProgress: (stage, ratio) => send(IPC.evTaskProgress, { taskId, label: stage === 'transcrevendo' ? 'Transcrevendo' : 'Extraindo áudio', ratio })
      })
      // Transcrição parcial substitui só o trecho transcrito
      const merged =
        opts.range && p.transcript
          ? { ...t, cues: [...p.transcript.cues.filter((c) => c.endSec <= opts.range!.startSec || c.startSec >= opts.range!.endSec), ...t.cues].sort((a, b) => a.startSec - b.startSec) }
          : t
      projects.update(projectId, { transcript: merged })
      log('info', 'Transcrição concluída', { cues: merged.cues.length, language: merged.language })
      return ok(merged)
    } catch (err) {
      return fail(err)
    } finally {
      tasks.delete(taskId)
    }
  })
  handle(IPC.importSubtitles, async (_e, projectId: string) => {
    try {
      const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: FILE_FILTERS.subtitle })
      if (res.canceled) return ok(null)
      const cues = parseSubtitles(await readFile(res.filePaths[0], 'utf8'))
      if (cues.length === 0) throw new Error('Nenhuma legenda válida encontrada no arquivo.')
      const transcript = { language: null, engine: `importado (${extname(res.filePaths[0]).slice(1)})`, createdAt: Date.now(), cues }
      projects.update(projectId, { transcript })
      return ok(transcript)
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.exportSubtitles, async (_e, projectId: string, format: 'srt' | 'vtt') => {
    try {
      const p = requireProject(projectId)
      if (!p.transcript?.cues.length) throw new Error('Não há transcrição para exportar.')
      const res = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: join(dirname(p.path), `${basename(p.path, extname(p.path))}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
      })
      if (res.canceled || !res.filePath) return ok(null)
      await writeFile(res.filePath, format === 'srt' ? formatSrt(p.transcript.cues) : formatVtt(p.transcript.cues), 'utf8')
      return ok(res.filePath)
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.removeFillers, (_e, projectId: string, segmentId: string) => {
    try {
      const p = requireProject(projectId)
      const seg = p.segments.find((s) => s.id === segmentId)
      if (!seg) throw new Error('Trecho não encontrado.')
      const words = (p.transcript?.cues ?? []).flatMap((c) => c.words ?? [])
      if (words.length === 0) throw new Error('É preciso uma transcrição com tempo por palavra (whisper.cpp).')
      let removedSec = 0
      let removedWords = 0
      // Só corta pausas que também são silêncio no áudio (se o vídeo já foi analisado)
      const silences = projects.getAnalysis(projectId)?.silences
      const canCutPause = silences
        ? (a: number, b: number) => silences.reduce((t, s) => t + Math.max(0, Math.min(b, s.endSec) - Math.max(a, s.startSec)), 0) >= (b - a) * 0.8
        : undefined
      const ranges = seg.ranges.flatMap((r) => {
        const res = removeFillers(r, words, { ...DEFAULT_FILLER_OPTIONS, canCutPause })
        removedSec += res.removedSec
        removedWords += res.removedWords
        return res.ranges
      })
      if (ranges.length === 0) throw new Error('Nada sobraria do trecho.')
      const segment = { ...seg, ranges }
      projects.update(projectId, { segments: p.segments.map((s) => (s.id === segmentId ? segment : s)) })
      return ok({ segment, removedSec: Math.round(removedSec * 10) / 10, removedWords })
    } catch (err) {
      return fail(err)
    }
  })

  handle(IPC.enqueue, (_e, requests: CutRequest[], priority: Job['priority'] = 'normal') => {
    try {
      if (!Array.isArray(requests) || requests.length === 0) throw new Error('Nada para exportar.')
      return ok(requests.map((r) => queue.add(r, priority).id))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.queueState, () => queue.state())
  handle(IPC.queueAction, (_e, action: string, id: string) => {
    if (action === 'cancel') queue.cancel(id)
    else if (action === 'retry') queue.retry(id)
    else if (action === 'remove') queue.remove(id)
    else if (action === 'up' || action === 'down') queue.move(id, action === 'up' ? -1 : 1)
    else if (action === 'alta' || action === 'normal' || action === 'baixa') queue.setPriority(id, action)
  })
  handle(IPC.queueControl, (_e, action: string) => {
    if (action === 'pause') queue.pause()
    else if (action === 'resume') queue.resume()
    else if (action === 'clearFinished') queue.clearFinished()
    else if (action === 'cancelAll') queue.cancelAll()
  })
  ipcMain.on(IPC.startDrag, (e, path: string) => {
    if (typeof path !== 'string' || !existsSync(path)) return
    e.sender.startDrag({ file: path, icon: nativeImage.createFromBuffer(Buffer.from(TRAY_ICON, 'base64')) })
  })
  handle(IPC.exportInterchange, async (_e, projectId: string, kind: 'fcpxml' | 'edl', segmentIds?: string[]) => {
    try {
      const p = requireProject(projectId)
      const segs = p.segments.filter((s) => !segmentIds || segmentIds.includes(s.id))
      if (segs.length === 0) throw new Error('Crie pelo menos um trecho antes de exportar.')
      const meta = await probeMedia(ffprobePath()!, p.path)
      const src = {
        path: p.path,
        fileName: p.fileName,
        durationSec: meta.durationSec,
        width: meta.video?.width ?? 1920,
        height: meta.video?.height ?? 1080,
        fps: meta.video?.fps ?? 30,
        audioChannels: meta.audio?.channels ?? null,
        sampleRate: meta.audio?.sampleRate ?? null
      }
      const name = `${basename(p.path, extname(p.path))} — BigLoop`
      const dir = join(settings.get().outputDir, 'Premiere e DaVinci')
      const base = join(dir, `${basename(p.path, extname(p.path))}_cortes`)
      let out = `${base}.${kind === 'fcpxml' ? 'xml' : 'edl'}`
      for (let i = 2; existsSync(out); i++) out = `${base} (${i}).${kind === 'fcpxml' ? 'xml' : 'edl'}`
      await mkdir(dir, { recursive: true })
      await writeFile(out, kind === 'fcpxml' ? buildFcpXml(name, src, segs) : buildEdl(name, src, segs), 'utf8')
      log('info', 'Exportado para edição', { kind, out })
      return ok(out)
    } catch (err) {
      return fail(err)
    }
  })

  handle(IPC.aiSocial, async (_e, projectId: string, segmentId: string, platform: string) => {
    try {
      const ai = currentAi()
      if (!ai) throw new AiError('A IA está desligada. Cole uma chave grátis em Configurações → IA.')
      const p = requireProject(projectId)
      const seg = p.segments.find((x) => x.id === segmentId)
      if (!seg) throw new Error('Trecho não encontrado.')
      const text = (p.transcript?.cues ?? [])
        .filter((c) => seg.ranges.some((r) => c.endSec > r.startSec && c.startSec < r.endSec))
        .map((c) => c.text)
        .join(' ')
      if (!text.trim()) throw new Error('O trecho não tem transcrição. Transcreva antes.')
      log('info', 'IA: gerando texto para redes', { chars: text.length })
      return ok(await socialCopyWith(ai.ask, text, platform))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.aiTest, async () => {
    try {
      const ai = currentAi()
      if (!ai) throw new AiError('Nenhuma IA configurada. Cole uma chave grátis do Groq (ou Cerebras/OpenRouter).')
      const res = await ai.ask('Você é um teste de conexão.', 'Responda {"ok": true}', z.object({ ok: z.boolean() }))
      if (!res.ok) throw new AiError('A IA respondeu, mas de um jeito inesperado.')
      return ok(ai.via())
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.aiTranslate, async (_e, projectId: string, language: string) => {
    try {
      const ai = currentAi()
      if (!ai) throw new AiError('A IA está desligada. Cole uma chave grátis em Configurações → IA.')
      const p = requireProject(projectId)
      if (!p.transcript?.cues.length) throw new Error('Não há transcrição para traduzir.')
      const cues = await translateCuesWith(ai.ask, p.transcript.cues, language)
      const transcript = { language, engine: `${p.transcript.engine} + tradução`, createdAt: Date.now(), cues }
      projects.update(projectId, { transcript })
      return ok(transcript)
    } catch (err) {
      return fail(err)
    }
  })

  handle(IPC.autoStart, async (_e, path: string, options) => {
    try {
      if (!existsSync(path)) throw new Error('Arquivo não encontrado.')
      settings.update({ auto: options })
      return ok(autopilot.start(path, settings.get().auto, 'manual'))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.autoList, () => autopilot.list())
  handle(IPC.tiktokStatus, () => tiktokStatus())
  handle(IPC.tiktokSaveApp, (_e, clientKey: string, clientSecret: string | null, redirectUri: string) => {
    try {
      const patch: Partial<AppSettings> = { tiktokClientKey: String(clientKey ?? '').trim() }
      if (clientSecret) patch.tiktokClientSecretEnc = encryptSecret(clientSecret.trim())
      if (redirectUri && /^https?:\/\//.test(redirectUri)) patch.tiktokRedirectUri = redirectUri.trim()
      settings.update(patch)
      tiktok.setConfig(tiktokConfig())
      return ok(tiktokStatus())
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.tiktokConnect, async () => {
    try {
      const cfg = tiktokConfig()
      if (!cfg.clientKey || !cfg.clientSecret) throw new Error('Preencha o Client Key e o Client Secret do seu app do TikTok primeiro.')
      const port = settings.get().tiktokCallbackPort
      const { verifier, challenge } = createPkce()
      // o sufixo ".porta" deixa a página de retorno saber para onde devolver
      const state = `${createPkce().verifier.slice(0, 24)}.${port}`
      const wait = waitForAuthCode(port, state)
      await shell.openExternal(buildAuthUrl(cfg, state, challenge))
      const code = await wait.promise
      const tokens = await exchangeCode(cfg, code, verifier)
      tiktok.setConfig(cfg)
      tiktok.setTokens(tokens)
      const info = await tiktok.client().userInfo().catch(() => null)
      settings.update({ tiktokDisplayName: info?.displayName ?? '' })
      log('info', 'TikTok conectado', { name: info?.displayName })
      return ok(tiktokStatus())
    } catch (err) {
      log('warn', 'TikTok: falha ao conectar', err)
      return fail(err)
    }
  })
  handle(IPC.tiktokDisconnect, () => {
    tiktok.setTokens(null)
    settings.update({ tiktokDisplayName: '', tiktokAutoDrafts: false })
    return tiktokStatus()
  })
  handle(IPC.tiktokCreator, async () => {
    try {
      tiktok.setConfig(tiktokConfig())
      return ok(await tiktok.client().creatorInfo())
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.tiktokSend, async (_e, req: TikTokPostRequest, taskId: string) => {
    try {
      if (req.mode === 'direto' && (!req.post || !req.post.privacyLevel)) throw new Error('Escolha quem pode ver o vídeo.')
      return ok(await sendToTikTok(req, (r) => send(IPC.evTaskProgress, { taskId, label: 'Enviando ao TikTok', ratio: r })))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.soundsList, (_e, kind?: 'musica' | 'efeito') => sounds.list(kind))
  handle(IPC.soundsSearch, async (_e, query: string, kind: 'musica' | 'efeito', allowAttribution: boolean) => {
    try {
      return ok(await searchOpenverse({ query, kind, allowAttribution, api: process.env.BIGLOOP_OPENVERSE_API || undefined }))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.soundsDownload, async (_e, result, kind, mood) => {
    try {
      const item = await downloadToLibrary(result, kind, mood, sounds)
      allowMediaPath(item.file)
      return ok(item)
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.soundsImport, async (_e, kind: 'musica' | 'efeito', mood) => {
    try {
      const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }] })
      if (res.canceled) return ok(null)
      const probe = ffprobePath()
      if (!probe) throw new Error('ffprobe não encontrado.')
      return ok(await sounds.importFile(probe, res.filePaths[0], kind, mood))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.soundsUpdate, (_e, id: string, patch) => sounds.update(id, { title: typeof patch?.title === 'string' ? patch.title.slice(0, 120) : undefined, mood: patch?.mood }))
  handle(IPC.soundsRemove, (_e, id: string) => sounds.remove(id))
  handle(IPC.autoCancel, (_e, id: string) => autopilot.cancel(id))
  handle(IPC.autoRemove, (_e, id: string) => autopilot.remove(id))
  const toolsDir = () => join(app.getPath('userData'), 'ferramentas')
  handle(IPC.installWhisper, async (_e, taskId: string, model: 'base' | 'small') => {
    const ctrl = new AbortController()
    tasks.set(taskId, ctrl)
    try {
      const r = await installWhisper(model === 'base' ? 'base' : 'small', {
        baseDir: toolsDir(),
        signal: ctrl.signal,
        onProgress: (label, ratio) => send(IPC.evTaskProgress, { taskId, label, ratio })
      })
      settings.update({ whisperPath: r.whisperPath, whisperModelPath: r.modelPath, whisperLanguage: settings.get().whisperLanguage || 'pt' })
      log('info', 'Legendas automáticas instaladas', r)
      return ok(r)
    } catch (err) {
      log('error', 'Falha ao instalar whisper.cpp', err)
      return fail(err)
    } finally {
      tasks.delete(taskId)
    }
  })
  handle(IPC.installFfmpeg, async (_e, taskId: string) => {
    const ctrl = new AbortController()
    tasks.set(taskId, ctrl)
    try {
      const r = await installFfmpeg({ baseDir: toolsDir(), signal: ctrl.signal, onProgress: (label, ratio) => send(IPC.evTaskProgress, { taskId, label, ratio }) })
      settings.update({ ffmpegPath: r.ffmpegPath, ffprobePath: r.ffprobePath })
      hwEncoders = null
      void sounds.ensureGeneratedEffects(r.ffmpegPath).catch(() => undefined)
      log('info', 'FFmpeg instalado', r)
      return ok(r)
    } catch (err) {
      log('error', 'Falha ao instalar FFmpeg', err)
      return fail(err)
    } finally {
      tasks.delete(taskId)
    }
  })
  handle(IPC.getSettings, () => settings.get())
  handle(IPC.saveSettings, async (_e, patch: Partial<AppSettings>) => {
    const before = settings.get()
    // Segredos só pelo canal próprio
    const { obsPasswordEnc: _a, aiKeyEnc: _b, tiktokClientSecretEnc: _c, tiktokTokensEnc: _d, groqKeyEnc: _g1, cerebrasKeyEnc: _g2, openrouterKeyEnc: _g3, ...safe } = patch
    const after = settings.update(safe)
    if (after.concurrency !== before.concurrency) queue.setConcurrency(after.concurrency)
    if (after.obsEnabled !== before.obsEnabled || after.obsHost !== before.obsHost || after.obsPort !== before.obsPort) {
      obs.stop()
      if (after.obsEnabled) obs.start()
    }
    if (after.obsEnabled !== before.obsEnabled || after.markerShortcut !== before.markerShortcut) registerShortcut()
    if (after.watchEnabled !== before.watchEnabled || after.watchDir !== before.watchDir) await restartWatcher()
    if (after.ffmpegPath !== before.ffmpegPath) hwEncoders = null
    if (after.minimizeToTray && !tray) createTray()
    if (after.autoUpdate && !before.autoUpdate) void updates.check()
    return after
  })
  handle(IPC.setSecret, (_e, kind: SecretKind, value: string) => {
    try {
      if (value && !safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece armazenamento seguro; o segredo não foi salvo.')
      const enc = value ? safeStorage.encryptString(value).toString('base64') : ''
      const field = ({ obs: 'obsPasswordEnc', ai: 'aiKeyEnc', groq: 'groqKeyEnc', cerebras: 'cerebrasKeyEnc', openrouter: 'openrouterKeyEnc' } as const)[kind]
      if (!field) throw new Error('Tipo de segredo desconhecido.')
      settings.update({ [field]: enc })
      if (kind === 'obs' && settings.get().obsEnabled) {
        obs.stop()
        obs.start()
      }
      return ok(!!value)
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.toolStatus, async (_e, refresh?: boolean): Promise<ToolStatus> => {
    const check = async (path: string | null) => {
      if (!path) return { path: null, version: null, error: 'Não encontrado' }
      try {
        return { path, version: await readVersion(path), error: null }
      } catch (err) {
        return { path, version: null, error: errorMessage(err) }
      }
    }
    const s = settings.get()
    const ff = ffmpegPath()
    if (ff && (refresh || hwEncoders === null)) hwEncoders = (await detectHardwareEncoders(ff)) as VideoEncoder[]
    const whisper = s.whisperPath
      ? existsSync(s.whisperPath)
        ? { path: s.whisperPath, version: existsSync(s.whisperModelPath) ? `modelo: ${basename(s.whisperModelPath)}` : null, error: existsSync(s.whisperModelPath) ? null : 'Modelo não configurado' }
        : { path: s.whisperPath, version: null, error: 'Arquivo não encontrado' }
      : { path: null, version: null, error: 'Não configurado' }
    return { ffmpeg: await check(ff), ffprobe: await check(ffprobePath()), whisper, hardwareEncoders: hwEncoders ?? [] }
  })

  handle(IPC.obsStatus, () => obs.status)
  handle(IPC.obsTest, async (_e, host: string, port: number, password?: string) => {
    try {
      return ok(await ObsManager.test(host, port, password ?? decryptSecret(settings.get().obsPasswordEnc)))
    } catch (err) {
      return fail(err)
    }
  })
  handle(IPC.obsMarker, () => addObsMarker())
  handle(IPC.watchStatus, () => ({ ...watchState, pending: watcher?.pending ?? [], error: watchState.error ?? watcher?.lastError ?? null }))

  handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${os.release()} ${process.arch}`,
    userData: app.getPath('userData'),
    logPath: logPath() ?? ''
  }))
  handle(IPC.openFolder, async (_e, dir: string) => {
    const err = await shell.openPath(dir)
    if (err) log('warn', 'Não foi possível abrir a pasta', { dir, err })
  })
  handle(IPC.showInFolder, (_e, file: string) => shell.showItemInFolder(file))
  handle(IPC.openExternal, (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  handle(IPC.updateStatus, () => updates.status)
  handle(IPC.checkUpdates, () => updates.check())
  handle(IPC.installUpdate, () => installUpdateNow())
  handle(IPC.diagnostics, async () => {
    const s = settings.get()
    const logText = logPath() ? await readFile(logPath()!, 'utf8').catch(() => '') : ''
    const text = [
      `BigLoop AutoClips ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${os.release()} ${process.arch}`,
      `FFmpeg: ${ffmpegPath() ?? 'não encontrado'} · ffprobe: ${ffprobePath() ?? 'não encontrado'}`,
      `Encoders de vídeo: ${(hwEncoders ?? []).join(', ') || 'nenhum de placa de vídeo'}`,
      `OBS: ${obs.status.state} ${obs.status.version ?? ''} · Monitoramento: ${watchState.enabled ? watchState.dir : 'desligado'}`,
      `Fila: ${queue.state().jobs.length} itens, ${queue.activeCount} processando`,
      `Atualização: ${updates.status.state}${updates.status.newVersion ? ` (${updates.status.newVersion})` : ''}${updates.status.error ? ` — ${updates.status.error}` : ''}`,
      `Configurações: ${JSON.stringify({ ...s, learnedWeights: undefined })}`,
      '',
      '— Últimas linhas do log —',
      logText.split('\n').slice(-200).join('\n')
    ].join('\n')
    const clean = redact(text, os.homedir(), os.userInfo().username)
    clipboard.writeText(clean)
    return clean
  })
}

// ───────────── Ciclo de vida ─────────────

app.on('second-instance', showWindow)

app.whenReady().then(async () => {
  // Só para testes automatizados no Linux sem cofre de senhas (no Windows sempre usa DPAPI)
  if (process.platform === 'linux' && process.env.BIGLOOP_E2E === '1' && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true)
  const lp = initLogger(join(app.getPath('userData'), 'logs'))
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), defaultSettings({ outputDir: defaultOutputDir() }))
  projects = new ProjectStore(join(app.getPath('userData'), 'projetos'))
  // Uma vez só: quem usava "Vídeo inteiro" (o padrão antigo) passa para o enquadramento inteligente
  if (!settings.get().smartDefaultsV1) {
    const a = settings.get().auto
    settings.update({ auto: { ...a, framing: a.framing === 'blur' ? 'auto' : a.framing, smartEdit: true }, smartDefaultsV1: true })
  }
  log('info', `BigLoop AutoClips ${app.getVersion()} iniciado`, { log: lp })
  handleMediaProtocol()
  setupQueue()
  setupObs()
  setupUpdates()
  sounds = new SoundLibrary(join(app.getPath('userData'), 'sons'))
  setupTikTok()
  allowMediaDir(sounds.filesDir)
  setupAutopilot()
  registerIpc()
  createWindow()
  if (settings.get().minimizeToTray) createTray()
  registerShortcut()
  await restartWatcher()
  // Pacote de efeitos gerado pelo app (uma vez)
  const ff = ffmpegPath()
  if (ff) void sounds.ensureGeneratedEffects(ff).catch((err) => log('warn', 'Efeitos sonoros', err))
  // Detecta logo ao abrir se a pasta padrão está bloqueada (sem travar a abertura)
  if (settings.get().outputDir === defaultOutputDir()) void ensureOutputDir(defaultOutputDir()).catch((err) => log('warn', 'Pasta de saída', err))
  app.on('activate', showWindow)
})

app.on('before-quit', () => {
  quitting = true
  queue?.flush()
  autopilot?.flush()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watcher?.stop()
  obs?.stop()
  for (const t of tasks.values()) t.abort()
  queue?.cancelAll()
  queue?.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !(settings?.get().minimizeToTray && tray)) app.quit()
})
