// Chụp ảnh màn hình cho Microsoft Store từ APP THẬT, dùng dữ liệu mẫu tự viết (không bản quyền):
// bài hát mẫu, bản Kinh Thánh mẫu (templates/import/bible.sample.xml), ảnh nền tự sinh bằng thuật toán.
//   node scripts/make-store-screenshots.mjs
// Kết quả: docs/drafts/screenshots/*.png (1920x1080). Không chụp dữ liệu người dùng thật: app chạy trong
// hồ sơ tạm riêng (--instance), xóa sau khi xong. Cửa sổ Live sẽ nháy toàn màn hình vài giây.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from '../test/_e2e-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'drafts', 'screenshots');
const W = 1920, H = 1080;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PNG gradient tự sinh (không cần thư viện ảnh) ───────────────────────────────
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function gradientPng(w, h, c1, c2, c3) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w) * 0.6 + (y / h) * 0.4;
      const a = t < 0.5 ? c1 : c2, b = t < 0.5 ? c2 : c3, u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      // chấm sáng nhẹ để nền không phẳng
      const glow = Math.max(0, 1 - Math.hypot(x - w * 0.72, y - h * 0.3) / (w * 0.5)) * 38;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.min(255, Math.round(a[k] + (b[k] - a[k]) * u + glow));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── Dữ liệu mẫu (nội dung tự viết, chỉ để minh họa) ──────────────────────────────
const BG = [
  ['nen-xanh-duong.png', [10, 28, 74], [24, 78, 150], [60, 130, 200]],
  ['nen-tim.png', [34, 14, 70], [92, 44, 150], [170, 110, 210]],
  ['nen-vang-am.png', [70, 30, 10], [160, 82, 30], [232, 170, 90]]
];
const SONGS = [
  { id: 1801000000001, title: 'Bài hát mẫu 1 - Ngợi khen', bg: 0, lyrics: 'Ngợi khen Chúa mỗi sớm mai\nLòng con dâng lời ca hát\n\nTôn vinh danh Ngài cao cả\nCả đất trời cùng vang lên\n\nNgợi khen Chúa mỗi sớm mai\nBình an ngập tràn trong con' },
  { id: 1801000000002, title: 'Bài hát mẫu 2 - Bình an', bg: 1, lyrics: 'Bình an như dòng sông êm\nChảy qua mọi nỗi âu lo\n\nCon đứng yên trong vòng tay Chúa\nHy vọng bừng lên mỗi ngày' },
  { id: 1801000000003, title: 'Bài hát mẫu 3 - Cảm tạ', bg: 2, lyrics: 'Cảm tạ Chúa vì ngày hôm nay\nVì hơi thở và lời hứa thành tín\n\nCảm tạ Chúa vì gia đình, bạn hữu\nCon xin đáp lại bằng cả cuộc đời' }
];

fs.mkdirSync(OUT, { recursive: true });
for (const old of fs.readdirSync(OUT)) if (/^\d\d-.*\.png$/.test(old)) fs.unlinkSync(path.join(OUT, old));
const instanceId = 'e2e-shots' + Math.random().toString(36).slice(2, 6);
const ud = instanceUserDataDir(instanceId);
fs.mkdirSync(path.join(ud, 'media'), { recursive: true });
fs.mkdirSync(path.join(ud, 'bible-versions'), { recursive: true });
for (const [name, a, b, c] of BG) fs.writeFileSync(path.join(ud, 'media', name), gradientPng(W, H, a, b, c));
fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS.map((s) => ({
  id: s.id, type: 'song', title: s.title, lyrics: s.lyrics,
  style: { fontFamily: 'CMG Sans', fontSize: '80px', color: '#ffffff', textAlign: 'center' },
  background: { mediaName: BG[s.bg][0], mediaType: 'image' }
}))));
fs.copyFileSync(path.join(ROOT, 'templates', 'import', 'bible.sample.xml'), path.join(ud, 'bible-versions', 'Ban_Dich_Mau.xml'));

