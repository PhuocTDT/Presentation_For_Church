// Hộp thư setlist trên KV: hỏi 1 lần lúc (kết nối lại) + vòng an toàn thưa — KHÔNG poll 60s/lần nữa
// (mỗi lượt hỏi = 1 lượt `list` KV, hạn mức free 1.000/ngày chung cho mọi nhà thờ).
//   node --test test/cloud-poll.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRelayClient } = createRequire(import.meta.url)(path.join(ROOT, 'src/band-comm/relay-client.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { load: () => ({ room: { code: 'ABC123', name: 'T', password: 'p' }, relayAdminSecret: 'sec' }) };

// WebSocket giả: tự 'open' sau 5ms, .serverClose() mô phỏng relay/mạng đứt.
const sockets = [];
class FakeWS {
  constructor() { this.l = {}; sockets.push(this); setTimeout(() => this.emit('open'), 5); }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  emit(t, ev = {}) { (this.l[t] || []).forEach((f) => f(ev)); }
  send() {}
  close() { this.emit('close'); }
  serverClose() { this.emit('close'); }
}

function make(opts, mailbox = []) {
  const polls = { n: 0 };
  sockets.length = 0;
  globalThis.WebSocket = FakeWS;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/setlist?roomId=')) { polls.n++; return { ok: true, json: async () => ({ setlists: mailbox }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const got = [];
  const c = createRelayClient({ store, onEvent() {}, onPresence() {}, onSetlist: (s) => got.push(s), ...opts });
  return { c, polls, got };
}

test('lúc start: hỏi hộp thư ĐÚNG 1 lần (không hỏi đôi), nhận setlist rơi vào hộp thư lúc offline', async () => {
  const { c, polls, got } = make({ cloudPollOnlineMs: 10000, cloudPollMinGapMs: 10000 }, [{ id: 'sl-1', name: 'Từ hộp thư', items: [{ type: 'song', id: '1', title: 'A' }], bg: 'nen.jpg' }]);
  await c.start();
  await sleep(150);
  assert.equal(polls.n, 1);
  assert.equal(got.length, 1);
  assert.equal(got[0].bg, 'nen.jpg');
  c.stop();
});

test('đang kết nối: KHÔNG hỏi liên tục — chỉ hỏi lại theo vòng an toàn thưa', async () => {
  const { c, polls } = make({ cloudPollOnlineMs: 300, cloudPollMinGapMs: 10 });
  await c.start();
  await sleep(150);
  assert.equal(polls.n, 1, 'mới start: 1 lượt');
  await sleep(100); // ~250ms: chưa tới vòng 300ms
  assert.equal(polls.n, 1, 'chưa tới vòng an toàn thì không hỏi (trước đây hỏi mỗi 60s dù đang online)');
  await sleep(300); // ~550ms: đã qua 1 vòng
  assert.equal(polls.n, 2, 'đúng 1 lượt thêm sau vòng an toàn');
  c.stop();
  const after = polls.n;
  await sleep(400);
  assert.equal(polls.n, after, 'stop() dừng hẳn lịch hỏi');
});

test('kết nối lại sau khi đứt → hỏi hộp thư ngay (vét tin gửi lúc offline)', async () => {
  const { c, polls } = make({ cloudPollOnlineMs: 60000, cloudPollMinGapMs: 20 });
  await c.start();
  await sleep(100);
  assert.equal(polls.n, 1);
  sockets[0].serverClose();          // relay/mạng đứt → client tự reconnect sau ~1s
  await sleep(1400);
  assert.equal(sockets.length >= 2, true, 'đã mở socket mới');
  assert.equal(polls.n, 2, 'reconnect → 1 lượt hỏi hộp thư');
  c.stop();
});

test('mạng chập chờn (socket mở/đóng liên tục) không đốt KV: bị chặn bởi khoảng cách tối thiểu', async () => {
  const { c, polls } = make({ cloudPollOnlineMs: 60000, cloudPollMinGapMs: 5000 });
  await c.start();
  await sleep(100);
  assert.equal(polls.n, 1);
  sockets[0].serverClose();
  await sleep(1400);                 // reconnect xong nhưng mới ~1,5s < 5s kể từ lượt hỏi trước
  assert.equal(sockets.length >= 2, true);
  assert.equal(polls.n, 1, 'bị chặn, KHÔNG hỏi thêm');
  c.stop();
});
