// E2E (app Electron thật) — LƯU / MỞ SCHEDULE (.bcsch) có mang theo định dạng giàu (màu theo từ, nền, hoạt ảnh) không?
//   node --test test/schedule-rich.e2e.mjs
// Dùng file .bcsch THẬT trên đĩa (hộp thoại Lưu/Mở được giả lập qua hàng đợi file trong test/_e2e-app.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const RM = createRequire(import.meta.url)('../src/editor/rich-model.js');
const instances = []; const copies = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-sched-'));
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
  if (work.includes('pfc-sched-')) fs.rmSync(work, { recursive: true, force: true });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SONG_ID = 1700000000001;
const style = { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' };
const BODY = 'Chúa chính Ngài là VUA của muôn đời';
const VS = BODY.indexOf('VUA');
const comp = RM.composeSong([{ label: 'Đoạn 1', text: BODY, parts: {
  marks: [{ s: VS, e: VS + 3, color: '#ffff00', bold: true }],
  bgs: [{ s: 0, e: 18, preset: 'brush-a', color: '#7c4dff', opacity: 0.8, z: 0 }],
  anims: [{ s: VS, e: VS + 3, phase: 'in', type: 'zoom' }]
} }]);

test('Lưu/Mở Schedule mang theo định dạng giàu; sửa bài trong Schedule rồi lưu cũng được; file bị sửa bậy bị lọc', async () => {
  const instanceId = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(instanceId);
  const ud = instanceUserDataDir(instanceId); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify([{ id: SONG_ID, type: 'song', title: 'Bài thử', lyrics: comp.lyrics, rich: comp.rich, style, background: null }]));
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  const ev = (x) => app.ev(x);
  const file = path.join(work, 'buoi-nhom.bcsch');
  const runsOf = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)} + ' .rr-run')].map((s) => [s.textContent, getComputedStyle(s).color])`);
  try {
    /* 1. thêm vào Schedule: mục mang theo rich */
    await ev(`(async () => { window.__songs = await window.electronAPI.loadSongs(); return 1; })()`);
    await ev(`addToSchedule(window.__songs.find((x) => x.id === ${SONG_ID}))`);
    assert.deepEqual(await ev(`schedule[0].rich`), comp.rich, 'mục trong Schedule mang rich của bài');
    await ev(`currentScheduleIndex = 0; loadToPreview(schedule[0])`); await sleep(500);
    assert.deepEqual((await runsOf('#preview-lyrics-text')).find((r) => r[0] === 'VUA'), ['VUA', 'rgb(255, 255, 0)'], 'xem trước từ Schedule có định dạng');

    /* 2. Lưu Schedule (Ctrl+S → hộp thoại Lưu) → file .bcsch THẬT chứa rich */
    app.pushSaveDialog(file);
    await ev(`saveSchedule()`); await sleep(600);
    assert.ok(fs.existsSync(file), 'file .bcsch được tạo');
    let saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].rich, comp.rich, 'file .bcsch chứa đủ marks/bgs/anims');
    assert.equal(saved[0].lyrics, comp.lyrics, 'lời trong file là chuỗi thuần như cũ');
    assert.equal(await ev(`isScheduleDirty()`), false, 'sau khi lưu: không còn "chưa lưu"');

    /* 3. đổi CHỈ định dạng (không đổi lời) → Schedule phải được coi là "chưa lưu" */
    await ev(`schedule[0].rich = JSON.parse(JSON.stringify(schedule[0].rich)); schedule[0].rich.slides[0].marks[0].color = '#ff0000'; true`);
    assert.equal(await ev(`isScheduleDirty()`), true, 'chỉ đổi định dạng cũng đánh dấu chưa lưu');
    await ev(`schedule[0].rich.slides[0].marks[0].color = '#ffff00'; true`);
    assert.equal(await ev(`isScheduleDirty()`), false, 'trả lại như cũ thì hết chưa lưu');

    /* 4. SỬA bài ngay trong Schedule (hộp Edit Song) rồi lưu lại: file có màu mới */
    await ev(`openSongEditor('Edit Song', schedule[0])`); await sleep(700);
    await ev(`(() => { const b = seBlocks()[0]; seSyncBlockRich(b); const vs = b._txt.indexOf('VUA'); const p = seCloneParts(b._rich);
      p.marks = RichModel.applyMarkPatch(p.marks, b._txt, vs, vs + 3, { color: '#00ff00' }); seCommitParts(b, p); })()`);
    await ev(`saveSong(true)`); await sleep(900);
    const item = await ev(`({ color: schedule[0].rich.slides[0].marks.find((m) => m.color).color, dirty: isScheduleDirty() })`);
    assert.equal(item.color, '#00ff00', 'mục trong Schedule nhận định dạng mới sau khi Apply/OK');
    assert.equal(item.dirty, true, 'sửa định dạng trong hộp soạn làm Schedule "chưa lưu"');
    await ev(`saveSchedule()`); await sleep(600);   // đã có đường dẫn → ghi đè không hỏi
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved[0].rich.slides[0].marks.find((m) => m.color).color, '#00ff00', 'file .bcsch có màu mới');
    assert.equal(saved[0].rich.slides[0].bgs.length, 1); assert.equal(saved[0].rich.slides[0].anims.length, 1, 'nền + hoạt ảnh cũ vẫn còn');
    const savedRich = JSON.stringify(saved[0].rich);

    /* 5. MỞ lại từ file: rich còn nguyên và hiển thị đúng */
    await ev(`schedule = []; currentScheduleIndex = -1; renderSchedule(); true`);
    app.pushDialog([file]);
    await ev(`openSchedule()`); await sleep(700);
    assert.equal(await ev(`JSON.stringify(schedule[0].rich)`), savedRich, 'mở file: rich y hệt đã lưu');
    await ev(`currentScheduleIndex = 0; loadToPreview(schedule[0])`); await sleep(500);
    assert.deepEqual((await runsOf('#preview-lyrics-text')).find((r) => r[0] === 'VUA'), ['VUA', 'rgb(0, 255, 0)'], 'mở file: xem trước đúng màu mới');
    assert.equal(await ev(`document.querySelectorAll('#preview-output-box .rr-bg-item').length`), 1, 'mở file: có lớp nền');
    assert.equal(await ev(`isScheduleDirty()`), false, 'vừa mở file: không "chưa lưu"');

    /* 6. file .bcsch bị sửa/độc hại: lời đổi → bỏ định dạng của slide đó; giá trị bẩn bị lọc */
    const evil = JSON.parse(fs.readFileSync(file, 'utf8'));
    evil.push({ ...evil[0], scheduleId: 12345, title: 'Lời đã đổi', lyrics: 'Đoạn 1\nLời khác hẳn', rich: evil[0].rich });
    const dirty = JSON.parse(JSON.stringify(evil[0])); dirty.scheduleId = 67890; dirty.title = 'Giá trị bẩn';
    dirty.rich.slides[0].marks[0].color = 'red; background:url(http://x)'; dirty.rich.slides[0].marks.push({ s: 0, e: 4, font: 'A"; }</style><script>alert(1)</script>', bold: true });
    dirty.rich.slides[0].bgs[0].preset = '<svg onload=alert(1)>';
    evil.push(dirty);
    const evilFile = path.join(work, 'bay.bcsch'); fs.writeFileSync(evilFile, JSON.stringify(evil));
    app.pushDialog([evilFile]);
    await ev(`openSchedule()`); await sleep(700);
    const loaded = await ev(`schedule.map((i) => ({ t: i.title, rich: i.rich || null }))`);
    assert.deepEqual(loaded[0].rich && loaded[0].rich.slides[0].marks.length, 1, 'mục hợp lệ giữ định dạng');
    assert.equal(loaded[1].rich, null, 'lời bị đổi so với định dạng → bỏ định dạng (không áp sai chỗ)');
    assert.ok(loaded[2].rich, 'mục có giá trị bẩn vẫn còn phần hợp lệ');
    const d = loaded[2].rich.slides[0];
    assert.equal(d.marks.some((m) => m.color && /red|url|background/.test(m.color)), false, 'màu bẩn bị loại');
    assert.equal(d.marks.some((m) => m.font), false, 'font chứa mã bị loại');
    assert.equal(d.bgs.length, 0, 'kiểu nền lạ bị loại');
    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
  } finally { await app.close(); }
});
