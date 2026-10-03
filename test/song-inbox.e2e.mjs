// E2E local: relay THẬT (wrangler dev) + createRelayClient THẬT (operator) + phone/web giả lập.
// Luồng mới: web TẠO bài -> lưu ngay vào danh sách chung -> thêm vào setlist (mang webId) ->
// operator NẠP setlist mới duyệt (kéo /admin/songs/pending, resolve approve/reject) -> web thấy trạng thái.
//   RELAY_BASE=http://127.0.0.1:28787 node test/song-inbox.e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.RELAY_BASE || 'http://127.0.0.1:28787';
process.env.BAND_RELAY_BASE = BASE;
const { createRelayClient } = createRequire(import.meta.url)(path.join(ROOT, 'src/band-comm/relay-client.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
const ROOM = 'S' + Math.random().toString(36).slice(2, 7).toUpperCase();
const PASS = 'pw' + ROOM;
const ADMIN = 'adminsecret-' + ROOM + '-0123456789';

async function join(name) {
  const j = await (await fetch(`${BASE}/api/room/${ROOM}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ROOM, password: PASS, name, profileId: 'p-' + name })
  })).json();
  if (!j.token) throw new Error('join fail ' + JSON.stringify(j));
  return j.token;
}
const api = (token, p, method = 'GET', body) => fetch(`${BASE}/api/room/${ROOM}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const setlists = [];
function makeOperator() {
  const store = { load: () => ({ room: { code: ROOM, name: 'E2E', password: PASS }, relayAdminSecret: ADMIN }) };
  return createRelayClient({ operatorAuthStore: { load: () => ({ idToken: 'e2e-owner' }) }, store, onEvent() {}, onPresence() {}, getLibraryIndex: () => [], onSetlist: (s) => setlists.push(s) });
}
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : '')); };

const op = makeOperator();
await op.start(); // operator mở Kênh Band trước -> phòng mới được cấu hình
const hoa = await join('Hoa');
const minh = await join('Minh');

// 1. Hoa TẠO bài -> lưu ngay vào danh sách chung (Minh cũng thấy, có lời, chưa cần duyệt)
let r = await api(hoa, '/song-submit', 'POST', { webId: 'web-aaaa-0001', title: 'Bài Mới A', lyrics: 'Dòng 1\r\nDòng 2\r\n\r\n\r\nĐiệp khúc\nLa la' });
check('Tạo bài A: lưu ngay, chưa duyệt, 2 slide', r.status === 200 && r.body.song.status === 'pending' && r.body.song.slides === 2, JSON.stringify(r.body.song));
r = await api(minh, '/songs/web');
const seen = r.body.songs && r.body.songs.find((s) => s.webId === 'web-aaaa-0001');
check('Thành viên khác (Minh) thấy NGAY bài của Hoa trong danh sách chung, kèm lời', !!seen && seen.lyrics === 'Dòng 1\nDòng 2\n\nĐiệp khúc\nLa la' && seen.mine === false && seen.by === 'Hoa', JSON.stringify(seen && seen.by));

// 2. Gửi lại cùng webId (mạng chập chờn) -> idempotent
r = await api(hoa, '/song-submit', 'POST', { webId: 'web-aaaa-0001', title: 'Bài Mới A', lyrics: 'x' });
check('Gửi lại cùng webId: duplicate=true, không tạo thêm', r.status === 200 && r.body.duplicate === true);

// 3. Minh đưa bài của Hoa + 1 bài thư viện vào setlist; setlist mang webId, KHÔNG mang lời
r = await api(minh, '/setlist', 'POST', { id: 'sl-e2e-1', name: 'Chúa nhật', items: [
  { type: 'song', id: '1778231805071', title: 'Bài thư viện' },
  { type: 'song', id: 'web:web-aaaa-0001', title: 'Bài Mới A', webId: 'web-aaaa-0001' }
] });
check('Gửi setlist có bài web: relay nhận, operator đang online', r.status === 200 && r.body.delivered === true);
await until(() => setlists.length > 0);
const sl = setlists[0];
check('Operator nhận setlist: bài web mang webId, bài thư viện thì không', sl && sl.items.length === 2 && sl.items[1].webId === 'web-aaaa-0001' && !sl.items[0].webId, JSON.stringify(sl && sl.items));
check('Setlist KHÔNG mang lời (lời lấy từ relay lúc nạp)', sl && !JSON.stringify(sl).includes('La la'));

// 4. Lúc NẠP: operator kéo bài chờ duyệt (có lời) rồi duyệt
const pending = await op.fetchPendingSongs();
const pa = pending.find((s) => s.webId === 'web-aaaa-0001');
check('Lúc nạp, operator kéo được bài chờ duyệt đủ lời + người tạo', !!pa && pa.lyrics === 'Dòng 1\nDòng 2\n\nĐiệp khúc\nLa la' && pa.from.name === 'Hoa');
let res = await op.resolveSong({ webId: 'web-aaaa-0001', action: 'approve', songId: 1778231805071 });
check('Operator duyệt bài A', res.ok === true, JSON.stringify(res));
r = await api(hoa, '/songs/mine');
const a = r.body.songs.find((s) => s.webId === 'web-aaaa-0001');
check('Người tạo thấy bài A: approved + songId', a && a.status === 'approved' && a.songId === '1778231805071');
check('Bài đã duyệt không còn trong hộp chờ duyệt', !(await op.fetchPendingSongs()).some((s) => s.webId === 'web-aaaa-0001'));

// 5. Operator OFFLINE: web tạo bài B -> operator mở lại vẫn kéo được B (không có A đã duyệt)
op.stop();
await sleep(300);
r = await api(hoa, '/song-submit', 'POST', { webId: 'web-bbbb-0002', title: 'Bài Mới B', lyrics: 'B1\n\nB2\n\nB3' });
check('Tạo bài B lúc operator tắt: server vẫn nhận', r.status === 200 && r.body.song.slides === 3);
const op2 = makeOperator();
await op2.start();
const pend2 = await op2.fetchPendingSongs();
check('Operator mở lại: kéo được bài B, không còn bài A đã duyệt', pend2.some((s) => s.webId === 'web-bbbb-0002') && !pend2.some((s) => s.webId === 'web-aaaa-0001'));

// 6. Từ chối -> web thấy lý do; bài biến khỏi danh sách chung
res = await op2.resolveSong({ webId: 'web-bbbb-0002', action: 'reject', reason: 'Trùng bài có sẵn' });
r = await api(hoa, '/songs/mine');
const b = r.body.songs.find((s) => s.webId === 'web-bbbb-0002');
check('Từ chối: người tạo thấy rejected + lý do', b && b.status === 'rejected' && b.reason === 'Trùng bài có sẵn', JSON.stringify(b));
r = await api(minh, '/songs/web');
check('Bài bị từ chối biến khỏi danh sách chung của cả phòng', !r.body.songs.some((s) => s.webId === 'web-bbbb-0002'));

// 7. Bảo mật
r = await api('token-gia', '/song-submit', 'POST', { webId: 'web-cccc-0003', title: 'X', lyrics: 'x' });
check('Token giả bị từ chối (401)', r.status === 401);
r = await api('token-gia', '/songs/web');
check('Danh sách bài web cần token (401)', r.status === 401);
const bad = await fetch(`${BASE}/api/room/${ROOM}/admin/songs/pending`, { headers: { 'X-Admin-Secret': 'sai-secret-sai-secret' } });
check('Sai admin secret bị chặn (403)', bad.status === 403);

op2.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\nKẾT QUẢ: ${failed}/${results.length} FAIL` : `\nKẾT QUẢ: ${results.length}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
