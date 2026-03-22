const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { validateItem, migrateItem } = require('./src/schema.js');

// 1. Register custom protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'app-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }
]);

// 2. Global State
let userDataPath, songsFilePath, bibleFilePath, settingsFilePath, mediaFolderPath;
let liveWindow = null;
let mainWindow = null;

// 3. Helper Functions
function isVideo(fileName) {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.mp4') || ext.endsWith('.mov');
}

function isSupportedMedia(fileName) {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.mp4') || ext.endsWith('.mov') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp');
}

function safeWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error(`Failed to safeWriteSync ${filePath}:`, err);
    throw err;
  }
}

function backupBeforeWriteSync(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const ext = path.extname(filePath);
    const base = filePath.slice(0, -ext.length);
    const backup3 = `${base}.backup.3${ext}`;
    const backup2 = `${base}.backup.2${ext}`;
    const backup1 = `${base}.backup.1${ext}`;
    
    if (fs.existsSync(backup2)) fs.renameSync(backup2, backup3);
    if (fs.existsSync(backup1)) fs.renameSync(backup1, backup2);
    fs.copyFileSync(filePath, backup1);
  } catch (err) {
    console.error(`Failed to backup ${filePath}:`, err);
  }
}

function saveAndBackupSync(filePath, data) {
  backupBeforeWriteSync(filePath);
  safeWriteSync(filePath, data);
}

