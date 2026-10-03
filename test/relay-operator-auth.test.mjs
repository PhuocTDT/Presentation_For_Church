// B-17: các endpoint KV dành riêng cho operator (worker.js) phải yêu cầu X-Admin-Secret
// khớp với adminSecret của Durable Object (RoomRelay thật, mock ctx) của phòng đó.
//   node --test test/relay-operator-auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = (await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/worker.js')).href)).default;
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);

const ROOM = 'ABC123';
const SECRET = 'operator-secret-0123456789abcdef';

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) };
  }
}
class FakeR2 {
  constructor() { this.m = new Map(); }
  async put(k, v) { this.m.set(k, v); }
  async get(k) { return this.m.has(k) ? { body: this.m.get(k), httpMetadata: {} } : null; }
  async delete(k) { this.m.delete(k); }
}

async function makeEnv({ mode, configured = true } = {}) {
  const rooms = new Map();
  const env = {
    SETLISTS: new FakeKV(), GALLERY: new FakeR2(), GLOBAL_USERS: new FakeKV(),
    OPERATOR_AUTH_MODE: mode,
    doCalls: 0
  };
  async function roomFor(code) {
    if (rooms.has(code)) return rooms.get(code);
    const store = new Map();
    if (configured && code === ROOM) {
      store.set('adminSecret', SECRET);
      store.set('config', { code: ROOM, name: 'T', password: 'pw12' });
    }
    const ctx = {
      storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
      blockConcurrencyWhile: (fn) => fn(), acceptWebSocket() {}, getWebSockets: () => []
    };
    const relay = new RoomRelay(ctx, env);
    await relay.ready;
    rooms.set(code, relay);
    return relay;
  }
  env.ROOMS = {
    idFromName: (n) => n,
    get: (code) => ({ fetch: async (url, init) => { env.doCalls++; return (await roomFor(code)).fetch(new Request(url, init)); } })
  };
  return env;
}

const post = (env, p, body, headers = {}) => worker.fetch(new Request('https://channel.test' + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers }, body: JSON.stringify(body)
}), env);
const get = (env, p, headers = {}) => worker.fetch(new Request('https://channel.test' + p, { headers: { 'CF-Connecting-IP': '203.0.113.9', ...headers } }), env);

const SONGS = { roomId: ROOM, songs: [{ id: 's1', title: 'Bài 1', lyrics: 'x' }] };

test('enforce: không có secret → 401, và không đụng tới Durable Object', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  assert.equal((await post(env, '/library-sync', SONGS)).status, 401);
  assert.equal((await post(env, '/setlist/ack', { roomId: ROOM, id: 'sl-1' })).status, 401);
  assert.equal((await post(env, '/gallery/remove', { roomId: ROOM, id: 'img-1' })).status, 401);
  assert.equal((await get(env, '/setlist?roomId=' + ROOM)).status, 401);
  assert.equal(env.doCalls, 0, 'request thiếu header không được tạo/đánh thức DO');
  assert.equal(await env.SETLISTS.get('lib:' + ROOM), null, 'không được ghi KV');
});

test('mặc định (không đặt OPERATOR_AUTH_MODE) = enforce', async () => {
  const env = await makeEnv({ mode: undefined });
  assert.equal((await post(env, '/library-sync', SONGS)).status, 401);
});

test('enforce: secret sai → 403, đúng → 200 và ghi được', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  const bad = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': 'wrong-secret-0123456789abcdef' });
  assert.equal(bad.status, 403);
  assert.equal(await env.SETLISTS.get('lib:' + ROOM), null);
  const ok = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': SECRET });
  assert.equal(ok.status, 200);
  assert.ok(await env.SETLISTS.get('lib:' + ROOM));
});

test('secret của phòng khác không dùng được cho phòng này', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  const res = await post(env, '/library-sync', { roomId: 'ZZZ999', songs: SONGS.songs }, { 'X-Admin-Secret': SECRET });
  assert.equal(res.status, 403, 'phòng ZZZ999 chưa có adminSecret → không ai xác thực được');
  assert.equal(await env.SETLISTS.get('lib:ZZZ999'), null);
});

test('roomId không phải mã phòng hợp lệ (chữ thường/UUID) → không xác thực được', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  const res = await post(env, '/library-sync', { roomId: '3f2b8c1e-9d4a-4c7b-8a55-0e1f2a3b4c5d', songs: SONGS.songs }, { 'X-Admin-Secret': SECRET });
  assert.equal(res.status, 403);
});

