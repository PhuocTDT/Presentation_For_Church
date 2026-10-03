// E2E trình duyệt THẬT (Chrome qua puppeteer-core) cho trang /setlist/ + relay local + operator thật.
// Cần: relay local (wrangler dev) và `puppeteer-core` (không nằm trong package.json của app):
//   PUPPETEER_CORE=<đường dẫn tới puppeteer-core> RELAY_BASE=http://127.0.0.1:28787 node test/setlist-page.e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.RELAY_BASE || 'http://127.0.0.1:28787';
process.env.BAND_RELAY_BASE = BASE;
const req = createRequire(import.meta.url);
const puppeteer = req(process.env.PUPPETEER_CORE || 'puppeteer-core');
const { createRelayClient } = req(path.join(ROOT, 'src/band-comm/relay-client.js'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env.SHOTS_DIR || path.join(ROOT, 'test', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = 'W' + Math.random().toString(36).slice(2, 7).toUpperCase();
const PASS = 'pw' + ROOM;
const ADMIN = 'adminsecret-' + ROOM + '-0123456789';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : '')); };

// Chrome dựng 2 ảnh JPEG thật (nền thử) bằng canvas -> "desktop" đẩy lên như bản thu nhỏ.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--window-size=1100,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const mkJpeg = (c1, c2) => page.evaluate((a, b) => {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
  const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 320, 180); gr.addColorStop(0, a); gr.addColorStop(1, b);
  g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
  return cv.toDataURL('image/jpeg', 0.8).split(',')[1];
}, c1, c2).then((b64) => Buffer.from(b64, 'base64'));
const THUMBS = { 'sunset.jpg': await mkJpeg('#ff7a18', '#af002d'), 'forest.jpg': await mkJpeg('#0f9b0f', '#003300') };

// ---- operator (desktop giả lập, dùng createRelayClient THẬT) ----
const LIB = [
  { id: 1778231805071, title: 'Chúa Là Ánh Sáng', lyrics: 'Đoạn 1\nChúa là ánh sáng đời con\n\nĐiệp khúc\nHallelujah [Am]ngợi khen', style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffff00', textAlign: 'center', verticalAlign: 'middle', textStrokeWidth: 4, textStrokeColor: '#000000' }, bg: 'sunset.jpg' },
  { id: 1778231805072, title: 'Ơn Chúa Tuyệt Vời', lyrics: 'Ơn Chúa tuyệt vời\nCon ca ngợi Ngài', style: {}, bg: null },
  { id: 1778231805073, title: 'Bài Thứ Ba', lyrics: 'Dòng một\n\nDòng hai', style: {}, bg: null }
];
const gotSetlists = [];
const op = createRelayClient({ operatorAuthStore: { load: () => ({ idToken: 'e2e-owner' }) },
  store: { load: () => ({ room: { code: ROOM, name: 'Nhà Thờ E2E', password: PASS }, relayAdminSecret: ADMIN }) },
  onEvent() {}, onPresence() {}, getLibraryIndex: () => LIB,
  onSetlist: (sl) => gotSetlists.push(sl),
  libraryDebounceMs: 50,
  listBackgroundImages: () => Object.keys(THUMBS).map((name) => ({ name, key: 'k-' + name })),
  makeBackgroundThumb: async (name) => THUMBS[name],
  backgroundSyncDelayMs: 50
});
await op.start();
await sleep(2500); // chờ đẩy thư viện + ảnh nền lần đầu

const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|Failed to load resource.*404|status of 403/.test(m.text())) problems.push('console.' + m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
const $text = (sel) => page.$eval(sel, (e) => e.textContent);
const visible = (sel) => page.$eval(sel, (e) => !e.classList.contains('hidden') && e.offsetParent !== null).catch(() => false);
const waitText = (sel, re, ms = 15000) => page.waitForFunction((s, r) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), { timeout: ms }, sel, re.source).then(() => true).catch(() => false);

