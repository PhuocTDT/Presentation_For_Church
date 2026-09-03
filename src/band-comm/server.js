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

const MOBILE_DIR = path.join(__dirname, '..', '..', 'comm', 'mobile');
const RING_MAX = 120;          // messages replayed to a phone that reconnects
const HEARTBEAT_MS = 15000;    // WS ping to keep the connection alive through NAT / proxies
const PRESENCE_STALE_MS = 25000;
const DUP_WINDOW_MS = 5000;    // same button/text from same phone → ignored

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
    req.on('data', d => { buf += d; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
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
 * @param {Function} [opts.onEvent]   (envelope) => void — every non-presence message
 * @param {Function} [opts.onPresence](clientList) => void
 */
function createCommServer({ store, onEvent, onPresence }) {
  let server = null;
  let running = false;
  let secret = null;
  let port = 0;
  let boundIp = null;
  let hb = null;
  const clients = new Map(); // clientId -> { clientId, name, role, ws, lastSeen, dupMap }
  const ring = [];           // { id, env }

  // token = clientId.issued.<b64url(name)>.role.<hmac(payload)>
  // Name + role travel inside the token so a phone that was evicted server-side
  // (staleness sweep, brief leave) can be rehydrated on its next request without
  // forcing the user back through the join screen. Only a server restart (new
  // secret) invalidates tokens.
  const b64url = (s) => Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);

  function makeToken(clientId, name, role) {
    const payload = `${clientId}.${Date.now()}.${b64url(name)}.${role}`;
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 5) return null;
    const sig = parts[4];
    const payload = parts.slice(0, 4).join('.');
    try {
      if (sign(payload) !== sig) return null;
    } catch (e) { return null; } // server stopped, secret gone
    return { clientId: parts[0], name: unb64url(parts[2]) || 'Ẩn danh', role: parts[3] === 'leader' ? 'leader' : 'band' };
  }

  const wsAlive = (c) => !!(c && c.ws && c.ws.isAlive());

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
      client = { clientId, name: ident.name, role: ident.role, ws: null, lastSeen: Date.now(), dupMap: new Map() };
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

  async function handle(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);

    // --- join is the only unauthenticated endpoint ---
    if (p === '/api/join' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      const cfg = store.load();
      if (String(body.pin || '') !== String(cfg.room.pin)) return sendJson(res, 403, { error: 'Sai mã PIN' });
      const name = String(body.name || '').trim().slice(0, 40) || 'Ẩn danh';
      const role = ['band', 'leader'].includes(body.role) ? body.role : 'band';
      const clientId = newId('c');
      clients.set(clientId, { clientId, name, role, res: null, lastSeen: Date.now(), dupMap: new Map() });
      const restore = body.profileId && cfg.profiles[body.profileId]
        ? { profileId: body.profileId, ...cfg.profiles[body.profileId] }
        : store.findProfileByName(name);
      setTimeout(pushPresence, 50);
      return sendJson(res, 200, {
        token: makeToken(clientId, name, role),
        clientId,
        room: { name: cfg.room.name },
        operatorReplies: cfg.operatorReplies,
        profile: restore || null,
        gallery: galleryManifest()
      });
    }

    // --- everything else needs a valid token ---
    const token = u.searchParams.get('token') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const ident = verifyToken(token);
    if (!ident) return sendJson(res, 401, { error: 'unauthorized' });
    const clientId = ident.clientId;
    let client = clients.get(clientId);
    if (!client) {
      // valid token, but the record was swept / left — rebuild it from the token.
      client = { clientId, name: ident.name, role: ident.role, ws: null, lastSeen: Date.now(), dupMap: new Map() };
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
  function galleryManifest() { return { images: gallery.images.map(x => ({ id: x.id, name: x.name })), updatedAt: gallery.updatedAt || 0 }; }
  function announceGallery() { fanout(makeEnvelope({ type: 'gallery', from: OPERATOR, to: 'all', meta: galleryManifest() })); }

  function galleryAdd({ name = '', ext = '.jpg', dataB64 = '' } = {}) {
    const b64 = String(dataB64 || '').replace(/^data:[^,]*,/, '');
    if (!b64) return galleryManifest();
    const cleanExt = /^\.(jpe?g|png|webp)$/i.test(ext) ? ext.toLowerCase().replace('.jpeg', '.jpg') : '.jpg';
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch (e) { return galleryManifest(); }
    if (!buf.length || buf.length > 8 * 1024 * 1024) return galleryManifest();
    const id = newId('img');
    try { fs.writeFileSync(path.join(store.mediaDir, id + cleanExt), buf); } catch (e) { return galleryManifest(); }
    gallery.images.push({ id, name: String(name || 'Hợp âm').slice(0, 80), ext: cleanExt });
    saveGallery(); announceGallery();
    return galleryManifest();
  }
  function galleryRemove(id) {
    const i = gallery.images.findIndex(x => x.id === id);
    if (i < 0) return galleryManifest();
    const [rm] = gallery.images.splice(i, 1);
    try { fs.unlinkSync(path.join(store.mediaDir, rm.id + rm.ext)); } catch (e) {}
    saveGallery(); announceGallery();
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
      pin: cfg.room.pin,
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
        resolve(getStatus());
      });
    });

    return tryPort(0);
  }

  function stop() {
    if (!running && !server) return;
    if (hb) { clearInterval(hb); hb = null; }
    for (const c of clients.values()) { if (c.ws) { try { c.ws.close(1001); } catch (e) {} } }
    clients.clear();
    ring.length = 0;
    try { if (server) server.close(); } catch (e) {}
    server = null;
    running = false;
    secret = null;
    boundIp = null;
    port = 0;
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
    galleryReorder
  };
}

module.exports = { createCommServer, lanIPv4List };
