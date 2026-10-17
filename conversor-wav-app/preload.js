'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  version: () => ipcRenderer.invoke('app:version'),
  presets: () => ipcRenderer.invoke('presets:list'),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  pickOutDir: () => ipcRenderer.invoke('outdir:pick'),
  // arquivos/pastas arrastados para a janela
  expandDropped: files => ipcRenderer.invoke('paths:expand', [...files].map(f => webUtils.getPathForFile(f))),
  convert: job => ipcRenderer.invoke('convert', job),
  reveal: p => ipcRenderer.invoke('shell:reveal', p),
  setBusy: b => ipcRenderer.send('app:busy', !!b),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: cb => {
    ipcRenderer.on('update:status', (_e, s) => cb(s));
    ipcRenderer.invoke('update:state').then(cb);
  },
});
