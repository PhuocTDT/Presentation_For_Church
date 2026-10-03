// Hộp thư "bài hát mới từ web" trong Durable Object (RoomRelay thật, mock ctx).
//   node --test test/song-inbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);

class FakeSocket {
  constructor(att) { this.sent = []; this.att = att; }
  send(s) { this.sent.push(JSON.parse(s)); }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
  close() {}
}

async function makeRoom(store = new Map(), sockets = []) {
  if (!store.has('adminSecret')) { store.set('adminSecret', 'admin-secret-0123456789'); store.set('config', { code: 'ABC123', name: 'T', password: 'pw12' }); }
  const ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket() {}, getWebSockets: () => sockets
  };
  const relay = new RoomRelay(ctx, {});
  await relay.ready;
  return { relay, store, sockets };
}
const tok = (relay, clientId, name, profileId) => relay.makeToken(clientId, name, profileId);
const post = (relay, token, body) => relay.handleSongSubmit(
  new Request('https://x/song-submit', { method: 'POST', body: JSON.stringify(body) }),
  new URL('https://x/song-submit?token=' + encodeURIComponent(token)));
const admin = (relay, action, method, body, secret = 'admin-secret-0123456789') => relay.handleAdminSongs(
  new Request('https://x/admin/songs/' + action, { method, headers: { 'X-Admin-Secret': secret }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), action);
const mine = (relay, token) => relay.handleSongsMine(new URL('https://x/songs/mine?token=' + encodeURIComponent(token)));
const WEBID = (n) => 'web-song-' + String(n).padStart(4, '0');

test('không có/sai token → 401', async () => {
  const { relay } = await makeRoom();
  assert.equal((await post(relay, '', { webId: WEBID(1), title: 'A', lyrics: 'x' })).status, 401);
  assert.equal((await post(relay, 'bậy.bạ.token.x.y', { webId: WEBID(1), title: 'A', lyrics: 'x' })).status, 401);
  assert.equal((await mine(relay, '')).status, 401);
});

test('gửi hợp lệ: chuẩn hoá CRLF + nhiều dòng trống = 1 ngắt slide, đếm slide', async () => {
  const { relay } = await makeRoom();
  const t = await tok(relay, 'c1', 'Hoa', 'p1');
  const res = await post(relay, t, { webId: WEBID(1), title: '  Bài   Mới <b> ', lyrics: 'Dòng 1  \r\nDòng 2\r\n\r\n\r\n\r\nDòng 3\n \n\n   \nDòng 4' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.song.status, 'pending');
  assert.equal(j.song.slides, 3);
  assert.equal(j.song.title, 'Bài Mới b', 'ký tự < > bị loại, khoảng trắng gộp lại');
  const pend = await (await admin(relay, 'pending', 'GET')).json();
  assert.equal(pend.songs[0].lyrics, 'Dòng 1\nDòng 2\n\nDòng 3\n\nDòng 4'.replace('Dòng 3\n\nDòng 4', 'Dòng 3\n\nDòng 4'));
});

test('idempotent theo webId: gửi lại không tạo thêm; người khác dùng webId đó → 409', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  const b = await tok(relay, 'c2', 'Minh', 'p2');
  await post(relay, a, { webId: WEBID(1), title: 'A', lyrics: 'x' });
  const again = await (await post(relay, a, { webId: WEBID(1), title: 'A', lyrics: 'x' })).json();
  assert.equal(again.duplicate, true);
  assert.equal(relay.songInbox.length, 1);
  assert.equal((await post(relay, b, { webId: WEBID(1), title: 'Khác', lyrics: 'y' })).status, 409);
});

test('dữ liệu xấu: webId lạ, thiếu tên, lời rỗng, lời quá dài → 400', async () => {
  const { relay } = await makeRoom();
  const t = await tok(relay, 'c1', 'Hoa', 'p1');
  assert.equal((await post(relay, t, { webId: 'ngắn', title: 'A', lyrics: 'x' })).status, 400);
  assert.equal((await post(relay, t, { webId: WEBID(1), title: '   ', lyrics: 'x' })).status, 400);
  assert.equal((await post(relay, t, { webId: WEBID(2), title: 'A', lyrics: ' \n\n \n' })).status, 400);
  assert.equal((await post(relay, t, { webId: WEBID(3), title: 'A', lyrics: 'a'.repeat(6001) })).status, 400);
  assert.equal(relay.songInbox.length, 0);
});

test('giới hạn 10 bài/giờ/thành viên (kể cả đổi clientId nhưng cùng profileId) và 50 bài chờ/phòng', async () => {
  const { relay } = await makeRoom();
  for (let i = 1; i <= 10; i++) {
    const t = await tok(relay, 'c' + i, 'Hoa', 'pSame'); // mỗi lần reconnect = clientId mới, profileId giữ nguyên
    assert.equal((await post(relay, t, { webId: WEBID(i), title: 'B' + i, lyrics: 'x' })).status, 200);
  }
  const t11 = await tok(relay, 'c11', 'Hoa', 'pSame');
  assert.equal((await post(relay, t11, { webId: WEBID(11), title: 'B11', lyrics: 'x' })).status, 429);

  // 40 bài nữa từ 40 người khác nhau → đủ 50 chờ → người thứ 51 bị chặn
  for (let i = 0; i < 40; i++) {
    const t = await tok(relay, 'k' + i, 'N' + i, 'pk' + i);
    assert.equal((await post(relay, t, { webId: WEBID(100 + i), title: 'K' + i, lyrics: 'x' })).status, 200);
  }
  const t51 = await tok(relay, 'z', 'Z', 'pz');
  assert.equal((await post(relay, t51, { webId: WEBID(999), title: 'Z', lyrics: 'x' })).status, 429);
});

test('/songs/mine chỉ trả bài của chính mình, không lộ lời bài người khác', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  const b = await tok(relay, 'c2', 'Minh', 'p2');
  await post(relay, a, { webId: WEBID(1), title: 'Của Hoa', lyrics: 'bí mật' });
  await post(relay, b, { webId: WEBID(2), title: 'Của Minh', lyrics: 'x' });
  const ma = await (await mine(relay, a)).json();
  assert.deepEqual(ma.songs.map((s) => s.title), ['Của Hoa']);
  assert.equal('lyrics' in ma.songs[0], false);
  assert.equal('submitter' in ma.songs[0], false);
});

