// GET /setlist (poll của app operator) không được tốn lượt `list` KV khi hộp thư trống, nhưng cũng KHÔNG BAO GIỜ che setlist mới.
//   node --test test/mailbox-empty.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = (await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/worker.js')).href)).default;
const ROOM = 'ABC123';

class FakeKV {
  constructor() { this.m = new Map(); this.lists = 0; this.hideListOnce = false; }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '', limit = 1000 } = {}) {
    this.lists++;
    if (this.hideListOnce) { this.hideListOnce = false; return { keys: [] }; } // mô phỏng KV chưa đồng bộ: list ngay sau put chưa thấy
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) };
  }
}
const env = () => ({ SETLISTS: new FakeKV(), GLOBAL_USERS: new FakeKV(), OPERATOR_AUTH_MODE: 'off' });
const get = (e) => worker.fetch(new Request(`https://x/setlist?roomId=${ROOM}`), e).then((r) => r.json());
const post = (e, id) => worker.fetch(new Request('https://x/setlist', { method: 'POST', body: JSON.stringify({ roomId: ROOM, setlist: { id, name: 'N', items: [{ type: 'song', id: '1', title: 'A' }] } }) }), e);
const ack = (e, id) => worker.fetch(new Request('https://x/setlist/ack', { method: 'POST', body: JSON.stringify({ roomId: ROOM, id }) }), e);

async function withClock(fn) {
  const real = Date.now; let offset = 0;
  Date.now = () => real() + offset;
  try { await fn((ms) => { offset += ms; }); } finally { Date.now = real; }
}

test('hộp thư trống: poll lần 1 tốn 1 list, các lần sau KHÔNG tốn list (trả rỗng từ marker)', async () => {
  const e = env();
  assert.deepEqual((await get(e)).setlists, []);
  assert.equal(e.SETLISTS.lists, 1);
  for (let i = 0; i < 50; i++) assert.deepEqual((await get(e)).setlists, []);
  assert.equal(e.SETLISTS.lists, 1, '50 lần poll tiếp theo không tốn lượt list nào');
});

test('có setlist mới thì poll thấy NGAY (marker bị vô hiệu bởi lần ghi hộp thư)', async () => {
  const e = env();
  await get(e);                        // đặt marker trống
  assert.equal((await post(e, 'sl-1')).status, 200);
  const r = await get(e);
  assert.equal(r.setlists.length, 1);
  assert.equal(r.setlists[0].id, 'sl-1');
  assert.equal(e.SETLISTS.lists, 3, '1 (poll đầu) + 1 (POST tự list để kiểm tra giới hạn/phòng) + 1 (poll sau khi có tin)');
});

test('race KV: list ngay sau put chưa thấy tin → marker trống được ghi, nhưng lần poll kế vẫn thấy tin (không bị che)', async () => {
  const e = env();
  await post(e, 'sl-2');
  e.SETLISTS.hideListOnce = true;      // lần list kế tiếp "chưa thấy" sl-2
  assert.deepEqual((await get(e)).setlists, [], 'lần này KV chưa đồng bộ nên rỗng (như hành vi cũ)');
  const r = await get(e);              // vẫn trong khoảng chờ đồng bộ → marker KHÔNG được tin → list lại
  assert.equal(r.setlists.length, 1, 'setlist không bị che bởi marker');
});

test('sau ack và hết khoảng chờ đồng bộ: marker trống lại có hiệu lực', async () => {
  await withClock(async (advance) => {
    const e = env();
    await post(e, 'sl-3');
    assert.equal((await get(e)).setlists.length, 1);
    assert.equal((await ack(e, 'sl-3')).status, 200);
    assert.deepEqual((await get(e)).setlists, []);   // list lại (marker chưa đủ điều kiện), ghi marker
    const lists = e.SETLISTS.lists;
    assert.deepEqual((await get(e)).setlists, []);
    assert.equal(e.SETLISTS.lists > lists, true, 'còn trong khoảng chờ 70s sau lần ghi → vẫn list');
    advance(75 * 1000);
    assert.deepEqual((await get(e)).setlists, []);   // list 1 lần nữa, marker mới nằm sau lần ghi + 70s
    const l2 = e.SETLISTS.lists;
    assert.deepEqual((await get(e)).setlists, []);
    assert.equal(e.SETLISTS.lists, l2, 'từ giờ poll không tốn list');
  });
});
