// Minimal multicast-DNS responder — answers A queries for "<hostname>.local"
// with our current LAN IPv4, so phones can reach the comm server at a stable
// URL even when DHCP changes the laptop's IP. Zero dependencies.
//
// Scope on purpose: ONE hostname, A records only, no service discovery, no
// conflict probing. If binding 5353 fails we just no-op — the IP text fallback
// under the QR still works. See band-comm-plan.md B2.

const dgram = require('dgram');

const MADDR = '224.0.0.251';
const MPORT = 5353;
const TTL = 120;

function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  const bufs = [];
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

// Read a DNS name starting at offset; returns { name, next } (next = offset past
// the name in the *question*, pointers are followed but don't advance `next`).
function readName(buf, offset) {
  const labels = [];
  let i = offset;
  let next = -1;
  let hops = 0;
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0) { if (next < 0) next = i + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (next < 0) next = i + 2;
      i = ((len & 0x3f) << 8) | buf[i + 1];
      if (++hops > 8) break;
      continue;
    }
    labels.push(buf.toString('utf8', i + 1, i + 1 + len));
    i += 1 + len;
  }
  return { name: labels.join('.'), next: next < 0 ? i + 1 : next };
}

function parseQuestions(buf) {
  if (buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const out = [];
  let off = 12;
  for (let q = 0; q < qd && off + 4 <= buf.length; q++) {
    const { name, next } = readName(buf, off);
    off = next;
    if (off + 4 > buf.length) break;
    const type = buf.readUInt16BE(off);
    const qclass = buf.readUInt16BE(off + 2);
    off += 4;
    out.push({ name, type, qclass });
  }
  return out;
}

function buildAResponse(hostname, ip, queryId) {
  const name = encodeName(hostname);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(queryId || 0, 0);
  header.writeUInt16BE(0x8400, 2); // QR=1, AA=1
  header.writeUInt16BE(0, 4);      // qdcount 0 (mDNS responses omit the question)
  header.writeUInt16BE(1, 6);      // ancount 1
  const rr = Buffer.alloc(name.length + 10 + 4);
  name.copy(rr, 0);
  let o = name.length;
  rr.writeUInt16BE(0x0001, o); o += 2;       // TYPE A
  rr.writeUInt16BE(0x8001, o); o += 2;       // CLASS IN + cache-flush
  rr.writeUInt32BE(TTL, o); o += 4;          // TTL
  rr.writeUInt16BE(4, o); o += 2;            // RDLENGTH
  ip.split('.').forEach((n) => { rr.writeUInt8(parseInt(n, 10) & 0xff, o++); });
  return Buffer.concat([header, rr]);
}

function createMdnsResponder() {
  let sock = null;
  let hostFqdn = null;      // e.g. "worship.local"
  let getIp = () => null;
  let announceTimer = null;

  function announce() {
    const ip = safeIp();
    if (!sock || !ip) return;
    const msg = buildAResponse(hostFqdn, ip, 0);
    try { sock.send(msg, 0, msg.length, MPORT, MADDR); } catch (e) {}
  }

  function safeIp() {
    try { return getIp() || null; } catch (e) { return null; }
  }

  function onMessage(msg, rinfo) {
    let questions;
    try { questions = parseQuestions(msg); } catch (e) { return; }
    const hit = questions.some((q) =>
      q.name.toLowerCase() === hostFqdn &&
      (q.type === 1 || q.type === 255) &&        // A or ANY
      ((q.qclass & 0x7fff) === 1)                // IN (ignore QU bit)
    );
    if (!hit) return;
    const ip = safeIp();
    if (!ip) return;
    const id = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
    const resp = buildAResponse(hostFqdn, ip, id);
    try { sock.send(resp, 0, resp.length, MPORT, MADDR); } catch (e) {}
    // also unicast straight back — helps clients that set the QU bit
    try { sock.send(resp, 0, resp.length, rinfo.port, rinfo.address); } catch (e) {}
  }

  function start(hostname, ipGetter) {
    stop();
    hostFqdn = String(hostname || 'worship').toLowerCase().replace(/\.local$/, '') + '.local';
    getIp = typeof ipGetter === 'function' ? ipGetter : () => null;

    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (e) => {
      console.error('[BandComm][mDNS] socket error, disabling:', e && e.message);
      try { sock.close(); } catch (x) {}
      sock = null;
    });
    sock.on('message', onMessage);
    try {
      sock.bind(MPORT, () => {
        const lanIp = safeIp();
        // Join / send multicast on the actual LAN interface, not whatever the
        // OS picks by default (which is often a virtual adapter here).
        try { sock.addMembership(MADDR, lanIp || undefined); }
        catch (e) { try { sock.addMembership(MADDR); } catch (x) { console.error('[BandComm][mDNS] membership failed:', x && x.message); } }
        try { if (lanIp) sock.setMulticastInterface(lanIp); } catch (e) {}
        try { sock.setMulticastTTL(255); } catch (e) {}
        try { sock.setMulticastLoopback(false); } catch (e) {}
        announce();
        let n = 0;
        announceTimer = setInterval(() => { announce(); if (++n >= 3) { clearInterval(announceTimer); announceTimer = null; } }, 1000);
        console.log(`[BandComm][mDNS] announcing ${hostFqdn} -> ${safeIp() || '(no ip yet)'}`);
      });
    } catch (e) {
      console.error('[BandComm][mDNS] bind failed, disabling:', e && e.message);
      sock = null;
    }
  }

  function stop() {
    if (announceTimer) { clearInterval(announceTimer); announceTimer = null; }
    if (sock) { try { sock.close(); } catch (e) {} sock = null; }
  }

  return { start, stop, announce, get host() { return hostFqdn; } };
}

module.exports = { createMdnsResponder };
