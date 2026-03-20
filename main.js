const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 1. Register custom protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'app-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

// 2. Global State
let userDataPath, songsFilePath, bibleFilePath, settingsFilePath, mediaFolderPath;
let liveWindow = null;
let mainWindow = null;

// 3. Helper Functions
function isVideo(fileName) {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.mp4') || ext.endsWith('.mov') || ext.endsWith('.wmv');
}

function initializeData() {
  userDataPath = app.getPath('userData');
  songsFilePath = path.join(userDataPath, 'songs.json');
  bibleFilePath = path.join(userDataPath, 'bible.json');
  settingsFilePath = path.join(userDataPath, 'settings.json');
  mediaFolderPath = path.join(__dirname, 'media');

  if (!fs.existsSync(mediaFolderPath)) fs.mkdirSync(mediaFolderPath, { recursive: true });
  if (!fs.existsSync(songsFilePath)) {
    fs.writeFileSync(songsFilePath, JSON.stringify([
      { id: 1, title: '10,000 Reasons', lyrics: 'Verse 1\nBless the Lord, O my soul\nO my soul, worship His holy name' },
      { id: 2, title: 'Amazing Grace', lyrics: 'Verse 1\nAmazing grace! How sweet the sound\nThat saved a wretch like me!' }
    ], null, 2));
  }
  if (!fs.existsSync(bibleFilePath)) fs.writeFileSync(bibleFilePath, JSON.stringify([], null, 2));
}

function createLiveWindow() {
  if (liveWindow) {
    liveWindow.focus();
    return;
  }
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const external = displays.find(d => d.id !== primary.id);
  const targetDisplay = external || primary;

  liveWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    fullscreen: !!external,
    width: external ? undefined : 800,
    height: external ? undefined : 450,
    frame: !external,
    alwaysOnTop: true,
    title: 'Screen Live',
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
  });

  liveWindow.loadFile('live.html');
  liveWindow.on('closed', () => {
    liveWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('live-window-closed');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
    title: "BlessingChurch"
  });
  mainWindow.loadFile('index.html');
  setupMenu(mainWindow);
}

function setupMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Schedule', click: () => win.webContents.send('menu-action', 'new-schedule') },
        { label: 'New Song', click: () => win.webContents.send('menu-action', 'new-song') },
        { label: 'Save Schedule', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('menu-action', 'save-schedule') },
        { label: 'Open Schedule', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu-action', 'open-schedule') },
        { type: 'separator' },
        { label: 'Import Media', click: () => win.webContents.send('menu-action', 'import-media') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Screen Live', accelerator: 'F5', click: () => { createLiveWindow(); win.webContents.send('live-window-opened'); } },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 4. App Initialization
app.whenReady().then(() => {
  initializeData();

  // Protocol Implementation
  protocol.handle('app-media', (request) => {
    try {
      const match = request.url.match(/^app-media:\/\/+(.+)$/);
      if (!match) return new Response('Invalid URL', { status: 400 });
      const fileName = decodeURIComponent(match[1]).split(/[?#]/)[0].replace(/\/+$/, '');
      const fullPath = path.join(path.resolve(__dirname, 'media'), fileName);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return new Response('Not Found', { status: 404 });
      return net.fetch(pathToFileURL(fullPath).toString());
    } catch (e) { return new Response('Error', { status: 500 }); }
  });

  // --- IPC Handlers ---
  ipcMain.handle('load-songs', () => {
    try { return JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]'); } catch (e) { return []; }
  });

  ipcMain.handle('load-bible', () => {
    try { return JSON.parse(fs.readFileSync(bibleFilePath, 'utf8') || '[]'); } catch (e) { return []; }
  });

  ipcMain.handle('save-song', (event, song) => {
    try {
      const filePath = song.type === 'bible' ? bibleFilePath : songsFilePath;
      let items = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]') : [];
      if (song.id) {
        const idx = items.findIndex(s => s.id === song.id);
        if (idx !== -1) items[idx] = song; else items.push(song);
      } else {
        song.id = Date.now();
        items.push(song);
      }
      fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
      return { success: true, item: song, list: items };
    } catch (e) { throw e; }
  });

  ipcMain.handle('delete-song', (event, data) => {
    try {
      const filePath = data.type === 'bible' ? bibleFilePath : songsFilePath;
      let items = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
      items = items.filter(i => i.id !== data.id);
      fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
      return items;
    } catch (e) { throw e; }
  });

  ipcMain.handle('show-open-dialog', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Worship Schedule', extensions: ['bcsch'] }] });
    if (!r.canceled && r.filePaths.length > 0) return { filePath: r.filePaths[0], data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
    return null;
  });

  ipcMain.handle('show-save-dialog', async (e, d) => {
    const r = await dialog.showSaveDialog({ filters: [{ name: 'Worship Schedule', extensions: ['bcsch'] }] });
    if (!r.canceled && r.filePath) { fs.writeFileSync(r.filePath, JSON.stringify(d, null, 2)); return r.filePath; }
    return null;
  });

  ipcMain.handle('import-media', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media Files', extensions: ['jpg', 'png', 'mp4', 'mov', 'wmv'] }] });
    if (!r.canceled && r.filePaths.length > 0) {
      return r.filePaths.map(p => {
        const name = path.basename(p);
        const dest = path.join(mediaFolderPath, name);
        fs.copyFileSync(p, dest);
        return { name, path: dest, type: isVideo(name) ? 'video' : 'image' };
      });
    }
    return null;
  });

  ipcMain.handle('load-media', () => {
    try {
      return fs.readdirSync(mediaFolderPath)
        .filter(f => fs.statSync(path.join(mediaFolderPath, f)).isFile())
        .map(f => ({ name: f, path: path.join(mediaFolderPath, f), type: isVideo(f) ? 'video' : 'image' }));
    } catch (e) { return []; }
  });

  ipcMain.handle('open-live-window', () => { createLiveWindow(); return true; });
  ipcMain.handle('close-live-window', () => { if (liveWindow) liveWindow.close(); return true; });
  ipcMain.handle('live-send-content', (e, d) => { if (liveWindow && !liveWindow.isDestroyed()) liveWindow.webContents.send('live-update-content', d); });
  ipcMain.handle('live-send-background', (e, d) => { if (liveWindow && !liveWindow.isDestroyed()) liveWindow.webContents.send('live-update-background', d); });
  ipcMain.handle('live-send-clear', () => { if (liveWindow && !liveWindow.isDestroyed()) liveWindow.webContents.send('live-clear'); });

  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
