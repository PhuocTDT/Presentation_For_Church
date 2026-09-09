const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { validateItem, migrateItem } = require('./src/schema');
const { createStore: createBandCommStore } = require('./src/band-comm/store');
const { createCommServer, lanIPv4List } = require('./src/band-comm/server');
const { createMdnsResponder } = require('./src/band-comm/mdns');

// CPU Usage helper
let lastCpuUsage = { idle: 0, total: 0 };
function getCpuUsage() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  cpus.forEach(core => {
    for (const type in core.times) {
      total += core.times[type];
    }
    idle += core.times.idle;
  });
  
  const diffIdle = idle - lastCpuUsage.idle;
  const diffTotal = total - lastCpuUsage.total;
  lastCpuUsage = { idle, total };
  
  if (diffTotal === 0) return 0;
  return Math.round(100 * (1 - diffIdle / diffTotal));
}

// 1. Storage Helpers
function safeWriteSync(filePath, data) {
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (e) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    return false;
  }
}

function saveAndBackupSync(filePath, data) {
  try {
    if (fs.existsSync(filePath)) {
      for (let i = 2; i >= 1; i--) {
        const old = `${filePath.replace('.json', '')}.backup.${i}.json`;
        const next = `${filePath.replace('.json', '')}.backup.${i + 1}.json`;
        if (fs.existsSync(old)) fs.renameSync(old, next);
      }
      fs.copyFileSync(filePath, `${filePath.replace('.json', '')}.backup.1.json`);
    }
  } catch (e) {
    console.error('Backup failed:', e);
  }
  return safeWriteSync(filePath, data);
}

// 2. Global State
let userDataPath, songsFilePath, bibleFilePath, settingsFilePath, defaultMediaFolderPath, userBibleDataPath, bibleVersionRegistryPath, styleTemplatesPath, customFontsPath, customFontsDir;
let liveWindow = null;
let mainWindow = null;
let bandCommStore = null;
let commServer = null;
let bandMdns = null;
let lastBandStartError = null;
let globalSettings = {};
let liveWindowTargetDisplayId = null;
const bundledBibleDataPath = path.join(__dirname, 'data');
const defaultBibleXmlName = 'Bible_Vietnamese_Version_1925.xml';
const bibleMigrationMarkerPath = () => path.join(userBibleDataPath || userDataPath || app.getPath('userData'), '.bible-versions-migrated');

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

const bibleBookMapReverse = Object.fromEntries(
  Object.entries(bibleBookMap).map(([en, vi]) => [vi, en])
);

// Standard Bible books in order (1-66) for mapping numbers to names if needed
const bibleBooksOrdered = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew",
  "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians",
  "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
  "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"
];

const bibleBooksOrderedVi = bibleBooksOrdered.map(name => bibleBookMap[name] || name);

