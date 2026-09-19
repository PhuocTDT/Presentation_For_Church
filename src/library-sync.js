/**
 * Presentation For Church — Library Synchronization & Upgrade Migration Engine
 * 
 * Đảm bảo khi người dùng nâng cấp từ phiên bản cũ (EasyWorship App / Presentation For Church
 * các bản trước) hoặc cài đặt vào thư mục mới / ổ đĩa mới, toàn bộ thư viện bài hát (songs.json),
 * hợp âm, bản dịch Kinh Thánh, kiểu dáng (style-templates) và font chữ từ máy của người dùng
 * được tự động phát hiện, bảo tồn và đồng bộ đầy đủ mà không bị mất mát dữ liệu.
 */

const fs = require('fs');
const path = require('path');

function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Tìm tất cả các đường dẫn thư mục dữ liệu của phiên bản cũ có thể tồn tại trên máy
 * @param {string} currentUserDataPath Thư mục userData hiện tại của app
 * @param {string} appDataRoot %APPDATA%
 * @param {string} localAppDataRoot %LOCALAPPDATA%
 * @param {string} exeDir Thư mục chứa file exe đang chạy
 */
function findCandidateDataDirs(currentUserDataPath, appDataRoot, localAppDataRoot, exeDir) {
  const normCurrent = path.resolve(currentUserDataPath || '').toLowerCase();
  const candidates = new Set();

  function addIfValid(dir) {
    if (!dir || typeof dir !== 'string') return;
    try {
      const resolved = path.resolve(dir);
      if (resolved.toLowerCase() !== normCurrent && fs.existsSync(resolved)) {
        candidates.add(resolved);
      }
    } catch (e) {}
  }

  // 1. Các thư mục dữ liệu mặc định của Electron theo tên app cũ & mới trong Roaming
  if (appDataRoot) {
    addIfValid(path.join(appDataRoot, 'easyworship-app'));
    addIfValid(path.join(appDataRoot, 'Presentation For Church'));
    addIfValid(path.join(appDataRoot, 'presentation-for-church'));
    addIfValid(path.join(appDataRoot, 'easyworship-app-dev'));
  }

  // 2. Local AppData nếu có bản portable hoặc bản cũ từng lưu
  if (localAppDataRoot) {
    addIfValid(path.join(localAppDataRoot, 'easyworship-app'));
    addIfValid(path.join(localAppDataRoot, 'Presentation For Church'));
    addIfValid(path.join(localAppDataRoot, 'Programs', 'Presentation For Church', 'PresentationForChurch-Data'));
  }

  // 3. Cạnh file exe (nếu cài ở ổ D, E... ví dụ: D:\app\Presentation For Church\PresentationForChurch-Data)
  if (exeDir) {
    addIfValid(path.join(exeDir, 'PresentationForChurch-Data'));
    addIfValid(path.join(path.dirname(exeDir), 'PresentationForChurch-Data'));
  }

  // 4. Kiểm tra các file datadir.json trong các ứng viên để xem có trỏ tới ổ khác không
  const checkedDirs = Array.from(candidates);
  for (const dir of checkedDirs) {
    const marker = path.join(dir, 'datadir.json');
    if (fs.existsSync(marker)) {
      try {
        const raw = JSON.parse(fs.readFileSync(marker, 'utf8'));
        if (raw && typeof raw.path === 'string' && fs.existsSync(raw.path)) {
          addIfValid(raw.path);
        }
      } catch (e) {}
    }
  }

  return Array.from(candidates);
}

/**
 * Hợp nhất thông minh danh sách bài hát giữa phiên bản cũ và mới
 * @param {Array} currentSongs Danh sách bài hát hiện tại
 * @param {Array} incomingSongs Danh sách bài hát từ bản cũ
 * @param {Function} migrateItem Hàm migrate schema bài hát (nếu có)
 */
