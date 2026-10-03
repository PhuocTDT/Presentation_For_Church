// E2E local: relay THẬT (wrangler dev) + createRelayClient THẬT + điện thoại giả lập.
// Tái hiện kịch bản "máy mới cài, sau vài phút tin cũ đổ về" bằng cách ép rớt WebSocket.
//   RELAY_BASE=http://127.0.0.1:18787 [CLIENT_PATH=...relay-client.js] node test/band-replay.e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.RELAY_BASE || 'http://127.0.0.1:18787';
process.env.BAND_RELAY_BASE = BASE;
const clientPath = process.env.CLIENT_PATH || path.join(ROOT, 'src/band-comm/relay-client.js');
const { createRelayClient } = createRequire(import.meta.url)(clientPath);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
const PASS = 'pw' + ROOM;
const ADMIN = 'adminsecret-' + ROOM + '-0123456789';

// Giữ lại các socket operator để ép rớt (mô phỏng NAT/idle timeout).
const RealWS = globalThis.WebSocket;
const opSockets = [];
globalThis.WebSocket = class extends RealWS {
  constructor(u, ...r) { super(u, ...r); if (String(u).includes('adminSecret=')) opSockets.push(this); }
};
// Mạng đứt: client thấy 'close' ngay (không có close-handshake với server).
const dropOperatorSocket = () => { const s = opSockets[opSockets.length - 1]; try { s.close(); } catch (e) {} s.dispatchEvent(new Event('close')); };

async function phone(name) {
  const j = await (await fetch(`${BASE}/api/room/${ROOM}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ROOM, password: PASS, name, profileId: 'p-' + name })
  })).json();
  if (!j.token) throw new Error('join fail ' + JSON.stringify(j));
  const ws = new RealWS(`${BASE.replace(/^http/, 'ws')}/api/room/${ROOM}/ws?token=${encodeURIComponent(j.token)}`);
  await new Promise((r) => ws.addEventListener('open', r));
  return { send: (text) => ws.send(JSON.stringify({ kind: 'message', text })), close: () => ws.close() };
}
function makeOperator(label) {
  const events = [];
  const store = { load: () => ({ room: { code: ROOM, name: 'E2E', password: PASS }, relayAdminSecret: ADMIN }) };
  const c = createRelayClient({
    store, onEvent: (e) => events.push(e), onPresence() {}, getLibraryIndex: () => []
  });
  return { label, c, events, real: () => events.filter((e) => ['alert', 'text', 'ack', 'resolve'].includes(e.type)) };
}
function dupes(events) {
  const seen = new Map();
  for (const e of events) seen.set(e.id, (seen.get(e.id) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
}
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : '')); };

// ---- Pha 1: operator máy A, có hoạt động thật, rồi rớt mạng ----
const A = makeOperator('A');
await A.c.start();
const pa = await phone('Hoa'), pb = await phone('Minh');
pa.send('Tăng piano'); await sleep(150);
pa.send('Mất tiếng guitar'); await sleep(150);
pb.send('Dạo'); await sleep(150);
A.c.operatorResolve({ label: 'Tăng piano' }); await sleep(300);
const oldIds = new Set(A.real().map((e) => e.id));
console.log(`Máy A nhận ${oldIds.size} tin (alert/resolve) trước khi rớt mạng`);

for (let i = 0; i < 3; i++) { const t = await phone('Tmp' + i); await sleep(100); t.close(); await sleep(100); } // presence churn
const beforeDrop = A.events.length;
dropOperatorSocket(); await sleep(2500);
const replayedA = A.events.slice(beforeDrop).filter((e) => e.type !== 'presence');
check('Máy A: reconnect KHÔNG đẩy lại tin cũ', replayedA.length === 0, `đẩy lại ${replayedA.length} tin`);
check('Máy A: không tin nào trùng id', dupes(A.events).length === 0);

// ---- Pha 2: tin mới sau reconnect vẫn tới đúng 1 lần ----
pa.send('Chuyển bài'); await sleep(400);
check('Tin mới sau reconnect tới đúng 1 lần', A.events.filter((e) => e.text === 'Chuyển bài').length === 1);

// ---- Pha 3: MÁY MỚI (không có state) vào phòng đã có lịch sử, rồi rớt mạng ----
const B = makeOperator('B (máy mới)');
await B.c.start(); await sleep(500);
check('Máy mới: kết nối lần đầu không nhận tin cũ', B.real().length === 0, `nhận ${B.real().length}`);
for (let i = 0; i < 3; i++) { const t = await phone('Z' + i); await sleep(100); t.close(); await sleep(100); }
dropOperatorSocket(); await sleep(2500);
check('Máy mới: sau rớt mạng (kiểu 5-10 phút) KHÔNG nhận tin cũ', B.real().length === 0, `nhận ${B.real().length}: ${B.real().map((e) => e.text).join(' | ')}`);

// ---- Pha 4: máy mới nhận 1 tin thật rồi rớt, chỉ tin sau đó được bù ----
pb.send('Ok'); await sleep(300);
dropOperatorSocket(); await sleep(2500);
check('Máy mới: sau 1 tin thật + rớt mạng, không trùng', dupes(B.events).length === 0 && B.real().length === 1, `tin=${B.real().length}`);

pa.close(); pb.close(); A.c.stop(); B.c.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\nKẾT QUẢ: ${failed}/${results.length} FAIL` : `\nKẾT QUẢ: ${results.length}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