function detectBibleLanguage(xmlData = '', xmlName = '') {
  const sample = `${xmlName}\n${xmlData.slice(0, 2000)}`.toLowerCase();

  if (/translation\s*=\s*["'][^"']*english|english niv|niv|esv|kjv/.test(sample)) return 'en';
  if (/translation\s*=\s*["'][^"']*vietnamese|bpt|nvb|viet|thánh kinh|kinh thánh|ban đầu thượng đế|thượng đế/.test(sample)) return 'vi';
  if (/bible_vietnamese|ban[_ -]?pho[_ -]?thong|ban[_ -]?dich[_ -]?moi|englishnivbible/i.test(xmlName)) {
    return /englishnivbible/i.test(xmlName) ? 'en' : 'vi';
  }

  const hasVietnameseDiacritics = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(sample);
  if (hasVietnameseDiacritics || /thượng đế|đức chúa trời|ban đầu|buổi chiều|buổi sáng|phúc âm/i.test(sample)) {
    return 'vi';
  }

  const firstBookMatch = xmlData.match(/<(?:BIBLEBOOK|book)\s+[^>]*(?:bname|number)=['"]([^'"]+)['"]/i);
  if (firstBookMatch) {
    const bookRef = firstBookMatch[1];
    if (bibleBookMap[bookRef]) return 'en';
    if (bibleBookMapReverse[bookRef]) return 'vi';
    if (/^\d+$/.test(bookRef)) return 'unknown';
  }

  return 'unknown';
}

function getBibleLanguageLabel(language) {
  if (language === 'en') return 'English';
  if (language === 'vi') return 'Tiếng Việt';
  return 'Không rõ ngôn ngữ';
}

function getBibleVersionDisplayName(fileName, language = 'unknown') {
  const baseName = path.basename(fileName).replace(/\.xml$/i, '').replace(/_/g, ' ').trim();
  return `${baseName} - ${getBibleLanguageLabel(language)}`;
}

function resolveBibleBookName(bookRef, language = 'unknown') {
  if (/^\d+$/.test(String(bookRef))) {
    const idx = parseInt(bookRef, 10) - 1;
    if (language === 'en') return bibleBooksOrdered[idx] || `Book ${bookRef}`;
    if (language === 'vi') return bibleBooksOrderedVi[idx] || `Sách ${bookRef}`;
    return bibleBooksOrderedVi[idx] || bibleBooksOrdered[idx] || `Book ${bookRef}`;
  }

  if (language === 'en') {
    return bookRef;
  }

  if (language === 'vi') {
    return bibleBookMap[bookRef] || bookRef;
  }

  return bibleBookMap[bookRef] || bookRef;
}

function bootstrapGpuAccelerationPreference() {
  try {
    const bootstrapSettingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (!fs.existsSync(bootstrapSettingsPath)) return;
    const saved = JSON.parse(fs.readFileSync(bootstrapSettingsPath, 'utf8'));
    if (saved && saved.gpuAcceleration === false) {
      app.disableHardwareAcceleration();
    }
  } catch (e) {
    console.error('Failed to bootstrap GPU acceleration preference:', e);
  }
}

// 3. Helper Functions
function getMediaFolderPath() {
  return (globalSettings && globalSettings.mediaPath) ? globalSettings.mediaPath : defaultMediaFolderPath;
}

function ensureJsonFile(filePath, fallbackData) {
  if (!filePath || fs.existsSync(filePath)) return;
  safeWriteSync(filePath, fallbackData);
}

function sanitizeLiveWindowBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const normalized = {
    x: Math.round(Number(bounds.x)),
    y: Math.round(Number(bounds.y)),
    width: Math.round(Number(bounds.width)),
    height: Math.round(Number(bounds.height))
  };
  if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y) ||
      !Number.isFinite(normalized.width) || !Number.isFinite(normalized.height)) {
    return null;
  }
  if (normalized.width < 240 || normalized.height < 135) return null;
  return normalized;
}

let liveBoundsSaveTimer = null;
function persistLiveWindowBounds(bounds) {
  const normalized = sanitizeLiveWindowBounds(bounds);
  if (!normalized) return;
  globalSettings = { ...(globalSettings || {}), liveWindowBounds: normalized };
  clearTimeout(liveBoundsSaveTimer);
  liveBoundsSaveTimer = setTimeout(() => {
    try {
      if (settingsFilePath) safeWriteSync(settingsFilePath, globalSettings);
    } catch (e) {
      console.error('Failed to save live window bounds:', e);
    }
  }, 250);
}

function flushLiveWindowBounds() {
  if (liveBoundsSaveTimer) {
    clearTimeout(liveBoundsSaveTimer);
    liveBoundsSaveTimer = null;
  }
  try {
    if (settingsFilePath) safeWriteSync(settingsFilePath, globalSettings);
  } catch (e) {
    console.error('Failed to flush live window bounds:', e);
  }
}

function normalizeBibleFileName(fileName) {
  return path.basename(String(fileName || '')).normalize('NFC');
}

function getBibleDataDirs() {
  return [userBibleDataPath, bundledBibleDataPath].filter(Boolean);
}

function loadBibleVersionRegistrySync() {
  try {
    if (!bibleVersionRegistryPath || !fs.existsSync(bibleVersionRegistryPath)) {
      return { versions: {} };
    }

    const raw = JSON.parse(fs.readFileSync(bibleVersionRegistryPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return { versions: {} };
    if (!raw.versions || typeof raw.versions !== 'object') raw.versions = {};
    if (!Array.isArray(raw.order)) raw.order = [];
    if (!raw.defaultVersion) raw.defaultVersion = null;
    return raw;
  } catch (e) {
    console.error('[Bible] Failed to load bible version registry:', e);
    return { versions: {} };
  }
}

function saveBibleVersionRegistrySync(registry) {
  const normalized = registry && typeof registry === 'object' ? registry : { versions: {} };
  if (!normalized.versions || typeof normalized.versions !== 'object') {
    normalized.versions = {};
  }
  return safeWriteSync(bibleVersionRegistryPath, normalized);
}

function getBibleVersionMeta(fileName) {
  const registry = loadBibleVersionRegistrySync();
  return registry.versions[normalizeBibleFileName(fileName)] || null;
}

function updateBibleVersionMeta(fileName, updates = {}) {
  const normalizedFileName = normalizeBibleFileName(fileName);
  if (!normalizedFileName) return null;

  const registry = loadBibleVersionRegistrySync();
  const existing = registry.versions[normalizedFileName] || {};
  const next = {
    ...existing,
    ...updates,
    fileName: normalizedFileName
  };

  if (!next.displayName || !String(next.displayName).trim()) {
    delete next.displayName;
  } else {
    next.displayName = String(next.displayName).trim();
  }

  registry.versions[normalizedFileName] = next;
  saveBibleVersionRegistrySync(registry);
  return next;
}

function removeBibleVersionMeta(fileName) {
  const normalizedFileName = normalizeBibleFileName(fileName);
  if (!normalizedFileName) return;
  const registry = loadBibleVersionRegistrySync();
  if (registry.versions[normalizedFileName]) {
    delete registry.versions[normalizedFileName];
    saveBibleVersionRegistrySync(registry);
  }
}

function removeBibleVersionCache(fileName) {
  const normalizedFileName = normalizeBibleFileName(fileName);
  if (!normalizedFileName || !userDataPath) return;
  const cacheName = `bible-cache-${normalizedFileName.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`;
  const cachePath = path.join(userDataPath, cacheName);
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch (e) {
    console.error('[Bible] Failed to remove cache:', e);
  }
}

function loadStyleTemplatesSync() {
  try {
    if (!styleTemplatesPath || !fs.existsSync(styleTemplatesPath)) return { templates: [] };
    const raw = JSON.parse(fs.readFileSync(styleTemplatesPath, 'utf8'));
    return {
      templates: Array.isArray(raw && raw.templates) ? raw.templates : []
    };
  } catch (e) {
    console.error('[Templates] Failed to load style templates:', e);
    return { templates: [] };
  }
}

function saveStyleTemplatesSync(payload) {
  const normalized = {
    templates: Array.isArray(payload && payload.templates) ? payload.templates : []
  };
  const ok = safeWriteSync(styleTemplatesPath, normalized);
  if (!ok) {
    throw new Error('Không thể ghi file style-templates.json');
  }
  return normalized;
}

function sanitizeFontDisplayName(name = '') {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function loadCustomFontsRegistrySync() {
  try {
    if (!customFontsPath || !fs.existsSync(customFontsPath)) return { fonts: [] };
    const raw = JSON.parse(fs.readFileSync(customFontsPath, 'utf8'));
    return {
      fonts: Array.isArray(raw && raw.fonts) ? raw.fonts : []
    };
  } catch (e) {
    console.error('[Fonts] Failed to load custom fonts registry:', e);
    return { fonts: [] };
  }
}

function saveCustomFontsRegistrySync(payload) {
  const normalized = {
    fonts: Array.isArray(payload && payload.fonts) ? payload.fonts : []
  };
  const ok = safeWriteSync(customFontsPath, normalized);
  if (!ok) {
    throw new Error('Không thể ghi file custom-fonts.json');
  }
  return normalized;
}

function listCustomFonts() {
  const registry = loadCustomFontsRegistrySync();
  return registry.fonts
    .filter(font => font && font.fileName)
    .map(font => {
      const fullPath = path.join(customFontsDir, font.fileName);
      if (!fs.existsSync(fullPath)) return null;
      return {
        ...font,
        fullPath,
        url: pathToFileURL(fullPath).toString()
      };
    })
    .filter(Boolean);
}

function getSupportedFontFormat(fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext === '.ttf') return 'truetype';
  if (ext === '.otf') return 'opentype';
  return '';
}

function resolveBibleXmlPath(fileName) {
  const normalizedName = normalizeBibleFileName(fileName);
  if (!normalizedName) return null;

  for (const dir of getBibleDataDirs()) {
    const directPath = path.join(dir, normalizedName);
    if (fs.existsSync(directPath)) return directPath;

    const nfdPath = path.join(dir, normalizedName.normalize('NFD'));
    if (fs.existsSync(nfdPath)) return nfdPath;
  }

  return null;
}

function listBibleXmlFiles() {
  const versions = new Map();
  const registry = loadBibleVersionRegistrySync();

  for (const dir of getBibleDataDirs()) {
    if (!fs.existsSync(dir)) continue;

    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }

    for (const file of files) {
      if (!file.toLowerCase().endsWith('.xml')) continue;

      const normalizedName = normalizeBibleFileName(file);
      if (!normalizedName || versions.has(normalizedName)) continue;
      const meta = registry.versions[normalizedName] || {};
      if (meta.hidden) continue;

      versions.set(normalizedName, {
        fileName: normalizedName,
        fullPath: path.join(dir, file),
        source: dir === userBibleDataPath ? 'user' : 'bundled',
        displayName: meta.displayName || '',
        hidden: !!meta.hidden
      });
    }
  }

  return [...versions.values()];
}

function listBibleXmlFilesForManager() {
  const versions = new Map();
  const registry = loadBibleVersionRegistrySync();

  for (const dir of getBibleDataDirs()) {
    if (!fs.existsSync(dir)) continue;

    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }

    for (const file of files) {
      if (!file.toLowerCase().endsWith('.xml')) continue;

      const normalizedName = normalizeBibleFileName(file);
      if (!normalizedName || versions.has(normalizedName)) continue;
      const meta = registry.versions[normalizedName] || {};
      if (meta.hidden) continue;

      const fullPath = path.join(dir, file);
      let language = meta.language || detectBibleLanguage('', file);
      if (!meta.language) {
        try {
          const sample = fs.readFileSync(fullPath, 'utf8').slice(0, 2000);
          const detected = detectBibleLanguage(sample, file);
          if (detected !== 'unknown') language = detected;
        } catch (e) {}
      }

      versions.set(normalizedName, {
        fileName: normalizedName,
        fullPath,
        source: dir === userBibleDataPath ? 'user' : 'bundled',
        displayName: meta.displayName || getBibleVersionDisplayName(normalizedName, language),
        language,
        isDefault: registry.defaultVersion === normalizedName
      });
    }
  }

  const result = [...versions.values()];
  
  // Sort by registry order
  if (Array.isArray(registry.order) && registry.order.length > 0) {
    result.sort((a, b) => {
      let idxA = registry.order.indexOf(a.fileName);
      let idxB = registry.order.indexOf(b.fileName);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      return idxA - idxB;
    });
  }

  return result;
}

function getPreferredLiveDisplay() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const currentTarget = liveWindowTargetDisplayId
    ? displays.find(display => display.id === liveWindowTargetDisplayId)
    : null;

  if (currentTarget && currentTarget.id !== primaryDisplay.id) {
    return currentTarget;
  }

  const externalDisplay = displays.find(display => display.id !== primaryDisplay.id);
  return externalDisplay || primaryDisplay;
}

function listSystemFonts() {
  return [
    'Arial',
    'Arial Black',
    'Calibri',
    'Cambria',
    'Candara',
    'Comic Sans MS',
    'Courier New',
    'Georgia',
    'Helvetica',
    'Tahoma',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
    'Segoe UI',
    'CMG Sans'
  ];
}

let lastKnownMonitorCount = 0;
let lastKnownDisplayId = null;
let requestedLiveBounds = null;
let liveWindowSyncTimer = null;
let liveWindowSyncReason = 'unknown';
let liveWindowSyncForce = false;
let isApplyingLiveWindowState = false;

function getDefaultSingleDisplayBounds(display) {
  const bounds = display.workAreaBounds || display.bounds;
  const w = Math.floor(bounds.width / 3);
  const h = Math.floor(bounds.height / 3);
  return {
    x: bounds.x + bounds.width - w - 50,
    y: bounds.y + 50,
    width: w,
    height: h
  };
}

function normalizeWindowBounds(bounds) {
  return sanitizeLiveWindowBounds(bounds);
}

function areBoundsEqual(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= 1 &&
         Math.abs(a.y - b.y) <= 1 &&
         Math.abs(a.width - b.width) <= 1 &&
         Math.abs(a.height - b.height) <= 1;
}

