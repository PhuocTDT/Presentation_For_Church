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
function createRelayClient({ store, operatorAuthStore, refreshOperatorSession, onEvent, onPresence, onSetlist, getLibraryIndex,
  listBackgroundImages, makeBackgroundThumb, backgroundSyncDelayMs = 5000, backgroundSyncIntervalMs = 10 * 60 * 1000,
  libraryDebounceMs = 3000,
  libraryRetryDelaysMs = [5000, 15000, 45000, 120000, 300000] }) {
  let ws = null;
  let wsOpen = false;
  let wantConnected = false; // true giữa start()..stop() — phân biệt "đang cố reconnect" với "đã stop() chủ động"
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let lastEnvelopeId = null;
  let lastEnvelopeTs = 0; // gửi kèm `sinceTs` để server vẫn bù đúng tin mới nếu id không còn trong ring
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
      const r = await fetch(`${relayHttpBase()}/setlist?roomId=${encodeURIComponent(roomId)}`, {
        headers: { 'X-Admin-Secret': c.relayAdminSecret },
        signal: AbortSignal.timeout(8000)
      });
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
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
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
    // idToken Cognito chỉ sống ~1 giờ; relay dùng nó để cho phép chủ phòng lấy lại quyền
    // (cài lại app/đổi máy) nên làm mới trước khi gửi nếu sắp/đã hết hạn.
    if (typeof refreshOperatorSession === 'function') { try { await refreshOperatorSession(); } catch (e) {} }
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
        name: c.room.name, code: c.room.code, password: c.room.password, cloudRoomId: roomId
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
    const since = lastEnvelopeId ? `&since=${encodeURIComponent(lastEnvelopeId)}&sinceTs=${lastEnvelopeTs}` : '';
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
      // CHỈ cập nhật cursor `since` bằng id của loại envelope THẬT SỰ có nằm
      // trong ring (alert/text/ack/resolve — xem room-relay.js's pushRing()
      // call sites). `gallery`/`presence`/`setlist` không hề được pushRing(),
      // nên nếu lỡ dùng id của chúng làm `since` lúc reconnect, server không
      // tìm thấy trong ring (`idx === -1`) và replay lại TOÀN BỘ ring — hiện
      // lại các alert/tin nhắn đã thấy rồi thành trùng lặp trên feed.
      if (envelope.id && ['alert', 'text', 'ack', 'resolve'].includes(envelope.type)) {
        lastEnvelopeId = envelope.id;
        lastEnvelopeTs = Number(envelope.ts) || lastEnvelopeTs;
      }
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
    syncLibraryToCloud({ immediate: true });
    startBackgroundSyncLoop();
    pollCloud().catch(() => {});
    clearInterval(cloudPollTimer);
    cloudPollTimer = setInterval(() => { pollCloud().catch(() => {}); }, CLOUD_POLL_MS);
    if (cloudPollTimer && cloudPollTimer.unref) cloudPollTimer.unref();
    return getStatus();
  }

  function stop() {
    wantConnected = false;
    clearTimeout(reconnectTimer);
    clearTimeout(libTimer);
    libTimer = null;
    clearTimeout(bgTimer);
    bgTimer = null;
    clearInterval(bgIntervalTimer);
    bgIntervalTimer = null;
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

  // sendRaw() trả false khi socket đang đóng/gửi lỗi — TRƯỚC ĐÂY 2 hàm dưới
  // bỏ qua kết quả đó và luôn báo thành công, khiến sidebar hiện "đã gửi"/
  // "đã tiếp nhận" dù tin không hề tới nơi lúc WebSocket rớt mạng thoáng qua.
  function operatorSend({ to = 'all', text } = {}) {
    const body = String(text || '').trim().slice(0, 500);
    if (!body) return null;
    return sendRaw({ kind: 'text', to, text: body });
  }

  function operatorAck({ clientIds = [], label = '' } = {}) {
    const targets = Array.isArray(clientIds) ? clientIds : [clientIds];
    const ok = sendRaw({ kind: 'ack', clientIds: targets.filter(Boolean), label: String(label || '').trim() });
    return ok ? targets : [];
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
  function galleryRemoveMany(ids) { return adminGalleryCall('remove-many', { ids }); }
  function galleryClear() { return adminGalleryCall('clear', {}); }
  function galleryReorder(ids) { return adminGalleryCall('reorder', { ids }); }

  // ---- Ai đang online + kick/block (sidebar, popup "Kết nối") — gọi
  // /admin/presence/* mới (X-Admin-Secret). Tách riêng khỏi WS envelope
  // 'presence' công khai (chỉ clientId+name): route này có profileId để
  // kick/block đúng người, an toàn vì chỉ operator gọi được (adminSecret).
  async function adminPresenceCall(action, method, body) {
    const c = cfg();
    const res = await fetch(`${roomBaseUrl()}/admin/presence/${action}`, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000)
    });
    return res.json().catch(() => ({ error: 'Không đọc được phản hồi từ relay' }));
  }
  async function presenceList() {
    const j = await adminPresenceCall('list', 'GET');
    return j.clients || [];
  }
  async function blockedList() {
    const j = await adminPresenceCall('blocked', 'GET');
    return j.blocked || [];
  }
  // ---- Hộp thư bài hát mới từ web (/admin/songs/*, X-Admin-Secret) ----
  // Operator duyệt rồi mới nạp vào thư viện. Relay giữ bản chờ trong DO storage
  // nên bài gửi lúc laptop tắt vẫn còn khi mở lại.
  async function fetchPendingSongs() {
    const j = await adminSongsCall('pending', 'GET');
    return Array.isArray(j.songs) ? j.songs : [];
  }
  async function adminSongsCall(action, method, body) {
    const c = cfg();
    const res = await fetch(`${roomBaseUrl()}/admin/songs/${action}`, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000)
    });
    const j = await res.json().catch(() => ({ error: 'Không đọc được phản hồi từ relay' }));
    if (!res.ok && !j.error) j.error = `HTTP ${res.status}`;
    return j;
  }
  // action: 'approve' | 'reject'. Trả {ok:true} hoặc {error}.
  function resolveSong({ webId, action, reason = '', songId = null } = {}) {
    return adminSongsCall('resolve', 'POST', { webId, action, reason, songId });
  }

  // ---- Ảnh nền thư viện -> cloud (cho trang /setlist/ xem trước slide) ----
  // `listBackgroundImages()` -> [{name, key}] (key đổi khi file đổi, vd. sha1(tên+size+mtime));
  // `makeBackgroundThumb(name)` -> Promise<Buffer JPEG ≤400KB | null>. Cả hai do main.js cấp
  // (cần Electron nativeImage) nên relay-client vẫn chạy được bằng Node thuần khi test.
  // Chỉ ẢNH — video bỏ qua. So với manifest trên relay: tải ảnh thiếu/đã đổi, xoá ảnh đã bỏ.
  let bgTimer = null;
  let bgIntervalTimer = null;
  let bgRunning = false;
  let bgDirty = false;
  let bgLastSync = { ok: null, at: 0, error: null, uploaded: 0, removed: 0 };

  async function adminBgCall(action, method, body) {
    const c = cfg();
    const res = await fetch(`${roomBaseUrl()}/admin/backgrounds/${action}`, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: AbortSignal.timeout(30000)
    });
    const j = await res.json().catch(() => ({ error: 'Không đọc được phản hồi từ relay' }));
    if (!res.ok && !j.error) j.error = `HTTP ${res.status}`;
    return j;
  }

  async function runBackgroundSync() {
    if (!listBackgroundImages || !makeBackgroundThumb) return;
    if (bgRunning) { bgDirty = true; return; }
    bgRunning = true; bgDirty = false;
    let uploaded = 0, removed = 0, errMsg = null;
    try {
      const remote = await adminBgCall('list', 'GET');
      if (remote.error) throw new Error(remote.error);
      const remoteItems = Array.isArray(remote.items) ? remote.items : [];
      const local = (listBackgroundImages() || []).slice(0, 200);
      const localByName = new Map(local.map((l) => [l.name, l]));
      const remoteByName = new Map(remoteItems.map((r) => [r.name, r]));

      const staleIds = remoteItems.filter((r) => !localByName.has(r.name)).map((r) => r.id);
      if (staleIds.length) {
        const r = await adminBgCall('remove', 'POST', { ids: staleIds });
        if (r.error) throw new Error(r.error);
        removed = staleIds.length;
      }
      for (const img of local) {
        const have = remoteByName.get(img.name);
        if (have && have.key === img.key) continue;
        let thumb = null;
        try { thumb = await makeBackgroundThumb(img.name); } catch (e) { thumb = null; }
        if (!thumb || !thumb.length) continue; // ảnh hỏng/không đọc được -> bỏ qua, không chặn cả đợt
        const r = await adminBgCall('put', 'POST', { name: img.name, key: img.key, dataB64: Buffer.from(thumb).toString('base64') });
        if (r.error) { console.warn(`[BandComm] Không đẩy được nền "${img.name}": ${r.error}`); continue; }
        uploaded++;
      }
    } catch (e) {
      errMsg = String((e && e.message) || e);
    }
    bgRunning = false;
    bgLastSync = { ok: !errMsg, at: Date.now(), error: errMsg, uploaded, removed };
    if (errMsg) console.warn(`[BandComm] Đồng bộ ảnh nền thất bại: ${errMsg} (sẽ thử lại ở lượt định kỳ).`);
    else if (uploaded || removed) console.log(`[BandComm] Đồng bộ ảnh nền: +${uploaded} / -${removed}.`);
    if (bgDirty) scheduleBackgroundSync(backgroundSyncDelayMs);
  }

  function scheduleBackgroundSync(delayMs) {
    clearTimeout(bgTimer);
    bgTimer = setTimeout(() => { bgTimer = null; runBackgroundSync().catch(() => {}); }, delayMs == null ? backgroundSyncDelayMs : delayMs);
    if (bgTimer && bgTimer.unref) bgTimer.unref();
  }
  function syncBackgroundsToCloud() { scheduleBackgroundSync(backgroundSyncDelayMs); }
  function getBackgroundSyncStatus() { return { ...bgLastSync, pending: !!bgTimer || bgRunning }; }
  function startBackgroundSyncLoop() {
    if (!listBackgroundImages) return;
    scheduleBackgroundSync(backgroundSyncDelayMs);
    clearInterval(bgIntervalTimer);
    // Định kỳ: bắt cả ảnh người dùng bỏ thẳng vào thư mục media (không qua nút Import).
    bgIntervalTimer = setInterval(() => { scheduleBackgroundSync(0); }, backgroundSyncIntervalMs);
    if (bgIntervalTimer && bgIntervalTimer.unref) bgIntervalTimer.unref();
  }

  // Kick = ngắt kết nối hiện tại, KHÔNG cấm quay lại. Block = ngắt luôn +
  // cấm profileId đó join lại (bền vững, xem room-relay.js's verifyToken()).
  function kickClient(clientId) { return adminPresenceCall('kick', 'POST', { clientId }); }
  function blockClient(clientId) { return adminPresenceCall('block', 'POST', { clientId }); }
  function unblockProfile(profileId) { return adminPresenceCall('unblock', 'POST', { profileId }); }

  // Đẩy chỉ mục thư viện lên Worker (KV theo room code, KHÔNG qua DO).
  // Gọi sau MỖI lần thư viện đổi (save/delete/import…) nên phải:
  //  - GOM (debounce, trailing): import 40 bài = 1 lượt đẩy chứ không phải 40
  //    — Worker giới hạn 30 lượt ghi/5 phút/phòng (chung với setlist/ack),
  //    vượt là 429 và lượt cuối (đầy đủ nhất) có thể là lượt bị từ chối.
  //  - THỬ LẠI có lùi dần khi 429/lỗi mạng — trước đây lỗi bị nuốt, cloud cũ mãi.
  //  - luôn đọc thư viện MỚI NHẤT lúc thực sự gửi (getLibraryIndex đọc đĩa).
  let libTimer = null;
  let libAttempt = 0;
  let libInFlight = false;
  let libDirty = false;
  let libLastSync = { ok: null, at: 0, error: null, count: 0 };

  function scheduleLibrarySync(delayMs) {
    clearTimeout(libTimer);
    libTimer = setTimeout(() => { libTimer = null; pushLibraryNow().catch(() => {}); }, delayMs);
    if (libTimer && libTimer.unref) libTimer.unref();
  }

  async function pushLibraryNow() {
    if (libInFlight) { libDirty = true; return; } // đang gửi dở → gửi lại bản mới nhất ngay sau đó
    const c = cfg();
    const roomId = (c.room && c.room.code) || c.cloudRoomId;
    if (!roomId || typeof getLibraryIndex !== 'function') return;
    libInFlight = true;
    libDirty = false;
    let errMsg = null;
    let count = 0;
    try {
      const idx = getLibraryIndex() || [];
      count = idx.length;
      const res = await fetch(`${relayHttpBase()}/library-sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': c.relayAdminSecret },
        body: JSON.stringify({ roomId, songs: idx }),
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) errMsg = `HTTP ${res.status}`;
    } catch (e) {
      errMsg = String((e && e.message) || e);
    }
    libInFlight = false;
    if (!errMsg) {
      libAttempt = 0;
      libLastSync = { ok: true, at: Date.now(), error: null, count };
      if (libDirty) scheduleLibrarySync(libraryDebounceMs);
      return;
    }
    libLastSync = { ok: false, at: Date.now(), error: errMsg, count };
    const delay = libraryRetryDelaysMs[Math.min(libAttempt, libraryRetryDelaysMs.length - 1)];
    libAttempt++;
    console.warn(`[BandComm] Đồng bộ thư viện lên cloud thất bại (${errMsg}) — thử lại sau ${Math.round(delay / 1000)}s (lần ${libAttempt}).`);
    if (libAttempt <= libraryRetryDelaysMs.length + 2) scheduleLibrarySync(delay);
  }

  // `immediate` dùng cho start() (đẩy ngay khi vừa kết nối); các nơi khác gọi
  // không tham số → gom lại. Tên/hình dạng cũ (không tham số) giữ nguyên.
  function syncLibraryToCloud({ immediate = false } = {}) {
    libAttempt = 0;
    if (immediate) { clearTimeout(libTimer); pushLibraryNow().catch(() => {}); return; }
    scheduleLibrarySync(libraryDebounceMs);
  }
  function getLibrarySyncStatus() { return { ...libLastSync, pending: !!libTimer || libInFlight }; }

  function announceRoomConfig() { /* no-op có chủ đích — xem comment đầu file */ }

  return {
    start, stop, getStatus, isRunning,
    operatorSend, operatorAck, operatorResolve,
    rotateSecret,
    galleryManifest, galleryAdd, galleryRemove, galleryRemoveMany, galleryClear, galleryReorder,
    announceRoomConfig, syncLibraryToCloud, getLibrarySyncStatus,
    accountsList, accountsCreate, accountsUpdate, accountsUpdatePassword, accountsSetActive, accountsRemove,
    presenceList, blockedList, kickClient, blockClient, unblockProfile,
    fetchPendingSongs, resolveSong,
    syncBackgroundsToCloud, getBackgroundSyncStatus
  };
}

module.exports = { createRelayClient };
