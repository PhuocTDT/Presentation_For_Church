// Band Comm — LAN server (HTTP + SSE), lives in the Electron main process.
//
// Transport: Server-Sent Events downstream (one long-lived GET per phone) +
// plain `fetch` POST upstream. Zero new dependencies. See band-comm-plan.md §3.
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

const MOBILE_DIR = path.join(__dirname, '..', '..', 'comm', 'mobile');
const RING_MAX = 120;          // messages replayed to a phone that reconnects
const HEARTBEAT_MS = 15000;    // SSE keep-alive comment through NAT / proxies
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
  const clients = new Map(); // clientId -> { clientId, name, role, res, lastSeen, dupMap }
  const ring = [];           // { id, frame }

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

  function presenceList() {
    const now = Date.now();
    return [...clients.values()]
      .filter(c => now - c.lastSeen < PRESENCE_STALE_MS)
      .map(c => ({ clientId: c.clientId, name: c.name, role: c.role, online: !!c.res }));
  }

  const frameFor = (env) => `id: ${env.id}\ndata: ${JSON.stringify(env)}\n\n`;

  function remember(env) {
    ring.push({ id: env.id, frame: frameFor(env) });
    if (ring.length > RING_MAX) ring.shift();
  }

  // Deliver an envelope: to 'all' phones, or just one when env.to is a clientId.
  // Always remembered in the ring (except presence) and pushed to main via onEvent.
  function fanout(env) {
    const isPresence = env.type === 'presence';
    if (!isPresence) remember(env);
    const frame = frameFor(env);
    for (const c of clients.values()) {
      if (!c.res) continue;
      if (env.to === 'all' || env.to === c.clientId) {
        try { c.res.write(frame); } catch (e) { /* dead socket, close handler will clean up */ }
      }
    }
    if (!isPresence && onEvent) { try { onEvent(env); } catch (e) {} }
  }

  function pushPresence() {
    const list = presenceList();
    fanout(makeEnvelope({ type: 'presence', meta: { clients: list } }));
    if (onPresence) { try { onPresence(list); } catch (e) {} }
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
        profile: restore || null
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
      client = { clientId, name: ident.name, role: ident.role, res: null, lastSeen: Date.now(), dupMap: new Map() };
      clients.set(clientId, client);
    }
    client.lastSeen = Date.now();

    if (p === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      client.res = res;
      const lastId = req.headers['last-event-id'];
      let start = 0;
      if (lastId) {
        const idx = ring.findIndex(r => r.id === lastId);
        if (idx >= 0) start = idx + 1;
      }
      for (let i = start; i < ring.length; i++) res.write(ring[i].frame);
      res.write(frameFor(makeEnvelope({ type: 'system', text: 'Đã kết nối kênh', meta: { event: 'connected' } })));
      pushPresence();
      req.on('close', () => {
        if (client.res === res) client.res = null;
        pushPresence();
      });
      return;
    }

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
      pin: cfg.room.pin,
      roomName: cfg.room.name,
      clients: presenceList()
    };
  }

  function start(preferredPort) {
    if (running) return Promise.resolve(getStatus());
    secret = crypto.randomBytes(32);
    const cfg = store.load();
    const wantPort = preferredPort || cfg.port || 7071;
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handle(req, res).catch(() => { try { sendJson(res, 500, { error: 'server' }); } catch (e) {} });
      });
      server.on('error', (e) => { running = false; server = null; reject(e); });
      server.listen(wantPort, '0.0.0.0', () => {
        running = true;
        port = server.address().port;
        const ips = lanIPv4List();
        boundIp = ips[0] ? ips[0].address : '127.0.0.1';
        hb = setInterval(() => {
          const now = Date.now();
          for (const [cid, c] of clients) {
            if (c.res) { try { c.res.write(': hb\n\n'); } catch (e) {} }
            else if (now - c.lastSeen > PRESENCE_STALE_MS * 2) clients.delete(cid);
          }
        }, HEARTBEAT_MS);
        resolve(getStatus());
      });
    });
  }

  function stop() {
    if (!running && !server) return;
    if (hb) { clearInterval(hb); hb = null; }
    for (const c of clients.values()) { if (c.res) { try { c.res.end(); } catch (e) {} } }
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
    operatorResolve
  };
}

module.exports = { createCommServer, lanIPv4List };