function computeDesiredLiveWindowState() {
  const displays = screen.getAllDisplays();
  const monitorCount = displays.length;
  const display = getPreferredLiveDisplay();
  if (!display) return null;

  const isMultiDisplay = monitorCount > 1;
  const targetId = display.id;
  const bounds = isMultiDisplay
    ? { ...(display.bounds || display.workAreaBounds) }
    : (normalizeWindowBounds(requestedLiveBounds) || getDefaultSingleDisplayBounds(display));

  return {
    monitorCount,
    targetId,
    bounds,
    shouldFullscreen: isMultiDisplay,
    skipTaskbar: isMultiDisplay
  };
}

function syncLiveWindowToPreferredDisplay(reason = 'manual', force = false) {
  if (!liveWindow || liveWindow.isDestroyed()) return;
  if (isApplyingLiveWindowState) {
    console.log(`[LiveWindow] Skip sync while applying (${reason})`);
    return;
  }

  const desired = computeDesiredLiveWindowState();
  if (!desired) return;

  const currentBounds = normalizeWindowBounds(liveWindow.getBounds());
  const isFullscreen = liveWindow.isFullScreen();
  const wasVisible = liveWindow.isVisible();
  const displayChanged = desired.targetId !== lastKnownDisplayId;
  const monitorCountChanged = desired.monitorCount !== lastKnownMonitorCount;
  const fullscreenChanged = isFullscreen !== desired.shouldFullscreen;
  const boundsChanged = !areBoundsEqual(currentBounds, desired.bounds);

  const shouldApply = force ||
    displayChanged ||
    monitorCountChanged ||
    fullscreenChanged ||
    (!desired.shouldFullscreen && boundsChanged);

  liveWindowTargetDisplayId = desired.targetId;
  lastKnownMonitorCount = desired.monitorCount;
  lastKnownDisplayId = desired.targetId;

  if (!shouldApply) return;

  console.log(`[LiveWindow] Sync ${reason}: display=${desired.targetId} multi=${desired.shouldFullscreen} force=${force}`);
  isApplyingLiveWindowState = true;

  try {
    if (desired.shouldFullscreen) {
      if (displayChanged || monitorCountChanged || fullscreenChanged) {
        if (isFullscreen) {
          liveWindow.setFullScreen(false);
        }
        if (!areBoundsEqual(currentBounds, desired.bounds)) {
          liveWindow.setBounds(desired.bounds, false);
        }
        liveWindow.setFullScreen(true);
      }
      try {
        liveWindow.setSkipTaskbar(desired.skipTaskbar);
      } catch (e) {}
    } else {
      if (isFullscreen) {
        liveWindow.setFullScreen(false);
      }
      if (boundsChanged || displayChanged || monitorCountChanged || force) {
        liveWindow.setBounds(desired.bounds, false);
      }
      try {
        liveWindow.setSkipTaskbar(desired.skipTaskbar);
      } catch (e) {}
    }

    if (!wasVisible) {
      liveWindow.show();
    }

    if (!wasVisible || displayChanged || monitorCountChanged) {
      liveWindow.setAlwaysOnTop(true, 'screen-saver');
      if (desired.shouldFullscreen) {
        try {
          liveWindow.moveTop();
        } catch (e) {}
      }
    }
  } finally {
    setTimeout(() => {
      isApplyingLiveWindowState = false;
    }, 200);
  }
}

function scheduleLiveWindowSync(reason = 'screen-change', force = false, delay = 200) {
  liveWindowSyncReason = reason;
  liveWindowSyncForce = liveWindowSyncForce || force;
  if (liveWindowSyncTimer) clearTimeout(liveWindowSyncTimer);
  liveWindowSyncTimer = setTimeout(() => {
    liveWindowSyncTimer = null;
    const nextReason = liveWindowSyncReason;
    const nextForce = liveWindowSyncForce;
    liveWindowSyncReason = 'unknown';
    liveWindowSyncForce = false;
    syncLiveWindowToPreferredDisplay(nextReason, nextForce);
  }, delay);
}

function migrateBundledBibleVersionsToUserData() {
  if (!userBibleDataPath || !fs.existsSync(userBibleDataPath) || !fs.existsSync(bundledBibleDataPath)) return;
  const markerPath = bibleMigrationMarkerPath();

  try {
    if (fs.existsSync(markerPath)) return;
  } catch (e) {
    // If we cannot read the marker, fall through and try migration best-effort.
  }

  try {
    const bundledFiles = fs.readdirSync(bundledBibleDataPath).filter(file => file.toLowerCase().endsWith('.xml'));
    for (const file of bundledFiles) {
      const source = path.join(bundledBibleDataPath, file);
      const target = path.join(userBibleDataPath, normalizeBibleFileName(file));
      if (!fs.existsSync(target) && fs.existsSync(source) && fs.statSync(source).isFile()) {
        fs.copyFileSync(source, target);
      }
    }
    fs.writeFileSync(markerPath, JSON.stringify({
      migratedAt: new Date().toISOString(),
      source: bundledBibleDataPath,
      destination: userBibleDataPath
    }, null, 2), 'utf8');
  } catch (e) {
    console.error('[Bible] Failed to migrate bundled versions to userData:', e);
  }
}

function isVideo(fileName) {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.mp4') || ext.endsWith('.mov') || ext.endsWith('.m4v') || ext.endsWith('.webm');
}

function isSupportedMedia(fileName) {
  const ext = fileName.toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.m4v', '.webm'].some(e => ext.endsWith(e));
}

function getMediaMimeType(fileName) {
  const ext = fileName.toLowerCase();
  if (ext.endsWith('.webm')) return 'video/webm';
  if (ext.endsWith('.mov')) return 'video/quicktime';
  if (ext.endsWith('.m4v') || ext.endsWith('.mp4')) return 'video/mp4';
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.jpeg') || ext.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildReplaceRegex(findText, caseSensitive = false) {
  return new RegExp(escapeRegExp(findText), caseSensitive ? 'g' : 'gi');
}

function countRegexMatches(text, regex) {
  if (!text) return 0;
  const matches = String(text).match(regex);
  return matches ? matches.length : 0;
}

function replaceWithRegex(text, regex, replaceText) {
  return String(text || '').replace(regex, replaceText);
}

