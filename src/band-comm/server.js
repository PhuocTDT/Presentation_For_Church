// Band Comm — LAN server (HTTP + WebSocket), lives in the Electron main process.
//
// Transport: one WebSocket per phone (downstream push + lightweight upstream) +
// plain `fetch` POST for join / message / profile. Zero new dependencies — the
// WS server is src/band-comm/ws.js. See band-comm-plan.md §3.
//
// Why WebSocket, not SSE: Cloudflare Tunnel (and many reverse proxies) buffer
// long-lived streaming HTTP responses, so operator→phone messages never arrive.
// WebSocket is relayed frame-by-frame, so it works over a tunnel AND on raw LAN.
//
// The operator side does NOT talk HTTP — main.js calls the methods returned by
// createCommServer() and forwards inbound envelopes to the renderer windows via
// the onEvent / onPresence callbacks.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { makeEnvelope, newId } = require('./protocol');
const { acceptWebSocket } = require('./ws');
const { isSafeProfileId } = require('./store');

// Đăng nhập tài khoản qua bước 2 (mã PIN phòng sau khi login) — nonce ngẫu
// nhiên, KHÔNG đi qua makeToken()/verifyToken() (band-comm-plan.md §11, điểm
// 8/D16): vì tempToken không phải chuỗi ký HMAC hợp lệ (không đủ 6 phần cách
// nhau bằng dấu chấm), mọi route khác tự động 401 nếu lỡ dùng nhầm, ngay tại
// gate "everything else needs a valid token" — fail-closed theo cấu trúc,
// không phải vì có route nào tự nhớ kiểm tra 1 cờ.
const PENDING_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;

const MOBILE_DIR = path.join(__dirname, '..', '..', 'comm', 'mobile');
const RING_MAX = 120;          // messages replayed to a phone that reconnects
const HEARTBEAT_MS = 15000;    // WS ping to keep the connection alive through NAT / proxies
const PRESENCE_STALE_MS = 25000;
const DUP_WINDOW_MS = 5000;    // same button/text from same phone → ignored
// Session tokens carry their issue time but never expired before — a leaked
// QR/PIN screenshot, or a phone that left the band, kept working forever
// (until someone restarts the server, which drops ALL sessions, not just the
// leaked one). 12h covers a same-day rehearsal+service without re-joining,
// but a token from a previous day always needs a fresh /api/join afterwards.
// The mobile client already handles this gracefully — see comm/mobile/app.js
// scheduleReconnect(): a 401 clears the stored token and bounces to the join
// screen, no code change needed there.
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Hộp thư setlist khi laptop tắt hẳn (M2, xem cloud/worker). Kéo về lúc
// server khởi động + định kỳ trong khi chạy, phòng khi phone tự fallback lên
// cloud vì mất LAN thoáng qua dù laptop vẫn đang mở.
const CLOUD_API_BASE = 'https://api.worship-official.link';
const CLOUD_POLL_MS = 60000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json'
};

// Real Wi-Fi / Ethernet first; virtual adapters (WSL, Hyper-V, VM bridges) last,
// so the QR / URL shown to the band points at an address phones can actually reach.
const VIRTUAL_IFACE = /vethernet|wsl|virtualbox|vmware|hyper-v|loopback|docker|tailscale|zerotier|npcap/i;
function ifaceScore(name, address) {
  let s = 0;
  if (VIRTUAL_IFACE.test(name)) s += 100;
  if (address.startsWith('192.168.')) s += 0;
  else if (address.startsWith('10.')) s += 1;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 2;
  else if (address.startsWith('169.254.')) s += 50; // link-local, no DHCP
  else s += 10;
  return s;
}
function lanIPv4List() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        out.push({ iface: name, address: ni.address, score: ifaceScore(name, ni.address) });
      }
    }
  }
  return out.sort((a, b) => a.score - b.score).map(({ iface, address }) => ({ iface, address }));
}

function readJson(req) {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    // destroy() with no error arg only ever emits 'close', never 'end'/'error' —
    // listening for 'close' too (and guarding against a double-resolve) is what
    // actually stops the request from hanging forever on an oversized body.
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    // 12MB: chord-sheet image uploads (base64 of a downscaled JPEG) go through here.
    req.on('data', d => { buf += d; if (buf.length > 12e6) { req.destroy(); finish(null); } });
    req.on('end', () => { try { finish(JSON.parse(buf || '{}')); } catch (e) { finish(null); } });
    req.on('error', () => finish(null));
    req.on('close', () => finish(null));
  });
}

function sendJson(res, code, obj, headers) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(headers || {}) });
  res.end(body);
}

/**
 * @param {object}   opts
 * @param {object}   opts.store       from ./store createStore()
 * @param {object}   [opts.accountsStore] from ./accounts createAccountsStore() — đăng nhập tài khoản (band-comm-plan.md §11); bỏ trống = chỉ dùng luồng PIN phòng cũ
 * @param {Function} [opts.onEvent]   (envelope) => void — every non-presence message
 * @param {Function} [opts.onPresence](clientList) => void
 * @param {Function} [opts.getLibraryIndex] () => [{id,title,lyrics}] — for /api/library
 * @param {Function} [opts.onSetlist] (setlist) => void — a phone sent a setlist
 */
