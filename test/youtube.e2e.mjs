// E2E (app Electron thật) — YouTube nhúng trên Screen Live. KHÔNG phụ thuộc mạng: chỉ kiểm tra ranh giới tin cậy
// (ai được gửi gì cho ai), vòng đời iframe và việc tắt video khi chiếu thứ khác. Phát thật có script thử riêng (thủ công).
//   node --test test/youtube.e2e.mjs      (mở cửa sổ Electron, ~1 phút)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});
const ID = 'dQw4w9WgXcQ';
const SONGS = [1].map((n) => ({ id: 1700000000000 + n, type: 'song', title: 'Bài thử ' + n, lyrics: `Dòng ${n} một\nDòng ${n} hai\n\nĐiệp khúc ${n}\nHallelujah`, style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' }, background: null }));

async function open() {
  const id = 'e2e-yt-' + Math.random().toString(36).slice(2, 8); instances.push(id);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId: id });
  await app.raw('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  return app;
}

test('ranh giới tin cậy: link/ID/lệnh xấu bị main từ chối; dữ liệu .bcsch xấu bị làm sạch', async () => {
  const app = await open();
  try {
    const r = await app.ev(`(async () => {
      const out = {};
      out.evilHost = (await window.electronAPI.youtubeResolve('https://evil.com/watch?v=${ID}')).ok;
      out.userinfo = (await window.electronAPI.youtubeResolve('https://youtube.com@evil.com/watch?v=${ID}')).ok;
      out.script = (await window.electronAPI.youtubeResolve('javascript:alert(1)')).ok;
      out.notString = (await window.electronAPI.youtubeResolve({ a: 1 })).ok;
      // Chưa có cửa sổ Live: dù lệnh hợp lệ cũng không có nơi nhận
      out.noLive = await window.electronAPI.liveSendYoutube({ action: 'load', id: '${ID}' });
      out.badAction = await window.electronAPI.liveSendYoutube({ action: 'eval', id: '${ID}' });
      out.badId = await window.electronAPI.liveSendYoutube({ action: 'load', id: '${ID}"onload="x' });
      out.badId2 = await window.electronAPI.liveSendYoutube({ action: 'load', id: '../../evil' });
      out.nullMsg = await window.electronAPI.liveSendYoutube(null);
      // Lọc dữ liệu lịch sinh hoạt không tin cậy
      const list = normalizeScheduleList([
        { type: 'youtube', ytId: 'short', title: 'xấu' },
        { type: 'youtube', ytId: '${ID}"><img src=x onerror=alert(1)>', title: 'xấu 2' },
        { type: 'youtube', ytId: '${ID}', title: 'T'.repeat(500), lyrics: 'không giữ', background: { mediaType: 'video', url: 'http://evil/x.mp4' }, style: { color: 'red' }, onload: 'x', isMediaOnly: false }
      ]);
      out.kept = list.length; out.item = list[0];
      out.modes = normalizeScheduleList([{ type: 'youtube', ytId: '${ID}', ytMode: 'audio' }, { type: 'youtube', ytId: '${ID}', ytMode: '<img>' }, { type: 'youtube', ytId: '${ID}' }]).map(i => i.ytMode);
      out.badMode = await window.electronAPI.liveSendYoutube({ action: 'mode', mode: 'evil' });
      return out;
    })()`);
    assert.equal(r.evilHost, false); assert.equal(r.userinfo, false); assert.equal(r.script, false); assert.equal(r.notString, false);
    assert.equal(r.noLive, false); assert.equal(r.badAction, false); assert.equal(r.badId, false); assert.equal(r.badId2, false); assert.equal(r.nullMsg, false);
    assert.equal(r.kept, 1, 'chỉ mục có ID hợp lệ được giữ');
    assert.equal(r.item.ytId, ID); assert.equal(r.item.isMediaOnly, true); assert.equal(r.item.title.length, 200);
    assert.deepEqual(r.modes, ['audio', 'video', 'video'], 'ytMode chỉ nhận audio|video, còn lại = video');
    assert.equal(r.badMode, false, 'chưa có Live → không nơi nhận');
    assert.equal(r.item.lyrics, ''); assert.equal(r.item.background, null);
    assert.deepEqual(Object.keys(r.item).sort(), ['background', 'id', 'isMediaOnly', 'lyrics', 'scheduleId', 'title', 'type', 'ytId', 'ytMode'], 'không giữ trường lạ');
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});

test('CSP: cả hai cửa sổ chỉ cho phép đúng youtube-nocookie; cửa sổ điều khiển không có iframe nếu chưa xem trước', async () => {
  const app = await open();
  try {
    const csp = await app.ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
    assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com(;|$)/, 'index.html chỉ mở đúng một origin cho iframe');
    assert.doesNotMatch(csp, /script-src[^;]*https:/); assert.doesNotMatch(csp, /connect-src[^;]*https:/);
    assert.equal(await app.ev(`document.querySelectorAll('iframe').length`), 0, 'chưa xem trước thì không có iframe nào');
    const live = fs.readFileSync(new URL('../live.html', import.meta.url), 'utf8');
    const m = live.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(m, /frame-src https:\/\/www\.youtube-nocookie\.com(;|$)/);
    assert.doesNotMatch(m, /script-src[^;]*https:/, 'không mở script từ xa');
    assert.doesNotMatch(m, /connect-src[^;]*https:/, 'không mở kết nối mạng từ renderer');
  } finally { await app.close(); }
});

test('vòng đời: cần Screen Live; Go Live mở iframe đúng origin; chiếu bài hát/Clear/Stop thì tắt video', async () => {
  const app = await open();
  let live = null;
  try {
    await app.ev(`(() => { addToSchedule(songLibrary[0]); schedule.push(normalizeScheduleItem({ type: 'youtube', ytId: '${ID}', title: 'Video thử' })); renderSchedule(); })()`);
    const ytIdx = await app.ev(`schedule.findIndex(s => s.type === 'youtube')`);
    // 1) Chưa mở Screen Live → không chiếu, báo lỗi dễ hiểu
    await app.ev(`selectScheduleItem(${ytIdx})`);
    assert.equal(await app.ev(`document.querySelector('#preview-slides-container').textContent.includes('Video thử')`), true, 'xem trước hiện thẻ tên video');
    await app.ev(`goLiveFromPreview()`);
    await sleep(400);
    assert.equal(await app.ev(`ytLive`), null);
    assert.equal(await app.ev(`!!document.querySelector('.ws-dialog-msg') && document.querySelector('.ws-dialog-msg').textContent.includes('Screen Live')`), true);
    await app.ev(`document.querySelectorAll('.ws-dialog-ov').forEach(e => e.remove())`);
    // 2) Mở Screen Live rồi chiếu
    await app.ev(`toggleLiveWindow()`);
    live = await app.attach(/live\.html/);
    await sleep(1200);
    assert.equal(await live.ev(`!!document.querySelector('#yt-layer iframe')`), false);
    await app.ev(`selectScheduleItem(${ytIdx}); goLiveFromPreview()`);
    await sleep(800);
    const f = await live.ev(`(() => { const f = document.querySelector('#yt-layer iframe'); return f ? { src: f.src, shown: !document.getElementById('yt-layer').classList.contains('hidden') } : null; })()`);
    assert.ok(f, 'iframe được tạo trên Screen Live'); assert.equal(f.shown, true);
    const u = new URL(f.src); assert.equal(u.origin, 'https://www.youtube-nocookie.com'); assert.equal(u.pathname, '/embed/' + ID);
    assert.equal(await app.ev(`!document.getElementById('yt-bar').classList.contains('hidden') && ytLive.id === '${ID}'`), true, 'thanh điều khiển hiện');
    assert.equal(await app.ev(`document.querySelectorAll('#live-slides-container > div').length`), 0, 'không còn thẻ slide cũ để bấm nhầm');
    // 3) Chiếu bài hát → tắt video
    await app.ev(`selectScheduleItem(0); goLiveFromPreview()`);
    await sleep(600);
    assert.equal(await live.ev(`!!document.querySelector('#yt-layer iframe')`), false, 'chiếu bài hát thì tắt video');
    assert.equal(await app.ev(`ytLive`), null); assert.equal(await app.ev(`document.getElementById('yt-bar').classList.contains('hidden')`), true);
    // 4) Clear tắt video
    await app.ev(`selectScheduleItem(${ytIdx}); goLiveFromPreview()`);
    await sleep(600);
    assert.equal(await live.ev(`!!document.querySelector('#yt-layer iframe')`), true);
    await app.ev(`clearLive()`);
    await sleep(500);
    assert.equal(await live.ev(`!!document.querySelector('#yt-layer iframe')`), false, 'Clear tắt video');
    // 5) Nút Stop trên thanh điều khiển; đóng Screen Live thì thanh biến mất
    await app.ev(`selectScheduleItem(${ytIdx}); goLiveFromPreview()`);
    await sleep(600);
    await app.ev(`document.getElementById('yt-stop').click()`);
    await sleep(500);
    assert.equal(await live.ev(`!!document.querySelector('#yt-layer iframe')`), false, 'Stop tắt video');
    await app.ev(`selectScheduleItem(${ytIdx}); goLiveFromPreview()`);
    await sleep(500);
    await app.ev(`toggleLiveWindow()`);   // đóng
    await sleep(800);
    assert.equal(await app.ev(`ytLive`), null); assert.equal(await app.ev(`document.getElementById('yt-bar').classList.contains('hidden')`), true);
    assert.deepEqual(app.exceptions, []);
  } finally { try { live && live.close(); } catch (e) { /* đã đóng */ } await app.close(); }
});

test('xem trước ở Screen Monitor: iframe sandbox, kéo mốc rồi GO LIVE từ Screen Monitor → Live bắt đầu đúng mốc, xem trước tắt', async () => {
  const app = await open();
  let live = null;
  try {
    await app.ev(`(() => { addToSchedule(songLibrary[0]); schedule.push(normalizeScheduleItem({ type: 'youtube', ytId: '${ID}', title: 'Video thử' })); renderSchedule(); })()`);
    const ytIdx = await app.ev(`schedule.findIndex(s => s.type === 'youtube')`);
    const vis = (sel) => app.ev(`(() => { const e = document.querySelector('${sel}'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`);
    // chọn bài hát: không có khung YouTube
    await app.ev(`selectScheduleItem(0)`);
    assert.equal(await vis('#ytp-stage'), false); assert.equal(await vis('#ytp-bar'), false);
    // chọn mục YouTube: hiện khung (poster) + nút GO LIVE, chưa có iframe
    await app.ev(`selectScheduleItem(${ytIdx})`);
    assert.equal(await vis('#ytp-stage'), true); assert.equal(await vis('#ytp-poster'), true); assert.equal(await vis('#ytp-golive'), true);
    assert.equal(await app.ev(`document.querySelectorAll('iframe').length`), 0, 'chọn mục KHÔNG tự phát (tránh tự bật tiếng khi tự nhảy mục kế)');
    // Xem trước: iframe sandbox, tắt tiếng, có nút điều khiển của YouTube
    await app.ev(`document.getElementById('ytp-play').click()`);
    await sleep(500);
    const f = await app.ev(`(() => { const f = document.querySelector('#ytp-frame-wrap iframe'); return f ? { src: f.src, sandbox: f.getAttribute('sandbox') } : null; })()`);
    assert.ok(f, 'có iframe xem trước');
    const u = new URL(f.src); assert.equal(u.origin, 'https://www.youtube-nocookie.com'); assert.equal(u.pathname, '/embed/' + ID);
    assert.equal(u.searchParams.get('controls'), '1'); assert.equal(u.searchParams.get('mute'), '1'); assert.equal(u.searchParams.get('start'), null);
    assert.ok(/allow-scripts/.test(f.sandbox) && !/allow-popups|allow-top-navigation|allow-forms/.test(f.sandbox), 'sandbox chặn popup/điều hướng/form: ' + f.sandbox);
    assert.equal(await vis('#ytp-ctrls'), true); assert.equal(await vis('#ytp-seek'), true);
    // giống Screen Live: khung không nhận chuột + có rèm đen (đen cho tới khi video chạy); nút bàn tay bật chuột tạm thời
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('#ytp-frame-wrap iframe')).pointerEvents`), 'none');
    assert.equal(await app.ev(`document.querySelectorAll('#ytp-curtain').length`), 1);
    await app.ev(`document.getElementById('ytp-click').click()`);
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('#ytp-frame-wrap iframe')).pointerEvents`), 'auto', 'bật cho phép bấm để Bỏ qua quảng cáo');
    await app.ev(`document.getElementById('ytp-click').click()`);
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('#ytp-frame-wrap iframe')).pointerEvents`), 'none');
    await app.ev(`ytPrev.state = 2; renderYtp()`);
    assert.equal(await app.ev(`document.getElementById('ytp-curtain').classList.contains('on')`), true, 'tạm dừng → rèm đen');
    await app.ev(`ytPrev.state = 1; renderYtp()`);
    assert.equal(await app.ev(`document.getElementById('ytp-curtain').classList.contains('on')`), false, 'đang phát → trong suốt');
    // đổi sang mục khác thì xem trước tắt
    await app.ev(`selectScheduleItem(0)`);
    assert.equal(await app.ev(`document.querySelectorAll('iframe').length`), 0, 'đổi mục → gỡ iframe');
    await app.ev(`selectScheduleItem(${ytIdx})`);
    await app.ev(`document.getElementById('ytp-play').click()`);
    await sleep(300);
    // kéo tới mốc 95s (mô phỏng: trình phát báo vị trí qua ytPrev, thanh kéo gọi change)
    const label = await app.ev(`(() => { ytPrev.dur = 300; const s = document.getElementById('ytp-seek'); renderYtp(); s.value = '95'; s.dispatchEvent(new Event('input')); const l = document.getElementById('ytp-golive-label').textContent; s.dispatchEvent(new Event('change')); return l; })()`);
    assert.equal(label, 'GO LIVE · 1:35', 'kéo tới đâu nút GO LIVE hiện mốc tới đó');
    // Chưa mở Screen Live → không chiếu, xem trước GIỮ NGUYÊN (không mất mốc đã kéo)
    await app.ev(`document.getElementById('ytp-golive').click()`);
    await sleep(400);
    assert.equal(await app.ev(`ytLive`), null); assert.equal(await app.ev(`!!document.querySelector('#ytp-frame-wrap iframe')`), true);
    await app.ev(`document.querySelectorAll('.ws-dialog-ov').forEach(e => e.remove())`);
    // Mở Screen Live rồi GO LIVE từ Screen Monitor
    await app.ev(`toggleLiveWindow()`);
    live = await app.attach(/live\.html/);
    await sleep(1200);
    await app.ev(`ytPrev.cur = 95; document.getElementById('ytp-golive').click()`);
    await sleep(800);
    const lf = await live.ev(`(() => { const f = document.querySelector('#yt-layer iframe'); return f ? f.src : null; })()`);
    assert.ok(lf, 'Live có iframe'); const lu = new URL(lf);
    assert.equal(lu.searchParams.get('start'), '95', 'Live bắt đầu đúng mốc đã chọn'); assert.equal(lu.searchParams.get('controls'), '0');
    assert.equal(await app.ev(`document.querySelectorAll('#ytp-frame-wrap iframe').length`), 0, 'GO LIVE tắt xem trước (không 2 luồng âm thanh)');
    assert.equal(await app.ev(`ytLive.cur`), 95);
    // Viền nhận diện: Live đè lên màn hình điều khiển (1 màn hình) → có viền; có màn hình riêng thì main tự tắt
    const extended = await app.ev(`!!(window.screen && window.screen.isExtended)`);
    if (!extended) {
      await sleep(900);
      assert.equal(await live.ev(`document.documentElement.classList.contains('frame-hint')`), true, '1 màn hình → Live có viền trắng');
      assert.equal(await live.ev(`getComputedStyle(document.body, '::after').borderTopWidth`), '4px');
    }
    assert.deepEqual(app.exceptions, []);
  } finally { try { live && live.close(); } catch (e) { /* đã đóng */ } await app.close(); }
});

test('chế độ "chỉ phát nhạc" vs "phát video": Live trong suốt khi chỉ nhạc, giữ nền, lưu theo mục, đổi nóng khi đang chiếu', async () => {
  const app = await open();
  let live = null;
  try {
    await app.ev(`(() => { addToSchedule(songLibrary[0]); schedule.push(normalizeScheduleItem({ type: 'youtube', ytId: '${ID}', title: 'Video thử' })); renderSchedule(); })()`);
    const ytIdx = await app.ev(`schedule.findIndex(s => s.type === 'youtube')`);
    await app.ev(`toggleLiveWindow()`);
    live = await app.attach(/live\.html/);
    await sleep(1200);
    // mặc định = video
    await app.ev(`selectScheduleItem(${ytIdx})`);
    assert.equal(await app.ev(`document.getElementById('ytp-mode-video').classList.contains('on')`), true);
    // chiếu chữ trước (để kiểm tra chữ cũ được dọn khi chỉ phát nhạc)
    await app.ev(`selectScheduleItem(0); goLiveFromPreview()`);
    await sleep(500);
    // chọn "Chỉ phát nhạc" ở Screen Monitor → lưu vào mục
    await app.ev(`selectScheduleItem(${ytIdx}); document.getElementById('ytp-mode-audio').click()`);
    assert.equal(await app.ev(`schedule[${ytIdx}].ytMode`), 'audio'); assert.equal(await app.ev(`document.getElementById('ytp-mode-audio').classList.contains('on')`), true);
    await app.ev(`document.getElementById('ytp-golive').click()`);
    await sleep(800);
    assert.equal(await live.ev(`document.getElementById('yt-layer').classList.contains('audio-only')`), true, 'chỉ nhạc → lớp video trong suốt');
    assert.equal(await live.ev(`getComputedStyle(document.getElementById('yt-layer')).opacity`), '0');
    assert.ok(await live.ev(`!!document.querySelector('#yt-layer iframe')`), 'trình phát vẫn chạy (để có tiếng)');
    assert.equal(await live.ev(`document.getElementById('lyrics-text').textContent.trim()`), '', 'chữ cũ được dọn');
    // đổi nóng sang video bằng nút ở thanh Live
    await app.ev(`document.getElementById('yt-mode').click()`);
    await sleep(400);
    assert.equal(await live.ev(`document.getElementById('yt-layer').classList.contains('audio-only')`), false);
    assert.equal(await app.ev(`schedule[${ytIdx}].ytMode`), 'video'); assert.equal(await app.ev(`ytLive.mode`), 'video');
    // đổi nóng lại sang nhạc từ Screen Monitor khi đang chiếu
    await app.ev(`document.getElementById('ytp-mode-audio').click()`);
    await sleep(400);
    assert.equal(await live.ev(`document.getElementById('yt-layer').classList.contains('audio-only')`), true);
    assert.deepEqual(app.exceptions, []);
  } finally { try { live && live.close(); } catch (e) { /* đã đóng */ } await app.close(); }
});