function initializeData() {
  userDataPath = app.getPath('userData');
  songsFilePath = path.join(userDataPath, 'songs.json');
  bibleFilePath = path.join(userDataPath, 'bible.json');
  settingsFilePath = path.join(userDataPath, 'settings.json');
  defaultMediaFolderPath = path.join(userDataPath, 'media');
  userBibleDataPath = path.join(userDataPath, 'bible-versions');
  bibleVersionRegistryPath = path.join(userDataPath, 'bible-versions.json');
  styleTemplatesPath = path.join(userDataPath, 'style-templates.json');
  customFontsPath = path.join(userDataPath, 'custom-fonts.json');
  customFontsDir = path.join(userDataPath, 'custom-fonts');

  if (!fs.existsSync(defaultMediaFolderPath)) fs.mkdirSync(defaultMediaFolderPath, { recursive: true });
  if (!fs.existsSync(userBibleDataPath)) fs.mkdirSync(userBibleDataPath, { recursive: true });
  if (!fs.existsSync(customFontsDir)) fs.mkdirSync(customFontsDir, { recursive: true });
  ensureJsonFile(bibleVersionRegistryPath, { versions: {} });
  ensureJsonFile(styleTemplatesPath, { templates: [] });
  ensureJsonFile(customFontsPath, { fonts: [] });
  migrateBundledBibleVersionsToUserData();
  
  if (!fs.existsSync(songsFilePath)) {
    const bundledSongs = path.join(__dirname, 'data', 'songs.json');
    if (fs.existsSync(bundledSongs)) {
      fs.copyFileSync(bundledSongs, songsFilePath);
    } else {
      safeWriteSync(songsFilePath, []);
    }
  }
  
  if (!fs.existsSync(bibleFilePath)) safeWriteSync(bibleFilePath, []);
  
  // Default Settings
  if (!fs.existsSync(settingsFilePath)) {
    globalSettings = {
      theme: 'dark',
      gpuAcceleration: true,
      fontFamilySong: 'CMG Sans',
      fontFamilyBible: 'Times New Roman',
      fontSize: '80px',
      color: '#ffffff',
      fontWeight: 'bold',
      textAlign: 'center',
      verticalAlign: 'middle',
      textStrokeWidth: 5,
      textStrokeColor: '#000000',
      textMargin: { top: 0, right: 0, bottom: 0, left: 0 },
      textPadding: { top: 0, right: 0, bottom: 0, left: 0 },
      mediaPath: defaultMediaFolderPath,
      allowSingleDisplayLiveWindow: true,
      autoFitText: true,
      liveWindowBounds: null,
      shortcuts: {
        nextSlide: 'ArrowRight',
        prevSlide: 'ArrowLeft',
        clearScreen: 'Escape'
      }
    };
    safeWriteSync(settingsFilePath, globalSettings);
  } else {
    try {
      globalSettings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
      if (!globalSettings.mediaPath) {
        globalSettings.mediaPath = defaultMediaFolderPath;
      }
      if (typeof globalSettings.allowSingleDisplayLiveWindow !== 'boolean') {
        globalSettings.allowSingleDisplayLiveWindow = true;
      }
      if (typeof globalSettings.autoFitText !== 'boolean') {
        globalSettings.autoFitText = true;
      }
      globalSettings.liveWindowBounds = sanitizeLiveWindowBounds(globalSettings.liveWindowBounds);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }
}

function createLiveWindow(initialBounds = null) {
  if (liveWindow) {
    if (initialBounds) {
      requestedLiveBounds = sanitizeLiveWindowBounds(initialBounds) || requestedLiveBounds;
      syncLiveWindowToPreferredDisplay('reuse-window-with-bounds', true);
    } else {
      syncLiveWindowToPreferredDisplay('reuse-window');
    }
    return;
  }
  
  requestedLiveBounds = sanitizeLiveWindowBounds(initialBounds) || sanitizeLiveWindowBounds(globalSettings.liveWindowBounds);
  const desired = computeDesiredLiveWindowState();
  if (!desired) return;
  liveWindowTargetDisplayId = desired.targetId;

  liveWindow = new BrowserWindow({
    x: desired.bounds.x,
    y: desired.bounds.y,
    width: desired.bounds.width,
    height: desired.bounds.height,
    frame: false,
    fullscreen: false,
    kiosk: false,
    simpleFullscreen: false,
    fullscreenable: true,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: desired.skipTaskbar,
    autoHideMenuBar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  liveWindow.setAlwaysOnTop(true, 'screen-saver');
  liveWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  liveWindow.setMenuBarVisibility(false);
  liveWindow.loadFile('live.html');

  const updateRequestedBounds = () => {
    if (!liveWindow || liveWindow.isDestroyed()) return;
    const displays = screen.getAllDisplays();
    if (displays.length === 1 && !isApplyingLiveWindowState) {
      requestedLiveBounds = liveWindow.getBounds();
      persistLiveWindowBounds(requestedLiveBounds);
    }
  };

  liveWindow.on('move', updateRequestedBounds);
  liveWindow.on('resize', updateRequestedBounds);

  liveWindow.once('ready-to-show', () => {
    if (!liveWindow || liveWindow.isDestroyed()) return;
    syncLiveWindowToPreferredDisplay('ready-to-show', true);
    if (screen.getAllDisplays().length === 1) {
      persistLiveWindowBounds(liveWindow.getBounds());
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live-window-opened');
    }
  });
  liveWindow.on('closed', () => {
    liveWindow = null;
    liveWindowTargetDisplayId = null;
    lastKnownMonitorCount = 0;
    lastKnownDisplayId = null;
    requestedLiveBounds = sanitizeLiveWindowBounds(globalSettings.liveWindowBounds);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live-window-closed');
    }
  });
}

// ---- Band Comm: the chat channel lives as a left sidebar INSIDE index.html
// (toggled by the "Channel" menu). The main process only runs the LAN comm
// server and relays messages to the operator renderer. See band-comm-plan.md §6. ----

// Fan an inbound envelope / presence / status out to the operator renderer.
function broadcastToRenderers(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, payload); } catch (e) {}
  }
}

function sendBandStatus(extra) {
  if (!commServer) return;
  const st = commServer.getStatus();
  st.operatorReplies = bandCommStore ? bandCommStore.load().operatorReplies : [];
  broadcastToRenderers('band-comm-status-changed', Object.assign(st, extra || {}));
}

// A system line for the operator sidebar feed only (not sent over SSE to phones).
function bandSystemLine(text) {
  broadcastToRenderers('band-comm-event', {
    id: 'sys-' + Date.now(), ts: Date.now(), type: 'system',
    from: { clientId: 'server', name: 'Hệ thống', role: 'system' },
    to: 'all', text: String(text || ''), meta: {}
  });
}

function bandStartupHint(err) {
  const code = err && err.code;
  if (code === 'EADDRINUSE') return `Cổng ${err.port || (bandCommStore && bandCommStore.load().port)} đang bận. Có thể app đang mở sẵn ở nơi khác, hoặc phần mềm khác giữ cổng. Đóng bớt rồi bấm Thử lại, hoặc đổi "port" trong band-comm.json.`;
  if (code === 'EACCES') return 'Hệ điều hành từ chối mở cổng này (cần quyền hoặc bị firewall chặn). Thử đổi "port" trong band-comm.json sang số > 1024, hoặc cho phép app qua Windows Firewall.';
  if (code === 'EADDRNOTAVAIL') return 'Không gán được địa chỉ mạng. Kiểm tra máy đã nối Wi-Fi/LAN chưa.';
  return 'Bấm Thử lại. Nếu vẫn lỗi, chép nội dung lỗi bên dưới để kiểm tra.';
}

// Start (or restart) the comm server + mDNS, and report success/failure to the
// operator sidebar. Used both by auto-start on launch and the "Thử lại" button.
async function startBandComm() {
  initBandComm();
  try {
    const st = await commServer.start();
    if (bandMdns) {
      bandMdns.stop();
      const ips = lanIPv4List();
      bandMdns.start(bandCommStore.load().room.hostname, () => {
        const list = lanIPv4List();
        return list[0] ? list[0].address : (ips[0] ? ips[0].address : null);
      });
    }
    lastBandStartError = null;
    sendBandStatus({ error: null });
    bandSystemLine(`Kênh đã sẵn sàng · ${st.hostUrl || st.url || ''}`);
    return commServer.getStatus();
  } catch (err) {
    const detail = {
      code: err && err.code || null,
      message: err && err.message || String(err),
      syscall: err && err.syscall || null,
      port: err && err.port || (bandCommStore && bandCommStore.load().port) || null,
      hint: bandStartupHint(err)
    };
    lastBandStartError = detail;
    console.error('[BandComm] server failed to start:', detail);
    sendBandStatus({ error: detail });
    bandSystemLine(`Kênh KHÔNG khởi chạy được: ${detail.code || ''} ${detail.message}`);
    return { running: false, error: detail };
  }
}

function stopBandComm() {
  if (bandMdns) bandMdns.stop();
  if (commServer) commServer.stop();
}

function initBandComm() {
  if (commServer) return;
  bandCommStore = createBandCommStore(userDataPath, safeWriteSync);
  bandMdns = createMdnsResponder();
  commServer = createCommServer({
    store: bandCommStore,
    onEvent: (env) => {
      broadcastToRenderers('band-comm-event', env);
      // Nudge the taskbar when a fresh band alert lands and the app is unfocused.
      if (env.type === 'alert' && env.from && env.from.role !== 'operator') {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          try { mainWindow.flashFrame(true); } catch (e) {}
        }
      }
    },
    onPresence: (list) => broadcastToRenderers('band-comm-presence', list),
    // Chỉ mục thư viện bài hát cho /api/library (điện thoại soạn setlist).
    getLibraryIndex: () => {
      try {
        const raw = JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]');
        return raw.map(migrateItem)
          .filter(s => s && s.title)
          .map(s => ({ id: s.id, title: s.title, lyrics: s.lyrics || '' }));
      } catch (e) { return []; }
    },
    onSetlist: (sl) => {
      broadcastToRenderers('band-comm-setlist', sl);
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        try { mainWindow.flashFrame(true); } catch (e) {}
      }
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  mainWindow = win;
  win.loadFile('index.html');
  setupMenu(win);

  // Push a queued .bcsch again once the page is up (covers the launch-with-file
  // case even if the renderer wired its listener after the first send).
  win.webContents.on('did-finish-load', () => {
    if (scheduleToOpen && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-schedule-file', scheduleToOpen);
      scheduleToOpen = null;
    }
  });

  // The operator window is the app itself. Closing it must shut everything
  // down — including the Screen Live window on the projector — so the user
  // never has to kill a stray process from Task Manager.
  win.on('closed', () => {
    mainWindow = null;
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.destroy();
    }
    stopBandComm();
    app.quit();
  });
}

function setupMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Schedule', click: () => win.webContents.send('menu-action', 'new-schedule') },
        { label: 'New Song', click: () => win.webContents.send('menu-action', 'new-song') },
        { label: 'Save Schedule', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('menu-action', 'save-schedule') },
        { label: 'Import File', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu-action', 'import-file') },
        { label: 'Open Schedule', click: () => win.webContents.send('menu-action', 'open-schedule') },
        { type: 'separator' },
        { label: 'Import Media', click: () => win.webContents.send('menu-action', 'import-media') },
        { label: 'Add To Schedule', accelerator: 'CmdOrCtrl+Shift+A', click: () => win.webContents.send('menu-action', 'add-selected-to-schedule') },
        { label: 'Screen Live', accelerator: 'CmdOrCtrl+L', click: () => win.webContents.send('menu-action', 'toggle-live-window') },
        { label: 'Clear Live', accelerator: 'CmdOrCtrl+H', click: () => win.webContents.send('menu-action', 'clear-live') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+Shift+P', click: () => win.webContents.send('menu-action', 'open-settings') },
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
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }]
    },
    {
      label: 'Channel',
      submenu: [
        { label: 'Kênh Band (sidebar)', accelerator: 'CmdOrCtrl+Shift+B', click: () => win.webContents.send('band-comm-toggle-panel') }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 4. App Lifecycle

// --- Open a .bcsch schedule file passed on the command line / by the OS ---
// Windows & Linux: the path is an argv entry when the file is double-clicked.
// macOS: the `open-file` event (can fire before `ready`).
//
// Timing is race-prone (did-finish-load vs. the renderer wiring its IPC
// listeners), so we do BOTH: stash the parsed file in `scheduleToOpen` for the
// renderer to pull on startup via 'get-pending-schedule', AND push it live for
// the already-running case (second-instance).
let scheduleToOpen = null;

function findSchedulePathInArgv(argv) {
  return (argv || []).find(a =>
    typeof a === 'string' && a.toLowerCase().endsWith('.bcsch') && fs.existsSync(a)
  ) || null;
}

function deliverSchedulePath(p) {
  if (!p) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[Schedule] cannot read', p, e);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, { type: 'error', message: 'Không đọc được file lịch trình:\n' + p, detail: String(e && e.message || e) });
    }
    return;
  }
  console.log('[Schedule] queued from file:', p);
  scheduleToOpen = { filePath: p, data };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-schedule-file', scheduleToOpen);
    scheduleToOpen = null; // consumed; don't clobber edits on a later reload
  }
}

// Single instance: a second launch (e.g. double-clicking another .bcsch) must
// reuse this window, not spin up a rival process that fights over userData /
// the comm-server port.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    deliverSchedulePath(findSchedulePathInArgv(argv));
  });
  app.on('open-file', (e, p) => { e.preventDefault(); deliverSchedulePath(p); });
  deliverSchedulePath(findSchedulePathInArgv(process.argv));
}