function createCommServer({ store, accountsStore, onEvent, onPresence, getLibraryIndex, onSetlist }) {
  let server = null;
  let running = false;
  let secret = null;
  let port = 0;
  let boundIp = null;
  let hb = null;
  const clients = new Map(); // clientId -> { clientId, name, role, ws, lastSeen, dupMap }
  const ring = [];           // { id, env }
  const setlists = [];             // setlist gửi từ điện thoại trong phiên (RAM)
  const receivedSetlistIds = new Set(); // idempotent theo setlist.id
  let cloudPollTimer = null;
  // accountId -> { accountId, name, role, expiresAt } — bước 1 (/api/login) đã
  // xác thực xong nhưng còn chờ mã PIN phòng (bước 2, /api/join-room) nếu
  // room.pinRequiredWithAccounts bật. Xem comment ở PENDING_LOGIN_MAX_AGE_MS.
  const pendingLogins = new Map(); // tempToken -> { accountId, name, role, expiresAt }

  // Chống dò mã PIN/mật khẩu bằng brute force — không có gì khác chặn thử
  // liên tục qua HTTP thô. Khoá tăng dần theo 1 khoá bất kỳ (IP nguồn cho
  // /api/join & /api/join-room, thêm theo accountId/username cho /api/login
  // — xem checkBlocked/recordFailure bên dưới); qua Cloudflare Tunnel mọi
  // request đều tới từ 127.0.0.1 (cloudflared proxy nội bộ) nên khi đó khoá
  // theo IP thành khoá dùng chung cho toàn bộ traffic ngoài LAN — chấp nhận
  // được, còn hơn không có gì chặn.
  const joinAttempts = new Map(); // key -> { fails, blockUntil, lastAt }
  function pinBackoffMs(fails) {
    if (fails < 5) return 0;
    if (fails < 10) return 30 * 1000;
    if (fails < 20) return 5 * 60 * 1000;
    return 30 * 60 * 1000;
  }
  // Số giây còn phải đợi nếu `key` đang bị khoá, hoặc 0 nếu không.
  function checkBlocked(key) {
    const att = joinAttempts.get(key);
    const now = Date.now();
    return (att && att.blockUntil > now) ? Math.ceil((att.blockUntil - now) / 1000) : 0;
  }
  function recordFailure(key) {
    const now = Date.now();
    const next = joinAttempts.get(key) || { fails: 0, blockUntil: 0, lastAt: now };
    next.fails += 1;
    next.lastAt = now;
    next.blockUntil = now + pinBackoffMs(next.fails);
    joinAttempts.set(key, next);
  }
  function clearAttempts(key) { joinAttempts.delete(key); }
  function prunePendingLogins() {
    const now = Date.now();
    for (const [tok, p] of pendingLogins) {
      if (p.expiresAt < now) pendingLogins.delete(tok);
    }
  }
  function pruneJoinAttempts() {
    const now = Date.now();
    for (const [ip, att] of joinAttempts) {
      if (now - att.lastAt > 60 * 60 * 1000) joinAttempts.delete(ip);
    }
  }

  // Điểm nhận duy nhất cho 1 setlist đã hợp lệ, dù đến từ LAN (POST /api/setlist)
  // hay kéo về từ hộp thư cloud — cùng idempotent theo id, cùng phát ra onSetlist.
  function ingestSetlist(sl) {
    if (!sl || typeof sl.id !== 'string' || !sl.id || receivedSetlistIds.has(sl.id)) return false;
    receivedSetlistIds.add(sl.id);
    setlists.push(sl);
    if (setlists.length > 30) setlists.shift();
    if (onSetlist) { try { onSetlist(sl); } catch (e) {} }
    return true;
  }

  async function pollCloud() {
    const cfg = store.load();
    const roomId = cfg.cloudRoomId;
    if (!roomId) return;
    let data;
    try {
      const r = await fetch(`${CLOUD_API_BASE}/setlist?roomId=${encodeURIComponent(roomId)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      data = await r.json();
    } catch (e) { return; } // cloud không tới được — LAN vẫn hoạt động bình thường, im lặng bỏ qua
    const list = (data && Array.isArray(data.setlists)) ? data.setlists : [];
    const newIds = [];
    for (const sl of list) {
      if (sl && Array.isArray(sl.items) && sl.items.length && ingestSetlist(sl)) newIds.push(sl.id);
    }
    if (!newIds.length) return;
    console.log(`[BandComm] Đã nhận ${newIds.length} setlist từ hộp thư cloud.`);
    for (const id of newIds) {
      fetch(`${CLOUD_API_BASE}/setlist/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, id })
      }).catch(() => {});
    }
  }

  // token = clientId.issued.<b64url(name)>.role.<hmac(payload)>
  // Name + role travel inside the token so a phone that was evicted server-side
  // (staleness sweep, brief leave) can be rehydrated on its next request without
  // forcing the user back through the join screen. Only a server restart (new
  // secret) invalidates tokens.
  const b64url = (s) => Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);

  // profileId đi kèm token (không chỉ name/role) để "chỉ tự xoá ảnh mình
  // đăng" không bị mất giữa chừng phiên nếu client record bị quét dọn rồi
  // rebuild lại từ token (mất mạng thoáng qua > PRESENCE_STALE_MS*2, WS bị
  // coi mất kết nối) — rebuild vẫn phải nhớ đúng profileId, không chỉ
  // name/role như trước.
  function makeToken(clientId, name, role, profileId) {
    const payload = `${clientId}.${Date.now()}.${b64url(name)}.${role}.${b64url(profileId || '')}`;
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 6) return null;
    const sig = parts[5];
    const payload = parts.slice(0, 5).join('.');
    try {
      if (sign(payload) !== sig) return null;
    } catch (e) { return null; } // server stopped, secret gone
    const issued = Number(parts[1]);
    if (!Number.isFinite(issued) || Date.now() - issued > TOKEN_MAX_AGE_MS) return null;
    const profileId = unb64url(parts[4]);
    return {
      clientId: parts[0],
      name: unb64url(parts[2]) || 'Ẩn danh',
      role: parts[3] === 'leader' ? 'leader' : 'band',
      profileId: isSafeProfileId(profileId) ? profileId : null
    };
  }

  const wsAlive = (c) => !!(c && c.ws && c.ws.isAlive());

  // Setlist (soạn từ xa/khi laptop tắt) chỉ có ý nghĩa khi có link CỐ ĐỊNH để
  // band vào từ ngoài LAN (Named Tunnel). Quick Tunnel đổi URL mỗi lần chạy —
  // không có cách nào gửi cho band 1 link dùng lại được, nên ẩn hẳn tính năng
  // thay vì hứa hẹn nửa vời. `tunnelName` chỉ được set khi cấu hình Named
  // Tunnel (main.js), nên dùng luôn làm cờ bật/tắt, không cần field riêng.
  function setlistEnabled() { return !!store.load().tunnelName; }

  function presenceList() {
    const now = Date.now();
    return [...clients.values()]
      .filter(c => wsAlive(c) || now - c.lastSeen < PRESENCE_STALE_MS)
      .map(c => ({ clientId: c.clientId, name: c.name, role: c.role, online: wsAlive(c) }));
  }

  function remember(env) {
    ring.push({ id: env.id, env });
    if (ring.length > RING_MAX) ring.shift();
  }

  // Deliver an envelope: to 'all' phones, or just one when env.to is a clientId.
  // Always remembered in the ring (except presence) and pushed to main via onEvent.
  function fanout(env) {
    const isPresence = env.type === 'presence';
    if (!isPresence) remember(env);
    const json = JSON.stringify(env);
    for (const c of clients.values()) {
      if (!wsAlive(c)) continue;
      if (env.to === 'all' || env.to === c.clientId) {
        try { c.ws.send(json); } catch (e) { /* dead socket, close handler will clean up */ }
      }
    }
    if (!isPresence && onEvent) { try { onEvent(env); } catch (e) {} }
  }

  function pushPresence() {
    const list = presenceList();
    fanout(makeEnvelope({ type: 'presence', meta: { clients: list } }));
    if (onPresence) { try { onPresence(list); } catch (e) {} }
  }

  // Downstream channel: phone opens  ws(s)://host/api/ws?token=…&since=<lastId>
  function handleUpgrade(req, socket) {
    let u;
    try { u = new URL(req.url, 'http://localhost'); } catch (e) { try { socket.destroy(); } catch (_) {} return; }
    if (u.pathname !== '/api/ws') { try { socket.destroy(); } catch (e) {} return; }

    const ident = verifyToken(u.searchParams.get('token') || '');
    if (!ident) {
      try { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); } catch (e) {}
      return;
    }
    const clientId = ident.clientId;
    let client = clients.get(clientId);
    if (!client) {
      client = { clientId, name: ident.name, role: ident.role, profileId: ident.profileId, ws: null, lastSeen: Date.now(), dupMap: new Map() };
      clients.set(clientId, client);
    }
    client.lastSeen = Date.now();
    if (client.ws && client.ws.isAlive()) { try { client.ws.close(1000); } catch (e) {} }

    const conn = acceptWebSocket(req, socket, {
      onMessage: () => { client.lastSeen = Date.now(); }, // {"t":"ping"} keep-alive; payload ignored
      onClose: () => { if (client.ws === conn) client.ws = null; pushPresence(); }
    });
    if (!conn) return;
    client.ws = conn;

    // Replay whatever the phone missed while disconnected.
    const since = u.searchParams.get('since');
    let start = 0;
    if (since) {
      const idx = ring.findIndex(r => r.id === since);
      if (idx >= 0) start = idx + 1;
    }
    for (let i = start; i < ring.length; i++) {
      try { conn.send(JSON.stringify(ring[i].env)); } catch (e) {}
    }
    // No id → the client won't use it as a replay cursor.
    conn.send(JSON.stringify({ type: 'system', ts: Date.now(), text: 'Đã kết nối kênh', meta: { event: 'connected' } }));
    pushPresence();
  }

  function serveStatic(res, urlPath) {
    let rel = (urlPath === '/' ? '/index.html' : urlPath).split('?')[0];
    const full = path.normalize(path.join(MOBILE_DIR, rel));
    if (full !== MOBILE_DIR && !full.startsWith(MOBILE_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
    fs.readFile(full, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  // Cấp token đầy đủ + response giống hệt /api/join cho 1 { id, name, role }
  // — dùng chung cho cả /api/login (khi không cần PIN phòng) và
  // /api/join-room (bước 2, sau khi đã qua PIN phòng).
  function finishLogin(res, account, cfg) {
    const clientId = newId('c');
    // profileId = accountId, KHÔNG phải id ngẫu nhiên riêng — đây là điểm
    // mấu chốt giải quyết xung đột "1 người 2 máy" giữa gallery ownership
    // và bộ nút cảnh báo (band-comm-plan.md §11, điểm 1+2): mọi nơi đã dùng
    // client.profileId làm khoá định danh-theo-người-dùng tự động hoạt động
    // đúng với tài khoản, không cần sửa gì thêm ở gallery.
    const profileId = account.id;
    clients.set(clientId, { clientId, name: account.name, role: account.role, profileId, ws: null, lastSeen: Date.now(), dupMap: new Map() });
    const restore = cfg.profiles[profileId]
      ? { profileId, ...cfg.profiles[profileId] }
      : store.findProfileByName(account.name);
    setTimeout(pushPresence, 50);
    return sendJson(res, 200, {
      token: makeToken(clientId, account.name, account.role, profileId),
      clientId,
      // /api/join trả lại name/role vì client tự khai lúc gửi lên (đã biết
      // sẵn); đăng nhập tài khoản thì client chỉ gửi username/password, nên
      // phải trả lại name/role thật ở đây để UI hiển thị đúng.
      name: account.name,
      role: account.role,
      room: { name: cfg.room.name },
      operatorReplies: cfg.operatorReplies,
      profile: restore || null,
      gallery: galleryManifest(),
      cloudRoomId: cfg.cloudRoomId,
      setlistEnabled: setlistEnabled()
    });
  }

  async function handle(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);

    // --- không cần token: đăng nhập (dò được mode), join PIN phòng cũ, đăng
    // nhập tài khoản (band-comm-plan.md §11) ---
    if (p === '/api/mode' && req.method === 'GET') {
      const cfg = store.load();
      // Không nhạy cảm (không có tên/roster) — chỉ đủ để mobile biết vẽ màn
      // hình nào, KHÔNG lộ danh sách tài khoản (điểm 3/D17: không có
      // GET/POST /api/accounts public nào cả).
      return sendJson(res, 200, { accountsEnabled: !!cfg.accountsEnabled, pinRequiredWithAccounts: !!cfg.room.pinRequiredWithAccounts });
    }

    if (p === '/api/join' && req.method === 'POST') {
      const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
      const blockedSec = checkBlocked(ip);
      if (blockedSec > 0) {
        res.setHeader('Retry-After', String(blockedSec));
        return sendJson(res, 429, { error: 'Thử sai mã PIN quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' });
      }
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      const cfg = store.load();
      if (String(body.pin || '') !== String(cfg.room.pin)) {
        recordFailure(ip);
        return sendJson(res, 403, { error: 'Sai mã PIN' });
      }
      clearAttempts(ip);
      const name = String(body.name || '').trim().slice(0, 40) || 'Ẩn danh';
      const role = ['band', 'leader'].includes(body.role) ? body.role : 'band';
      // profileId tự khai ở luồng cũ này KHÔNG được trùng id 1 tài khoản thật
      // — nếu không, 1 client biết/đoán đúng accounts[].id sẽ chiếm quyền
      // xoá ảnh + bộ nút cảnh báo của account đó mà không cần đăng nhập
      // (band-comm-plan.md §11, điểm 10/D17). Rủi ro thấp (newId() ngẫu
      // nhiên) nhưng chặn gần như miễn phí.
      const claimedProfileId = isSafeProfileId(body.profileId) ? body.profileId : null;
      const profileId = (claimedProfileId && accountsStore && accountsStore.isAccountId(claimedProfileId)) ? null : claimedProfileId;
      const clientId = newId('c');
      clients.set(clientId, { clientId, name, role, profileId, ws: null, lastSeen: Date.now(), dupMap: new Map() });
      const restore = profileId && cfg.profiles[profileId]
        ? { profileId, ...cfg.profiles[profileId] }
        : store.findProfileByName(name);
      setTimeout(pushPresence, 50);
      return sendJson(res, 200, {
        token: makeToken(clientId, name, role, profileId),
        clientId,
        room: { name: cfg.room.name },
        operatorReplies: cfg.operatorReplies,
        profile: restore || null,
        gallery: galleryManifest(),
        cloudRoomId: cfg.cloudRoomId,
        setlistEnabled: setlistEnabled()
      });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const cfg = store.load();
      if (!cfg.accountsEnabled || !accountsStore) return sendJson(res, 404, { error: 'not found' });
      const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      const username = String(body.username || '').trim().toLowerCase();
      const ipKey = 'login-ip:' + ip;
      const acctKey = 'login-acct:' + username;
      const blockedSec = Math.max(checkBlocked(ipKey), username ? checkBlocked(acctKey) : 0);
      if (blockedSec > 0) {
        res.setHeader('Retry-After', String(blockedSec));
        return sendJson(res, 429, { error: 'Thử sai quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' });
      }
      const account = accountsStore.verify(username, body.password);
      if (!account) {
        recordFailure(ipKey);
        if (username) recordFailure(acctKey);
        // Không phân biệt "sai username" và "sai password" — tránh lộ
        // username nào tồn tại qua thông báo lỗi.
        return sendJson(res, 403, { error: 'Sai tên đăng nhập hoặc mật khẩu' });
      }
      clearAttempts(ipKey); clearAttempts(acctKey);
      if (!cfg.room.pinRequiredWithAccounts) return finishLogin(res, account, cfg);
      const tempToken = crypto.randomBytes(16).toString('hex');
      pendingLogins.set(tempToken, { accountId: account.id, name: account.name, role: account.role, expiresAt: Date.now() + PENDING_LOGIN_MAX_AGE_MS });
      return sendJson(res, 200, { needsRoomPin: true, tempToken });
    }

    if (p === '/api/join-room' && req.method === 'POST') {
      const cfg = store.load();
      if (!cfg.accountsEnabled || !cfg.room.pinRequiredWithAccounts || !accountsStore) return sendJson(res, 404, { error: 'not found' });
      const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
      const ipKey = 'joinroom-ip:' + ip;
      const blockedSec = checkBlocked(ipKey);
      if (blockedSec > 0) {
        res.setHeader('Retry-After', String(blockedSec));
        return sendJson(res, 429, { error: 'Thử sai mã PIN quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' });
      }
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      const tempToken = String(body.tempToken || '');
      const pending = pendingLogins.get(tempToken);
      if (!pending || pending.expiresAt < Date.now()) {
        pendingLogins.delete(tempToken);
        return sendJson(res, 401, { error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' });
      }
      if (String(body.pin || '') !== String(cfg.room.pin)) {
        recordFailure(ipKey);
        return sendJson(res, 403, { error: 'Sai mã PIN' });
      }
      clearAttempts(ipKey);
      pendingLogins.delete(tempToken);
      const acc = accountsStore.findById(pending.accountId);
      if (!acc || acc.active === false) return sendJson(res, 401, { error: 'Tài khoản không còn hoạt động' });
      return finishLogin(res, { id: acc.id, name: acc.name, role: acc.role }, cfg);
    }

    // --- everything else needs a valid token ---
    const token = u.searchParams.get('token') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const ident = verifyToken(token);
    if (!ident) return sendJson(res, 401, { error: 'unauthorized' });
    const clientId = ident.clientId;
    let client = clients.get(clientId);
    if (!client) {
      // valid token, but the record was swept / left — rebuild it from the token.
      client = { clientId, name: ident.name, role: ident.role, profileId: ident.profileId, ws: null, lastSeen: Date.now(), dupMap: new Map() };
      clients.set(clientId, client);
    }
    client.lastSeen = Date.now();

    // Downstream is the WebSocket at /api/ws — handled in `handleUpgrade`, not here.

    if (p === '/api/message' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      const text = String(body.text || body.label || '').trim().slice(0, 500);
      if (!text) return sendJson(res, 400, { error: 'empty' });
      const key = String(body.buttonId || text).toLowerCase();
      const now = Date.now();
      if (now - (client.dupMap.get(key) || 0) < DUP_WINDOW_MS) return sendJson(res, 200, { ok: true, deduped: true });
      client.dupMap.set(key, now);
      const env = makeEnvelope({
        type: 'alert',
        from: { clientId, name: client.name, role: client.role },
        to: 'all',
        text,
        buttonId: body.buttonId || null
      });
      fanout(env);
      return sendJson(res, 200, { ok: true, id: env.id });
    }

    if (p === '/api/ping' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, clients: presenceList() });
    }

    if (p === '/api/profile' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      const saved = store.saveProfile(body.profileId, { name: client.name, role: client.role, buttons: body.buttons });
      return sendJson(res, 200, { ok: true, profile: saved });
    }
    if (p === '/api/profile' && req.method === 'GET') {
      return sendJson(res, 200, { profile: store.findProfileByName(u.searchParams.get('name') || client.name) || null });
    }

    if (p === '/api/leave' && req.method === 'POST') {
      clients.delete(clientId);
      pushPresence();
      return sendJson(res, 200, { ok: true });
    }

    // ---- chord-sheet gallery (read side — token required, see above) ----
    if (p === '/api/gallery' && req.method === 'GET') {
      return sendJson(res, 200, galleryManifest());
    }
    if (p.indexOf('/api/gallery/image/') === 0 && req.method === 'GET') {
      const gid = p.slice('/api/gallery/image/'.length).replace(/[^a-z0-9_.-]/gi, '');
      const item = gallery.images.find(x => x.id === gid);
      if (!item) return sendJson(res, 404, { error: 'not found' });
      return fs.readFile(path.join(store.mediaDir, item.id + item.ext), (e, data) => {
        if (e) return sendJson(res, 404, { error: 'gone' });
        res.writeHead(200, {
          'Content-Type': item.ext === '.png' ? 'image/png' : (item.ext === '.webp' ? 'image/webp' : 'image/jpeg'),
          'Cache-Control': 'public, max-age=31536000, immutable'
        });
        res.end(data);
      });
    }

    // ---- chord-sheet gallery (write side) ----
    // Ai đã join hợp lệ (token) cũng thêm được ảnh — không còn giới hạn "1
    // người phụ trách" (uploaderPin) như trước, tránh 1 phiên chiếm quyền
    // (đặc biệt hại nếu phiên đó zombie — xem fix ws.js cùng đợt). Xoá thì
    // chỉ được xoá ảnh CHÍNH MÌNH đã đăng, so theo profileId (ổn định qua
    // các lần join lại trên cùng điện thoại — clientId thì đổi mỗi phiên).
    if (p === '/api/gallery/add' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      return sendJson(res, 200, galleryAdd({ name: body.name, ext: body.ext, dataB64: body.dataB64, ownerId: client.profileId }));
    }

    if (p === '/api/gallery/remove' && req.method === 'POST') {
      const body = await readJson(req);
      const item = gallery.images.find(x => x.id === (body && body.id));
      if (!item) return sendJson(res, 200, galleryManifest()); // đã không còn, coi như xong
      if (!client.profileId || item.ownerId !== client.profileId) {
        return sendJson(res, 403, { error: 'Bạn chỉ xoá được ảnh mình đã đăng' });
      }
      return sendJson(res, 200, galleryRemove(item.id));
    }

    // ---- setlist: điện thoại soạn danh sách bài -> operator nạp vào Schedule ----
    // (chỉ khi setlistEnabled() — xem giải thích ở định nghĩa hàm)
    if (p === '/api/library' && req.method === 'GET') {
      if (!setlistEnabled()) return sendJson(res, 404, { error: 'not found' });
      const idx = (typeof getLibraryIndex === 'function' && getLibraryIndex()) || [];
      return sendJson(res, 200, { songs: idx, count: idx.length, updatedAt: Date.now() });
    }
    if (p === '/api/setlist' && req.method === 'GET') {
      if (!setlistEnabled()) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { setlists });
    }
    if (p === '/api/setlist' && req.method === 'POST') {
      if (!setlistEnabled()) return sendJson(res, 404, { error: 'not found' });
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      // Strip < > defense-in-depth: item.title for an id that doesn't match a
      // real library song reaches the operator's Electron renderer as free
      // text (see loadSetlistIntoSchedule() in index.html) — the render side
      // must escape it regardless, but a joined phone shouldn't be able to
      // hand the operator raw HTML either.
      const items = (Array.isArray(body.items) ? body.items : [])
        .filter(it => it && it.type === 'song' && it.id != null)
        .slice(0, 60)
        .map(it => ({ type: 'song', id: it.id, title: String(it.title || '').replace(/[<>]/g, '').slice(0, 200) }));
      if (!items.length) return sendJson(res, 400, { error: 'Setlist rỗng' });
      const sl = {
        id: String(body.id || newId('sl')),
        name: String(body.name || '').trim().slice(0, 80) || 'Setlist',
        from: { name: client.name, role: client.role },
        ts: Date.now(),
        items
      };
      ingestSetlist(sl);
      return sendJson(res, 200, { ok: true, id: sl.id });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  // ---- operator-initiated (called by main.js over IPC) ----
  const OPERATOR = { clientId: 'operator', name: 'Người chiếu máy', role: 'operator' };

  function operatorSend({ to = 'all', text } = {}) {
    const body = String(text || '').trim().slice(0, 500);
    if (!running || !body) return null;
    const env = makeEnvelope({ type: 'text', from: OPERATOR, to: to || 'all', text: body });
    fanout(env);
    return env;
  }

  function operatorAck({ clientIds = [], label = '' } = {}) {
    if (!running) return [];
    const nice = String(label || '').trim();
    const targets = (Array.isArray(clientIds) ? clientIds : [clientIds]).filter(Boolean);
    const ids = [];
    for (const cid of targets) {
      const env = makeEnvelope({
        type: 'ack', from: OPERATOR, to: cid,
        text: nice ? `Người vận hành đã tiếp nhận ${nice}` : 'Người vận hành đã tiếp nhận',
        meta: { label: nice }   // client bolds this part of the toast
      });
      fanout(env);
      ids.push(env.id);
    }
    return ids;
  }

  function operatorResolve({ label = '', dedupKey = null } = {}) {
    if (!running) return null;
    const env = makeEnvelope({
      type: 'resolve', from: OPERATOR, to: 'all',
      text: label ? `Đã xử lý: ${label}` : 'Đã xử lý',
      meta: { dedupKey: dedupKey || null }
    });
    fanout(env);
    return env;
  }

  // ---- chord-sheet gallery: operator uploads, phones show them below the
  // buttons. Persisted to its own file so store.js stays untouched. ----
  const galleryFile = path.join(path.dirname(store.configPath), 'band-comm-gallery.json');
  let gallery = (function () {
    try { const g = JSON.parse(fs.readFileSync(galleryFile, 'utf8')); if (g && Array.isArray(g.images)) return g; } catch (e) {}
    return { images: [], updatedAt: 0 };
  })();
  function saveGallery() { gallery.updatedAt = Date.now(); try { fs.writeFileSync(galleryFile, JSON.stringify(gallery)); } catch (e) {} }
  function galleryManifest() { return { images: gallery.images.map(x => ({ id: x.id, name: x.name, ownerId: x.ownerId || null })), updatedAt: gallery.updatedAt || 0 }; }
  function announceGallery() { fanout(makeEnvelope({ type: 'gallery', from: OPERATOR, to: 'all', meta: galleryManifest() })); }

  // Phones only learn `setlistEnabled` once, from their /api/join response —
  // nếu operator đổi tunnelName (thứ quyết định setlistEnabled) SAU khi phone
  // đã join, đường reconnect của WS (POST /api/ping) không tự fetch lại, nên
  // phone sẽ kẹt không thấy UI setlist suốt phiên (dài) còn lại. Đẩy giá trị
  // hiện tại để phone đã kết nối phản ứng ngay, giống cách gallery đã làm.
  function announceRoomConfig() {
    fanout(makeEnvelope({
      type: 'room', from: OPERATOR, to: 'all',
      meta: { setlistEnabled: setlistEnabled() }
    }));
  }

  // Mirror ảnh sang Cloudflare R2 (Worker route /gallery, xem cloud/worker) để
  // điện thoại XEM được ổn định, không phụ thuộc tunnel còn sống lúc đang
  // xem. Fire-and-forget — ảnh vẫn xem được qua local/LAN như cũ nếu mirror
  // lỗi (mất mạng ngoài, Worker down…), không chặn/làm hỏng luồng chính.
  function mirrorGalleryAdd(id, name, ext, b64) {
    const roomId = store.load().cloudRoomId;
    if (!roomId) return;
    fetch(`${CLOUD_API_BASE}/gallery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, id, name, ext, dataB64: b64 }),
      signal: AbortSignal.timeout(15000)
    }).catch(() => {});
  }
  function mirrorGalleryRemove(id) {
    const roomId = store.load().cloudRoomId;
    if (!roomId) return;
    fetch(`${CLOUD_API_BASE}/gallery/remove`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, id }),
      signal: AbortSignal.timeout(8000)
    }).catch(() => {});
  }

  function galleryAdd({ name = '', ext = '.jpg', dataB64 = '', ownerId = null } = {}) {
    const b64 = String(dataB64 || '').replace(/^data:[^,]*,/, '');
    if (!b64) return galleryManifest();
    const cleanExt = /^\.(jpe?g|png|webp)$/i.test(ext) ? ext.toLowerCase().replace('.jpeg', '.jpg') : '.jpg';
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch (e) { return galleryManifest(); }
    if (!buf.length || buf.length > 8 * 1024 * 1024) return galleryManifest();
    const id = newId('img');
    try { fs.writeFileSync(path.join(store.mediaDir, id + cleanExt), buf); } catch (e) { return galleryManifest(); }
    const cleanName = String(name || 'Hợp âm').slice(0, 80);
    gallery.images.push({ id, name: cleanName, ext: cleanExt, ownerId: isSafeProfileId(ownerId) ? ownerId : null });
    saveGallery(); announceGallery();
    mirrorGalleryAdd(id, cleanName, cleanExt, b64);
    return galleryManifest();
  }
  function galleryRemove(id) {
    const i = gallery.images.findIndex(x => x.id === id);
    if (i < 0) return galleryManifest();
    const [rm] = gallery.images.splice(i, 1);
    try { fs.unlinkSync(path.join(store.mediaDir, rm.id + rm.ext)); } catch (e) {}
    saveGallery(); announceGallery();
    mirrorGalleryRemove(rm.id);
    return galleryManifest();
  }
  function galleryReorder(ids) {
    const map = new Map(gallery.images.map(x => [x.id, x]));
    const next = (Array.isArray(ids) ? ids : []).map(id => map.get(id)).filter(Boolean);
    gallery.images.forEach(x => { if (next.indexOf(x) < 0) next.push(x); });
    gallery.images = next;
    saveGallery(); announceGallery();
    return galleryManifest();
  }

  function getStatus() {
    const cfg = store.load();
    const host = `${cfg.room.hostname}.local`;
    return {
      running,
      port,
      ip: boundIp,
      ips: lanIPv4List(),
      host,
      url: running && boundIp ? `http://${boundIp}:${port}` : null,
      hostUrl: running ? `http://${host}:${port}` : null,
      publicUrl: cfg.publicUrl || '',
      tunnelName: cfg.tunnelName || '',
      pin: cfg.room.pin,
      pinSetAt: cfg.room.pinSetAt || 0,
      roomName: cfg.room.name,
      clients: presenceList()
    };
  }

  // Windows (Hyper-V / WSL / WinNAT) reserves scattered TCP port ranges; a bind
  // in one fails with EACCES even though nothing is listening. So we don't trust
  // a single fixed port — we walk a spread-out list, and when we land on a
  // working one we persist it to band-comm.json so the QR / URL stays stable
  // from then on. These are all outside the ranges Hyper-V typically grabs.
  const FALLBACK_PORTS = [7071, 8471, 17771, 27700, 39393, 45517, 52731];

  function start(preferredPort) {
    if (running) return Promise.resolve(getStatus());
    secret = crypto.randomBytes(32);
    const cfg = store.load();
    const first = preferredPort || cfg.port || 7071;
    const candidates = [...new Set([first, ...FALLBACK_PORTS])];

    const startHeartbeat = () => {
      hb = setInterval(() => {
        const now = Date.now();
        for (const [cid, c] of clients) {
          if (c.ws && c.ws.isAlive()) { try { c.ws.ping(); } catch (e) {} }
          else if (now - c.lastSeen > PRESENCE_STALE_MS * 2) clients.delete(cid);
        }
        pruneJoinAttempts();
        prunePendingLogins();
      }, HEARTBEAT_MS);
    };

    const tryPort = (idx) => new Promise((resolve, reject) => {
      if (idx >= candidates.length) {
        const e = new Error('Không cổng nào khả dụng (đã thử: ' + candidates.join(', ') + '). Windows có thể đã dành hết các cổng này cho Hyper-V/WSL.');
        e.code = 'ENOPORT';
        return reject(e);
      }
      const p = candidates[idx];
      const srv = http.createServer((req, res) => {
        handle(req, res).catch(() => { try { sendJson(res, 500, { error: 'server' }); } catch (e) {} });
      });
      srv.on('upgrade', (req, socket) => {
        try { handleUpgrade(req, socket); } catch (e) { try { socket.destroy(); } catch (_) {} }
      });
      const onErr = (e) => {
        srv.removeListener('error', onErr);
        try { srv.close(); } catch (_) {}
        if ((e.code === 'EADDRINUSE' || e.code === 'EACCES') && idx + 1 < candidates.length) {
          console.warn(`[BandComm] cổng ${p} không dùng được (${e.code}) — thử ${candidates[idx + 1]}`);
          resolve(tryPort(idx + 1));
        } else {
          running = false;
          reject(e);
        }
      };
      srv.on('error', onErr);
      srv.listen(p, '0.0.0.0', () => {
        srv.removeListener('error', onErr);
        srv.on('error', (e) => console.error('[BandComm] server error:', e));
        server = srv;
        running = true;
        port = srv.address().port;
        boundIp = (lanIPv4List()[0] || {}).address || '127.0.0.1';
        if (port !== cfg.port) {
          try { store.save({ ...cfg, port }); } catch (_) {}
          console.log(`[BandComm] chốt cổng ${port} (đã lưu vào band-comm.json — QR sẽ ổn định từ lần sau)`);
        }
        startHeartbeat();
        pollCloud().catch(() => {});
        cloudPollTimer = setInterval(() => { pollCloud().catch(() => {}); }, CLOUD_POLL_MS);
        resolve(getStatus());
      });
    });

    return tryPort(0);
  }

  function stop() {
    if (!running && !server) return;
    if (hb) { clearInterval(hb); hb = null; }
    if (cloudPollTimer) { clearInterval(cloudPollTimer); cloudPollTimer = null; }
    for (const c of clients.values()) { if (c.ws) { try { c.ws.close(1001); } catch (e) {} } }
    clients.clear();
    ring.length = 0;
    setlists.length = 0;
    receivedSetlistIds.clear();
    pendingLogins.clear();
    try { if (server) server.close(); } catch (e) {}
    server = null;
    running = false;
    secret = null;
    boundIp = null;
    port = 0;
  }

  // Sinh lại secret ký token — mọi token đang tồn tại lập tức verify-fail ở
  // lần gọi kế tiếp (y hệt hiệu ứng restart server, nhưng không phải đóng
  // socket/mất trạng thái khác). Gọi khi bật/tắt accountsEnabled hoặc
  // room.pinRequiredWithAccounts, hoặc khi 1 account bị khoá/xoá/đổi mật
  // khẩu — client tự bung màn đăng nhập lại qua đúng luồng 401 đã có
  // (comm/mobile/app.js's scheduleReconnect()), không cần cơ chế "kick"
  // riêng (band-comm-plan.md §11, điểm 5).
  function rotateSecret() {
    if (running) secret = crypto.randomBytes(32);
  }

  return {
    start,
    stop,
    getStatus,
    isRunning: () => running,
    operatorSend,
    operatorAck,
    operatorResolve,
    galleryManifest,
    galleryAdd,
    galleryRemove,
    galleryReorder,
    announceRoomConfig,
    rotateSecret
  };
}

module.exports = { createCommServer, lanIPv4List };