function smartMergeSongLibraries(currentSongs, incomingSongs, migrateItem) {
  const mig = typeof migrateItem === 'function' ? migrateItem : (s => s);
  const currentList = Array.isArray(currentSongs) ? [...currentSongs] : [];
  const incomingList = Array.isArray(incomingSongs) ? incomingSongs : [];

  const existingById = new Map();
  const existingByNormTitle = new Map();

  currentList.forEach((s, idx) => {
    if (s && s.id) existingById.set(String(s.id), idx);
    const nt = normalizeTitle(s && s.title);
    if (nt) existingByNormTitle.set(nt, idx);
  });

  let addedCount = 0;
  let updatedCount = 0;

  incomingList.forEach(rawSong => {
    if (!rawSong || typeof rawSong !== 'object') return;
    const song = mig({ ...rawSong });
    const songId = song.id ? String(song.id) : null;
    const nt = normalizeTitle(song.title);

    let matchIdx = -1;
    if (songId && existingById.has(songId)) {
      matchIdx = existingById.get(songId);
    } else if (nt && existingByNormTitle.has(nt)) {
      matchIdx = existingByNormTitle.get(nt);
    }

    if (matchIdx >= 0) {
      // Đã tồn tại bài hát: kiểm tra xem bản cũ của user có hợp âm hoặc ghi chú mà bản mới chưa có không
      const cur = currentList[matchIdx];
      let enriched = false;

      // Giữ hợp âm của user nếu bản hiện tại chưa có
      if ((!cur.chords || cur.chords.length === 0) && (song.chords && song.chords.length > 0)) {
        cur.chords = song.chords;
        enriched = true;
      }

      // Giữ tone gốc hoặc tone biểu diễn của user
      if (!cur.key && song.key) {
        cur.key = song.key;
        enriched = true;
      }

      // Giữ background hoặc tag riêng
      if (!cur.background && song.background) {
        cur.background = song.background;
        enriched = true;
      }
      if ((!cur.tags || cur.tags.length === 0) && (song.tags && song.tags.length > 0)) {
        cur.tags = song.tags;
        enriched = true;
      }

      if (enriched) {
        currentList[matchIdx] = cur;
        updatedCount++;
      }
    } else {
      // Bài hát mới chưa có trong bản hiện tại -> thêm vào!
      if (!song.id) {
        song.id = Date.now() + Math.random().toString(36).substring(2, 7);
      }
      currentList.push(song);
      existingById.set(String(song.id), currentList.length - 1);
      if (nt) existingByNormTitle.set(nt, currentList.length - 1);
      addedCount++;
    }
  });

  return {
    mergedSongs: currentList,
    addedCount,
    updatedCount,
    totalSongs: currentList.length
  };
}

/**
 * Tự động quét và đồng bộ thư viện bài hát từ tất cả các bản cài cũ trên máy tính
 */