test('admin: sai secret → 403; pending có lời; resolve approve/reject, idempotent, xung đột → 409', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  await post(relay, a, { webId: WEBID(1), title: 'A', lyrics: 'lời A' });
  await post(relay, a, { webId: WEBID(2), title: 'B', lyrics: 'lời B' });
  assert.equal((await admin(relay, 'pending', 'GET', null, 'sai')).status, 403);
  assert.equal((await admin(relay, 'resolve', 'POST', { webId: WEBID(1), action: 'approve' }, '')).status, 403);

  const pend = await (await admin(relay, 'pending', 'GET')).json();
  assert.equal(pend.songs.length, 2);
  assert.equal(pend.songs[0].lyrics, 'lời A');

  const ok = await admin(relay, 'resolve', 'POST', { webId: WEBID(1), action: 'approve', songId: 1778231805071 });
  assert.equal(ok.status, 200);
  assert.equal((await admin(relay, 'resolve', 'POST', { webId: WEBID(1), action: 'approve', songId: 1778231805071 })).status, 200, 'gọi lại cùng kết quả = OK');
  assert.equal((await admin(relay, 'resolve', 'POST', { webId: WEBID(1), action: 'reject' })).status, 409);
  assert.equal((await admin(relay, 'resolve', 'POST', { webId: WEBID(2), action: 'reject', reason: 'Trùng bài <x>' })).status, 200);
  assert.equal((await admin(relay, 'resolve', 'POST', { webId: 'khong-ton-tai', action: 'approve' })).status, 404);
  assert.equal((await admin(relay, 'resolve', 'POST', { webId: WEBID(2), action: 'xoa' })).status, 400);

  assert.equal((await (await admin(relay, 'pending', 'GET')).json()).songs.length, 0, 'đã xử lý hết');
  const m = (await (await mine(relay, a)).json()).songs;
  assert.deepEqual(m.map((s) => [s.status, s.songId, s.reason]), [['approved', '1778231805071', ''], ['rejected', null, 'Trùng bài x']]);
});

test('KHÔNG đẩy thẻ/báo riêng cho operator: duyệt chỉ diễn ra lúc nạp setlist (không vào ring)', async () => {
  const op = new FakeSocket({ clientId: 'operator', isOperator: true });
  const other = new FakeSocket({ clientId: 'c9', name: 'Khác' });
  const { relay } = await makeRoom(new Map(), [op, other]);
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  await post(relay, a, { webId: WEBID(1), title: 'Bài Mới', lyrics: 'x\n\ny' });
  assert.equal(op.sent.length, 0);
  assert.equal(other.sent.length, 0);
  assert.equal(relay.ring.length, 0);
  // nhưng operator vẫn kéo được lúc cần (khi nạp setlist)
  const pend = await (await admin(relay, 'pending', 'GET')).json();
  assert.equal(pend.songs.length, 1);
});