bootstrapGpuAccelerationPreference();
app.whenReady().then(() => {
  if (!hasInstanceLock) return; // a rival instance — we're already quitting
  initializeData();
  // Band Comm: server auto-starts in the background (see band-comm-plan.md B1).
  // Result is reported to the operator sidebar via band-comm-status-changed +
  // a system feed line; the sidebar also re-reads state via band-comm-status.
  startBandComm();
  screen.on('display-added', () => scheduleLiveWindowSync('display-added', true, 250));
  screen.on('display-removed', () => scheduleLiveWindowSync('display-removed', true, 250));
  screen.on('display-metrics-changed', () => scheduleLiveWindowSync('display-metrics-changed', true, 250));

  // Register app-media:// protocol to serve local media files
  protocol.handle('app-media', (request) => {
    try {
      const match = request.url.match(/^app-media:\/\/+(.+)$/);
      if (!match) return new Response('Invalid URL', { status: 400 });
      const fileName = decodeURIComponent(match[1]).split(/[?#]/)[0].replace(/\/+$/, '');
      const fullPath = path.join(getMediaFolderPath(), fileName);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return new Response('Not Found', { status: 404 });
      return net.fetch(pathToFileURL(fullPath).toString());
    } catch (e) { return new Response('Error', { status: 500 }); }
  });

  // --- IPC Handlers ---
  ipcMain.handle('select-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!r.canceled && r.filePaths.length > 0) return r.filePaths[0];
    return null;
  });

  ipcMain.handle('load-settings', () => {
    try {
      if (fs.existsSync(settingsFilePath)) {
        return JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return null;
  });

  ipcMain.handle('load-system-fonts', () => {
    return listSystemFonts();
  });

  ipcMain.handle('load-style-templates', () => {
    return loadStyleTemplatesSync().templates;
  });

  ipcMain.handle('save-style-template', (event, payload) => {
    try {
      console.log('[Templates] Saving style template:', payload ? payload.name : 'null');
      const template = payload && typeof payload === 'object' ? { ...payload } : {};
      if (!template.id) template.id = `tpl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      template.name = String(template.name || '').trim();
      if (!template.name) return { success: false, error: 'Tên template không được để trống.' };
      template.scope = ['song', 'bible', 'both'].includes(template.scope) ? template.scope : 'both';
      template.style = template.style && typeof template.style === 'object' ? template.style : {};

      const store = loadStyleTemplatesSync();
      const existingIndex = store.templates.findIndex(item => item.id === template.id);
      if (existingIndex >= 0) store.templates[existingIndex] = template;
      else store.templates.push(template);
      saveStyleTemplatesSync(store);
      return { success: true, template, templates: store.templates };
    } catch (e) {
      console.error('[Templates] Save failed:', e);
      return { success: false, error: e.message || 'Save failed' };
    }
  });

  ipcMain.handle('delete-style-template', (event, templateId) => {
    try {
      const id = String(templateId || '').trim();
      const store = loadStyleTemplatesSync();
      store.templates = store.templates.filter(item => item.id !== id);
      saveStyleTemplatesSync(store);
      return { success: true, templates: store.templates };
    } catch (e) {
      console.error('[Templates] Delete failed:', e);
      return { success: false, error: e.message || 'Delete failed' };
    }
  });

  ipcMain.handle('duplicate-style-template', (event, templateId) => {
    try {
      const id = String(templateId || '').trim();
      const store = loadStyleTemplatesSync();
      const original = store.templates.find(item => item.id === id);
      if (!original) return { success: false, error: 'Không tìm thấy template để nhân bản.' };
      const duplicate = {
        ...original,
        id: `tpl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: `${original.name} Copy`
      };
      store.templates.push(duplicate);
      saveStyleTemplatesSync(store);
      return { success: true, template: duplicate, templates: store.templates };
    } catch (e) {
      console.error('[Templates] Duplicate failed:', e);
      return { success: false, error: e.message || 'Duplicate failed' };
    }
  });

  ipcMain.handle('load-custom-fonts', () => {
    return listCustomFonts();
  });

  ipcMain.handle('import-custom-font', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Fonts', extensions: ['ttf', 'otf'] }]
      });
      if (result.canceled || !result.filePaths.length) return null;
      const sourcePath = result.filePaths[0];
      const format = getSupportedFontFormat(sourcePath);
      if (!format) {
        return { success: false, error: 'Chỉ hỗ trợ font .ttf hoặc .otf.' };
      }

      const baseName = path.basename(sourcePath);
      const fileName = `${Date.now()}-${baseName}`;
      const displayName = sanitizeFontDisplayName(path.basename(baseName, path.extname(baseName)));
      const registry = loadCustomFontsRegistrySync();
      if (registry.fonts.some(font => sanitizeFontDisplayName(font.displayName) === displayName)) {
        return { success: false, error: 'Đã tồn tại một font custom có cùng tên hiển thị.' };
      }

      const targetPath = path.join(customFontsDir, fileName);
      fs.copyFileSync(sourcePath, targetPath);
      const font = {
        id: `font-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        displayName,
        fileName,
        format
      };
      registry.fonts.push(font);
      saveCustomFontsRegistrySync(registry);

      if (liveWindow && !liveWindow.isDestroyed()) {
        liveWindow.webContents.send('live-refresh-custom-fonts');
      }

      return {
        success: true,
        font: {
          ...font,
          fullPath: targetPath,
          url: pathToFileURL(targetPath).toString()
        }
      };
    } catch (e) {
      console.error('[Fonts] Import failed:', e);
      return { success: false, error: e.message || 'Import failed' };
    }
  });

  ipcMain.handle('save-settings', (event, data) => {
    try {
      const incoming = data && typeof data === 'object' ? { ...data } : {};
      const currentLiveBounds = sanitizeLiveWindowBounds(globalSettings.liveWindowBounds);
      if (!sanitizeLiveWindowBounds(incoming.liveWindowBounds) && currentLiveBounds) {
        incoming.liveWindowBounds = currentLiveBounds;
      }
      globalSettings = incoming; // Update local copy
      safeWriteSync(settingsFilePath, globalSettings);
      return { success: true };
    } catch (e) {
      console.error('Failed to save settings:', e);
      return { success: false, error: e.message };
    }
  });

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
      const p = resolveBibleXmlPath(defaultBibleXmlName) || resolveBibleXmlPath('Bible_Vietnamese.xml');
      if (p && fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8');
      }
      return null;
    } catch (e) {
      return null;
    }
  });



  ipcMain.handle('load-bible-versions', () => {
    try {
      return listBibleXmlFilesForManager();
    } catch (e) { return []; }
  });

  ipcMain.handle('load-bible-version-manager-list', () => {
    try {
      return listBibleXmlFilesForManager();
    } catch (e) {
      console.error('[Bible] Failed to load manager list:', e);
      return [];
    }
  });

  ipcMain.handle('import-bible-version', async () => {
    try {
      const r = await dialog.showOpenDialog({ 
        properties: ['openFile'], 
        filters: [{ name: 'Bible XML', extensions: ['xml'] }] 
      });
      if (!r.canceled && r.filePaths.length > 0) {
        const src = r.filePaths[0];
        if (path.extname(src).toLowerCase() !== '.xml') {
          return { success: false, error: 'Chỉ hỗ trợ file XML cho bản dịch Kinh Thánh.' };
        }
        const name = normalizeBibleFileName(path.basename(src));
        const dest = path.join(userBibleDataPath, name);
        if (fs.existsSync(dest) && path.resolve(src) !== path.resolve(dest)) {
          return { success: false, error: 'Đã tồn tại một bản dịch có cùng tên file XML.' };
        }
        if (path.resolve(src) !== path.resolve(dest)) {
          fs.copyFileSync(src, dest);
        }
        let language = 'unknown';
        try {
          const sample = fs.readFileSync(dest, 'utf8').slice(0, 2000);
          language = detectBibleLanguage(sample, name);
        } catch (e) {
          // ignore
        }
        updateBibleVersionMeta(name, {
          displayName: getBibleVersionDisplayName(name, language),
          language,
          source: 'user',
          hidden: false
        });
        return {
          success: true,
          name: name.replace(/\.xml$/i, '').replace(/_/g, ' '),
          displayName: getBibleVersionDisplayName(name, language),
          language,
          fileName: name,
          source: 'user'
        };
      }
      return { success: false, error: 'No file selected' };
    } catch (e) {
      console.error('[Bible] Import failed:', e);
      return { success: false, error: e.message || 'Import failed' };
    }
  });

  ipcMain.handle('rename-bible-version', (event, payload) => {
    try {
      const fileName = normalizeBibleFileName(payload && payload.fileName);
      const displayName = String(payload && payload.displayName || '').trim();
      if (!fileName) return { success: false, error: 'Thiếu fileName.' };
      if (!displayName) return { success: false, error: 'Tên phiên bản không được để trống.' };
      const existing = listBibleXmlFilesForManager().find(item => item.fileName === fileName);
      if (!existing) return { success: false, error: 'Không tìm thấy bản dịch cần sửa.' };

      let language = detectBibleLanguage('', fileName);
      try {
        const sample = fs.readFileSync(existing.fullPath, 'utf8').slice(0, 2000);
        const detected = detectBibleLanguage(sample, fileName);
        if (detected !== 'unknown') language = detected;
      } catch (e) {}

      updateBibleVersionMeta(fileName, {
        displayName,
        language,
        source: existing.source,
        hidden: false
      });
      return { success: true };
    } catch (e) {
      console.error('[Bible] Rename failed:', e);
      return { success: false, error: e.message || 'Rename failed' };
    }
  });

  ipcMain.handle('delete-bible-version', (event, payload) => {
    try {
      const fileName = normalizeBibleFileName(payload && payload.fileName);
      if (!fileName) return { success: false, error: 'Thiếu fileName.' };
      const existing = listBibleXmlFilesForManager().find(item => item.fileName === fileName);
      if (!existing) return { success: false, error: 'Không tìm thấy bản dịch cần xoá.' };

      if (existing.source === 'user') {
        try {
          if (fs.existsSync(existing.fullPath)) {
            fs.unlinkSync(existing.fullPath);
          }
        } catch (e) {
          return { success: false, error: 'Không thể xóa file XML của bản dịch.' };
        }
        removeBibleVersionMeta(fileName);
      } else {
        updateBibleVersionMeta(fileName, { hidden: true });
      }

      // Cleanup registry
      const registry = loadBibleVersionRegistrySync();
      if (Array.isArray(registry.order)) {
        registry.order = registry.order.filter(f => f !== fileName);
      }
      if (registry.defaultVersion === fileName) {
        registry.defaultVersion = null;
      }
      saveBibleVersionRegistrySync(registry);

      removeBibleVersionCache(fileName);
      
      let fallbackFileName = null;
      const remaining = listBibleXmlFilesForManager();
      if (remaining.length > 0) {
        fallbackFileName = remaining[0].fileName;
      }

      return { success: true, fallbackFileName };
    } catch (error) {
      console.error('[Bible] Failed to delete version:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-default-bible-version', (event, payload) => {
    console.log('[Bible] Setting default version:', payload);
    try {
      const fileName = normalizeBibleFileName(payload && payload.fileName);
      if (!fileName) return { success: false, error: 'Missing fileName' };
      const registry = loadBibleVersionRegistrySync();
      registry.defaultVersion = fileName;
      saveBibleVersionRegistrySync(registry);
      console.log('[Bible] Default version saved:', fileName);
      return { success: true };
    } catch (error) {
      console.error('[Bible] Failed to set default version:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-bible-version-order', (event, payload) => {
    console.log('[Bible] Saving version order:', payload);
    try {
      const order = payload && payload.order;
      if (!Array.isArray(order)) return { success: false, error: 'Invalid order data.' };
      const registry = loadBibleVersionRegistrySync();
      registry.order = order;
      saveBibleVersionRegistrySync(registry);
      console.log('[Bible] Version order saved.');
      return { success: true };
    } catch (error) {
      console.error('[Bible] Failed to save order:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('load-bible-parsed', (event, fileName) => {
    const xmlName = normalizeBibleFileName(fileName || defaultBibleXmlName);
    const cacheName = `bible-cache-${xmlName.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`;
    const cachePath = path.join(userDataPath, cacheName);
    const xmlPath = resolveBibleXmlPath(xmlName);
    const sourceStat = xmlPath && fs.existsSync(xmlPath) ? fs.statSync(xmlPath) : null;

    console.log(`[Bible] Loading Version: ${xmlName}`);

    // Try loading from cache first
    try {
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

        const cachedItems = Array.isArray(cached)
          ? cached
          : (cached && Array.isArray(cached.items) ? cached.items : null);

        if (cachedItems && cachedItems.length > 0) {
          const cachedSource = cached && !Array.isArray(cached) ? cached.source : null;
          const cacheMatchesSource = !!(sourceStat && cachedSource && cachedSource.mtimeMs === sourceStat.mtimeMs && cachedSource.size === sourceStat.size);

          if (!sourceStat || cacheMatchesSource) {
            console.log(`[Bible] ${cachedItems.length} chapters loaded from cache.`);
            return cachedItems;
          }
        }

        fs.unlinkSync(cachePath);
      }
    } catch (e) {
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    }

    // Parse XML and build cache
    try {
      if (!xmlPath) {
        console.error(`[Bible] File not found: ${xmlName}`);
        return [];
      }

      let xmlData = fs.readFileSync(xmlPath, 'utf8');
      console.log(`[Bible] Reading file, size: ${xmlData.length} bytes`);

      // Fix legacy encoding for Vietnamese
      xmlData = xmlData.replace(/\u00D0/g, '\u0110');
      const bibleLanguage = detectBibleLanguage(xmlData, xmlName);
      console.log(`[Bible] Detected language: ${bibleLanguage}`);

      const bibleLibrary = [];

      // Improved robust regex
      const bookRegex = /<(BIBLEBOOK|book)\s+([^>]*?)>([\s\S]*?)<\/\1>/gi;
      const chapterRegex = /<(CHAPTER|chapter)\s+([^>]*?)>([\s\S]*?)<\/\1>/gi;
      const verseRegex = /<(VERS|verse)\s+([^>]*?)>([\s\S]*?)<\/\1>/gi;

      let bookMatch;
      while ((bookMatch = bookRegex.exec(xmlData)) !== null) {
        const bookAttrs = bookMatch[2];
        const bookContent = bookMatch[3];

        // Extract bname or number from attributes
        const nameMatch = bookAttrs.match(/(bname|number)=['"]([^'"]*)['"]/i);
        if (!nameMatch) continue;

        const attrValue = nameMatch[2];
        const bookTitle = resolveBibleBookName(attrValue, bibleLanguage).trim();

        chapterRegex.lastIndex = 0;
        let chapterMatch;
        while ((chapterMatch = chapterRegex.exec(bookContent)) !== null) {
          const chapterAttrs = chapterMatch[2];
          const chapterContent = chapterMatch[3];

          const cNumMatch = chapterAttrs.match(/(cnumber|number)=['"]([^'"]*)['"]/i);
          if (!cNumMatch) continue;
          const cnumber = cNumMatch[2];

          let versesText = '';
          verseRegex.lastIndex = 0;
          let verseMatch;
          while ((verseMatch = verseRegex.exec(chapterContent)) !== null) {
            const vAttrs = verseMatch[2];
            const vContent = verseMatch[3];

            const vNumMatch = vAttrs.match(/(vnumber|number)=['"]([^'"]*)['"]/i);
            const vnumber = vNumMatch ? vNumMatch[2] : '';

            const text = vContent.replace(/<[^>]*>/g, '').trim();
            versesText += `${vnumber} ${text}\n\n`;
          }

          bibleLibrary.push({
            title: `${bookTitle} ${cnumber}`,
            lyrics: versesText.trim(),
            type: 'bible'
          });
        }
      }

      if (bibleLibrary.length > 0) {
        safeWriteSync(cachePath, {
          source: sourceStat ? {
            fileName: xmlName,
            size: sourceStat.size,
            mtimeMs: sourceStat.mtimeMs
          } : null,
          items: bibleLibrary
        });
        console.log(`[Bible] Successfully parsed ${bibleLibrary.length} chapters.`);
      } else {
        console.warn(`[Bible] Warning: 0 chapters parsed from ${xmlName}.`);
      }
      return bibleLibrary;
    } catch (e) {
      console.error('[Bible] Critical error parsing XML:', e);
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

  ipcMain.handle('export-songs-to-file', async () => {
    try {
      const songs = JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]').map(migrateItem);
      const stamp = new Date().toISOString().slice(0, 10);
      const r = await dialog.showSaveDialog({
        defaultPath: `songs-export-${stamp}.json`,
        filters: [{ name: 'Songs JSON', extensions: ['json'] }]
      });
      if (r.canceled || !r.filePath) return null;
      safeWriteSync(r.filePath, songs);
      return { filePath: r.filePath, count: songs.length };
    } catch (e) {
      console.error('Failed to export songs:', e);
      return { error: e.message || 'Export failed' };
    }
  });

  ipcMain.handle('bulk-replace-library-text', async (event, payload) => {
    try {
      const mode = payload && payload.mode === 'apply' ? 'apply' : 'preview';
      const findText = String(payload && payload.findText || '');
      const replaceText = String(payload && payload.replaceText || '');
      const target = String(payload && payload.target || 'songs');
      const field = String(payload && payload.field || 'all');
      const caseSensitive = !!(payload && payload.caseSensitive);

      if (!findText.trim()) {
        return { success: false, error: 'Vui lòng nhập nội dung cần tìm.' };
      }

      const regex = buildReplaceRegex(findText, caseSensitive);
      const summary = {
        success: true,
        mode,
        target,
        field,
        caseSensitive,
        songs: { changedItems: 0, totalMatches: 0 },
        bible: { changedFiles: 0, totalMatches: 0 }
      };

      if (target === 'songs' || target === 'all') {
        let songs = fs.existsSync(songsFilePath) ? JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]') : [];
        let changedSongs = false;

        songs = songs.map(rawSong => {
          const song = migrateItem(rawSong);
          let changed = false;
          let titleMatches = 0;
          let lyricsMatches = 0;

          if (field === 'all' || field === 'title') {
            titleMatches = countRegexMatches(song.title, regex);
            if (titleMatches > 0) {
              summary.songs.totalMatches += titleMatches;
              if (mode === 'apply') {
                song.title = replaceWithRegex(song.title, regex, replaceText);
                changed = true;
              }
            }
          }

          if (field === 'all' || field === 'lyrics') {
            lyricsMatches = countRegexMatches(song.lyrics, regex);
            if (lyricsMatches > 0) {
              summary.songs.totalMatches += lyricsMatches;
              if (mode === 'apply') {
                song.lyrics = replaceWithRegex(song.lyrics, regex, replaceText);
                changed = true;
              }
            }
          }

          if (changed || titleMatches > 0 || lyricsMatches > 0) {
            summary.songs.changedItems += 1;
          }
          if (changed) {
            changedSongs = true;
          }
          return song;
        });

        if (mode === 'apply' && changedSongs) {
          saveAndBackupSync(songsFilePath, songs);
        }
      }

      if (target === 'bible' || target === 'all') {
        const bibleFiles = fs.existsSync(userBibleDataPath)
          ? fs.readdirSync(userBibleDataPath).filter(file => file.toLowerCase().endsWith('.xml'))
          : [];

        for (const file of bibleFiles) {
          const filePath = path.join(userBibleDataPath, file);
          const xmlContent = fs.readFileSync(filePath, 'utf8');
          const matchCount = countRegexMatches(xmlContent, regex);
          if (matchCount <= 0) continue;

          summary.bible.changedFiles += 1;
          summary.bible.totalMatches += matchCount;

          if (mode === 'apply') {
            fs.writeFileSync(filePath, replaceWithRegex(xmlContent, regex, replaceText), 'utf8');
            removeBibleVersionCache(file);
          }
        }
      }

      return summary;
    } catch (e) {
      console.error('Bulk replace failed:', e);
      return { success: false, error: e.message || 'Bulk replace failed' };
    }
  });

  ipcMain.handle('show-open-dialog', async () => {
    // Parent the dialog to the window — a modeless native dialog on Windows can
    // leave the BrowserWindow without keyboard/mouse focus ("app feels locked").
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Worship Schedule', extensions: ['bcsch'] }] });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    if (!r.canceled && r.filePaths.length > 0) {
      try {
        return { filePath: r.filePaths[0], data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    }
    return null;
  });

  ipcMain.handle('show-save-dialog', async (e, d) => {
    const r = await dialog.showSaveDialog(mainWindow, { filters: [{ name: 'Worship Schedule', extensions: ['bcsch'] }] });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    if (!r.canceled && r.filePath) { safeWriteSync(r.filePath, d); return r.filePath; }
    return null;
  });

  // Overwrite an already-known schedule file (Ctrl+S after Open) without a dialog.
  ipcMain.handle('save-schedule-to-path', (e, payload) => {
    const filePath = payload && payload.filePath;
    if (!filePath || typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.bcsch')) return false;
    return safeWriteSync(filePath, payload.data);
  });

  ipcMain.handle('import-media', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'mp4', 'mov', 'm4v', 'webm'] }] });
    const mediaPath = getMediaFolderPath();
    if (!r.canceled && r.filePaths.length > 0) {
      return r.filePaths.map(p => {
        const name = path.basename(p);
        const dest = path.join(mediaPath, name);
        fs.copyFileSync(p, dest);
        return { name, path: dest, url: pathToFileURL(dest).toString(), type: isVideo(name) ? 'video' : 'image', mimeType: getMediaMimeType(name) };
      });
    }
    return null;
  });

  ipcMain.handle('load-media', () => {
    try {
      const mediaPath = getMediaFolderPath();
      if (!fs.existsSync(mediaPath)) return [];
      return fs.readdirSync(mediaPath)
        .filter(f => fs.statSync(path.join(mediaPath, f)).isFile() && isSupportedMedia(f))
        .map(f => {
          const fullPath = path.join(mediaPath, f);
          return { name: f, path: fullPath, url: pathToFileURL(fullPath).toString(), type: isVideo(f) ? 'video' : 'image', mimeType: getMediaMimeType(f) };
        });
    } catch (e) { return []; }
  });

  ipcMain.handle('open-live-window', (e, bounds) => {
    const displayCount = screen.getAllDisplays().length;
    if (displayCount <= 1 && globalSettings.allowSingleDisplayLiveWindow === false) {
      return { opened: false, reason: 'external-required' };
    }
    createLiveWindow(bounds);
    return { opened: true };
  });
  ipcMain.handle('close-live-window', () => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      if (screen.getAllDisplays().length === 1) {
        persistLiveWindowBounds(liveWindow.getBounds());
        flushLiveWindowBounds();
      }
      liveWindow.destroy();
    }
    return true;
  });
  ipcMain.handle('live-send-content', (e, d) => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('live-update-content', d);
    }
  });
  ipcMain.handle('live-send-background', (e, d) => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('live-update-background', d);
    }
  });
  ipcMain.handle('live-send-clear', () => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('live-clear');
    }
  });

  // ---- Band Comm (sidebar in index.html) ----
  // Retry after a failed auto-start ("Thử lại" button). Never throws — the
  // result (running, or a detailed error object) is what the sidebar renders.
  ipcMain.handle('band-comm-start', async () => {
    const st = await startBandComm();
    return { ...st, operatorReplies: bandCommStore.load().operatorReplies, error: lastBandStartError };
  });

  ipcMain.handle('band-comm-stop', () => {
    stopBandComm();
    sendBandStatus();
    return commServer ? commServer.getStatus() : { running: false };
  });

  // One-click: add a Windows Firewall inbound-allow rule for this app so phones
  // on the LAN can reach the comm server + mDNS. Triggers a UAC prompt. The
  // elevated script writes a result file we read back to know if it truly worked.
  ipcMain.handle('band-comm-open-firewall', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Chỉ áp dụng trên Windows.' };
    const { spawnSync } = require('child_process');
    const exe = process.execPath;
    const tmp = app.getPath('temp');
    const ps1 = path.join(tmp, 'bandcomm-fw.ps1');
    const res = path.join(tmp, 'bandcomm-fw-result.txt');
    const port = bandCommStore ? bandCommStore.load().port : 7071;
    const manual =
      `netsh advfirewall firewall add rule name="Presentation Ban Comm" dir=in action=allow program="${exe}" enable=yes profile=any\n` +
      `netsh advfirewall firewall add rule name="Presentation Ban Comm TCP" dir=in action=allow protocol=TCP localport=${port} enable=yes profile=any`;

    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$exe = '${exe.replace(/'/g, "''")}'`,
      `$res = '${res.replace(/'/g, "''")}'`,
      'try {',
      "  cmd /c 'netsh advfirewall firewall delete rule name=\"Presentation Ban Comm\"' | Out-Null",
      "  cmd /c 'netsh advfirewall firewall delete rule name=\"Presentation Ban Comm TCP\"' | Out-Null",
      `  $r1 = cmd /c ('netsh advfirewall firewall add rule name=\"Presentation Ban Comm\" dir=in action=allow program=\"' + $exe + '\" enable=yes profile=any')`,
      `  $r2 = cmd /c ('netsh advfirewall firewall add rule name=\"Presentation Ban Comm TCP\" dir=in action=allow protocol=TCP localport=${port} enable=yes profile=any')`,
      "  if ($LASTEXITCODE -ne 0) { throw ('netsh: ' + $r1 + ' ' + $r2) }",
      "  Set-Content -LiteralPath $res -Value 'OK' -Encoding ascii",
      '} catch {',
      "  Set-Content -LiteralPath $res -Value ('ERR: ' + $_.Exception.Message) -Encoding ascii",
      '}'
    ].join('\n');

    try {
      try { fs.unlinkSync(res); } catch (e) {}
      fs.writeFileSync(ps1, script, 'utf8');
      const r = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Start-Process -FilePath powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1.replace(/'/g, "''")}')`
      ], { windowsHide: true, timeout: 120000 });
      let out = '';
      try { out = fs.readFileSync(res, 'utf8').trim(); } catch (e) {}
      try { fs.unlinkSync(ps1); } catch (e) {}
      try { fs.unlinkSync(res); } catch (e) {}
      if (out === 'OK') return { ok: true };
      if (out.indexOf('ERR:') === 0) return { ok: false, error: out + '\n\nChạy tay (PowerShell Admin):\n' + manual };
      return { ok: false, error: 'Bị huỷ UAC hoặc không chạy được (' + (r.status) + '). Chạy tay (PowerShell/CMD Admin):\n' + manual };
    } catch (e) {
      return { ok: false, error: (e && e.message || 'Lỗi') + '\n\nChạy tay:\n' + manual };
    }
  });

  ipcMain.handle('band-comm-status', () => {
    initBandComm();
    const st = commServer.getStatus();
    st.operatorReplies = bandCommStore.load().operatorReplies;
    st.error = lastBandStartError;
    return st;
  });

  ipcMain.handle('band-comm-get-config', () => {
    initBandComm();
    return bandCommStore.load();
  });

  ipcMain.handle('band-comm-save-config', (e, cfg) => {
    initBandComm();
    const saved = bandCommStore.save(cfg);
    sendBandStatus();
    return saved;
  });

  ipcMain.handle('band-comm-send', (e, payload) => {
    if (!commServer) return null;
    return commServer.operatorSend(payload || {});
  });

  ipcMain.handle('band-comm-ack', (e, payload) => {
    if (!commServer) return [];
    return commServer.operatorAck(payload || {});
  });

  ipcMain.handle('band-comm-resolve', (e, payload) => {
    if (!commServer) return null;
    return commServer.operatorResolve(payload || {});
  });

  ipcMain.handle('band-comm-gallery-list', () => commServer ? commServer.galleryManifest() : { images: [], updatedAt: 0 });
  ipcMain.handle('band-comm-gallery-add', (e, p) => commServer ? commServer.galleryAdd(p || {}) : null);
  ipcMain.handle('band-comm-gallery-remove', (e, id) => commServer ? commServer.galleryRemove(id) : null);
  ipcMain.handle('band-comm-gallery-reorder', (e, ids) => commServer ? commServer.galleryReorder(ids || []) : null);

  ipcMain.handle('quit-app', () => {
    app.quit();
    return true;
  });

  ipcMain.handle('get-cpu-usage', () => {
    return getCpuUsage();
  });

  ipcMain.handle('show-open-dialog-multi', async (event, options) => {
    const result = await dialog.showOpenDialog({ ...options, properties: ['openFile', 'multiSelections'] });
    return result;
  });

  ipcMain.handle('import-songs-from-file', async (event, filePaths) => {
    let mammoth = null;
    try { mammoth = require('mammoth'); } catch (e) { /* not installed */ }
    const results = [];
    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const title = path.basename(filePath, ext);
      let lyrics = '';
      if (ext === '.txt') {
        lyrics = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trim();
        results.push({ title, lyrics, ext });
      } else if (ext === '.docx' && mammoth) {
        const r = await mammoth.extractRawText({ path: filePath });
        lyrics = r.value.trim();
        results.push({ title, lyrics, ext });
      } else if (ext === '.json') {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (Array.isArray(content)) {
            // Persistent Save: Merge imported songs into local songs.json
            const currentItems = JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]');
            const currentIds = new Set(currentItems.map(s => s.id));
            let addedCount = 0;

            for (let song of content) {
              song = migrateItem(song);
              if (!song.id) song.id = Date.now() + Math.random();
              if (!currentIds.has(song.id)) {
                currentItems.push(song);
                currentIds.add(song.id);
                addedCount++;
              }
            }
            if (addedCount > 0) {
              saveAndBackupSync(songsFilePath, currentItems);
              console.log(`Imported and saved ${addedCount} songs from JSON array.`);
            }
            results.push({ type: 'json-array', data: content, imported: true });
          } else {
            results.push({ type: 'json-object', data: content });
          }
        } catch (e) {
          console.error('Failed to parse JSON file:', filePath, e);
        }
      }
    }
    return results;
  });

  createWindow();

});


app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  flushLiveWindowBounds();
  if (liveWindowSyncTimer) {
    clearTimeout(liveWindowSyncTimer);
    liveWindowSyncTimer = null;
  }
  stopBandComm();
  if (liveWindow && !liveWindow.isDestroyed()) {
    liveWindow.destroy();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});
