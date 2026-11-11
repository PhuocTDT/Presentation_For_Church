// Preview = Projector về BỐ CỤC (không chỉ nội dung): với mọi slide của nhiều kiểu bài và cài đặt, khung xem trước trong
// Edit Song, khung Preview, màn giám sát của cửa sổ chính phải cho ĐÚNG cỡ chữ cuối (sau tự co), đúng từng dòng hiển thị
// (chỗ ngắt dòng), đúng vị trí khung/chữ và đúng vị trí các lớp nền như cửa sổ Live thật.
// Hồi quy: (1) hai thuật toán tự co khác nhau (cửa sổ chính đếm số dòng bằng công thức chiều cao → chữ có cỡ riêng bị co nhỏ
// hơn màn chiếu); (2) khung chữ cửa sổ chính có padding 1.2em/2em và thanh kéo chiếm 20px trong khung → chữ thấp hơn màn chiếu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const require = createRequire(import.meta.url);
const RM = require('../src/editor/rich-model.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_STYLE = { fontFamily: 'Calibri', fontSize: '80px', color: '#ffffff', textAlign: 'center', fontWeight: 'bold', fontStyle: 'normal', textDecoration: 'none', textStrokeWidth: 5, textStrokeColor: '#000000', autoFitText: true };
// Slide thật người dùng báo lệch: 4 font + cỡ riêng to hơn cỡ gốc + 2 lớp vệt sơn
const S_USER = 'Trời đất sẽ phải tiêu tan\nnhưng CHÚA vẫn mãi y nguyên\nđến muôn thu không đổi thay\nđến muôn thu không dời lay';
const USER_PARTS = {
  marks: [
    { s: 0, e: 32, size: 80, font: 'Segoe UI', stroke: { w: 9, color: '#000000' } }, { s: 32, e: 37, color: '#ffff00', italic: true, size: 88, font: 'Comic Sans MS', stroke: { w: 15, color: '#000000' } },
    { s: 37, e: 53, size: 80, font: 'Segoe UI', stroke: { w: 9, color: '#000000' } }, { s: 53, e: 67, italic: true, size: 72, font: 'CMG Sans' },
    { s: 67, e: 81, color: '#39ff14', italic: true, size: 88, font: 'Cambria', stroke: { w: 8, color: '#000000' } }, { s: 81, e: 95, italic: true, size: 72, font: 'CMG Sans' },
    { s: 95, e: 108, color: '#39ff14', italic: true, size: 88, font: 'Cambria', stroke: { w: 8, color: '#000000' } }
  ],
  bgs: [{ s: 0, e: 53, preset: 'brush-b', color: '#e0463c', padding: -8, scale: 0.8 }, { s: 53, e: 108, preset: 'brush-b', color: '#1f78ff', padding: -12, scale: 0.81 }],
  anims: []
};
const S_WRAP = 'Một dòng rất dài sẽ phải tự xuống hàng khi chiếu lên màn hình lớn của hội thánh\nDòng hai ngắn';
const S_MANY = 'Một\nHai\nBa\nBốn\nNăm\nSáu\nBảy';
const S_MIX = 'Ha-lê-lu-gia\nChúa là Vua của muôn vua';
const MIX_PARTS = { marks: [{ s: 0, e: 12, size: 120, color: '#ffd700', font: 'Georgia' }], bgs: [{ s: 13, e: 37, preset: 'brush-a', color: '#7c4dff' }], anims: [] };

function song(id, title, slides, style, partsBySlide) {
  const lyrics = slides.join('\n\n');
  const rich = partsBySlide ? { v: 1, slides: slides.map((b, i) => (partsBySlide[i] ? Object.assign({ h: RM.hashText(b) }, partsBySlide[i]) : null)) } : undefined;
  if (rich) assert.ok(RM.sanitizeRich(rich, lyrics), 'fixture rich hợp lệ: ' + title);
  return Object.assign({ id, type: 'song', title, lyrics, style: Object.assign({}, BASE_STYLE, style), background: null }, rich ? { rich } : {});
}
const SONGS = [
  song(1700000000101, 'Bài thật (4 font)', [S_USER, S_MIX], { verticalAlign: 'top', textBox: { left: 45.8, width: 864, top: 32 } }, [USER_PARTS, MIX_PARTS]),
  song(1700000000102, 'Dòng dài + nhiều dòng (giữa)', [S_WRAP, S_MANY, S_MIX], { verticalAlign: 'middle' }, [null, null, MIX_PARTS]),
  song(1700000000103, 'Căn dưới, chữ nhỏ', [S_WRAP, S_USER], { verticalAlign: 'bottom', fontSize: '64px', fontFamily: 'CMG Sans' }, [null, USER_PARTS])
];

// đo bố cục trong MỘT khung (đơn vị layout của khung ảo 960x540 — không phụ thuộc tỉ lệ thu phóng)
const MEASURE = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const tb = el.parentElement;
  const lines = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; const r = document.createRange(); const s = el.getBoundingClientRect(); const k0 = el.offsetHeight / (s.height || 1);
  while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) { if (n.nodeValue[i] === '\\n') continue; r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getClientRects()[0]; if (!b) continue; const y = (b.top + b.bottom) / 2; let L = lines.find((x) => Math.abs(x.y - y) < 12 / k0); if (!L) { L = { y, t: '' }; lines.push(L); } L.t += n.nodeValue[i]; }
  lines.sort((a, b) => a.y - b.y);
  const bgs = [...tb.querySelectorAll('.rr-bg-item')].map((b) => [b.dataset.preset, b.style.left, b.style.top, b.style.width, b.style.height]);
  return { fs: el.style.fontSize, lines: lines.map((l) => l.t.trim()), tb: [tb.style.left, tb.style.top, tb.style.bottom, tb.style.width, tb.style.transform, tb.offsetHeight], el: [el.offsetTop, el.offsetHeight, el.offsetWidth], stroke: el.style.webkitTextStroke, bgs };
})()`;

test('Preview = Projector: cùng cỡ chữ, cùng chỗ ngắt dòng, cùng vị trí chữ và nền ở mọi slide (Edit Song / Preview / màn giám sát / Live)', { timeout: 300000 }, async () => {
  const id = 'e2e-' + Math.random().toString(36).slice(2, 8);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  const copy = makeAppCopy();
  const app = await launchApp({ appDir: copy.dir, instanceId: id });
  try {
    await app.ev(`(async () => { window.__s = await window.electronAPI.loadSongs(); return 1; })()`);
    await app.ev(`(async () => { for (const s of window.__s) addToSchedule(s); await window.electronAPI.openLiveWindow({ x: 0, y: 0, width: 960, height: 540 }); })()`);
    await sleep(1500);
    const live = await app.attach(/live\.html/, 20000);
    const diffs = [];
    let compared = 0;
    for (const nextVerse of [false, true]) {
      await app.ev(`globalSettings.showNextVerse = ${nextVerse}; true`);
      for (let si = 0; si < SONGS.length; si++) {
        const nSlides = SONGS[si].lyrics.split('\n\n').length;
        for (let k = 0; k < nSlides; k++) {
          // Live + màn giám sát
          await app.ev(`(() => { currentScheduleIndex = ${si}; loadToPreview(schedule[${si}]); currentLiveScheduleIndex = ${si}; goLiveFromSlide(${k}); })()`);
          await sleep(700);
          const L = await live.ev(MEASURE('#lyrics-text'));
          const M = await app.ev(MEASURE('#media-monitor-lyrics-text'));
          // Preview
          // (goLiveFromSlide tự đẩy Preview sang bài kế tiếp trong lịch → nạp lại đúng bài)
          await app.ev(`(() => { currentScheduleIndex = ${si}; loadToPreview(schedule[${si}]); currentPreviewIndex = ${k}; updatePreviewOutput(currentSlides[${k}].content); })()`); await sleep(150);
          const P = await app.ev(MEASURE('#preview-lyrics-text'));
          // Edit Song
          await app.ev(`(() => { openSongEditor('Edit Song', window.__s[${si}]); })()`); await sleep(500);
          await app.ev(`(() => { const b = seBlocks()[${k}]; seRenderPreview(b); })()`); await sleep(250);
          const E = await app.ev(MEASURE('#editor-preview-text'));
          await app.ev(`closeSongEditor()`); await sleep(200);
          const tag = SONGS[si].title + ' / slide ' + (k + 1) + ' / next verse ' + (nextVerse ? 'bật' : 'tắt');
          assert.ok(L && L.lines.length, tag + ': Live có chữ');
          // không slide nào bị co về cỡ nhỏ nhất (từng xảy ra: căn dưới + next verse bật → 10px ở cả hai cửa sổ)
          assert.ok(parseFloat(L.fs) >= 30, tag + ': cỡ chữ không bị co về tối thiểu (' + L.fs + ')');
          for (const [name, X] of [['Edit Song', E], ['Preview', P], ['màn giám sát', M]]) {
            compared++;
            // vị trí lớp nền: làm tròn 0.5px (khung thu nhỏ đo Range.getClientRects ở tỉ lệ khác → lệch phần chục pixel, mắt không thấy)
            const pick = (o) => ({ fs: o.fs, lines: o.lines, tb: o.tb, el: o.el, stroke: o.stroke, bgs: o.bgs.map((b) => b[0]) });
            const near = (a, b) => a.bgs.length === b.bgs.length && a.bgs.every((x, i) => x[0] === b.bgs[i][0] && x.slice(1).every((v, j) => Math.abs(parseFloat(v) - parseFloat(b.bgs[i][j + 1])) <= 0.6));
            try { assert.deepEqual(pick(X), pick(L)); assert.ok(near(X, L), 'vị trí lớp nền lệch quá 0.6px'); } catch (e) { diffs.push(tag + ' — ' + name + ' khác Live:\n  ' + JSON.stringify(pick(X)) + '\n  Live: ' + JSON.stringify(pick(L))); }
          }
        }
      }
    }
    assert.ok(compared >= 40, 'đủ số lần so: ' + compared);
    assert.deepEqual(diffs, [], diffs.join('\n'));
    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
    live.close();
  } finally {
    await app.close();
    try { copy.cleanup(); } catch (e) { /* bỏ qua */ }
    try { removeInstanceUserData(id); } catch (e) { /* bỏ qua */ }
  }
});
