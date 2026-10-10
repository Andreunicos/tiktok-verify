import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppSettings, CutRequest, Result, ToolStatus } from '../shared/types'
import { initLogger, log } from './logger'
import { allowMediaPath, handleMediaProtocol, registerMediaSchemePrivileges } from './mediaProtocol'
import { CutCancelledError, startCut, type CutHandle } from './media/cut'
import { probeMedia } from './media/probe'
import { readVersion, resolveTool } from './media/tools'
import { SettingsStore } from './settings'

registerMediaSchemePrivileges()

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'm4v', 'webm', 'avi']
const jobs = new Map<string, CutHandle>()
const durations = new Map<string, number>()
let settings: SettingsStore
let mainWindow: BrowserWindow | null = null

/** Pasta "resources/bin" do instalador, onde um FFmpeg pode ser empacotado. */
const bundledBinDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin')

const ffmpegPath = () => resolveTool('ffmpeg', settings.get().ffmpegPath, bundledBinDir())
const ffprobePath = () => resolveTool('ffprobe', settings.get().ffprobePath, bundledBinDir())

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'BigLoop AutoClips',
    backgroundColor: '#111318',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // Links externos abrem no navegador, nunca dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle(IPC.pickVideo, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Importar vídeo',
      properties: ['openFile'],
      filters: [
        { name: 'Vídeos', extensions: VIDEO_EXTENSIONS },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.probe, async (_e, filePath: string): Promise<Result<unknown>> => {
    const probe = ffprobePath()
    if (!probe) return { ok: false, error: 'ffprobe não encontrado. Instale o FFmpeg ou configure o caminho em Configurações.' }
    try {
      const meta = await probeMedia(probe, filePath)
      allowMediaPath(filePath)
      durations.set(filePath, meta.durationSec)
      log('info', 'Mídia importada', { file: meta.fileName, duration: meta.durationSec })
      return { ok: true, value: meta }
    } catch (err) {
      log('error', 'Falha ao ler metadados', err)
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.startCut, async (event, req: CutRequest): Promise<Result<{ jobId: string }>> => {
    const ffmpeg = ffmpegPath()
    if (!ffmpeg) return { ok: false, error: 'FFmpeg não encontrado. Instale o FFmpeg ou configure o caminho em Configurações.' }
    const jobId = randomUUID()
    const sender = event.sender
    try {
      const handle = await startCut(req, {
        ffmpegPath: ffmpeg,
        sourceDurationSec: durations.get(req.inputPath) ?? 0,
        onProgress: (processedSec, ratio) => {
          if (!sender.isDestroyed()) sender.send(IPC.cutProgress, { jobId, ratio, processedSec })
        }
      })
      jobs.set(jobId, handle)
      log('info', 'Corte iniciado', { jobId, ...req })
      handle.done
        .then(({ outputPath, elapsedMs }) => {
          log('info', 'Corte concluído', { jobId, outputPath, elapsedMs })
          if (!sender.isDestroyed())
            sender.send(IPC.cutDone, {
              jobId,
              ok: true,
              value: { jobId, outputPath, elapsedMs, durationSec: req.endSec - req.startSec }
            })
        })
        .catch((err) => {
          const cancelled = err instanceof CutCancelledError
          log(cancelled ? 'warn' : 'error', cancelled ? 'Corte cancelado' : 'Corte falhou', err)
          if (!sender.isDestroyed()) sender.send(IPC.cutDone, { jobId, ok: false, error: errorMessage(err) })
        })
        .finally(() => jobs.delete(jobId))
      return { ok: true, value: { jobId } }
    } catch (err) {
      log('error', 'Corte rejeitado', err)
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.cancelCut, (_e, jobId: string) => jobs.get(jobId)?.cancel())

  ipcMain.handle(IPC.getSettings, () => settings.get())
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<AppSettings>) => settings.update(patch))

  ipcMain.handle(IPC.chooseOutputDir, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Pasta de saída dos cortes',
      defaultPath: settings.get().outputDir,
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.openFolder, async (_e, dir: string) => {
    const err = await shell.openPath(dir)
    if (err) log('warn', 'Não foi possível abrir a pasta', { dir, err })
  })
  ipcMain.handle(IPC.showInFolder, (_e, file: string) => shell.showItemInFolder(file))

  ipcMain.handle(IPC.toolStatus, async (): Promise<ToolStatus> => {
    const check = async (path: string | null) => {
      if (!path) return { path: null, version: null, error: 'Não encontrado' }
      try {
        return { path, version: await readVersion(path), error: null }
      } catch (err) {
        return { path, version: null, error: errorMessage(err) }
      }
    }
    return { ffmpeg: await check(ffmpegPath()), ffprobe: await check(ffprobePath()) }
  })
}

app.whenReady().then(() => {
  const logPath = initLogger(join(app.getPath('userData'), 'logs'))
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), {
    outputDir: join(app.getPath('videos'), 'BigLoop AutoClips'),
    ffmpegPath: '',
    ffprobePath: '',
    defaultMode: 'precise'
  })
  log('info', `BigLoop AutoClips ${app.getVersion()} iniciado`, { logPath })
  handleMediaProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const job of jobs.values()) job.cancel()
  if (process.platform !== 'darwin') app.quit()
})
