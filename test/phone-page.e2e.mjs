// E2E trình duyệt THẬT cho trang phone /m/ (Chrome qua puppeteer-core) + relay local + operator thật.
// Phủ 3 việc: (1) nút "Setlist" nhảy sang trang riêng /setlist/ không hỏi mật khẩu lại,
// (2) nút mặc định cho thiết bị ĐÃ có nút tự tạo, (3) sắp xếp thứ tự ảnh hợp âm (thành viên + cả phòng thấy).
//   PUPPETEER_CORE=<puppeteer-core> RELAY_BASE=http://127.0.0.1:28787 node test/phone-page.e2e.mjs
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
const ROOM = 'P' + Math.random().toString(36).slice(2, 7).toUpperCase();
const PASS = 'pw' + ROOM;
const ADMIN = 'adminsecret-' + ROOM + '-0123456789';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : '')); };

const op = createRelayClient({ operatorAuthStore: { load: () => ({ idToken: 'e2e-owner' }) }, store: { load: () => ({ room: { code: ROOM, name: 'Phòng Phone', password: PASS }, relayAdminSecret: ADMIN }) }, onEvent() {}, onPresence() {}, getLibraryIndex: () => [] });
await op.start();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|status of 403/.test(m.text())) problems.push('console: ' + m.text()); });
const visible = (sel) => page.$eval(sel, (e) => !e.classList.contains('hidden') && !e.hidden && e.offsetParent !== null).catch(() => false);
const waitFor = (fn, ms = 10000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args).then(() => true).catch(() => false);
const btnLabels = () => page.$$eval('#buttons .qbtn', (n) => n.map((b) => b.textContent.trim()));

