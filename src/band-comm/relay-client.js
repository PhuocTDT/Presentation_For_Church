// Band Comm — GĐ2 relay client (band-comm-plan.md §14). Thay thế
// src/band-comm/server.js (LAN HTTP+WS server) cho phần "operator" — main.js
// giờ là 1 WebSocket CLIENT nối RA NGOÀI tới Durable Object relay
// (cloud/worker/src/room-relay.js), không tự host server nào nữa. Không cần
// mDNS, không cần Cloudflare Tunnel, không có cổng nào mở ra Internet từ máy
// operator.
//
// Interface cố tình khớp createCommServer() ở server.js (start/stop/
// getStatus/isRunning/operatorSend/operatorAck/operatorResolve/gallery*/
// syncLibraryToCloud/announceRoomConfig) để main.js đổi tối thiểu lúc rewire
// — chỉ đổi factory function được gọi, không đổi cách IPC handler dùng nó.
//
// `announceRoomConfig()` là no-op có chủ đích: envelope 'room' cũ dùng để
// báo setlistEnabled đổi giữa chừng (phụ thuộc Named Tunnel) — relay không
// còn khái niệm đó (setlistEnabled luôn true), giữ hàm rỗng chỉ để main.js
// gọi không lỗi, không cần sửa call site.

const RELAY_HTTP_BASE_DEFAULT = 'https://channel.worship-official.link';

