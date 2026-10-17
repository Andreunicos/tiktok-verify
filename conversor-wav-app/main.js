'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { PRESETS, expand, convert } = require('./convert');

let win = null;
let busy = false; // há conversão em andamento: não reinicia sozinho para atualizar
let updateState = { state: 'idle' };

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 780, minWidth: 720, minHeight: 560,
    title: 'Conversor WAV',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161a' : '#f6f7f9',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.once('did-finish-load', () => setTimeout(checkForUpdates, 800));
  win.on('closed', () => { win = null; });
}

// ---------- atualização automática (GitHub Releases) ----------
function sendUpdate(s) {
  updateState = s;
  if (win && !win.isDestroyed()) win.webContents.send('update:status', s);
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
autoUpdater.on('update-not-available', () => sendUpdate({ state: 'uptodate' }));
autoUpdater.on('update-available', info => sendUpdate({ state: 'downloading', version: info.version, percent: 0 }));
autoUpdater.on('download-progress', p => sendUpdate({ state: 'downloading', version: updateState.version, percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', info => {
  sendUpdate({ state: 'ready', version: info.version });
  // ao abrir o app (nada em andamento) já reinicia sozinho; senão espera o clique ou o fechamento
  if (!busy) setTimeout(() => autoUpdater.quitAndInstall(true, true), 2500);
});
autoUpdater.on('error', e => sendUpdate({ state: 'error', message: String((e && e.message) || e).split('\n')[0] }));

async function checkForUpdates() {
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  if (updateState.state === 'checking' || updateState.state === 'downloading' || updateState.state === 'ready') return;
  try { await autoUpdater.checkForUpdates(); } catch { /* o evento 'error' já avisa a interface */ }
}

// ---------- IPC ----------
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('presets:list', () => PRESETS.map(({ id, label }) => ({ id, label })));
ipcMain.on('app:busy', (_e, b) => { busy = !!b; });

ipcMain.handle('paths:expand', (_e, paths) => expand(paths));
ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Escolher áudios', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : expand(r.filePaths);
});
ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Escolher pasta', properties: ['openDirectory'] });
  return r.canceled ? [] : expand(r.filePaths);
});
ipcMain.handle('outdir:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pasta de saída', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('convert', (_e, job) => convert(job, p => shell.trashItem(p)));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('update:state', () => updateState);
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true));

app.setAppUserModelId('com.andreunicos.conversorwav');
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
