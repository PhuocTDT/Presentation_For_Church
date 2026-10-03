// Ảnh nền thư viện -> cloud: DO (R2 giả) + logic so sánh/tải của relay-client.
//   node --test test/backgrounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);
const { createRelayClient } = createRequire(import.meta.url)(path.join(ROOT, 'src/band-comm/relay-client.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = 'admin-secret-0123456789';

function fakeR2() {
  const m = new Map();
  return { m, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, get: async (k) => (m.has(k) ? { body: m.get(k) } : null) };
}
async function room(env = { BGS: fakeR2() }) {
  const store = new Map([['adminSecret', SECRET], ['config', { code: 'ABC123', name: 'T', password: 'pw12' }]]);
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) }, blockConcurrencyWhile: (f) => f(), acceptWebSocket() {}, getWebSockets: () => [] };
  const relay = new RoomRelay(ctx, env); await relay.ready;
  return { relay, env };
}
const jpeg = (n = 300, fill = 7) => { const b = new Uint8Array(n).fill(fill); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; return b; };
const b64 = (u8) => Buffer.from(u8).toString('base64');
const adm = (relay, action, method, body, secret = SECRET) => relay.handleAdminBackgrounds(
  new Request('https://x/admin/backgrounds/' + action, { method, headers: { 'X-Admin-Secret': secret }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), action);

test('admin: sai secret 403; thiếu bucket BGS -> 503', async () => {
  const { relay } = await room();
  assert.equal((await adm(relay, 'list', 'GET', null, 'sai')).status, 403);
  const { relay: r2 } = await room({});
  assert.equal((await adm(r2, 'list', 'GET')).status, 503);
});

test('put: chỉ nhận JPEG ≤400KB, đủ name/key; lưu R2 đúng khoá <code>/<id>', async () => {
  const { relay, env } = await room();
  assert.equal((await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: b64(new Uint8Array(100).fill(1)) })).status, 400, 'không phải JPEG');
  assert.equal((await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: b64(jpeg(401 * 1024)) })).status, 400, 'quá 400KB');
  assert.equal((await adm(relay, 'put', 'POST', { name: '', key: 'k1', dataB64: b64(jpeg()) })).status, 400, 'thiếu tên');
  assert.equal((await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: '@@@' })).status, 400, 'base64 hỏng');
  const ok = await (await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: b64(jpeg()) })).json();
  assert.equal(ok.ok, true);
  assert.deepEqual([...env.BGS.m.keys()], ['ABC123/' + ok.id]);
});

test('cùng tên, key khác -> thay ảnh: id MỚI (bỏ cache cũ), xoá object cũ khỏi R2', async () => {
  const { relay, env } = await room();
  const a = await (await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: b64(jpeg(300, 1)) })).json();
  const b = await (await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k2', dataB64: b64(jpeg(300, 2)) })).json();
  assert.notEqual(a.id, b.id);
  assert.deepEqual([...env.BGS.m.keys()], ['ABC123/' + b.id]);
  const list = await (await adm(relay, 'list', 'GET')).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].key, 'k2');
});

test('remove: xoá manifest + R2; id lạ bị bỏ qua', async () => {
  const { relay, env } = await room();
  const a = await (await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: b64(jpeg()) })).json();
  const b = await (await adm(relay, 'put', 'POST', { name: 'b.jpg', key: 'k2', dataB64: b64(jpeg()) })).json();
  const r = await (await adm(relay, 'remove', 'POST', { ids: [a.id, 'khong-ton-tai'] })).json();
  assert.equal(r.removed, 1);
  assert.deepEqual([...env.BGS.m.keys()], ['ABC123/' + b.id]);
});

test('giới hạn 200 ảnh/phòng', async () => {
  const { relay } = await room();
  for (let i = 0; i < 200; i++) assert.equal((await adm(relay, 'put', 'POST', { name: 'n' + i + '.jpg', key: 'k' + i, dataB64: b64(jpeg(50)) })).status, 200);
  assert.equal((await adm(relay, 'put', 'POST', { name: 'thua.jpg', key: 'kx', dataB64: b64(jpeg(50)) })).status, 400);
  assert.equal((await adm(relay, 'put', 'POST', { name: 'n5.jpg', key: 'doi', dataB64: b64(jpeg(50)) })).status, 200, 'thay ảnh có sẵn vẫn được khi đã đủ 200');
});

test('manifest cho thành viên: cần token, KHÔNG lộ key nội bộ', async () => {
  const { relay } = await room();
  await adm(relay, 'put', 'POST', { name: 'a.jpg', key: 'khoa-noi-bo', dataB64: b64(jpeg()) });
  assert.equal((await relay.handleBackgroundsManifest(new URL('https://x/backgrounds?token=bay'))).status, 401);
  const t = await relay.makeToken('c1', 'Hoa', 'p1');
  const j = await (await relay.handleBackgroundsManifest(new URL('https://x/backgrounds?token=' + encodeURIComponent(t)))).json();
  assert.equal(j.items.length, 1);
  assert.deepEqual(Object.keys(j.items[0]).sort(), ['id', 'name']);
});

