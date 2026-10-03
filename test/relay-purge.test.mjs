// Xóa toàn bộ dữ liệu một phòng (quyền xóa dữ liệu theo chính sách riêng tư) — RoomRelay thật, mock ctx.
//   node --test test/relay-purge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);

const ROOM = 'ABC123', OTHER = 'XYZ789';
const SECRET = 'operator-secret-0123456789abcdef';
const PURGE_KEY = 'maintainer-purge-key-0123456789ab';

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '', limit = 2 } = {}) { // limit nhỏ để ép phân trang
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: all.slice(0, limit).map((name) => ({ name })), list_complete: all.length <= limit, cursor: 'c' };
  }
}
class FakeR2 {
  constructor() { this.m = new Map(); }
  async put(k, v) { this.m.set(k, v); }
  async delete(keys) { for (const k of [].concat(keys)) this.m.delete(k); }
  async list({ prefix = '', limit = 2 } = {}) {
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { objects: all.slice(0, limit).map((key) => ({ key })), truncated: all.length > limit, cursor: 'c' };
  }
}

async function makeRoom({ purgeKey } = {}) {
  const store = new Map([['adminSecret', SECRET], ['config', { code: ROOM, name: 'T', password: 'pw12' }],
    ['ring', [{ id: 'e1', type: 'text', text: 'riêng tư' }]], ['profiles', { p1: { name: 'Hoa', buttons: [] } }],
    ['accounts', [{ id: 'a1', username: 'hoa' }]], ['blocked', { p9: { name: 'X' } }], ['songInbox', [{ webId: 'w' }]]]);
  const closed = [];
  const sockets = [{ close: (c, r) => closed.push([c, r]) }, { close: () => { throw new Error('đã đóng'); } }];
  let deleted = false;
  const ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, deleteAll: async () => { store.clear(); deleted = true; } },
    blockConcurrencyWhile: (fn) => fn(), acceptWebSocket() {}, getWebSockets: () => sockets
  };
  const env = { GALLERY: new FakeR2(), BGS: new FakeR2(), SETLISTS: new FakeKV(), GLOBAL_USERS: new FakeKV() };
  if (purgeKey) env.ADMIN_PURGE_KEY = purgeKey;
  for (const code of [ROOM, OTHER]) {
    for (let i = 0; i < 5; i++) { await env.GALLERY.put(`${code}/img-${i}`, 'x'); await env.BGS.put(`${code}/bg-${i}`, 'x'); }
    for (let i = 0; i < 5; i++) { await env.SETLISTS.put(`sl:${code}:s${i}`, '{}'); await env.SETLISTS.put(`ack:${code}:s${i}`, '1'); }
    await env.SETLISTS.put(`lib:${code}`, '{"songs":[]}');
  }
  await env.GLOBAL_USERS.put('room:' + ROOM, JSON.stringify({ code: ROOM, operatorEmail: 'owner@church.org', password: 'pw12', name: 'T' }));
  const relay = new RoomRelay(ctx, env);
  await relay.ready;
  relay.roomCode = ROOM;
  relay.cognitoVerifier = { verifyIdToken: async (t) => (t === 'OWNER' ? { email: 'Owner@Church.org' } : t === 'OTHER' ? { email: 'other@x.com' } : null) };
  return { relay, store, env, closed, wasDeleted: () => deleted };
}
const purge = (relay, headers = {}) => relay.handlePurge(new Request('https://x/admin/purge', { method: 'POST', headers }));

test('không quyền → 403 và KHÔNG xóa gì', async () => {
  const { relay, store, env } = await makeRoom({ purgeKey: PURGE_KEY });
  for (const h of [{}, { 'X-Admin-Secret': 'sai-secret-0123456789abcdef' }, { 'X-Purge-Key': 'sai-khoa-0123456789abcdefgh' }, { Authorization: 'Bearer OTHER' }, { Authorization: 'Bearer garbage' }]) {
    assert.equal((await purge(relay, h)).status, 403, JSON.stringify(h));
  }
  assert.ok(store.size > 0 && env.GALLERY.m.size === 10 && env.SETLISTS.m.size === 22);
});

test('X-Purge-Key bị bỏ qua khi máy chủ chưa cấu hình ADMIN_PURGE_KEY', async () => {
  const { relay } = await makeRoom();
  assert.equal((await purge(relay, { 'X-Purge-Key': PURGE_KEY })).status, 403);
});

test('đúng adminSecret: xóa sạch dữ liệu phòng, KHÔNG đụng phòng khác, ngắt kết nối', async () => {
  const { relay, store, env, closed, wasDeleted } = await makeRoom();
  const res = await purge(relay, { 'X-Admin-Secret': SECRET });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.deleted, { r2Gallery: 5, r2Backgrounds: 5, kvSetlists: 10, kvLibrary: 1 }, 'phân trang phải xóa hết (limit giả lập = 2)');
  assert.ok(wasDeleted()); assert.equal(store.size, 0);
  // phòng khác còn nguyên
  assert.equal([...env.GALLERY.m.keys()].filter((k) => k.startsWith(OTHER + '/')).length, 5);
  assert.equal([...env.BGS.m.keys()].filter((k) => k.startsWith(OTHER + '/')).length, 5);
  assert.equal([...env.SETLISTS.m.keys()].filter((k) => k.includes(OTHER)).length, 11);
  // không còn khóa nào của phòng bị xóa
  assert.equal([...env.GALLERY.m.keys(), ...env.BGS.m.keys(), ...env.SETLISTS.m.keys()].filter((k) => k.includes(ROOM)).length, 0);
  assert.equal(closed.length, 1, 'socket mở phải bị đóng (socket lỗi không làm hỏng việc xóa)');
  // trạng thái RAM rỗng + secret cũ hết hiệu lực
  assert.equal(relay.adminSecret, null); assert.deepEqual(relay.profiles, {}); assert.deepEqual(relay.ring, []);
  assert.equal((await relay.handleAdminVerify(new Request('https://x/admin/verify', { headers: { 'X-Admin-Secret': SECRET } }))).status, 401);
});

test('chủ phòng bằng token Cognito xóa được; operator phòng khác thì không', async () => {
  const a = await makeRoom();
  assert.equal((await purge(a.relay, { Authorization: 'Bearer OTHER' })).status, 403);
  assert.ok(a.store.size > 0);
  assert.equal((await purge(a.relay, { Authorization: 'Bearer OWNER' })).status, 200);
  assert.equal(a.store.size, 0);
});

test('quản trị viên dịch vụ xóa bằng ADMIN_PURGE_KEY (chủ phòng không còn khóa/token)', async () => {
  const { relay, store, env } = await makeRoom({ purgeKey: PURGE_KEY });
  assert.equal((await purge(relay, { 'X-Purge-Key': PURGE_KEY })).status, 200);
  assert.equal(store.size, 0);
  assert.equal(env.SETLISTS.m.has('lib:' + ROOM), false);
  assert.equal(env.SETLISTS.m.has('lib:' + OTHER), true);
});

test('mã phòng không hợp lệ → 400, không xóa', async () => {
  const { relay, store } = await makeRoom();
  relay.roomCode = '../x'; relay.config = null;
  assert.equal((await purge(relay, { 'X-Admin-Secret': SECRET })).status, 400);
  assert.ok(store.size > 0);
});
