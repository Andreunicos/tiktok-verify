import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { BigLoopApi } from '../shared/api'
import { IPC } from '../shared/ipc'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: BigLoopApi = {
  pickFile: (kind) => invoke(IPC.pickFile, kind),
  pickDir: (title, current) => invoke(IPC.pickDir, title, current),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openMedia: (path) => invoke(IPC.openMedia, path),
  mediaUrl: (path) => `bigloop-media://local/?p=${encodeURIComponent(path)}`,
  listProjects: () => invoke(IPC.listProjects),
  getProject: (id) => invoke(IPC.getProject, id),
  updateProject: (id, patch) => invoke(IPC.updateProject, id, patch),
  removeProject: (id) => invoke(IPC.removeProject, id),
  analyze: (projectId, taskId, opts) => invoke(IPC.analyze, projectId, taskId, opts),
  getAnalysis: (projectId) => invoke(IPC.getAnalysis, projectId),
  thumbnails: (projectId, count) => invoke(IPC.thumbnails, projectId, count),
  cancelTask: (taskId) => invoke(IPC.cancelTask, taskId),
  suggest: (projectId, opts) => invoke(IPC.suggest, projectId, opts),
  rateSuggestion: (projectId, id, approved) => invoke(IPC.rateSuggestion, projectId, id, approved),
  transcribe: (projectId, taskId, opts) => invoke(IPC.transcribe, projectId, taskId, opts),
  importSubtitles: (projectId) => invoke(IPC.importSubtitles, projectId),
  exportSubtitles: (projectId, format) => invoke(IPC.exportSubtitles, projectId, format),
  removeFillers: (projectId, segmentId) => invoke(IPC.removeFillers, projectId, segmentId),
  enqueue: (requests, priority) => invoke(IPC.enqueue, requests, priority),
  queueState: () => invoke(IPC.queueState),
  queueAction: (action, jobId) => invoke(IPC.queueAction, action, jobId),
  queueControl: (action) => invoke(IPC.queueControl, action),
  startDrag: (path) => ipcRenderer.send(IPC.startDrag, path),
  exportInterchange: (projectId, kind, segmentIds) => invoke(IPC.exportInterchange, projectId, kind, segmentIds),
  aiSocial: (projectId, segmentId, platform) => invoke(IPC.aiSocial, projectId, segmentId, platform),
  aiTranslate: (projectId, language) => invoke(IPC.aiTranslate, projectId, language),
  autoStart: (path, options) => invoke(IPC.autoStart, path, options),
  autoList: () => invoke(IPC.autoList),
  autoCancel: (id) => invoke(IPC.autoCancel, id),
  autoRemove: (id) => invoke(IPC.autoRemove, id),
  onAuto: (cb) => on(IPC.evAuto, cb),
  soundsList: (kind) => invoke(IPC.soundsList, kind),
  soundsSearch: (query, kind, allowAttribution) => invoke(IPC.soundsSearch, query, kind, allowAttribution),
  soundsDownload: (result, kind, mood) => invoke(IPC.soundsDownload, result, kind, mood),
  soundsImport: (kind, mood) => invoke(IPC.soundsImport, kind, mood),
  soundsUpdate: (id, patch) => invoke(IPC.soundsUpdate, id, patch),
  soundsRemove: (id) => invoke(IPC.soundsRemove, id),
  tiktokStatus: () => invoke(IPC.tiktokStatus),
  tiktokSaveApp: (clientKey, clientSecret, redirectUri) => invoke(IPC.tiktokSaveApp, clientKey, clientSecret, redirectUri),
  tiktokConnect: () => invoke(IPC.tiktokConnect),
  tiktokDisconnect: () => invoke(IPC.tiktokDisconnect),
  tiktokCreator: () => invoke(IPC.tiktokCreator),
  tiktokSend: (req, taskId) => invoke(IPC.tiktokSend, req, taskId),
  installWhisper: (taskId, model) => invoke(IPC.installWhisper, taskId, model),
  installFfmpeg: (taskId) => invoke(IPC.installFfmpeg, taskId),
  getSettings: () => invoke(IPC.getSettings),
  saveSettings: (patch) => invoke(IPC.saveSettings, patch),
  setSecret: (kind, value) => invoke(IPC.setSecret, kind, value),
  toolStatus: (refresh) => invoke(IPC.toolStatus, refresh),
  obsStatus: () => invoke(IPC.obsStatus),
  obsTest: (host, port, password) => invoke(IPC.obsTest, host, port, password),
  obsMarker: () => invoke(IPC.obsMarker),
  watchStatus: () => invoke(IPC.watchStatus),
  appInfo: () => invoke(IPC.appInfo),
  openFolder: (path) => invoke(IPC.openFolder, path),
  showInFolder: (path) => invoke(IPC.showInFolder, path),
  openExternal: (url) => invoke(IPC.openExternal, url),
  diagnostics: () => invoke(IPC.diagnostics),
  updateStatus: () => invoke(IPC.updateStatus),
  checkUpdates: () => invoke(IPC.checkUpdates),
  installUpdate: () => invoke(IPC.installUpdate),
  onQueue: (cb) => on(IPC.evQueue, cb),
  onJobProgress: (cb) => on(IPC.evJobProgress, cb),
  onTaskProgress: (cb) => on(IPC.evTaskProgress, cb),
  onObsStatus: (cb) => on(IPC.evObs, cb),
  onWatchStatus: (cb) => on(IPC.evWatch, cb),
  onLibraryChanged: (cb) => on(IPC.evLibrary, cb),
  onShortcut: (cb) => on(IPC.evShortcut, cb),
  onUpdate: (cb) => on(IPC.evUpdate, cb),
  onNotice: (cb) => on(IPC.evNotice, cb)
}

contextBridge.exposeInMainWorld('bigloop', api)
