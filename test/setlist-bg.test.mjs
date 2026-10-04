// Nền tuỳ chọn trong setlist (riêng từng bài `bg` + chung cả list `bg`) — relay làm sạch, lưu lịch sử, phát envelope.
//   node --test test/setlist-bg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);

async function makeRoom() {
  const store = new Map([['adminSecret', 'admin-secret-0123456789'], ['config', { code: 'ABC123', name: 'T', password: 'pw12' }]]);
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, blockConcurrencyWhile: (fn) => fn(), acceptWebSocket() {}, getWebSockets: () => [] };
  const relay = new RoomRelay(ctx, {});
  await relay.ready;
  const sent = [];
  relay.broadcast = (env) => sent.push(env);
  return { relay, sent };
}
const T = (t) => new URL('https://x/y?token=' + encodeURIComponent(t));
const send = (relay, t, body) => relay.handleSetlistSubmit(new Request('https://x/setlist', { method: 'POST', body: JSON.stringify(body) }), T(t));

test('bg riêng từng bài + bg chung cả list: được giữ, làm sạch, phát cho operator và lưu lịch sử', async () => {
  const { relay, sent } = await makeRoom();
  const t = await relay.makeToken('c1', 'Hoa', 'p1');
  const r = await send(relay, t, {
    id: 'sl-1', name: 'CN', bg: 'nen-chung.jpg',
    items: [{ type: 'song', id: '1', title: 'A', bg: 'nen-a.jpg' }, { type: 'song', id: '2', title: 'B' }]
  });
  assert.equal(r.status, 200);
  const sl = sent.find((e) => e.type === 'setlist').meta;
  assert.equal(sl.bg, 'nen-chung.jpg');
  assert.equal(sl.items[0].bg, 'nen-a.jpg');
  assert.equal('bg' in sl.items[1], false, 'bài không chọn nền thì KHÔNG có trường bg (giữ nền mặc định)');
  const h = await (await relay.handleSetlistHistory(T(t))).json();
  assert.equal(h.setlists[0].bg, 'nen-chung.jpg');
  assert.equal(h.setlists[0].items[0].bg, 'nen-a.jpg');
});

test('bg độc hại / sai kiểu bị làm sạch: không thành đường dẫn hay HTML', async () => {
  const { relay, sent } = await makeRoom();
  const t = await relay.makeToken('c1', 'Hoa', 'p1');
  await send(relay, t, {
    id: 'sl-2', bg: String.raw`..\..\Windows\system32\x.jpg`,
    items: [
      { type: 'song', id: '1', title: 'A', bg: '<img src=x onerror=alert(1)>.png' },
      { type: 'song', id: '2', title: 'B', bg: { a: 1 } },
      { type: 'song', id: '3', title: 'C', bg: '../etc/passwd' },
      { type: 'song', id: '4', title: 'D', bg: 'x'.repeat(500) },
      { type: 'song', id: '5', title: 'E', bg: '   ' }
    ]
  });
  const sl = sent.find((e) => e.type === 'setlist').meta;
  const bad = /[<>\/\:*?"|\u0000-\u001f]/;
  assert.equal(bad.test(sl.bg), false);
  sl.items.forEach((it) => { if (it.bg !== undefined) assert.equal(bad.test(it.bg), false, it.bg); });
  assert.equal('bg' in sl.items[1], false);
  assert.equal(sl.items[3].bg.length, 200);
  assert.equal('bg' in sl.items[4], false);
});
