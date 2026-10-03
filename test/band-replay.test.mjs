// Test lỗi "tin cũ đã xử lý đổ về lại sau vài phút" (changelog 2026-10-02).
// Chạy:  node --test test/band-replay.test.mjs
// Test trên CODE THẬT: RoomRelay (Durable Object, mock ctx/WebSocketPair) và
// createRelayClient (mock WebSocket/fetch). RELAY_PATH=... để chạy lại với
// bản room-relay.js cũ, chứng minh test bắt được lỗi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relayPath = process.env.RELAY_PATH || path.join(ROOT, 'cloud/worker/src/room-relay.js');

// ---------- mock runtime Cloudflare ----------
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {   // Node từ chối status 101
  constructor(body, init = {}) {
    if (init.status === 101) {
      super(null, { ...init, status: 200 });
      Object.defineProperty(this, 'status', { value: 101 });
      this.webSocket = init.webSocket;
    } else super(body, init);
  }
};
class FakeSocket {
  constructor() { this.sent = []; this.att = null; }
  send(s) { this.sent.push(JSON.parse(s)); }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
  close() {}
}
globalThis.WebSocketPair = function () { return { 0: new FakeSocket(), 1: new FakeSocket() }; };

const { RoomRelay } = await import(pathToFileURL(relayPath).href);

// ---------- dựng 1 phòng có ring đã seed ----------
const T0 = 1_700_000_000_000;
const ring = [
  { id: 'm1', ts: T0 + 1, type: 'alert',   to: 'all', text: 'Tăng piano' },
  { id: 'm2', ts: T0 + 2, type: 'resolve', to: 'all', text: 'Tăng piano' },     // alert m1 ĐÃ xử lý
  { id: 'm3', ts: T0 + 3, type: 'alert',   to: 'all', text: 'Mất tiếng guitar' },
  { id: 'm4', ts: T0 + 4, type: 'text',    to: 'all', text: 'Ok' },
  { id: 'm5', ts: T0 + 5, type: 'alert',   to: 'c_other', text: 'riêng người khác' },
  { id: 'm6', ts: T0 + 6, type: 'alert',   to: 'all', text: 'Dạo' },
];
async function connect(query) {
  const store = new Map([['adminSecret', 's3cret'], ['ring', structuredClone(ring)], ['config', { code: 'ABC', name: 'Test' }]]);
  const ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket() {}, getWebSockets() { return sockets; }
  };
  const sockets = [];
  const origAccept = ctx.acceptWebSocket;
  const relay = new RoomRelay(ctx, {});
  await relay.ready;
  const origPair = globalThis.WebSocketPair;
  globalThis.WebSocketPair = function () { const p = origPair(); sockets.push(p[1]); return p; };
  const url = new URL('https://x/api/room/ABC/ws?adminSecret=s3cret' + query);
  const res = await relay.handleWebSocketUpgrade(new Request(url), url);
  globalThis.WebSocketPair = origPair;
  assert.equal(res.status, 101);
  return sockets[0].sent.filter((m) => m.kind === 'envelope' && m.envelope.type !== 'presence').map((m) => m.envelope.id);
}

test('server: since hợp lệ → chỉ replay tin SAU nó (bỏ tin riêng của người khác)', async () => {
  assert.deepEqual(await connect('&since=m3'), ['m4', 'm6']);
});
test('server: since là tin cuối → không replay gì', async () => {
  assert.deepEqual(await connect('&since=m6'), []);
});
test('server: không có since (máy mới cài) → không replay gì', async () => {
  assert.deepEqual(await connect(''), []);
});
test('LỖI GỐC: since là id presence/lạ, không có sinceTs → KHÔNG được đổ cả ring', async () => {
  assert.deepEqual(await connect('&since=m_presence_xyz'), []);
});
test('since lạ + sinceTs → chỉ bù tin mới hơn mốc', async () => {
  assert.deepEqual(await connect('&since=m_presence_xyz&sinceTs=' + (T0 + 3)), ['m4', 'm6']);
});
test('since lạ + sinceTs mới hơn mọi tin → không replay', async () => {
  assert.deepEqual(await connect('&since=zzz&sinceTs=' + (T0 + 99)), []);
});
test('sinceTs rác (NaN/âm) → không đổ ring', async () => {
  assert.deepEqual(await connect('&since=zzz&sinceTs=abc'), []);
});

// ---------- client operator: con trỏ since ----------
test('client: presence/gallery/setlist KHÔNG làm đổi cursor; reconnect gửi since+sinceTs của alert cuối', async () => {
  const urls = [];
  const sockets = [];
  globalThis.WebSocket = class {
    constructor(u) { urls.push(u); this.l = {}; sockets.push(this); setTimeout(() => this.emit('open'), 0); }
    addEventListener(t, f) { (this.l[t] ||= []).push(f); }
    emit(t, ev) { (this.l[t] || []).forEach((f) => f(ev)); }
    send() {} close() {}
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ setlists: [] }) });
  const require = createRequire(import.meta.url);
  const { createRelayClient } = require(path.join(ROOT, 'src/band-comm/relay-client.js'));
  const store = { load: () => ({ room: { code: 'ABC', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) };
  const client = createRelayClient({ store, onEvent() {}, onPresence() {}, getLibraryIndex: () => [] });
  await client.start();
  const push = (envelope) => sockets[0].emit('message', { data: JSON.stringify({ kind: 'envelope', envelope }) });
  push({ id: 'a1', ts: 111, type: 'alert', text: 'x' });
  push({ id: 'p1', ts: 222, type: 'presence', meta: { clients: [] } });
  push({ id: 'g1', ts: 333, type: 'gallery' });
  push({ id: 's1', ts: 444, type: 'setlist', meta: { id: 'sl', items: [] } });
  sockets[0].emit('close');                       // rớt mạng → tự reconnect sau ~1s
  await new Promise((r) => setTimeout(r, 1300));
  client.stop && client.stop();
  assert.equal(urls.length >= 2, true, 'phải có reconnect');
  const u = new URL(urls[1]);
  assert.equal(u.searchParams.get('since'), 'a1');
  assert.equal(u.searchParams.get('sinceTs'), '111');
  assert.equal(new URL(urls[0]).searchParams.has('since'), false, 'lần đầu không có since');
});
