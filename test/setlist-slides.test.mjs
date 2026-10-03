// Logic chia/chuẩn hoá lời bài hát của trang /setlist/ (comm/setlist/slides.js).
// Quan trọng: PHẢI khớp bộ chuẩn hoá của relay (room-relay.js) — web và relay mà lệch nhau
// thì bài gửi lên sẽ khác với bài người dùng thấy trong preview.
//   node --test test/setlist-slides.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = createRequire(import.meta.url)(path.join(ROOT, 'comm/setlist/slides.js'));
const { RoomRelay } = await import(pathToFileURL(path.join(ROOT, 'cloud/worker/src/room-relay.js')).href);

test('Enter đôi (1 hoặc nhiều dòng trống, kể cả dòng chỉ có khoảng trắng) = đúng 1 ngắt slide', () => {
  assert.equal(S.normalizeLyrics('a\n\nb'), 'a\n\nb');
  assert.equal(S.normalizeLyrics('a\n\n\n\n\nb'), 'a\n\nb');
  assert.equal(S.normalizeLyrics('a\n  \n\t\nb'), 'a\n\nb');
  assert.equal(S.normalizeLyrics('a\nb\nc'), 'a\nb\nc', 'Enter đơn KHÔNG ngắt slide');
});
test('CRLF/CR, khoảng trắng cuối dòng, ký tự điều khiển, đầu/cuối trống', () => {
  assert.equal(S.normalizeLyrics('\r\n\r\na  \r\nb\t\r\n\r\n\r\nc\r\n'), 'a\nb\n\nc');
  assert.equal(S.normalizeLyrics('a\u0000\u0007b'), 'ab');
  assert.equal(S.normalizeLyrics('   \n\n  '), '');
  assert.equal(S.normalizeLyrics(null), '');
});
test('splitSlides: nhãn đầu khối, bỏ khối rỗng, giữ chord ở nội dung', () => {
  const sl = S.splitSlides('Đoạn 1\nLời một\nLời hai\n\nĐiệp khúc\n[Am]Hallelujah\n\nChỉ có lời');
  assert.deepEqual(sl.map((x) => x.label), ['Đoạn 1', 'Điệp khúc', '']);
  assert.equal(sl[0].content, 'Lời một\nLời hai');
  assert.equal(sl[1].content, '[Am]Hallelujah');
  assert.equal(S.stripChords(sl[1].content), 'Hallelujah');
  assert.equal(sl[2].content, 'Chỉ có lời');
});
test('nhãn khớp hành vi desktop: nhận Verse/Chorus/Đoạn/Điệp khúc/Kết, không phân biệt hoa thường', () => {
  assert.equal(S.stripLabel('chorus 2\nlời').label, 'chorus 2');
  assert.equal(S.stripLabel('Kết\nAmen').label, 'Kết');
  assert.equal(S.stripLabel('Lời bình thường\nx').label, '');
});
test('searchNorm: bỏ dấu tiếng Việt, đ -> d', () => {
  assert.equal(S.searchNorm('Đức Chúa Trời Tuyệt Vời'), 'duc chua troi tuyet voi');
  assert.ok(S.searchNorm('Ơn Chúa').includes('on chua'));
});
test('resolveStyle: mặc định, ép kiểu, chặn giá trị lạ', () => {
  assert.deepEqual(S.resolveStyle(null), S.DEFAULT_STYLE);
  const r = S.resolveStyle({ fontSize: '60px', textAlign: 'bậy', textStrokeWidth: 999, color: '#f00' });
  assert.equal(r.fontSize, 60); assert.equal(r.textAlign, 'center'); assert.equal(r.textStrokeWidth, 30); assert.equal(r.color, '#f00');
  assert.equal(S.resolveStyle({ fontSize: '9999px' }).fontSize, 300);
});
test('newWebId hợp lệ với bộ kiểm tra của relay và không trùng', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) { const id = S.newWebId(); assert.match(id, /^[A-Za-z0-9_-]{8,64}$/); ids.add(id); }
  assert.equal(ids.size, 200);
});

// ---- Khớp với relay: cùng đầu vào => cùng lời lưu ----
async function relayNormalize(raw) {
  const store = new Map([['adminSecret', 'admin-secret-0123456789'], ['config', { code: 'ABC123', name: 'T', password: 'pw12' }]]);
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) }, blockConcurrencyWhile: (f) => f(), acceptWebSocket() {}, getWebSockets: () => [] };
  const relay = new RoomRelay(ctx, {}); await relay.ready;
  const token = await relay.makeToken('c1', 'Hoa', 'p1');
  const res = await relay.handleSongSubmit(new Request('https://x', { method: 'POST', body: JSON.stringify({ webId: S.newWebId(), title: 'T', lyrics: raw }) }), new URL('https://x/?token=' + encodeURIComponent(token)));
  if (res.status !== 200) return null;
  const pend = await (await relay.handleAdminSongs(new Request('https://x', { headers: { 'X-Admin-Secret': 'admin-secret-0123456789' } }), 'pending')).json();
  return pend.songs[0].lyrics;
}
test('web và relay chuẩn hoá GIỐNG HỆT nhau (kiểm tra 300 chuỗi ngẫu nhiên + ca biên)', async () => {
  const pieces = ['Chúa', ' ', '  ', '\n', '\n\n', '\r\n', '\t', 'Điệp khúc', '[Am]', 'Kết', 'a', '\u0000', ' ', ' \n ', 'Hallelujah'];
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cases = ['a\n\nb', '\r\n\r\nx\r\n', '  \n  ', 'một hai\n\n \n\nba'];
  for (let i = 0; i < 300; i++) { let s = ''; const n = 1 + Math.floor(rnd() * 12); for (let k = 0; k < n; k++) s += pieces[Math.floor(rnd() * pieces.length)]; cases.push(s); }
  let compared = 0;
  for (const c of cases) {
    const web = S.normalizeLyrics(c);
    const srv = await relayNormalize(c);
    if (!web) { assert.equal(srv, null, 'lời rỗng: relay phải từ chối: ' + JSON.stringify(c)); continue; }
    assert.equal(srv, web, 'lệch với đầu vào ' + JSON.stringify(c));
    compared++;
  }
  assert.ok(compared > 100);
});