try {
  // Thiết bị "cũ": đã có nút tự tạo trong localStorage TRƯỚC khi vào (mô phỏng điện thoại đang dùng)
  await page.goto(`${BASE}/m/?room=${ROOM}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.setItem('bandcomm.v1', JSON.stringify({
    profileId: 'p-e2e-phone', buttons: [
      { id: 'b-tu-tao-1', label: 'Nút tự tạo của tôi', group: 'Của tôi' },
      { id: 'b-tu-tao-2', label: 'Tăng piano', group: 'Âm lượng' }          // trùng NHÃN với nút mặc định -> không được nhân đôi
    ]
  })));
  await page.goto(`${BASE}/m/?room=${ROOM}`, { waitUntil: 'networkidle0' });
  await page.type('#name', 'Hoa Phone'); await page.type('#roomPassword', PASS); await page.click('#joinBtn');
  check('Vào phòng bằng ID + mật khẩu', await waitFor(() => !document.getElementById('main').classList.contains('hidden')));

  // ---------- (3) Nút mặc định cho thiết bị cũ ----------
  await sleep(600);
  const labels = await btnLabels();
  check('Nút TỰ TẠO của người dùng vẫn còn nguyên', labels.includes('Nút tự tạo của tôi'));
  check('Điện thoại cũ giờ CÓ bộ nút mặc định (Giảm piano, Guitar mất tiếng, Dạo, Ok…)', ['Giảm piano', 'Guitar mất tiếng', 'Dạo', 'Chuyển bài', 'Ok'].every((l) => labels.includes(l)), labels.join(' | '));
  check('Không nhân đôi nút trùng nhãn (“Tăng piano” chỉ 1 nút)', labels.filter((l) => l === 'Tăng piano').length === 1);
  check('Đủ bộ mặc định thì không còn nút “Nút mặc định”', !labels.includes('Nút mặc định'));
  await page.screenshot({ path: path.join(SHOTS, 'phone-default-buttons.png') });

  // Xoá 1 nút mặc định -> reload: KHÔNG tự thêm lại (tôn trọng ý người dùng); có nút “Nút mặc định” để khôi phục
  await page.$eval('#editModeBtn', (b) => b.click());
  await page.$$eval('#buttons .qbtn', (n) => n.find((b) => b.textContent.trim() === 'Dạo').click());
  await page.waitForSelector('#editor:not(.hidden)');
  await page.click('#edDelete');
  await sleep(500);
  check('Xoá nút mặc định “Dạo” được', !(await btnLabels()).includes('Dạo'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bandcomm.v1')));
  check('Nhớ nút mặc định đã xoá (deletedDefaults)', (saved.deletedDefaults || []).includes('b-def-intro'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#main:not(.hidden)', { timeout: 10000 });
  await sleep(500);
  const after = await btnLabels();
  check('Mở lại: KHÔNG tự thêm lại nút “Dạo” đã xoá', !after.includes('Dạo'));
  check('Có nút “Nút mặc định” để khôi phục', after.includes('Nút mặc định'));
  await page.$$eval('#buttons .qbtn', (n) => n.find((b) => b.textContent.trim() === 'Nút mặc định').click());
  await sleep(600);
  const restored = await btnLabels();
  check('Bấm “Nút mặc định”: “Dạo” trở lại, nút tự tạo vẫn còn, không trùng', restored.includes('Dạo') && restored.includes('Nút tự tạo của tôi') && restored.filter((l) => l === 'Tăng piano').length === 1 && !restored.includes('Nút mặc định'));
  const serverProfile = await (async () => {
    const j = await (await fetch(`${BASE}/api/room/${ROOM}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ROOM, password: PASS, name: 'Hoa Phone', profileId: 'p-e2e-phone' }) })).json();
    return j.profile;
  })();
  check('Bộ nút mới được lưu lên server (đổi máy vẫn khôi phục đủ)', !!serverProfile && serverProfile.buttons.some((b) => b.label === 'Dạo') && serverProfile.buttons.some((b) => b.label === 'Nút tự tạo của tôi'));

  // ---------- (1) Nút Setlist -> trang riêng ----------
  check('Trang phone không còn khối setlist nhúng', (await page.$('#setlistBlock')) === null && (await page.$('#slSearch')) === null);
  await sleep(4500); // chờ toast “Đã thêm … nút mặc định” tắt (nó phủ lên header)
  await page.click('#slToggleBtn');
  await page.waitForFunction(() => location.pathname === '/setlist/', { timeout: 15000 });
  check('Bấm “📋 Setlist” nhảy sang trang riêng /setlist/', new URL(page.url()).pathname === '/setlist/', page.url());
  check('Vào thẳng ứng dụng, KHÔNG hỏi lại mật khẩu (dùng lại phiên của /m/)', await waitFor(() => !document.getElementById('app').classList.contains('hidden')) && !(await visible('#login')));
  check('Hiện đúng tên phòng + tên người dùng', /Phòng Phone/.test(await page.$eval('#roomName', (e) => e.textContent)) && /Hoa Phone/.test(await page.$eval('#whoami', (e) => e.textContent)));
  await page.screenshot({ path: path.join(SHOTS, 'phone-to-setlist.png') });
  check('Trang /setlist/ có nút “‹ Quay lại” trỏ về /m/', (await page.$eval('#backBtn', (a) => a.getAttribute('href'))) === '/m/' && /Quay lại/.test(await page.$eval('#backBtn', (a) => a.textContent)));
  await page.click('#backBtn');
  await page.waitForFunction(() => location.pathname === '/m/', { timeout: 15000 });
  check('Bấm Quay lại: về /m/ và vào thẳng phòng (không hỏi mật khẩu)', await waitFor(() => !document.getElementById('main').classList.contains('hidden'), 15000) && !(await visible('#join')));

  // ---------- (2) Sắp xếp ảnh hợp âm ----------
  await page.goto(`${BASE}/m/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main:not(.hidden)', { timeout: 10000 });
  const tok = await page.evaluate(() => JSON.parse(localStorage.getItem('bandcomm.v1')).token);
  // Dựng canvas JPEG thật làm "ảnh hợp âm", tải lên qua API như thành viên
  const mkImg = (c) => page.evaluate((col) => { const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90; const g = cv.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 160, 90); return cv.toDataURL('image/jpeg', 0.8); }, c);
  const names = ['Ảnh-Đỏ', 'Ảnh-Xanh', 'Ảnh-Vàng'];
  for (const [i, col] of ['#d33', '#36c', '#ec3'].entries()) {
    const r = await fetch(`${BASE}/api/room/${ROOM}/gallery/add?token=${encodeURIComponent(tok)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: names[i], ext: '.jpg', dataB64: await mkImg(col) }) });
    if (!r.ok) throw new Error('add image ' + r.status);
  }
  const serverOrder = async () => (await (await fetch(`${BASE}/api/room/${ROOM}/gallery?token=${encodeURIComponent(tok)}`)).json()).images.map((x) => x.name);
  check('Đã có 3 ảnh hợp âm trên phòng', (await serverOrder()).join() === names.join());

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#main:not(.hidden)', { timeout: 10000 });
  await page.click('#chToggleBtn'); await sleep(700);
  check('Có nút “↕ Sắp xếp” khi đủ 2 ảnh trở lên', await visible('#chOrderBtn'));
  await page.click('#chOrderBtn');
  check('Mở bảng sắp xếp, liệt kê đúng thứ tự hiện tại', (await page.$eval('#chOrder', (e) => !e.classList.contains('hidden'))) && (await page.$$eval('#chOrderList .n', (n) => n.map((x) => x.textContent))).join() === names.join());
  // Đưa “Ảnh-Vàng” (cuối) lên đầu: ▲ hai lần
  // (danh sách vẽ lại sau mỗi lần bấm -> luôn tìm lại hàng của “Ảnh-Vàng” rồi bấm ▲)
  await page.evaluate(() => { const rows = [...document.querySelectorAll('#chOrderList .o')]; const i = rows.findIndex((r) => /Vàng/.test(r.textContent)); if (i > 0) rows[i].querySelectorAll('button')[0].click(); });
  await sleep(150);
  await page.evaluate(() => { const rows = [...document.querySelectorAll('#chOrderList .o')]; const i = rows.findIndex((r) => /Vàng/.test(r.textContent)); if (i > 0) rows[i].querySelectorAll('button')[0].click(); });
  await sleep(150);
  const sheetOrder = await page.$$eval('#chOrderList .n', (n) => n.map((x) => x.textContent));
  check('Bấm ▲ trên bảng: “Ảnh-Vàng” lên đầu (chưa lưu)', sheetOrder[0] === 'Ảnh-Vàng', sheetOrder.join());
  check('Chưa bấm Lưu thì server chưa đổi', (await serverOrder()).join() === names.join());
  await page.screenshot({ path: path.join(SHOTS, 'phone-order-sheet.png') });
  await page.click('#chOrderSave');
  check('Bấm “Lưu thứ tự”: server đổi theo, bảng đóng', await waitFor(() => document.getElementById('chOrder').classList.contains('hidden')) && (await serverOrder())[0] === 'Ảnh-Vàng', (await serverOrder()).join());
  const carousel = await page.$$eval('#chTrack img', (n) => n.map((i) => i.alt));
  check('Carousel xem ảnh vẽ lại theo thứ tự mới', carousel.length === 3);
  // Hủy không lưu
  await page.click('#chOrderBtn');
  await page.$$eval('#chOrderList .o', (rows) => rows[0].querySelectorAll('button')[1].click());
  await page.click('#chOrderCancel');
  check('Bấm Hủy: không gửi gì, thứ tự giữ nguyên', (await serverOrder())[0] === 'Ảnh-Vàng');
  // Thành viên KHÁC cũng thấy thứ tự mới (dùng chung cả phòng)
  const j2 = await (await fetch(`${BASE}/api/room/${ROOM}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ROOM, password: PASS, name: 'Người Khác', profileId: 'p-other' }) })).json();
  const m2 = await (await fetch(`${BASE}/api/room/${ROOM}/gallery?token=${encodeURIComponent(j2.token)}`)).json();
  check('Thành viên khác thấy cùng thứ tự mới (dùng chung cả phòng)', m2.images[0].name === 'Ảnh-Vàng');
  // Operator (laptop) sắp xếp -> điện thoại thấy
  const ids = (await op.galleryManifest()).images.map((x) => x.id);
  await op.galleryReorder([...ids].reverse());
  await sleep(800);
  check('Operator (laptop) đổi thứ tự -> phòng thấy theo', (await serverOrder()).join() === ['Ảnh-Xanh', 'Ảnh-Đỏ', 'Ảnh-Vàng'].join(), (await serverOrder()).join());
  check('Không có lỗi JS / console', problems.length === 0, problems.slice(0, 3).join(' || '));
} catch (e) {
  check('Kịch bản chạy hết không ném lỗi', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  try { await page.screenshot({ path: path.join(SHOTS, 'phone-failure.png') }); } catch (x) {}
}
await browser.close();
op.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\nKẾT QUẢ: ${failed}/${results.length} FAIL` : `\nKẾT QUẢ: ${results.length}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
