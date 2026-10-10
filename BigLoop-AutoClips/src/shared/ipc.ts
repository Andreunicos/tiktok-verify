export const IPC = {
  pickVideo: 'dialog:pick-video',
  probe: 'media:probe',
  startCut: 'cut:start',
  cancelCut: 'cut:cancel',
  cutProgress: 'cut:progress',
  cutDone: 'cut:done',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  chooseOutputDir: 'dialog:choose-output-dir',
  openFolder: 'shell:open-folder',
  showInFolder: 'shell:show-in-folder',
  toolStatus: 'tools:status'
} as const