test('POST /setlist (thành viên ban hát) vẫn không cần secret', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  const res = await post(env, '/setlist', { roomId: ROOM, setlist: { id: 'sl-1', name: 'CN', from: { name: 'Hoa' }, items: [{ type: 'song', id: 's1', title: 'Bài 1' }] } });
  assert.equal(res.status, 200);
  assert.ok(await env.SETLISTS.get(`sl:${ROOM}:sl-1`));
});

test('log: thiếu secret thì cho qua, nhưng secret SAI vẫn bị từ chối', async () => {
  const env = await makeEnv({ mode: 'log' });
  assert.equal((await post(env, '/library-sync', SONGS)).status, 200, 'app cũ chưa gửi header vẫn chạy');
  const bad = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': 'wrong-secret-0123456789abcdef' });
  assert.equal(bad.status, 403);
});

test('operator poll + ack đủ vòng với secret đúng (enforce)', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  await post(env, '/setlist', { roomId: ROOM, setlist: { id: 'sl-9', name: 'CN', from: { name: 'Hoa' }, items: [{ type: 'song', id: 's1', title: 'Bài 1' }] } });
  const h = { 'X-Admin-Secret': SECRET };
  const list = await (await get(env, '/setlist?roomId=' + ROOM, h)).json();
  assert.equal(list.setlists.length, 1);
  assert.equal((await post(env, '/setlist/ack', { roomId: ROOM, id: 'sl-9' }, h)).status, 200);
  assert.equal((await (await get(env, '/setlist?roomId=' + ROOM, h)).json()).setlists.length, 0);
});

test('gallery ghi/xóa yêu cầu secret; đọc ảnh công khai không đổi', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  const body = { roomId: ROOM, id: 'img-1', ext: '.png', dataB64: Buffer.from('png-bytes').toString('base64') };
  assert.equal((await post(env, '/gallery', body)).status, 401);
  assert.equal((await post(env, '/gallery', body, { 'X-Admin-Secret': SECRET })).status, 200);
  assert.equal((await get(env, `/gallery/image/${ROOM}/img-1`)).status, 200);
  assert.equal((await post(env, '/gallery/remove', { roomId: ROOM, id: 'img-1' })).status, 401);
  assert.equal((await get(env, `/gallery/image/${ROOM}/img-1`)).status, 200, 'xóa không secret không có hiệu lực');
  assert.equal((await post(env, '/gallery/remove', { roomId: ROOM, id: 'img-1' }, { 'X-Admin-Secret': SECRET })).status, 200);
  assert.equal((await get(env, `/gallery/image/${ROOM}/img-1`)).status, 404);
});

test('đoán secret sai nhiều lần từ một IP → 429 (kể cả khi sau đó dùng secret đúng)', async () => {
  const env = await makeEnv({ mode: 'enforce' });
  for (let i = 0; i < 20; i++) {
    const r = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': 'guess-' + i + '-0123456789abcdef' });
    assert.equal(r.status, 403, 'lần ' + i);
  }
  const blocked = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': SECRET });
  assert.equal(blocked.status, 429);
  // IP khác vẫn dùng bình thường
  const other = await worker.fetch(new Request('https://channel.test/library-sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7', 'X-Admin-Secret': SECRET }, body: JSON.stringify(SONGS)
  }), env);
  assert.equal(other.status, 200);
});

test('DO /admin/verify: không bootstrap phòng chưa cấu hình', async () => {
  const env = await makeEnv({ mode: 'enforce', configured: false });
  const res = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': SECRET });
  assert.equal(res.status, 403);
  // và verify lần sau với chính secret đó vẫn không "được ghim" vào DO
  const again = await post(env, '/library-sync', SONGS, { 'X-Admin-Secret': SECRET });
  assert.equal(again.status, 403);
});