try {
  // 1. Link có ?room= -> luôn bắt nhập mật khẩu
  await page.goto(`${BASE}/setlist/?room=${ROOM}`, { waitUntil: 'networkidle0' });
  check('Mở link ?room=: hiện màn đăng nhập, ID phòng điền sẵn', await visible('#login') && (await page.$eval('#roomCode', (e) => e.value)) === ROOM);
  await page.type('#roomPassword', 'saimatkhau');
  await page.type('#yourName', 'Hoa');
  await page.click('#loginBtn');
  check('Sai mật khẩu bị từ chối, vẫn ở màn đăng nhập', await waitText('#loginErr', /mật khẩu|Sai/i) && await visible('#login'));
  await page.$eval('#roomPassword', (e) => { e.value = ''; });
  await page.type('#roomPassword', PASS);
  await page.click('#loginBtn');
  check('Đúng mật khẩu: vào ứng dụng, hiện tên phòng', await page.waitForSelector('#app:not(.hidden)', { timeout: 8000 }).then(() => true).catch(() => false) && /Nhà Thờ E2E/.test(await $text('#roomName')));

  // 2. Thư viện đồng bộ từ desktop
  check('Thư viện tải đủ 3 bài từ desktop', await waitText('#libInfo', /3 bài/), await $text('#libInfo'));

  // 2b. ĐỒNG BỘ DESKTOP -> WEB: tạo bài mới + sửa bài ở "desktop", web phải thấy (nút Làm mới ~ chu kỳ 60s)
  LIB.push({ id: 1790000000001, title: 'Bài Vừa Tạo Ở Desktop', lyrics: 'Mới tinh\n\nSlide hai', style: {}, bg: null });
  LIB[1].title = 'Ơn Chúa Tuyệt Vời (đã sửa)'; LIB[1].lyrics = 'Lời đã được sửa ở desktop';
  op.syncLibraryToCloud(); // đúng hàm main.js gọi sau save-song
  // Chờ cloud thật sự nhận bản mới (trên production mỗi lượt đẩy mất vài trăm ms tới ~1s) rồi mới bấm Làm mới
  for (let i = 0; i < 60; i++) { const j = await (await fetch(BASE + '/library?roomId=' + ROOM)).json(); if (j.songs.length === 4) break; await sleep(250); }
  await page.click('#libRefresh');
  check('Desktop tạo bài mới -> web thấy (4 bài)', await waitText('#libInfo', /4 bài/, 8000), await $text('#libInfo'));
  await page.$eval('#slSearch', (e) => { e.value = ''; });
  await page.type('#slSearch', 'vua tao');
  await sleep(300);
  check('Tìm thấy bài vừa tạo ở desktop', (await page.$$eval('#slResults .res b', (n) => n.map((x) => x.textContent))).includes('Bài Vừa Tạo Ở Desktop'));
  await page.$eval('#slSearch', (e) => { e.value = ''; });
  await page.type('#slSearch', 'da duoc sua');
  await sleep(300);
  check('Desktop sửa lời bài cũ -> web tìm được theo lời mới', (await page.$$eval('#slResults .res b', (n) => n.map((x) => x.textContent))).includes('Ơn Chúa Tuyệt Vời (đã sửa)'));
  await page.$eval('#slSearch', (e) => { e.value = ''; });

  // 3. Tìm không dấu + thêm + gửi setlist
  await page.type('#slSearch', 'chua');
  await sleep(300);
  const hits = await page.$$eval('#slResults .res b', (n) => n.map((x) => x.textContent));
  check('Tìm “chua” (không dấu) ra “Chúa Là Ánh Sáng” và “Ơn Chúa Tuyệt Vời”', hits.includes('Chúa Là Ánh Sáng') && hits.some((h) => h.startsWith('Ơn Chúa Tuyệt Vời')), hits.join(' | '));
  await page.$$eval('#slResults .res', (rows) => rows[0].querySelector('.btn.ok').click());
  await page.type('#slName', 'Chúa nhật 05/10');
  await page.click('#slSend');
  check('Gửi setlist: báo thành công', await waitText('#slStatus', /Đã gửi/));
  await sleep(1200);
  check('Operator nhận setlist đúng tên + 1 bài + id chuỗi khớp thư viện', gotSetlists.length === 1 && gotSetlists[0].name === 'Chúa nhật 05/10' && gotSetlists[0].items.length === 1 && String(gotSetlists[0].items[0].id) === '1778231805071', JSON.stringify(gotSetlists[0] && gotSetlists[0].items));

  // 4. Preview bài trong thư viện (dùng style của bài)
  await page.$eval('#slSearch', (e) => { e.value = ''; });
  await page.type('#slSearch', 'anh sang');
  await sleep(300);
  await page.$$eval('#slResults .res', (rows) => rows[0].querySelector('.btn:not(.ok)').click());
  await page.waitForSelector('#pv:not(.hidden)');
  await sleep(400);
  check('Preview mở: slide 1 hiện đúng lời, nhãn “Đoạn 1 · 1 / 2”', (await $text('#pvText')).includes('Chúa là ánh sáng đời con') && /Đoạn 1 · 1 \/ 2/.test(await $text('#pvLabel')), await $text('#pvLabel'));
  const st = await page.$eval('#pvText', (e) => { const c = getComputedStyle(e); return { fs: c.fontSize, color: c.color, ff: c.fontFamily }; });
  check('Preview dùng style của bài (60px, vàng)', st.fs === '60px' && st.color === 'rgb(255, 255, 0)', JSON.stringify(st));
  await page.click('#pvNext');
  check('Slide 2: bỏ [Am] chord, nhãn Điệp khúc', (await $text('#pvText')).trim() === 'Hallelujah ngợi khen' && /Điệp khúc/.test(await $text('#pvLabel')), JSON.stringify(await $text('#pvText')));
  const box = await page.$eval('#pvStage', (e) => { const r = e.getBoundingClientRect(); return r.width / r.height; });
  check('Khung preview đúng tỉ lệ 16:9', Math.abs(box - 16 / 9) < 0.02, String(box));
  // Nền: lưới có 2 ảnh + "Nền đen"; bài này có bg='sunset.jpg' nên tự chọn sẵn đúng ảnh đó
  const grid = await page.$$eval('#bgGrid .bg-item', (n) => n.map((b) => ({ name: b.title || b.textContent, sel: b.classList.contains('sel') })));
  check('Lưới nền hiện 2 ảnh từ desktop + “Nền đen”', grid.length === 3 && grid.some((g) => g.name === 'sunset.jpg') && grid.some((g) => g.name === 'forest.jpg'), JSON.stringify(grid.map((g) => g.name)));
  check('Bài có nền riêng (sunset.jpg) được chọn sẵn', grid.find((g) => g.sel) && grid.find((g) => g.sel).name === 'sunset.jpg', JSON.stringify(grid.find((g) => g.sel)));
  await page.waitForFunction(() => { const i = document.getElementById('pvBg'); return i && !i.classList.contains('hidden') && i.naturalWidth > 0; }, { timeout: 8000 }).catch(() => {});
  const bgOk = await page.$eval('#pvBg', (i) => !i.classList.contains('hidden') && i.naturalWidth > 0);
  check('Ảnh nền thật tải về và hiển thị sau lớp chữ (naturalWidth > 0)', bgOk);
  await page.screenshot({ path: path.join(SHOTS, 'preview-library-bg.png') });
  await page.$$eval('#bgGrid .bg-item', (n) => n.find((b) => b.title === 'forest.jpg').click());
  await sleep(500);
  const sel2 = await page.$$eval('#bgGrid .bg-item.sel', (n) => n.map((b) => b.title));
  check('Chọn nền khác: lưới đánh dấu đúng ảnh forest.jpg', sel2.length === 1 && sel2[0] === 'forest.jpg', JSON.stringify(sel2));
  await page.screenshot({ path: path.join(SHOTS, 'preview-library-bg2.png') });
  await page.$$eval('#bgGrid .bg-item', (n) => n[0].click()); // “Nền đen”
  await sleep(200);
  check('Chọn “Nền đen”: ảnh nền ẩn', await page.$eval('#pvBg', (i) => i.classList.contains('hidden')));
  await page.keyboard.press('Escape');
  check('Esc đóng preview', !(await visible('#pv')));

  // 5. Tạo bài mới: gõ thật bằng bàn phím, Enter đôi = ngắt slide
  await page.click('.tab[data-tab="newsong"]');
  await page.type('#nsTitle', 'Bài Từ Web');
  await page.click('#nsLyrics');
  await page.keyboard.type('Đoạn 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Dòng lời một');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Dòng lời hai');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.type('Điệp khúc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Lời điệp khúc rất là dài '.repeat(8));
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); // 3 Enter vẫn = 1 ngắt
  await page.keyboard.type('Kết');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Amen');
  await sleep(400);
  check('Enter đôi tách đúng 3 slide (3 Enter liền vẫn là 1 ngắt)', /3 slide/.test(await $text('#nsSlideCount')), await $text('#nsSlideCount'));
  const cards = await page.$$eval('#nsSlides .slide-card', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('Danh sách slide hiện nhãn + nội dung', cards.length === 3 && /Đoạn 1/.test(cards[0]) && /Điệp khúc/.test(cards[1]) && /Kết/.test(cards[2]), cards.map((c) => c.slice(0, 30)).join(' | '));
  await page.click('#nsPreview');
  await page.waitForSelector('#pv:not(.hidden)');
  await sleep(400);
  const fit = await page.$eval('#pvBox', (e) => ({ h: e.scrollHeight }));
  check('Preview bài mới mở được, chữ vừa khung (≤454px)', fit.h <= 454, JSON.stringify(fit));
  await page.click('#pvNext'); await sleep(200);
  const fs2 = await page.$eval('#pvText', (e) => parseFloat(getComputedStyle(e).fontSize));
  check('Slide điệp khúc dài tự giảm cỡ chữ (< 80px) để vừa khung', fs2 < 80, fs2 + 'px');
  await page.screenshot({ path: path.join(SHOTS, 'preview-newsong-long.png') });
  await page.click('#pvClose');

  // 6. TẠO bài -> lưu ngay vào danh sách chung -> thêm vào setlist -> operator duyệt LÚC NẠP
  await page.click('#nsCreate');
  check('Tạo bài: báo đã lưu vào danh sách (không còn chờ duyệt riêng)', await waitText('#nsStatus', /Đã lưu vào danh sách/));
  check('“Bài tôi đã tạo” hiện ngay, trạng thái duyệt khi nạp setlist', await waitText('#mySongs', /Bài Từ Web/) && /duyệt khi nạp setlist/.test(await $text('#mySongs')));
  check('Ô nhập được dọn sau khi tạo', (await page.$eval('#nsTitle', (e) => e.value)) === '');
  check('Bài vừa tạo hiện ngay trong thư viện tìm kiếm với nhãn “Mới · chờ duyệt”', await (async () => {
    await page.click('.tab[data-tab="setlist"]');
    await page.$eval('#slSearch', (e) => { e.value = ''; });
    await page.type('#slSearch', 'bai tu web');
    await sleep(900);
    return /Mới · chờ duyệt/.test(await page.$eval('#slResults', (e) => e.textContent)) && (await page.$$eval('#slResults .res b', (n) => n.map((x) => x.textContent))).some((t) => /Bài Từ Web/.test(t));
  })());
  await page.$$eval('#slResults .res', (rows) => rows[0].querySelector('.btn.ok').click());
  check('Thêm vào setlist: dòng có nhãn “Mới · duyệt khi nạp”', /duyệt khi nạp/.test(await page.$eval('#slDraft', (e) => e.textContent)));
  await page.$eval('#slName', (e) => { e.value = ''; });
  await page.type('#slName', 'Setlist có bài mới');
  await page.click('#slSend');
  check('Gửi setlist có bài mới thành công', await waitText('#slStatus', /Đã gửi/));
  const sl2 = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 6000) { const x = gotSetlists.find((q) => q.name === 'Setlist có bài mới'); if (x) return x; await sleep(100); } return null; })();
  check('Operator nhận setlist: bài web mang webId, không mang lời', !!sl2 && sl2.items.length === 1 && /^web-/.test(sl2.items[0].webId) && !JSON.stringify(sl2).includes('Lời điệp khúc'), JSON.stringify(sl2 && sl2.items));
  const pend = await op.fetchPendingSongs();
  const webSong = pend.find((x) => x.webId === (sl2 && sl2.items[0].webId));
  check('Lúc nạp, operator kéo được bài chờ duyệt: lời đã chuẩn hoá (3 slide, không dòng trống thừa)', !!webSong && webSong.lyrics.split('\n\n').length === 3 && !/\n\n\n/.test(webSong.lyrics), webSong && JSON.stringify(webSong.lyrics.slice(0, 50)));
  const resp = await op.resolveSong({ webId: webSong.webId, action: 'approve', songId: 1790000000000 });
  check('Operator duyệt', resp.ok === true);
  await page.click('.tab[data-tab="newsong"]');
  check('Web tự đổi sang “Đã vào thư viện máy chiếu” (poll)', await waitText('#mySongs', /Đã vào thư viện máy chiếu/, 20000));
  await page.screenshot({ path: path.join(SHOTS, 'newsong-approved.png') });

  // 7. Đăng xuất + vào lại bằng link phải đòi mật khẩu
  await page.click('#logoutBtn');
  check('Đăng xuất về màn đăng nhập', await visible('#login'));
  await page.goto(`${BASE}/setlist/?room=${ROOM}`, { waitUntil: 'networkidle0' });
  check('Mở lại bằng link: vẫn đòi mật khẩu (không tự vào)', await visible('#login') && !(await visible('#app')));

  // 8. Link cũ /composer chuyển hướng
  await page.goto(`${BASE}/composer?room=${ROOM}`, { waitUntil: 'networkidle0' });
  check('/composer cũ chuyển sang /setlist/ giữ ?room=', new URL(page.url()).pathname === '/setlist/' && new URL(page.url()).searchParams.get('room') === ROOM, page.url());

  check('Không có lỗi console / CSP / request hỏng', problems.length === 0, problems.slice(0, 3).join(' || '));
} catch (e) {
  check('Kịch bản chạy hết không ném lỗi', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  try { await page.screenshot({ path: path.join(SHOTS, 'failure.png') }); } catch (x) {}
}
await browser.close();
op.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\nKẾT QUẢ: ${failed}/${results.length} FAIL` : `\nKẾT QUẢ: ${results.length}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