function relayHttpBase() {
  // Cho phép override lúc dev/test (BAND_RELAY_BASE=http://127.0.0.1:18787
  // khi chạy song song `wrangler dev` local) — sản phẩm thật không set biến
  // này nên luôn dùng domain production.
  return (process.env.BAND_RELAY_BASE || RELAY_HTTP_BASE_DEFAULT).replace(/\/+$/, '');
}
function relayWsBase() {
  return relayHttpBase().replace(/^http/, 'ws');
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * @param {object} opts
 * @param {ReturnType<import('./store').createStore>} opts.store
 * @param {(env:any)=>void} opts.onEvent
 * @param {(clients:any[])=>void} opts.onPresence
 * @param {(setlist:any)=>void} [opts.onSetlist]
 * @param {()=>Array}[opts.getLibraryIndex]
 */
function createRelayClient({ store, operatorAuthStore, onEvent, onPresence, onSetlist, getLibraryIndex }) {
  let ws = null;
  let wsOpen = false;
  let wantConnected = false; // true giữa start()..stop() — phân biệt "đang cố reconnect" với "đã stop() chủ động"
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let lastEnvelopeId = null;
  let clientsCache = [];
  let lastError = null;
  const seenSetlistIds = new Set();
  let cloudPollTimer = null;
  const CLOUD_POLL_MS = 60000;

  function ingestSetlist(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const id = String(raw.id || '').trim();
    if (!id || seenSetlistIds.has(id)) return false;
    seenSetlistIds.add(id);
    const sl = {
      id,
      name: String(raw.name || raw.title || 'Setlist mới').slice(0, 100),
      from: { name: String((raw.from && raw.from.name) || raw.fromName || 'Ban Hát').slice(0, 60) },
      ts: Number(raw.ts || raw.createdAt) || Date.now(),
      items: Array.isArray(raw.items) ? raw.items : []
    };
    if (onSetlist) { try { onSetlist(sl); } catch (e) {} }
    return true;
  }

  async function pollCloud() {
    const c = cfg();
    const roomId = (c.room && c.room.code) || c.cloudRoomId;
    if (!roomId) return;
    let data;
    try {
      const r = await fetch(`${relayHttpBase()}/setlist?roomId=${encodeURIComponent(roomId)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      data = await r.json();
    } catch (e) { return; }
    const list = (data && Array.isArray(data.setlists)) ? data.setlists : [];
    const newIds = [];
    for (const sl of list) {
      if (sl && Array.isArray(sl.items) && sl.items.length && ingestSetlist(sl)) newIds.push(sl.id);
    }
    if (!newIds.length) return;
    console.log(`[BandComm] Đã nhận ${newIds.length} setlist từ hộp thư cloud (room ${roomId}).`);
    for (const id of newIds) {
      fetch(`${relayHttpBase()}/setlist/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, id })
      }).catch(() => {});
    }
  }

  function cfg() { return store.load(); }

  // Durable Object định tuyến theo CHÍNH room.code (không phải cloudRoomId —
  // xem comment đầu room-relay.js: điện thoại biết code TRƯỚC khi join, còn
  // cloudRoomId chỉ lộ ra SAU khi join nên không dùng làm khoá định tuyến
  // được). cloudRoomId vẫn gửi kèm để relay lưu lại, dùng cho gallery/setlist/
  // library-sync (KV/R2 namespace cũ, không đổi).
  function roomBaseUrl() {
    return `${relayHttpBase()}/api/room/${encodeURIComponent(cfg().room.code)}`;
  }

  // Đăng ký/cập nhật cấu hình phòng (tên/code/password) với relay — gọi mỗi
  // lần start() để relay luôn khớp band-comm.json mới nhất (operator đổi mật
  // khẩu/tên phòng trong sidebar không cần thao tác đồng bộ riêng nào khác).
  async function syncRoomConfig() {
    const c = cfg();
    const roomId = (c.room && c.room.code) || c.cloudRoomId;
    const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret };
    if (operatorAuthStore) {
      try {
        const sess = operatorAuthStore.load();
        if (sess && sess.idToken) {
          headers['Authorization'] = `Bearer ${sess.idToken}`;
        }
      } catch (e) {}
    }
    const res = await fetch(`${roomBaseUrl()}/admin/config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: c.room.name, code: c.room.code, password: c.room.password, cloudRoomId: roomId,
        accountsEnabled: c.accountsEnabled, passwordRequiredWithAccounts: c.room.passwordRequiredWithAccounts,
        authMode: c.authMode
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `admin/config thất bại (HTTP ${res.status})`);
    }
  }

  function scheduleReconnect() {
    if (!wantConnected) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { connect().catch(() => {}); }, reconnectDelay);
    if (reconnectTimer && reconnectTimer.unref) reconnectTimer.unref();
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  // Trả về Promise resolve khi socket THẬT SỰ mở xong (hoặc lỗi ngay lập
  // tức) — start() cần chờ đúng cái này để status trả ra khớp thực tế (giống
  // commServer.start() cũ chờ tới lúc srv.listen() callback mới resolve).
  // Lúc reconnect tự động (không ai await), caller chỉ .catch(()=>{}) bỏ qua
  // kết quả — retry tiếp theo đã có scheduleReconnect() lo.
  function connect() {
    if (!wantConnected) return Promise.resolve();
    const c = cfg();
    const since = lastEnvelopeId ? `&since=${encodeURIComponent(lastEnvelopeId)}` : '';
    const url = `${relayWsBase()}/api/room/${encodeURIComponent(c.room.code)}/ws?adminSecret=${encodeURIComponent(c.relayAdminSecret)}${since}`;

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      lastError = String(e && e.message || e);
      scheduleReconnect();
      return Promise.reject(e);
    }
    ws = socket;

    socket.addEventListener('message', (ev) => {
      if (socket !== ws) return;
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (msg.kind !== 'envelope' || !msg.envelope) return;
      const envelope = msg.envelope;
      lastEnvelopeId = envelope.id;
      if (envelope.type === 'presence') {
        clientsCache = (envelope.meta && envelope.meta.clients) || [];
        try { onPresence && onPresence(clientsCache); } catch (e) {}
        return;
      }
      if (envelope.type === 'setlist') {
        ingestSetlist(envelope.meta);
        return;
      }
      try { onEvent && onEvent(envelope); } catch (e) {}
    });

    socket.addEventListener('close', () => {
      if (socket !== ws) return;
      wsOpen = false;
      ws = null;
      scheduleReconnect();
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      socket.addEventListener('open', () => {
        if (socket !== ws) return; // 1 kết nối cũ đã bị thay bằng cái mới hơn
        wsOpen = true;
        reconnectDelay = RECONNECT_MIN_MS;
        lastError = null;
        if (!settled) { settled = true; resolve(); }
      });
      // 'close' (đăng ký ở trên) luôn bắn theo sau 'error' cho WebSocket, lo
      // dọn dẹp/reconnect ở đó — ở đây chỉ cần bắt để start() không treo mãi
      // nếu lần connect ĐẦU TIÊN lỗi ngay (DNS sai, relay down, …).
      socket.addEventListener('error', () => {
        if (socket !== ws || settled) return;
        settled = true;
        lastError = 'Không kết nối được relay';
        reject(new Error(lastError));
      });
    });
  }

  async function start() {
    wantConnected = true;
    await syncRoomConfig(); // ném lỗi lên cho main.js báo sidebar nếu thất bại (giống commServer.start() cũ)
    reconnectDelay = RECONNECT_MIN_MS;
    await connect();
    syncLibraryToCloud();
    pollCloud().catch(() => {});
    clearInterval(cloudPollTimer);
    cloudPollTimer = setInterval(() => { pollCloud().catch(() => {}); }, CLOUD_POLL_MS);
    if (cloudPollTimer && cloudPollTimer.unref) cloudPollTimer.unref();
    return getStatus();
  }

  function stop() {
    wantConnected = false;
    clearTimeout(reconnectTimer);
    clearInterval(cloudPollTimer);
    cloudPollTimer = null;
    if (ws) { try { ws.close(); } catch (e) {} }
    ws = null;
    wsOpen = false;
  }

  function isRunning() { return wsOpen; }

  function getStatus() {
    const c = cfg();
    return {
      running: wsOpen,
      mode: 'relay',
      roomName: c.room.name,
      code: c.room.code,
      password: c.room.password,
      passwordSetAt: c.room.passwordSetAt || 0,
      clients: clientsCache,
      error: lastError
    };
  }

  function sendRaw(payload) {
    if (!ws || !wsOpen) return false;
    try { ws.send(JSON.stringify(payload)); return true; } catch (e) { return false; }
  }

  function operatorSend({ to = 'all', text } = {}) {
    const body = String(text || '').trim().slice(0, 500);
    if (!body) return null;
    sendRaw({ kind: 'text', to, text: body });
    return true;
  }

  function operatorAck({ clientIds = [], label = '' } = {}) {
    const targets = Array.isArray(clientIds) ? clientIds : [clientIds];
    sendRaw({ kind: 'ack', clientIds: targets.filter(Boolean), label: String(label || '').trim() });
    return targets;
  }

  function operatorResolve({ label = '', dedupKey = null } = {}) {
    sendRaw({ kind: 'resolve', label: String(label || '').trim(), dedupKey: dedupKey || null });
    return true;
  }

  // Đổi mật khẩu phòng -> gọi lại syncRoomConfig() để relay cập nhật + tự
  // rotateSecret() phía nó (xem room-relay.js's handleAdminConfig) — không
  // cần rotateSecret() riêng ở phía client này như commServer cũ (đó là vì
  // LAN server tự giữ token secret cục bộ; ở đây secret sống trong DO).
  async function rotateSecret() {
    await syncRoomConfig();
  }

  // ---- Tài khoản local (operator sidebar, "Tài khoản thành viên") — tài
  // khoản giờ sống TRONG DO (không còn band-comm-accounts.json cục bộ), gọi
  // qua /admin/accounts/* (X-Admin-Secret) thay vì src/band-comm/accounts.js
  // (accounts.js giờ CHỈ còn dùng làm tham chiếu thuật toán cho bản Web
  // Crypto ở cloud/worker/src/accounts-webcrypto.js, không tự chạy nữa). ----
  async function adminAccountsCall(action, method, body) {
    const c = cfg();
    const res = await fetch(`${roomBaseUrl()}/admin/accounts/${action}`, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000)
    });
    return res.json().catch(() => ({ error: 'Không đọc được phản hồi từ relay' }));
  }
  async function accountsList() {
    const c = cfg();
    const res = await fetch(`${roomBaseUrl()}/admin/accounts/list`, {
      headers: { 'X-Admin-Secret': c.relayAdminSecret }, signal: AbortSignal.timeout(15000)
    });
    const j = await res.json().catch(() => ({ accounts: [] }));
    return j.accounts || [];
  }
  function accountsCreate(payload) { return adminAccountsCall('create', 'POST', payload); }
  function accountsUpdate({ id, name } = {}) { return adminAccountsCall('update', 'POST', { id, name }); }
  function accountsUpdatePassword({ id, password, mustChangePassword } = {}) { return adminAccountsCall('update-password', 'POST', { id, password, mustChangePassword }); }
  function accountsSetActive({ id, active } = {}) { return adminAccountsCall('set-active', 'POST', { id, active }); }
  function accountsRemove(id) { return adminAccountsCall('remove', 'POST', { id }); }

  // ---- Ảnh hợp âm (operator sidebar) — gọi endpoint /admin/gallery/* mới
  // (X-Admin-Secret, KHÔNG qua check ownerId — operator quản lý ảnh bất kỳ,
  // y hệt commServer.galleryAdd/Remove/Reorder cũ). ----
  async function adminGalleryCall(action, body) {
    const c = cfg();
    const res = await fetch(`${roomBaseUrl()}/admin/gallery/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(20000)
    });
    return res.json().catch(() => ({ images: [], updatedAt: 0 }));
  }
  async function galleryManifest() {
    try {
      const res = await fetch(`${roomBaseUrl()}/gallery`, { signal: AbortSignal.timeout(10000) });
      return await res.json();
    } catch (e) { return { images: [], updatedAt: 0 }; }
  }
  function galleryAdd({ name, ext, dataB64 } = {}) { return adminGalleryCall('add', { name, ext, dataB64 }); }
  function galleryRemove(id) { return adminGalleryCall('remove', { id }); }
  function galleryReorder(ids) { return adminGalleryCall('reorder', { ids }); }

  // Đẩy chỉ mục thư viện lên Worker (KV theo room code, KHÔNG qua DO) — y
  // hệt server.js cũ, fire-and-forget, không chặn/ảnh hưởng luồng chính.
  function syncLibraryToCloud() {
    const c = cfg();
    const roomId = (c.room && c.room.code) || c.cloudRoomId;
    if (!roomId || typeof getLibraryIndex !== 'function') return;
    const idx = getLibraryIndex() || [];
    fetch(`${relayHttpBase()}/library-sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, songs: idx }),
      signal: AbortSignal.timeout(15000)
    }).catch(() => {});
  }

  function announceRoomConfig() { /* no-op có chủ đích — xem comment đầu file */ }

  return {
    start, stop, getStatus, isRunning,
    operatorSend, operatorAck, operatorResolve,
    rotateSecret,
    galleryManifest, galleryAdd, galleryRemove, galleryReorder,
    announceRoomConfig, syncLibraryToCloud,
    accountsList, accountsCreate, accountsUpdate, accountsUpdatePassword, accountsSetActive, accountsRemove
  };
}

module.exports = { createRelayClient };
