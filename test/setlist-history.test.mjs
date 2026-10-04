// Lịch sử setlist đã gửi của phòng (tab "Đã gửi" ở /setlist/) trong Durable Object RoomRelay (mock ctx).
//   node --test test/setlist-history.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);

async function makeRoom(store = new Map()) {
  if (!store.has('adminSecret')) { store.set('adminSecret', 'admin-secret-0123456789'); store.set('config', { code: 'ABC123', name: 'T', password: 'pw12' }); }
  const ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket() {}, getWebSockets: () => []
  };
  const relay = new RoomRelay(ctx, {});
  await relay.ready;
  return { relay, store };
}
const tok = (relay, clientId, name, profileId) => relay.makeToken(clientId, name, profileId);
const T = (t) => new URL('https://x/y?token=' + encodeURIComponent(t));
const send = (relay, t, body) => relay.handleSetlistSubmit(new Request('https://x/setlist', { method: 'POST', body: JSON.stringify(body) }), T(t));
const history = async (relay, t) => (await relay.handleSetlistHistory(T(t))).json();
const del = (relay, t, id) => relay.handleSetlistHistoryDelete(new Request('https://x/d', { method: 'POST', body: JSON.stringify({ id }) }), T(t));
const items = [{ type: 'song', id: '1', title: 'Bài 1' }, { type: 'song', id: 'web:web-song-0001', title: 'Mới', webId: 'web-song-0001', lyrics: 'không được lưu' }];

test('cần token để xem/xoá lịch sử', async () => {
  const { relay } = await makeRoom();
  assert.equal((await relay.handleSetlistHistory(T(''))).status, 401);
  assert.equal((await del(relay, '', 'x')).status, 401);
});

test('gửi setlist được lưu, cả phòng thấy; chỉ cờ mine theo người gửi; lời không bị lưu', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  const b = await tok(relay, 'c2', 'Minh', 'p2');
  assert.equal((await send(relay, a, { id: 'sl-1', name: 'CN 05/10', items })).status, 200);
  const ha = await history(relay, a), hb = await history(relay, b);
  assert.equal(ha.setlists.length, 1);
  assert.equal(ha.setlists[0].name, 'CN 05/10');
  assert.equal(ha.setlists[0].by, 'Hoa');
  assert.equal(ha.setlists[0].mine, true);
  assert.equal(hb.setlists[0].mine, false);
  assert.equal(ha.setlists[0].items.length, 2);
  assert.equal(JSON.stringify(ha).includes('không được lưu'), false);
  assert.equal(ha.setlists[0].items[1].webId, 'web-song-0001');
});

test('setlist rỗng không được lưu', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  assert.equal((await send(relay, a, { id: 'sl-1', items: [] })).status, 400);
  assert.equal((await history(relay, a)).setlists.length, 0);
});

test('gửi lại (resendOf) cập nhật bản cũ, tăng sendCount, không tạo bản sao; người khác gửi lại cũng được', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  const b = await tok(relay, 'c2', 'Minh', 'p2');
  await send(relay, a, { id: 'sl-1', name: 'CN', items });
  const r = await send(relay, b, { id: 'sl-2', name: 'CN', items, resendOf: 'sl-1' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).id, 'sl-2', 'id gửi đi là id MỚI để desktop không khử trùng');
  const h = (await history(relay, a)).setlists;
  assert.equal(h.length, 1);
  assert.equal(h[0].id, 'sl-1');
  assert.equal(h[0].sendCount, 2);
  assert.equal(h[0].lastBy, 'Minh');
  assert.equal(h[0].by, 'Hoa');
  // resendOf trỏ vào bản không tồn tại -> lưu như bản mới
  await send(relay, a, { id: 'sl-3', name: 'Khác', items, resendOf: 'sl-khong-co' });
  assert.equal((await history(relay, a)).setlists.length, 2);
});

test('xoá: chỉ người gửi; người khác 403; không có 404', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  const b = await tok(relay, 'c2', 'Minh', 'p2');
  await send(relay, a, { id: 'sl-1', name: 'CN', items });
  assert.equal((await del(relay, b, 'sl-1')).status, 403);
  assert.equal((await del(relay, a, 'sl-nope')).status, 404);
  // cùng profileId đổi clientId (reconnect) vẫn xoá được
  const a2 = await tok(relay, 'c9', 'Hoa', 'p1');
  assert.equal((await del(relay, a2, 'sl-1')).status, 200);
  assert.equal((await history(relay, a)).setlists.length, 0);
});

test('tối đa 50 bản (cũ nhất bị dọn), sắp xếp mới gửi nhất lên đầu, bền qua evict DO', async () => {
  const { relay, store } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  for (let i = 1; i <= 52; i++) await send(relay, a, { id: 'sl-' + i, name: 'S' + i, items });
  let h = (await history(relay, a)).setlists;
  assert.equal(h.length, 50);
  assert.equal(h.some((e) => e.id === 'sl-1' || e.id === 'sl-2'), false);
  await send(relay, a, { id: 'sl-new', name: 'S10', items, resendOf: 'sl-10' });
  h = (await history(relay, a)).setlists;
  assert.equal(h[0].id, 'sl-10', 'bản vừa gửi lại nổi lên đầu');
  const { relay: relay2 } = await makeRoom(store);
  assert.equal((await history(relay2, await tok(relay2, 'c1', 'Hoa', 'p1'))).setlists.length, 50);
});
