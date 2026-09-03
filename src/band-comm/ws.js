// Band Comm — minimal WebSocket server (RFC 6455), zero dependencies.
//
// Why not SSE: Cloudflare Tunnel (and many reverse proxies) buffer long-lived
// streaming HTTP responses, so operator→phone messages never arrive. WebSocket
// is proxied frame-by-frame, so it works over the tunnel AND on the raw LAN.
//
// Scope kept deliberately small for this use case:
//  - text frames only (payload is always a small JSON string)
//  - server never masks, never fragments outgoing frames
//  - handles masked client frames, continuation, ping/pong, close
//  - one accept() per HTTP `upgrade`, returns a tiny connection object

const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xA;
const MAX_MESSAGE = 256 * 1024; // a phone should never send us anything near this

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Complete the WebSocket handshake on a raw socket and return a connection.
 * @param {http.IncomingMessage} req
 * @param {net.Socket} socket
 * @param {{ onMessage?: (text:string)=>void, onClose?: ()=>void }} handlers
 * @returns {{ send:(text:string)=>void, ping:()=>void, close:(code?:number)=>void, isAlive:()=>boolean } | null}
 */
function acceptWebSocket(req, socket, handlers = {}) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    try { socket.destroy(); } catch (e) {}
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  socket.setTimeout(0);
  socket.setNoDelay(true);

  let alive = true;
  let buf = Buffer.alloc(0);
  let fragOpcode = 0;
  let fragChunks = [];
  let fragLen = 0;

  function finish() {
    if (!alive) return;
    alive = false;
    try { socket.destroy(); } catch (e) {}
    try { handlers.onClose && handlers.onClose(); } catch (e) {}
  }

  function send(text) {
    if (!alive) return;
    try { socket.write(encodeFrame(OP_TEXT, Buffer.from(String(text), 'utf8'))); }
    catch (e) { finish(); }
  }
  function ping() {
    if (!alive) return;
    try { socket.write(encodeFrame(OP_PING, Buffer.alloc(0))); } catch (e) { finish(); }
  }
  function close(code = 1000) {
    if (!alive) return;
    try {
      const body = Buffer.alloc(2); body.writeUInt16BE(code, 0);
      socket.write(encodeFrame(OP_CLOSE, body));
    } catch (e) {}
    finish();
  }

  function deliver(opcode, payload) {
    if (opcode === OP_TEXT || opcode === OP_BIN) {
      if (handlers.onMessage) { try { handlers.onMessage(payload.toString('utf8')); } catch (e) {} }
    }
  }

  function parse() {
    while (alive) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buf.length < offset + 2) return;
        len = buf.readUInt16BE(offset); offset += 2;
      } else if (len === 127) {
        if (buf.length < offset + 8) return;
        const big = buf.readBigUInt64BE(offset); offset += 8;
        if (big > BigInt(MAX_MESSAGE)) { close(1009); return; }
        len = Number(big);
      }
      if (!masked) { close(1002); return; }        // clients MUST mask
      if (buf.length < offset + 4 + len) return;   // wait for the rest

      const mask = buf.subarray(offset, offset + 4); offset += 4;
      const data = Buffer.from(buf.subarray(offset, offset + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(offset + len);

      if (opcode === OP_CLOSE) { close(1000); return; }
      if (opcode === OP_PING) {
        try { socket.write(encodeFrame(OP_PONG, data)); } catch (e) { finish(); }
        continue;
      }
      if (opcode === OP_PONG) continue;

      if (opcode === OP_CONT) {
        fragChunks.push(data); fragLen += data.length;
        if (fragLen > MAX_MESSAGE) { close(1009); return; }
        if (fin) {
          const full = Buffer.concat(fragChunks, fragLen);
          fragChunks = []; fragLen = 0;
          deliver(fragOpcode, full);
          fragOpcode = 0;
        }
        continue;
      }

      // new data frame
      if (!fin) { fragOpcode = opcode; fragChunks = [data]; fragLen = data.length; continue; }
      deliver(opcode, data);
    }
  }

  socket.on('data', (chunk) => {
    if (!alive) return;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (buf.length > MAX_MESSAGE + 14) { close(1009); return; }
    parse();
  });
  socket.on('close', finish);
  socket.on('error', finish);
  socket.on('end', finish);

  return { send, ping, close, isAlive: () => alive };
}

module.exports = { acceptWebSocket };