const webSongs = (relay, token) => relay.handleWebSongs(new URL('https://x/songs/web?token=' + encodeURIComponent(token)));

test('/songs/web: bài mới hiện NGAY cho cả phòng (có lời), chưa cần duyệt; bài bị từ chối biến mất', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  const b = await tok(relay, 'c2', 'Minh', 'p2');
  await post(relay, a, { webId: WEBID(1), title: 'Của Hoa', lyrics: 'lời hoa\n\nslide hai' });
  await post(relay, a, { webId: WEBID(2), title: 'Sẽ bị từ chối', lyrics: 'x' });
  assert.equal((await webSongs(relay, 'bậy')).status, 401);

  const seenByMinh = (await (await webSongs(relay, b)).json()).songs;
  assert.deepEqual(seenByMinh.map((x) => x.title).sort(), ['Của Hoa', 'Sẽ bị từ chối']);
  const hoaSong = seenByMinh.find((x) => x.webId === WEBID(1));
  assert.equal(hoaSong.lyrics, 'lời hoa\n\nslide hai');
  assert.equal(hoaSong.mine, false, 'Minh không phải chủ bài');
  assert.equal(hoaSong.by, 'Hoa');
  assert.equal('submitter' in hoaSong, false, 'không lộ profileId người gửi');
  assert.equal((await (await webSongs(relay, a)).json()).songs.find((x) => x.webId === WEBID(1)).mine, true);

  await admin(relay, 'resolve', 'POST', { webId: WEBID(2), action: 'reject', reason: 'trùng' });
  assert.deepEqual((await (await webSongs(relay, b)).json()).songs.map((x) => x.webId), [WEBID(1)]);

  await admin(relay, 'resolve', 'POST', { webId: WEBID(1), action: 'approve', songId: 5 });
  assert.equal((await (await webSongs(relay, b)).json()).songs[0].status, 'approved', 'bài vừa duyệt còn hiện ít phút để cầu nối tới khi desktop đồng bộ');
  relay.songInbox.find((e) => e.webId === WEBID(1)).resolvedAt = Date.now() - 11 * 60 * 1000;
  assert.equal((await (await webSongs(relay, b)).json()).songs.length, 0, 'sau 10 phút bài đã duyệt chỉ còn trong thư viện desktop');
});

test('bài chưa ai đưa vào setlist tự dọn sau 30 ngày; còn trong hạn thì giữ', async () => {
  const { relay } = await makeRoom();
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  await post(relay, a, { webId: WEBID(1), title: 'Cũ', lyrics: 'x' });
  await post(relay, a, { webId: WEBID(2), title: 'Mới', lyrics: 'y' });
  relay.songInbox.find((e) => e.webId === WEBID(1)).ts = Date.now() - 31 * 24 * 3600 * 1000;
  await relay.persistSongInbox();
  assert.deepEqual(relay.songInbox.map((e) => e.webId), [WEBID(2)]);
});

const sendSetlist = (relay, token, body) => relay.handleSetlistSubmit(
  new Request('https://x/setlist', { method: 'POST', body: JSON.stringify(body) }), new URL('https://x/setlist?token=' + encodeURIComponent(token)));

test('setlist mang webId của bài tạo trên web nhưng KHÔNG mang lời; webId rác bị bỏ', async () => {
  const op = new FakeSocket({ clientId: 'operator', isOperator: true });
  const { relay } = await makeRoom(new Map(), [op]);
  const t = await tok(relay, 'c1', 'Hoa', 'p1');
  const res = await sendSetlist(relay, t, { id: 'sl-1', name: 'CN', items: [
    { type: 'song', id: '1778231805071', title: 'Bài thư viện' },
    { type: 'song', id: 'web:' + WEBID(1), title: 'Bài mới', webId: WEBID(1), lyrics: 'LỜI TIÊM LẬU' },
    { type: 'song', id: 'x', title: 'webId rác', webId: '../../etc' }
  ] });
  assert.equal(res.status, 200);
  const env = op.sent.find((m) => m.envelope.type === 'setlist').envelope;
  assert.deepEqual(env.meta.items, [
    { type: 'song', id: '1778231805071', title: 'Bài thư viện' },
    { type: 'song', id: 'web:' + WEBID(1), title: 'Bài mới', webId: WEBID(1) },
    { type: 'song', id: 'x', title: 'webId rác' }
  ]);
  assert.equal(JSON.stringify(env).includes('TIÊM LẬU'), false, 'lời không đi theo setlist');
});

