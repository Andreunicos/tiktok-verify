import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { BigLoopApi, CutProgress, CutResult, Result } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: BigLoopApi = {
  pickVideo: () => ipcRenderer.invoke(IPC.pickVideo),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probe: (path) => ipcRenderer.invoke(IPC.probe, path),
  mediaUrl: (path) => `bigloop-media://local/?p=${encodeURIComponent(path)}`,
  startCut: (req) => ipcRenderer.invoke(IPC.startCut, req),
  cancelCut: (jobId) => ipcRenderer.invoke(IPC.cancelCut, jobId),
  onCutProgress: (cb) => subscribe<CutProgress>(IPC.cutProgress, cb),
  onCutDone: (cb) => subscribe<Result<CutResult> & { jobId: string }>(IPC.cutDone, cb),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  chooseOutputDir: () => ipcRenderer.invoke(IPC.chooseOutputDir),
  openFolder: (path) => ipcRenderer.invoke(IPC.openFolder, path),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  toolStatus: () => ipcRenderer.invoke(IPC.toolStatus)
}

contextBridge.exposeInMainWorld('bigloop', api)
