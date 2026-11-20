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
      return out;
    })()`);
    assert.equal(r.evilHost, false); assert.equal(r.userinfo, false); assert.equal(r.script, false); assert.equal(r.notString, false);
    assert.equal(r.noLive, false); assert.equal(r.badAction, false); assert.equal(r.badId, false); assert.equal(r.badId2, false); assert.equal(r.nullMsg, false);
    assert.equal(r.kept, 1, 'chỉ mục có ID hợp lệ được giữ');
    assert.equal(r.item.ytId, ID); assert.equal(r.item.isMediaOnly, true); assert.equal(r.item.title.length, 200);
    assert.equal(r.item.lyrics, ''); assert.equal(r.item.background, null);
    assert.deepEqual(Object.keys(r.item).sort(), ['background', 'id', 'isMediaOnly', 'lyrics', 'scheduleId', 'title', 'type', 'ytId'], 'không giữ trường lạ');
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});

test('CSP: cửa sổ điều khiển KHÔNG có iframe từ xa; Live chỉ cho phép đúng youtube-nocookie', async () => {
  const app = await open();
  try {
    const csp = await app.ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
    assert.match(csp, /frame-src 'none'/, 'index.html giữ frame-src none');
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