function autoSyncPreviousVersionsLibrary(options) {
  const {
    currentUserDataPath,
    appDataRoot,
    localAppDataRoot,
    exeDir,
    saveAndBackupSync,
    safeWriteSync,
    migrateItem
  } = options;

  if (!currentUserDataPath) return { success: false, reason: 'missing-userdata-path' };

  const songsFilePath = path.join(currentUserDataPath, 'songs.json');
  let currentSongs = [];
  try {
    if (fs.existsSync(songsFilePath)) {
      currentSongs = JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]');
    }
  } catch (e) {
    currentSongs = [];
  }

  const candidateDirs = findCandidateDataDirs(currentUserDataPath, appDataRoot, localAppDataRoot, exeDir);
  const foundSources = [];
  let totalAdded = 0;
  let totalUpdated = 0;

  for (const oldDir of candidateDirs) {
    const oldSongsPath = path.join(oldDir, 'songs.json');
    if (!fs.existsSync(oldSongsPath)) continue;

    try {
      const oldRaw = JSON.parse(fs.readFileSync(oldSongsPath, 'utf8') || '[]');
      if (Array.isArray(oldRaw) && oldRaw.length > 0) {
        const mergeRes = smartMergeSongLibraries(currentSongs, oldRaw, migrateItem);
        if (mergeRes.addedCount > 0 || mergeRes.updatedCount > 0) {
          currentSongs = mergeRes.mergedSongs;
          totalAdded += mergeRes.addedCount;
          totalUpdated += mergeRes.updatedCount;
          foundSources.push({
            dir: oldDir,
            songsCount: oldRaw.length,
            added: mergeRes.addedCount,
            updated: mergeRes.updatedCount
          });
        }

        // Đồng bộ kèm các kiểu dáng style-templates.json từ bản cũ nếu bản mới chưa có
        const oldStylesPath = path.join(oldDir, 'style-templates.json');
        const curStylesPath = path.join(currentUserDataPath, 'style-templates.json');
        if (fs.existsSync(oldStylesPath) && fs.existsSync(curStylesPath)) {
          try {
            const oldStyles = JSON.parse(fs.readFileSync(oldStylesPath, 'utf8')).templates || [];
            const curStylesData = JSON.parse(fs.readFileSync(curStylesPath, 'utf8'));
            const curStyles = curStylesData.templates || [];
            const curIds = new Set(curStyles.map(t => t.id));
            let stylesAdded = 0;
            oldStyles.forEach(st => {
              if (st && st.id && !curIds.has(st.id)) {
                curStyles.push(st);
                curIds.add(st.id);
                stylesAdded++;
              }
            });
            if (stylesAdded > 0) {
              safeWriteSync(curStylesPath, { templates: curStyles });
            }
          } catch (e) {}
        }

        // Đồng bộ kèm font chữ custom-fonts từ bản cũ
        const oldFontsDir = path.join(oldDir, 'custom-fonts');
        const curFontsDir = path.join(currentUserDataPath, 'custom-fonts');
        if (fs.existsSync(oldFontsDir)) {
          try {
            if (!fs.existsSync(curFontsDir)) fs.mkdirSync(curFontsDir, { recursive: true });
            const fontFiles = fs.readdirSync(oldFontsDir);
            for (const fontFile of fontFiles) {
              const srcFont = path.join(oldFontsDir, fontFile);
              const destFont = path.join(curFontsDir, fontFile);
              if (fs.existsSync(srcFont) && !fs.existsSync(destFont)) {
                fs.copyFileSync(srcFont, destFont);
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn(`[LibrarySync] Không đọc được bài hát từ: ${oldSongsPath}`, e);
    }
  }

  // Nếu có bài hát được thêm mới hoặc cập nhật từ phiên bản cũ -> Lưu lại vào đĩa!
  if (totalAdded > 0 || totalUpdated > 0) {
    saveAndBackupSync(songsFilePath, currentSongs);
    console.log(`[LibrarySync] Đã đồng bộ thành công ${totalAdded} bài hát mới, cập nhật ${totalUpdated} bài hát từ ${foundSources.length} nguồn bản cũ.`);
  }

  return {
    success: true,
    addedCount: totalAdded,
    updatedCount: totalUpdated,
    totalSongs: currentSongs.length,
    foundSources
  };
}

/**
 * Nhập và gộp thư viện từ một thư mục hoặc file bất kỳ do người dùng chọn (ví dụ: ổ USB, thư mục sao lưu)
 */
function importLibraryFromCustomPath(targetPath, currentUserDataPath, saveAndBackupSync, migrateItem) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { success: false, error: 'Đường dẫn không tồn tại' };
  }

  let songsToImport = [];
  let stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    const candidateJson = path.join(targetPath, 'songs.json');
    if (fs.existsSync(candidateJson)) {
      try {
        songsToImport = JSON.parse(fs.readFileSync(candidateJson, 'utf8'));
      } catch (e) {
        return { success: false, error: 'Không đọc được file songs.json trong thư mục đã chọn.' };
      }
    } else {
      return { success: false, error: 'Thư mục được chọn không chứa file songs.json.' };
    }
  } else if (stat.isFile() && targetPath.toLowerCase().endsWith('.json')) {
    try {
      const raw = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      songsToImport = Array.isArray(raw) ? raw : (raw.songs || []);
    } catch (e) {
      return { success: false, error: 'File JSON không hợp lệ.' };
    }
  }

  if (!Array.isArray(songsToImport) || songsToImport.length === 0) {
    return { success: false, error: 'Không tìm thấy danh sách bài hát hợp lệ để nhập.' };
  }

  const songsFilePath = path.join(currentUserDataPath, 'songs.json');
  let currentSongs = [];
  try {
    if (fs.existsSync(songsFilePath)) {
      currentSongs = JSON.parse(fs.readFileSync(songsFilePath, 'utf8') || '[]');
    }
  } catch (e) {
    currentSongs = [];
  }

  const mergeRes = smartMergeSongLibraries(currentSongs, songsToImport, migrateItem);
  if (mergeRes.addedCount > 0 || mergeRes.updatedCount > 0) {
    saveAndBackupSync(songsFilePath, mergeRes.mergedSongs);
  }

  return {
    success: true,
    addedCount: mergeRes.addedCount,
    updatedCount: mergeRes.updatedCount,
    totalSongs: mergeRes.totalSongs
  };
}

module.exports = {
  findCandidateDataDirs,
  smartMergeSongLibraries,
  autoSyncPreviousVersionsLibrary,
  importLibraryFromCustomPath
};