test('manifest sống sót qua evict', async () => {
  const store = new Map([['adminSecret', SECRET], ['config', { code: 'ABC123', name: 'T', password: 'pw12' }]]);
  const mk = async () => { const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) }, blockConcurrencyWhile: (f) => f(), acceptWebSocket() {}, getWebSockets: () => [] }; const r = new RoomRelay(ctx, { BGS: fakeR2() }); await r.ready; return r; };
  const r1 = await mk();
  await adm(r1, 'put', 'POST', { name: 'a.jpg', key: 'k1', dataB64: b64(jpeg()) });
  const r2 = await mk();
  assert.equal(r2.bgManifest.items.length, 1);
});

// ---------------- relay-client: so sánh & tải ----------------
function fakeRelayHttp() {
  const items = []; const calls = []; let n = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url); const body = init && init.body ? JSON.parse(init.body) : null;
    if (u.includes('/admin/backgrounds/list')) return { ok: true, status: 200, json: async () => ({ items: items.slice() }) };
    if (u.includes('/admin/backgrounds/put')) {
      calls.push(['put', body.name]);
      const i = items.findIndex((x) => x.name === body.name); if (i >= 0) items.splice(i, 1);
      items.push({ id: 'bg' + (++n), name: body.name, key: body.key });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.includes('/admin/backgrounds/remove')) {
      calls.push(['remove', body.ids.length]);
      for (const id of body.ids) { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1); }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ setlists: [], songs: [] }) };
  };
  return { items, calls };
}
function mkClient(local, thumbs) {
  const c = createRelayClient({
    store: { load: () => ({ room: { code: 'ABC123', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) },
    onEvent() {}, onPresence() {}, getLibraryIndex: () => [],
    listBackgroundImages: () => local.slice(), makeBackgroundThumb: async (name) => thumbs(name),
    backgroundSyncDelayMs: 20, backgroundSyncIntervalMs: 60000
  });
  return c;
}

test('client: lần đầu tải hết; lần sau CHỈ tải ảnh mới/đổi và xoá ảnh đã bỏ; ảnh hỏng không chặn cả đợt', async () => {
  const http = fakeRelayHttp();
  let local = [{ name: 'a.jpg', key: '1' }, { name: 'b.jpg', key: '1' }, { name: 'hong.jpg', key: '1' }];
  const c = createRelayClient({
    store: { load: () => ({ room: { code: 'ABC123', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) },
    onEvent() {}, onPresence() {}, getLibraryIndex: () => [],
    listBackgroundImages: () => local.slice(), makeBackgroundThumb: async (name) => (name === 'hong.jpg' ? null : Buffer.from(jpeg())),
    backgroundSyncDelayMs: 20
  });
  c.syncBackgroundsToCloud();
  await sleep(200);
  assert.deepEqual(http.calls.filter((x) => x[0] === 'put').map((x) => x[1]).sort(), ['a.jpg', 'b.jpg'], 'ảnh hỏng bị bỏ qua, 2 ảnh kia vẫn lên');
  assert.equal(c.getBackgroundSyncStatus().ok, true);

  http.calls.length = 0;
  local = [{ name: 'a.jpg', key: '1' }, { name: 'b.jpg', key: '2' }, { name: 'c.jpg', key: '1' }]; // b đổi, c mới, hong.jpg biến mất
  c.syncBackgroundsToCloud();
  await sleep(200);
  assert.deepEqual(http.calls.filter((x) => x[0] === 'put').map((x) => x[1]).sort(), ['b.jpg', 'c.jpg'], 'a không đổi -> không tải lại');
  assert.deepEqual(http.items.map((x) => x.name).sort(), ['a.jpg', 'b.jpg', 'c.jpg']);

  http.calls.length = 0;
  local = [{ name: 'a.jpg', key: '1' }];
  c.syncBackgroundsToCloud();
  await sleep(200);
  assert.deepEqual(http.calls, [['remove', 2]]);
  assert.deepEqual(http.items.map((x) => x.name), ['a.jpg']);

  http.calls.length = 0;
  c.syncBackgroundsToCloud();
  await sleep(200);
  assert.deepEqual(http.calls, [], 'không đổi gì -> không gọi put/remove');
});

test('client: nhiều lần kích hoạt liên tiếp (import nhiều ảnh) chỉ chạy 1 đợt', async () => {
  const http = fakeRelayHttp();
  let lists = 0;
  const c = createRelayClient({
    store: { load: () => ({ room: { code: 'ABC123', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) },
    onEvent() {}, onPresence() {}, getLibraryIndex: () => [],
    listBackgroundImages: () => { lists++; return [{ name: 'a.jpg', key: '1' }]; }, makeBackgroundThumb: async () => Buffer.from(jpeg()),
    backgroundSyncDelayMs: 40
  });
  for (let i = 0; i < 10; i++) c.syncBackgroundsToCloud();
  await sleep(250);
  assert.equal(lists, 1);
  assert.equal(http.calls.length, 1);
});

test('client: relay lỗi -> ghi nhận thất bại, không văng lỗi', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  const c = createRelayClient({
    store: { load: () => ({ room: { code: 'ABC123', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) },
    onEvent() {}, onPresence() {}, getLibraryIndex: () => [],
    listBackgroundImages: () => [{ name: 'a.jpg', key: '1' }], makeBackgroundThumb: async () => Buffer.from(jpeg()),
    backgroundSyncDelayMs: 20
  });
  c.syncBackgroundsToCloud();
  await sleep(150);
  const st = c.getBackgroundSyncStatus();
  assert.equal(st.ok, false);
  assert.match(st.error, /boom/);
});
