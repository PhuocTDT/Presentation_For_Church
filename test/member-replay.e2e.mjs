// E2E trình duyệt THẬT: thành viên (điện thoại /m/) vào lại phòng SAU buổi nhóm KHÔNG được nhận lại tin cũ.
// Relay local (wrangler dev) + createRelayClient (operator) + Chrome qua puppeteer-core.
//   PUPPETEER_CORE=<puppeteer-core> RELAY_BASE=http://127.0.0.1:28787 node test/member-replay.e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.RELAY_BASE || 'http://127.0.0.1:28787';
process.env.BAND_RELAY_BASE = BASE;
const req = createRequire(import.meta.url);
const puppeteer = req(process.env.PUPPETEER_CORE || 'puppeteer-core');
const { createRelayClient } = req(path.join(ROOT, 'src/band-comm/relay-client.js'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = 'R' + Math.random().toString(36).slice(2, 7).toUpperCase();
const PASS = 'pw' + ROOM;
const ADMIN = 'adminsecret-' + ROOM + '-0123456789';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : '')); };

const op = createRelayClient({ operatorAuthStore: { load: () => ({ idToken: 'e2e-owner' }) },
  store: { load: () => ({ room: { code: ROOM, name: 'Phòng E2E', password: PASS }, relayAdminSecret: ADMIN }) },
  onEvent() {}, onPresence() {}, getLibraryIndex: () => [] });
await op.start();
const say = async (text) => { op.operatorSend({ to: 'all', text }); await sleep(450); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
// ghi lại mọi toast hiện ra (mỗi tin tới phone hiện 1 toast) + giữ các WebSocket để ép rớt mạng
await page.evaluateOnNewDocument(() => {
  window.__toasts = []; window.__wss = [];
  const RealWS = window.WebSocket;
  window.WebSocket = function (u, p) { const s = p ? new RealWS(u, p) : new RealWS(u); window.__wss.push({ s, u: String(u) }); return s; };
  window.WebSocket.prototype = RealWS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { window.WebSocket[k] = RealWS[k]; });
  document.addEventListener('DOMContentLoaded', () => {
    const t = document.getElementById('toasts'); if (!t) return;
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) window.__toasts.push(n.textContent.trim()); }))).observe(t, { childList: true, subtree: true });
  });
});
const toasts = () => page.evaluate(() => window.__toasts.slice());
const waitFor = (fn, ms = 10000, ...a) => page.waitForFunction(fn, { timeout: ms }, ...a).then(() => true).catch(() => false);
const count = (arr, s) => arr.filter((x) => x.includes(s)).length;
const joinViaForm = async () => {
  await page.type('#name', 'Hoa Phone'); await page.type('#roomPassword', PASS); await page.click('#joinBtn');
  return waitFor(() => !document.getElementById('main').classList.contains('hidden'));
};