const copy = makeAppCopy();
const app = await launchApp({ appDir: copy.dir, instanceId });
const shots = [];
const shoot = async (target, name) => { const f = path.join(OUT, name); await target.screenshot(f); shots.push(f); console.log('  chụp', name); };
// Ẩn (không xóa) thông báo "đã tự động đồng bộ" của máy chụp: chỉ leo lên các phần tử NHỎ (<120px cao)
// quanh dòng chữ, tuyệt đối không động tới body/html.
const dismissToast = () => app.ev(`(function(){
  var n = document.evaluate("//*[contains(text(),'Đã tự động đồng bộ')]", document, null, 9, null).singleNodeValue;
  if (!n) return 'không có thông báo';
  var e = n;
  while (e.parentElement && e.parentElement !== document.body && e.parentElement.getBoundingClientRect().height < 120) e = e.parentElement;
  if (e === document.body || e === document.documentElement || e.getBoundingClientRect().height >= 200) return 'bỏ qua: phần tử quá lớn';
  e.style.visibility = 'hidden';
  return 'đã ẩn ' + e.tagName + ' cao ' + Math.round(e.getBoundingClientRect().height) + 'px';
})()`);
const viewport = (t) => t.raw('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
let live = null;
try {
  await viewport(app);
  await app.ev('window.alert = function () {}; true');
  // Chỉ giữ 3 bài mẫu trong thư viện để cảnh chụp sạch (bỏ các bài tự đồng bộ từ máy này)
  await app.ev('songLibrary = songLibrary.filter(s => /Bài hát mẫu/.test(s.title)); renderLibrary(); true');
  await app.ev(`(function(){ var base = Date.now(); songLibrary.forEach(function(s, i){ addToSchedule(Object.assign({}, s, { id: base + i })); }); return schedule.length; })()`);
  await sleep(800);
  // Hình nền trong app được gán cho TỪNG mục lịch trình: chọn mục rồi chọn ảnh trong khung Media
  const mediaCount = await app.ev('(async function(){ if (typeof loadMedia === "function") await loadMedia(); return mediaLibrary.length; })()');
  console.log('  media sẵn có:', mediaCount);
  const pick = (i, m) => app.ev('(function(){ currentScheduleIndex = ' + i + '; loadToPreview(schedule[' + i + ']); previewBackground(mediaLibrary[' + m + ']); return true; })()');
  for (let i = 2; i >= 0; i--) { await pick(i, i); await sleep(500); }
  console.log('  toast:', await dismissToast());
  await sleep(600);
  await shoot(app, '01-man-hinh-chinh.png');

  // Kinh Thánh (bản mẫu): thêm một chương vào lịch trình và đưa lên Preview
  await app.ev("switchLibraryTab('bible'); true");
  await sleep(2500);
  console.log('  chương mẫu:', await app.ev(`(function(){ if (typeof bibleLibrary === 'undefined' || !bibleLibrary.length) return 0; selectItemInLibrary(bibleLibrary[0]); addToSchedule(Object.assign({}, bibleLibrary[0], { id: Date.now() + 99 })); var i = schedule.length - 1; currentScheduleIndex = i; loadToPreview(schedule[i]); previewBackground(mediaLibrary[0]); return bibleLibrary.length; })()`));
  await sleep(1500);
  console.log('  toast:', await dismissToast());
  await shoot(app, '02-kinh-thanh.png');

  // Cửa sổ Live (chụp riêng cửa sổ chiếu)
  await app.ev("switchLibraryTab('songs'); true");
  await pick(0, 0);
  await app.ev('toggleLiveWindow()');
  live = await app.attach(/live\.html/);
  await viewport(live);
  await sleep(1500);
  await app.ev('goLiveFromPreview(); true');
  await sleep(2500);
  await shoot(live, '03-man-hinh-live.png');
  await app.ev("executeAction('close-live-window')");
  live.close(); live = null; await sleep(800);

  // Trình chỉnh sửa bài hát. KHÔNG chụp màn hình Cài đặt → Dữ liệu: nó hiện đường dẫn thật chứa tên tài khoản Windows.
  await app.ev('clearLive(); true');
  await app.ev(`(function(){ var s = songLibrary.find(function(x){ return /Ngợi khen/.test(x.title); }); selectItemInLibrary(s); openSongEditor('Chỉnh sửa bài hát', s); return !!s; })()`);
  await sleep(1500);
  await shoot(app, '04-chinh-sua-bai-hat.png');
  console.log('exceptions renderer:', app.exceptions.length);
} finally {
  if (live) live.close();
  await app.close();
  try { copy.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); }
  try { removeInstanceUserData(instanceId); } catch (e) { console.error('cleanup userData:', e.message); }
}
for (const f of shots) console.log(path.relative(ROOT, f), fs.statSync(f).size, 'bytes');