// ── B-19: ai được (tái) đặt adminSecret qua POST /admin/config ───────────────────
async function makeRelay({ secret = SECRET, config = { code: ROOM, name: 'T', password: 'pw12' }, ownerEmail } = {}) {
  const store = new Map();
  if (secret) store.set('adminSecret', secret);
  if (config) store.set('config', config);
  const kv = new FakeKV();
  if (ownerEmail !== undefined) await kv.put('room:' + ROOM, JSON.stringify({ code: ROOM, name: 'T', password: 'pw12', operatorEmail: ownerEmail }));
  const ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(), acceptWebSocket() {}, getWebSockets: () => []
  };
  const relay = new RoomRelay(ctx, { GLOBAL_USERS: kv });
  await relay.ready;
  // Giả lập verifier Cognito: token 'OWNER' -> chủ phòng, 'OTHER' -> operator của phòng khác
  relay.cognitoVerifier = { verifyIdToken: async (t) => (t === 'OWNER' ? { email: 'Owner@Church.org' } : t === 'OTHER' ? { email: 'other@x.com' } : null) };
  return { relay, store };
}
const adminConfig = (relay, headers, body = { name: 'T', code: ROOM, password: 'pw12' }) =>
  relay.handleAdminConfig(new Request('https://x/admin/config', { method: 'POST', headers, body: JSON.stringify(body) }));

test('B-19: thành viên biết mật khẩu phòng KHÔNG chiếm được quyền operator', async () => {
  const { relay, store } = await makeRelay({ ownerEmail: 'owner@church.org' });
  const res = await adminConfig(relay, { 'X-Admin-Secret': 'ATTACKER-SECRET-0123456789' });
  assert.equal(res.status, 403);
  assert.equal(store.get('adminSecret'), SECRET, 'adminSecret thật không bị thay');
  assert.equal((await relay.handleAdminVerify(new Request('https://x/admin/verify', { headers: { 'X-Admin-Secret': SECRET } }))).status, 200);
});

test('B-19: token Cognito của operator PHÒNG KHÁC không chiếm được', async () => {
  const { relay, store } = await makeRelay({ ownerEmail: 'owner@church.org' });
  const res = await adminConfig(relay, { 'X-Admin-Secret': 'ATTACKER-SECRET-0123456789', Authorization: 'Bearer OTHER' });
  assert.equal(res.status, 403);
  assert.equal(store.get('adminSecret'), SECRET);
});

test('B-19: chủ phòng (token Cognito khớp operatorEmail) đặt lại secret được — cài lại app/đổi máy', async () => {
  const { relay, store } = await makeRelay({ ownerEmail: 'owner@church.org' });
  const res = await adminConfig(relay, { 'X-Admin-Secret': 'NEW-MACHINE-SECRET-0123456789', Authorization: 'Bearer OWNER' });
  assert.equal(res.status, 200);
  assert.equal(store.get('adminSecret'), 'NEW-MACHINE-SECRET-0123456789');
});

test('B-19: bootstrap phòng chưa có adminSecret cũng chỉ dành cho chủ phòng', async () => {
  const anon = await makeRelay({ secret: null, config: null, ownerEmail: 'owner@church.org' });
  assert.equal((await adminConfig(anon.relay, { 'X-Admin-Secret': 'SQUATTER-SECRET-0123456789' })).status, 403, 'không token → không giữ phòng');
  assert.equal(anon.store.get('adminSecret'), undefined);
  const owner = await makeRelay({ secret: null, config: null, ownerEmail: 'owner@church.org' });
  assert.equal((await adminConfig(owner.relay, { 'X-Admin-Secret': 'OWNER-SECRET-0123456789', Authorization: 'Bearer OWNER' })).status, 200);
  assert.equal(owner.store.get('adminSecret'), 'OWNER-SECRET-0123456789');
});

test('B-19: phòng không có bản ghi chủ (operatorEmail) → không ai đặt lại được bằng token (fail closed)', async () => {
  const { relay, store } = await makeRelay({ ownerEmail: '' });
  const res = await adminConfig(relay, { 'X-Admin-Secret': 'ANY-SECRET-0123456789ab', Authorization: 'Bearer OWNER' });
  assert.equal(res.status, 403);
  assert.equal(store.get('adminSecret'), SECRET);
});

test('B-19: đúng adminSecret hiện tại vẫn đồng bộ config bình thường (luồng hằng ngày)', async () => {
  const { relay } = await makeRelay({ ownerEmail: 'owner@church.org' });
  const res = await adminConfig(relay, { 'X-Admin-Secret': SECRET }, { name: 'Tên mới', code: ROOM, password: 'pw12' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).config.name, 'Tên mới');
});