try {
  // Tin có sẵn trong phòng TRƯỚC khi người này tới (lịch sử của buổi nhóm trước đó)
  await say('CU-1 trước khi tới'); await say('CU-2 trước khi tới');

  // ---------- 1) vào phòng lần đầu ----------
  await page.goto(`${BASE}/m/?room=${ROOM}`, { waitUntil: 'networkidle0' });
  check('Vào phòng lần đầu bằng ID + mật khẩu', await joinViaForm());
  await sleep(1500);
  let t = await toasts();
  check('Lần đầu vào: KHÔNG nhận tin có từ trước (CU-1, CU-2)', count(t, 'CU-') === 0, JSON.stringify(t));
  await say('LIVE-1 đang dùng');
  await waitFor(() => window.__toasts.some((x) => x.includes('LIVE-1')), 4000);
  t = await toasts();
  check('Đang ở trong phòng: nhận tin MỚI đúng 1 lần', count(t, 'LIVE-1') === 1, JSON.stringify(t));

  // ---------- 2) rời đi (đóng trang) — buổi nhóm vẫn tiếp tục, gửi nhiều tin phone này KHÔNG nhận được ----------
  await page.goto('about:blank');
  await say('MISS-1 trong buổi nhóm'); await say('MISS-2 trong buổi nhóm'); await say('MISS-3 trong buổi nhóm');

  // ---------- 3a) mở lại trang (phiên đã lưu, không nhập lại) ----------
  await page.goto(`${BASE}/m/`, { waitUntil: 'networkidle0' });
  await waitFor(() => !document.getElementById('main').classList.contains('hidden'), 8000);
  await sleep(2500);
  t = await toasts();
  check('Mở lại trang sau buổi nhóm: KHÔNG nhận lại các tin đã bỏ lỡ (MISS-1..3)', count(t, 'MISS-') === 0, JSON.stringify(t));
  await say('MOI-A sau khi mở lại');
  await waitFor(() => window.__toasts.some((x) => x.includes('MOI-A')), 4000);
  t = await toasts();
  check('…nhưng tin MỚI từ lúc vào vẫn tới đúng 1 lần', count(t, 'MOI-A') === 1 && count(t, 'MISS-') === 0, JSON.stringify(t));

  // ---------- 3b) vào lại bằng link + mật khẩu (người vào sau buổi nhóm) ----------
  await page.goto('about:blank');
  await say('MISS-4 khi đang ngoài phòng'); await say('MISS-5 khi đang ngoài phòng');
  await page.goto(`${BASE}/m/?room=${ROOM}`, { waitUntil: 'networkidle0' });
  check('Vào lại bằng link phòng + mật khẩu', await joinViaForm());
  await sleep(2500);
  t = await toasts();
  check('Vào lại bằng mật khẩu: KHÔNG nhận lại tin đã bỏ lỡ (MISS-4, MISS-5, và cả MISS-1..3)', count(t, 'MISS-') === 0, JSON.stringify(t));
  await say('MOI-B sau khi vào lại');
  await waitFor(() => window.__toasts.some((x) => x.includes('MOI-B')), 4000);
  t = await toasts();
  check('…tin MỚI tới đúng 1 lần', count(t, 'MOI-B') === 1 && count(t, 'MISS-') === 0, JSON.stringify(t));

  // ---------- 4) rớt mạng NGẮN khi đang dùng: vẫn nhận tin gửi trong lúc rớt, không trùng, không đổ tin cũ ----------
  await page.evaluate(() => { const w = window.__wss[window.__wss.length - 1].s; try { w.close(); } catch (e) {} w.dispatchEvent(new Event('close')); });   // mạng đứt: client thấy 'close' ngay (không có close-handshake)
  await say('BLIP-1 gửi lúc phone đang rớt mạng');
  await waitFor(() => window.__toasts.some((x) => x.includes('BLIP-1')), 8000);
  await sleep(1200);
  if (process.env.DEBUG_WS) console.log('  [debug] ws:', JSON.stringify(await page.evaluate(() => window.__wss.map((x) => x.u.replace(/token=[^&]+/, 'token=…') + ' [' + x.s.readyState + ']'))));
  t = await toasts();
  check('Rớt mạng ngắn: tin gửi trong lúc rớt vẫn tới (đúng 1 lần)', count(t, 'BLIP-1') === 1, JSON.stringify(t.slice(-3)));
  check('Rớt mạng ngắn: không đổ lại tin cũ (MISS-*, CU-*, LIVE-1, MOI-A)', count(t, 'MISS-') + count(t, 'CU-') + count(t, 'LIVE-1') + count(t, 'MOI-A') === 0 || count(t, 'MOI-A') === 1, JSON.stringify(t));
  const allOnce = t.every((x, i) => t.indexOf(x) === i);
  check('Không toast nào bị lặp', allOnce, JSON.stringify(t));
  check('Không lỗi JS trên trang', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) {
  check('Kịch bản chạy hết không ném lỗi', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
}
await browser.close();
op.stop();
const failed = results.filter((x) => !x).length;
console.log(failed ? '\nKẾT QUẢ: ' + failed + '/' + results.length + ' FAIL' : '\nKẾT QUẢ: ' + results.length + '/' + results.length + ' PASS');
process.exit(failed ? 1 : 0);