// ---- sắp xếp ảnh hợp âm ----
async function roomWithGallery(n) {
  const r = await makeRoom();
  const sock = new FakeSocket({ clientId: 'c-listen', name: 'L' });
  r.sockets.push(sock);
  r.relay.gallery = { images: Array.from({ length: n }, (_, i) => ({ id: 'img' + (i + 1), name: 'Ảnh ' + (i + 1), ownerId: i === 0 ? 'p1' : 'p2' })), updatedAt: 1 };
  return { ...r, sock };
}
const reorder = (relay, token, ids) => relay.handleGalleryReorder(
  new Request('https://x/gallery/reorder', { method: 'POST', body: JSON.stringify({ ids }) }), new URL('https://x/gallery/reorder?token=' + encodeURIComponent(token)));
const order = (relay) => relay.gallery.images.map((x) => x.id);

test('sắp xếp ảnh: thành viên đổi được thứ tự, cả phòng được báo (gallery), không cần là chủ ảnh', async () => {
  const { relay, sock } = await roomWithGallery(4);
  const t = await tok(relay, 'c1', 'Minh', 'p-khac');
  const res = await reorder(relay, t, ['img3', 'img1', 'img4', 'img2']);
  assert.equal(res.status, 200);
  assert.deepEqual(order(relay), ['img3', 'img1', 'img4', 'img2']);
  assert.deepEqual((await res.json()).images.map((x) => x.id), ['img3', 'img1', 'img4', 'img2']);
  assert.ok(sock.sent.some((m) => m.envelope && m.envelope.type === 'gallery'), 'phát envelope gallery cho mọi người');
});

test('sắp xếp ảnh: id lạ/trùng bỏ qua, ảnh thiếu trong danh sách được GIỮ ở cuối (không mất ảnh)', async () => {
  const { relay } = await roomWithGallery(4);
  const t = await tok(relay, 'c1', 'Minh', 'p2');
  await reorder(relay, t, ['img4', 'khong-co', 'img4', 'img2']);
  assert.deepEqual(order(relay), ['img4', 'img2', 'img1', 'img3']);
  await reorder(relay, t, []);
  assert.equal(order(relay).length, 4, 'danh sách rỗng không làm mất ảnh');
});

test('sắp xếp ảnh: cần token hợp lệ; body xấu/quá lớn bị từ chối; giới hạn tần suất', async () => {
  const { relay } = await roomWithGallery(3);
  assert.equal((await reorder(relay, 'bậy', ['img1'])).status, 401);
  const t = await tok(relay, 'c1', 'Minh', 'p2');
  assert.equal((await relay.handleGalleryReorder(new Request('https://x', { method: 'POST', body: '{"ids":"x"}' }), new URL('https://x/?token=' + encodeURIComponent(t)))).status, 400);
  assert.equal((await reorder(relay, t, Array.from({ length: 501 }, (_, i) => 'i' + i))).status, 400);
  let last = 200;
  for (let i = 0; i < 40; i++) { last = (await reorder(relay, t, ['img2', 'img1', 'img3'])).status; if (last === 429) break; }
  assert.equal(last, 429, 'bấm liên tục sẽ bị chặn');
});

test('sắp xếp ảnh: operator (admin) vẫn đổi được, cùng một logic', async () => {
  const { relay } = await roomWithGallery(3);
  const res = await relay.handleAdminGallery(new Request('https://x', { method: 'POST', headers: { 'X-Admin-Secret': 'admin-secret-0123456789' }, body: JSON.stringify({ ids: ['img3', 'img2', 'img1'] }) }), 'reorder');
  assert.equal(res.status, 200);
  assert.deepEqual(order(relay), ['img3', 'img2', 'img1']);
});

test('sống sót qua evict (DO dậy lại) và dọn bản đã xử lý quá 7 ngày', async () => {
  const store = new Map();
  const { relay } = await makeRoom(store);
  const a = await tok(relay, 'c1', 'Hoa', 'p1');
  await post(relay, a, { webId: WEBID(1), title: 'A', lyrics: 'x' });
  await post(relay, a, { webId: WEBID(2), title: 'B', lyrics: 'y' });
  await admin(relay, 'resolve', 'POST', { webId: WEBID(2), action: 'reject' });

  const { relay: relay2 } = await makeRoom(store); // cùng storage = DO vừa dậy lại
  assert.equal(relay2.songInbox.length, 2);
  const old = relay2.songInbox.find((e) => e.webId === WEBID(2));
  old.resolvedAt = Date.now() - 8 * 24 * 3600 * 1000;
  await relay2.persistSongInbox();
  assert.deepEqual(relay2.songInbox.map((e) => e.webId), [WEBID(1)], 'bản đã xử lý >7 ngày bị dọn, bản đang chờ giữ nguyên');
});