function initializeData() {
  userDataPath = app.getPath('userData');
  songsFilePath = path.join(userDataPath, 'songs.json');
  bibleFilePath = path.join(userDataPath, 'bible.json');
  settingsFilePath = path.join(userDataPath, 'settings.json');
  mediaFolderPath = path.join(userDataPath, 'media');

  if (!fs.existsSync(mediaFolderPath)) fs.mkdirSync(mediaFolderPath, { recursive: true });
  if (!fs.existsSync(songsFilePath)) {
    safeWriteSync(songsFilePath, [
      { id: 1, title: '10,000 Reasons', lyrics: 'Verse 1\nBless the Lord, O my soul\nO my soul, worship His holy name' },
      { id: 2, title: 'Amazing Grace', lyrics: 'Verse 1\nAmazing grace! How sweet the sound\nThat saved a wretch like me!' }
    ]);
  }
  if (!fs.existsSync(bibleFilePath)) safeWriteSync(bibleFilePath, []);
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
    webPreferences: { 
      nodeIntegration: false, 
      contextIsolation: true, 
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
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
    webPreferences: { 
      nodeIntegration: false, 
      contextIsolation: true, 
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    },
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
      const fullPath = path.join(mediaFolderPath, fileName);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return new Response('Not Found', { status: 404 });
      return net.fetch(pathToFileURL(fullPath).toString());
    } catch (e) { return new Response('Error', { status: 500 }); }
  });

  // --- IPC Handlers ---
  ipcMain.handle('load-songs', () => {
    try {
      const items = JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]');
      return items.map(migrateItem);
    } catch (e) { return []; }
  });

  ipcMain.handle('load-bible', () => {
    try {
      const items = JSON.parse(fs.readFileSync(bibleFilePath, 'utf8') || '[]');
      return items.map(migrateItem);
    } catch (e) { return []; }
  });

  ipcMain.handle('load-bible-xml', () => {
    try {
      const p = path.join(__dirname, 'data', 'Bible_Vietnamese.xml');
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8');
      }
      return null;
    } catch (e) {
      return null;
    }
  });

  // Bible book name mapping (English XML → Vietnamese)
  const bibleBookMap = {
    "Genesis": "Sáng Thế Ký", "Exodus": "Xuất Ê-díp-tô Ký", "Leviticus": "Lê-vi Ký", "Numbers": "Dân Số Ký", "Deuteronomy": "Phục Truyền Luật Lệ Ký",
    "Joshua": "Giô-suê", "Judges": "Các Quan Xét", "Ruth": "Ru-tơ", "1 Samuel": "1 Sa-mu-ên", "2 Samuel": "2 Sa-mu-ên",
    "1 Kings": "1 Các Vua", "2 Kings": "2 Các Vua", "1 Chronicles": "1 Sử Ký", "2 Chronicles": "2 Sử Ký", "Ezra": "Ê-xơ-ra",
    "Nehemiah": "Nê-hê-mi", "Esther": "Ê-xơ-tê", "Job": "Gióp", "Psalm": "Thi Thiên", "Psalms": "Thi Thiên", "Proverbs": "Châm Ngôn",
    "Ecclesiastes": "Truyền Đạo", "Song of Solomon": "Nhã Ca", "Isaiah": "Ê-sai", "Jeremiah": "Giê-rê-mi", "Lamentations": "Ca Thương",
    "Ezekiel": "Ê-xê-chi-ên", "Daniel": "Đa-ni-ên", "Hosea": "Ô-sê", "Joel": "Giô-ên", "Amos": "A-mốt",
    "Obadiah": "Áp-đia", "Jonah": "Giô-na", "Micah": "Mi-chê", "Nahum": "Na-hum", "Habakkuk": "Ha-ba-cúc",
    "Zephaniah": "Sô-phô-ni", "Haggai": "A-ghê", "Zechariah": "Xa-cha-ri", "Malachi": "Ma-la-chi", "Matthew": "Ma-thi-ơ",
    "Mark": "Mác", "Luke": "Lu-ca", "John": "Giăng", "Acts": "Công Vụ Các Sứ Đồ", "Romans": "Rô-ma",
    "1 Corinthians": "1 Cô-rinh-tô", "2 Corinthians": "2 Cô-rinh-tô", "Galatians": "Ga-la-ti", "Ephesians": "Ê-phê-sô", "Philippians": "Phi-líp",
    "Colossians": "Cô-lô-se", "1 Thessalonians": "1 Tê-sa-lô-ni-ca", "2 Thessalonians": "2 Tê-sa-lô-ni-ca", "1 Timothy": "1 Ti-mô-thê", "2 Timothy": "2 Ti-mô-thê",
    "Titus": "Tít", "Philemon": "Phi-lê-môn", "Hebrews": "Hê-bơ-rơ", "James": "Gia-cơ", "1 Peter": "1 Phi-e-rơ",
    "2 Peter": "2 Phi-e-rơ", "1 John": "1 Giăng", "2 John": "2 Giăng", "3 John": "3 Giăng", "Jude": "Giu-đe",
    "Revelation": "Khải Huyền"
  };

  ipcMain.handle('load-bible-parsed', () => {
    const cachePath = path.join(userDataPath, 'bible-cache.json');

    // Try loading from cache first
    try {
      if (fs.existsSync(cachePath)) {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      }
    } catch (e) {
      console.error('Bible cache corrupted, rebuilding...', e);
    }

    // Parse XML and build cache
    try {
      const xmlPath = path.join(__dirname, 'data', 'Bible_Vietnamese.xml');
      if (!fs.existsSync(xmlPath)) return [];

      let xmlData = fs.readFileSync(xmlPath, 'utf8');
      // Fix legacy encoding: Ð (U+00D0) → Đ (U+0110)
      xmlData = xmlData.replace(/\u00D0/g, '\u0110');

      const bibleLibrary = [];
      const bookRegex = /<BIBLEBOOK[^>]*bname="([^"]*)"[^>]*>([\s\S]*?)<\/BIBLEBOOK>/g;
      const chapterRegex = /<CHAPTER[^>]*cnumber="([^"]*)"[^>]*>([\s\S]*?)<\/CHAPTER>/g;
      const verseRegex = /<VERS[^>]*vnumber="([^"]*)"[^>]*>([\s\S]*?)<\/VERS>/g;

      let bookMatch;
      while ((bookMatch = bookRegex.exec(xmlData)) !== null) {
        const bname = bookMatch[1];
        const vnName = bibleBookMap[bname] || bname;
        const bookContent = bookMatch[2];

        chapterRegex.lastIndex = 0;
        let chapterMatch;
        while ((chapterMatch = chapterRegex.exec(bookContent)) !== null) {
          const cnumber = chapterMatch[1];
          const chapterContent = chapterMatch[2];
          let versesText = '';

          verseRegex.lastIndex = 0;
          let verseMatch;
          while ((verseMatch = verseRegex.exec(chapterContent)) !== null) {
            const vnumber = verseMatch[1];
            const text = verseMatch[2].replace(/<[^>]*>/g, '').trim();
            versesText += `${vnumber} ${text}\n\n`;
          }

          bibleLibrary.push({
            title: `${vnName} ${cnumber}`,
            lyrics: versesText.trim(),
            type: 'bible'
          });
        }
      }

      // Save cache
      safeWriteSync(cachePath, bibleLibrary);
      console.log(`Bible parsed and cached: ${bibleLibrary.length} chapters`);
      return bibleLibrary;
    } catch (e) {
      console.error('Failed to parse Bible XML:', e);
      return [];
    }
  });

  ipcMain.handle('save-song', (event, rawSong) => {
    try {
      let song = { ...rawSong };
      if (!song.id) song.id = Date.now();
      song = migrateItem(song);

      const validation = validateItem(song);
      if (!validation.valid) throw new Error(`Invalid data: ${validation.errors.join(', ')}`);

      const filePath = song.type === 'bible' ? bibleFilePath : songsFilePath;
      let items = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]') : [];
      
      const idx = items.findIndex(s => s.id === song.id);
      if (idx !== -1) items[idx] = song; else items.push(song);
      
      saveAndBackupSync(filePath, items);
      return { success: true, item: song, list: items };
    } catch (e) { throw e; }
  });

  ipcMain.handle('delete-song', (event, data) => {
    try {
      const filePath = data.type === 'bible' ? bibleFilePath : songsFilePath;
      let items = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
      items = items.filter(i => i.id !== data.id);
      saveAndBackupSync(filePath, items);
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
    if (!r.canceled && r.filePath) { safeWriteSync(r.filePath, d); return r.filePath; }
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
        .filter(f => fs.statSync(path.join(mediaFolderPath, f)).isFile() && isSupportedMedia(f))
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
