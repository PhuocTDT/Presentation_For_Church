// Band Comm — config + profile-backup persistence.
//
// Everything lives in one file, userData/band-comm.json, written through the
// same safeWriteSync the rest of the app uses. NOT part of the library schema
// (src/schema.js) — no migrateItem here. See band-comm-plan.md §4.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 7071;
const DEFAULT_REPLIES = ['Đã nghe', 'Đợi một chút', 'Đang chỉnh', 'Chuyển sau câu này'];

function randomPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// `profiles` is a plain object keyed by client-supplied profileId, so a key of
// "__proto__" (etc.) reaching a bracket assignment would reassign the
// object's own prototype instead of adding a normal entry. Reject those
// specifically rather than trying to allowlist a charset (profileId is
// otherwise free-form, e.g. "p-1a2b3c4d").
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function isSafeProfileId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && !UNSAFE_KEYS.has(id);
}

function defaultConfig() {
  return {
    version: 1,
    room: { name: 'Kênh Band', pin: randomPin(), hostname: 'worship', uploaderPin: null },
    port: DEFAULT_PORT,
    // Địa chỉ công khai band gõ/quét (Cloudflare Tunnel, domain riêng…). Rỗng =
    // chưa cấu hình → sidebar chỉ hiện IP LAN + worship.local như trước.
    publicUrl: '',
    // Namespace phòng trên Cloudflare Worker (hộp thư setlist khi laptop tắt
    // hẳn — xem cloud/worker). Sinh 1 lần, ổn định vĩnh viễn cho máy này.
    cloudRoomId: crypto.randomUUID(),
    // Tên Cloudflare Named Tunnel để main.js tự spawn `cloudflared tunnel run
    // <tunnelName>` cùng lúc band-comm start. Rỗng = không tự chạy tunnel (mặc
    // định — máy nào chưa tự thiết lập cloudflared thì không bị ảnh hưởng).
    tunnelName: '',
    operatorReplies: [...DEFAULT_REPLIES],
    profiles: {},
    gallery: { activeSetId: null, sets: [] }
  };
}

// Fill in anything missing on a loaded config so callers never guard for holes.
function normalizeConfig(raw) {
  const base = defaultConfig();
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const room = cfg.room && typeof cfg.room === 'object' ? cfg.room : {};
  return {
    version: 1,
    room: {
      name: String(room.name || base.room.name).trim() || base.room.name,
      pin: /^\d{4,8}$/.test(String(room.pin || '')) ? String(room.pin) : base.room.pin,
      hostname: /^[a-z0-9][a-z0-9-]{0,29}$/i.test(String(room.hostname || '')) ? String(room.hostname).toLowerCase() : base.room.hostname,
      uploaderPin: /^\d{4,8}$/.test(String(room.uploaderPin || '')) ? String(room.uploaderPin) : null
    },
    port: Number.isInteger(cfg.port) && cfg.port > 0 ? cfg.port : base.port,
    publicUrl: /^https?:\/\/[^\s]+$/i.test(String(cfg.publicUrl || '').trim())
      ? String(cfg.publicUrl).trim().replace(/\/+$/, '')
      : '',
    cloudRoomId: /^[a-zA-Z0-9_-]{8,64}$/.test(String(cfg.cloudRoomId || '')) ? String(cfg.cloudRoomId) : base.cloudRoomId,
    tunnelName: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(String(cfg.tunnelName || '')) ? String(cfg.tunnelName) : '',
    operatorReplies: Array.isArray(cfg.operatorReplies) && cfg.operatorReplies.length
      ? cfg.operatorReplies
          .map(s => String(s).replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 12)
      : base.operatorReplies,
    profiles: cfg.profiles && typeof cfg.profiles === 'object' ? cfg.profiles : {},
    gallery: cfg.gallery && typeof cfg.gallery === 'object'
      ? { activeSetId: cfg.gallery.activeSetId || null, sets: Array.isArray(cfg.gallery.sets) ? cfg.gallery.sets : [] }
      : base.gallery
  };
}

function sanitizeButtons(buttons) {
  if (!Array.isArray(buttons)) return [];
  return buttons.slice(0, 40).map((b, i) => ({
    id: String(b && b.id || `b-${i}`),
    label: String(b && b.label || '').trim().slice(0, 60),
    icon: String(b && b.icon || '').slice(0, 8),
    group: String(b && b.group || '').trim().slice(0, 40)
  })).filter(b => b.label);
}

/**
 * @param {string} userDataPath
 * @param {(filePath:string, data:any)=>boolean} safeWriteSync  reused from main.js
 */
function createStore(userDataPath, safeWriteSync) {
  const configPath = path.join(userDataPath, 'band-comm.json');
  const mediaDir = path.join(userDataPath, 'band-comm-media');
  let cache = null;

  try {
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
  } catch (e) {
    console.error('[BandComm] Cannot create media dir:', e);
  }

  function load() {
    if (cache) return cache;
    let raw = null;
    try {
      if (fs.existsSync(configPath)) raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[BandComm] Failed to read band-comm.json, using defaults:', e);
    }
    cache = normalizeConfig(raw);
    // File mới toàn bộ, hoặc file cũ chưa có cloudRoomId (nâng cấp từ bản trước
    // M2) — ghi lại ngay để UUID vừa sinh không bị mất, đổi mỗi lần khởi động.
    if (!raw || raw.cloudRoomId !== cache.cloudRoomId) safeWriteSync(configPath, cache);
    return cache;
  }

  function save(next) {
    cache = normalizeConfig(next);
    safeWriteSync(configPath, cache);
    return cache;
  }

  // Merge a partial patch (room/replies/gallery) without touching profiles.
  function patch(partial) {
    const cur = load();
    return save({ ...cur, ...(partial || {}), profiles: cur.profiles });
  }

  function saveProfile(profileId, { name, role, buttons }) {
    if (!isSafeProfileId(profileId)) return null;
    const cur = load();
    const entry = {
      name: String(name || '').trim().slice(0, 40) || 'Ẩn danh',
      role: ['band', 'leader'].includes(role) ? role : 'band',
      updatedAt: Date.now(),
      buttons: sanitizeButtons(buttons)
    };
    cur.profiles[profileId] = entry;
    safeWriteSync(configPath, cur);
    cache = cur;
    return entry;
  }

  // Newest backup whose name matches (case-insensitive), for "restore on a new phone".
  function findProfileByName(name) {
    const cur = load();
    const want = String(name || '').trim().toLowerCase();
    if (!want) return null;
    let best = null;
    for (const [profileId, p] of Object.entries(cur.profiles)) {
      if (String(p.name || '').trim().toLowerCase() !== want) continue;
      if (!best || (p.updatedAt || 0) > (best.updatedAt || 0)) best = { profileId, ...p };
    }
    return best;
  }

  return { configPath, mediaDir, load, save, patch, saveProfile, findProfileByName };
}

module.exports = { createStore, defaultConfig, DEFAULT_PORT, isSafeProfileId };
