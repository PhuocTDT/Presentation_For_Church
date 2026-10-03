// Đồng bộ thư viện desktop -> cloud: gom (debounce), thử lại khi 429/lỗi mạng.
//   node --test test/library-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRelayClient } = createRequire(import.meta.url)(path.join(ROOT, 'src/band-comm/relay-client.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { load: () => ({ room: { code: 'ABC123', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) };

function make(songsRef, fetchImpl) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).endsWith('/library-sync')) return { ok: true, json: async () => ({}) };
    const body = JSON.parse(init.body);
    calls.push(body);
    return fetchImpl(calls.length, body);
  };
  const c = createRelayClient({
    store, onEvent() {}, onPresence() {},
    getLibraryIndex: () => songsRef.list.slice(),
    libraryDebounceMs: 40, libraryRetryDelaysMs: [30, 60, 90]
  });
  return { c, calls };
}

test('nhiều lần gọi liên tiếp (import hàng loạt) → chỉ 1 lượt đẩy, mang bản MỚI NHẤT', async () => {
  const songs = { list: [] };
  const { c, calls } = make(songs, async () => ({ ok: true }));
  for (let i = 1; i <= 40; i++) { songs.list.push({ id: i, title: 'B' + i, lyrics: 'x' }); c.syncLibraryToCloud(); }
  await sleep(200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].songs.length, 40);
  assert.equal(calls[0].roomId, 'ABC123');
  assert.equal(c.getLibrarySyncStatus().ok, true);
});

test('429 rồi thành công → tự thử lại, cloud cuối cùng có đủ bài', async () => {
  const songs = { list: [{ id: 1, title: 'A', lyrics: 'a' }] };
  const { c, calls } = make(songs, async (n) => (n < 3 ? { ok: false, status: 429 } : { ok: true }));
  c.syncLibraryToCloud();
  await sleep(500);
  assert.equal(calls.length, 3, 'lần 1,2 bị 429, lần 3 thành công');
  const st = c.getLibrarySyncStatus();
  assert.equal(st.ok, true);
  assert.equal(st.pending, false);
});

test('lỗi mạng (fetch ném lỗi) cũng được thử lại, không văng ra ngoài', async () => {
  const songs = { list: [{ id: 1, title: 'A', lyrics: 'a' }] };
  const { c, calls } = make(songs, async (n) => { if (n < 2) throw new Error('ECONNRESET'); return { ok: true }; });
  c.syncLibraryToCloud();
  await sleep(400);
  assert.equal(calls.length, 2);
  assert.equal(c.getLibrarySyncStatus().ok, true);
});

test('gọi thêm lúc đang gửi dở → gửi lại bản mới ngay sau đó (không mất thay đổi)', async () => {
  const songs = { list: [{ id: 1, title: 'A', lyrics: 'a' }] };
  const { c, calls } = make(songs, async (n) => { if (n === 1) await sleep(120); return { ok: true }; });
  c.syncLibraryToCloud();           // sẽ gửi lúc ~40ms, mất 120ms
  await sleep(70);
  songs.list.push({ id: 2, title: 'B', lyrics: 'b' });
  c.syncLibraryToCloud({ immediate: true }); // đang in-flight → đánh dấu dirty
  await sleep(400);
  assert.equal(calls.length >= 2, true);
  assert.equal(calls[calls.length - 1].songs.length, 2, 'lượt cuối phải có cả bài mới');
});
