// E2E (app Electron thật) — trình soạn bài giàu định dạng: định dạng theo từng từ ("VUA" khác màu), nền brush/marker, hoạt ảnh,
// lưu/mở lại/đổi slide, gõ chữ không làm lệch định dạng, Undo/Redo, Preview = Projector (cửa sổ Live thật), bài cũ và Kinh Thánh.
//   node --test test/rich-editor.e2e.mjs      (mở cửa sổ Electron, ~1 phút)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SONG_ID = 1700000000001, OLD_ID = 1700000000002, CHORD_ID = 1700000000003, BIBLE_ID = 1700000000004;
const LYRICS = 'Đoạn 1\nChúa chính Ngài là VUA của muôn đời\nDòng hai\n\nĐiệp khúc\nHallelujah';
const BODY0 = 'Chúa chính Ngài là VUA của muôn đời\nDòng hai';
const VS = BODY0.indexOf('VUA');
const style = { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' };

test('trình soạn giàu định dạng: từ-theo-từ, nền, hoạt ảnh, lưu/mở, gõ chữ, Undo/Redo, Preview = Projector', async () => {
  const instanceId = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(instanceId);
  const ud = instanceUserDataDir(instanceId); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify([
    { id: SONG_ID, type: 'song', title: 'Bài thử', lyrics: LYRICS, style, background: null },
    { id: OLD_ID, type: 'song', title: 'Bài cũ', lyrics: 'Đoạn 1\nBài cũ dòng 1\nDòng 2\n\nĐiệp khúc\nHa-lê-lu-gia', style, background: null },
    { id: CHORD_ID, type: 'song', title: 'Bài có hợp âm', lyrics: '[Am]Chúa là [G]VUA muôn đời', style, background: null }
  ]));
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  const ev = (x) => app.ev(x);
  const q = (x) => JSON.stringify(x);
  const click = (sel) => ev(`document.querySelector(${q(sel)}).click()`);
  const key = async (k, code, vk, modifiers = 0) => { await app.raw('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await app.raw('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  // Hai lệnh riêng (tải bài, rồi mở): gói cả hai trong MỘT evaluate async đôi khi bị DevTools báo "Promise was collected" (lỗi của cách gọi trong test, không phải của app)
  const open = async (id) => {
    await ev(`(async () => { window.__songs = await window.electronAPI.loadSongs(); return window.__songs.length; })()`);
    await ev(`openSongEditor('Edit Song', window.__songs.find((x) => x.id === ${id}))`);
    await sleep(700);
  };
  const selectText = async (blockIdx, text) => {   // tô chọn một đoạn chữ trong thẻ (như người dùng kéo chuột)
    await ev(`(() => { const cd = document.querySelectorAll('#lyrics-editor-container .lyrics-slide-content')[${blockIdx}]; cd.focus();
      const w = document.createTreeWalker(cd, NodeFilter.SHOW_TEXT); let n, hit;
      while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(${q(text)}); if (i >= 0) { hit = [n, i]; break; } }
      const r = document.createRange(); r.setStart(hit[0], hit[1]); r.setEnd(hit[0], hit[1] + ${text.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cd.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);   // như người dùng kéo chuột rồi nhả
    await sleep(260);
  };
  const runs = (sel = '#editor-preview-text') => ev(`[...document.querySelectorAll(${q(sel)} + ' .rr-run')].map((s) => { const c = getComputedStyle(s); return { t: s.textContent, color: c.color, weight: c.fontWeight, italic: c.fontStyle, deco: c.textDecorationLine, size: parseFloat(c.fontSize), font: c.fontFamily, shadow: c.textShadow, stroke: c.webkitTextStrokeWidth }; })`);
  const VUA = async (sel) => (await runs(sel)).find((r) => r.t === 'VUA');
  const btn = (label) => ev(`(() => { const b = [...document.querySelectorAll('.se-seg-panel button.sp-btn')].find((x) => x.lastElementChild && x.lastElementChild.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error('khong thay nut ' + ${JSON.stringify(label)}); b.click(); })()`);
  const setSel = (sel, value) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const pickStd = async (hex) => { await click('#text-color-btn'); await click(`.cp-std .cp-sw[data-hex="${hex}"]`); await sleep(200); };
  try {
    /* ---------- 1. "VUA" độc lập: chỉ từ đó đổi màu ---------- */
    await open(SONG_ID);
    assert.equal((await runs()).length, 0, 'chưa có định dạng: xem trước là chữ thuần (không có span định dạng)');
    assert.equal(await ev(`document.getElementById('editor-preview-text').textContent`), BODY0);
    await selectText(0, 'VUA');
    assert.equal(await ev(`document.getElementById('se-scope-chip').hidden`), false, 'chip phạm vi hiện khi có vùng chọn');
    assert.match(await ev(`document.getElementById('se-scope-chip').textContent`), /VUA/);
    await pickStd('#ffff00');
    let r = await runs();
    assert.deepEqual(r.map((x) => x.t).join(''), BODY0, 'chữ không đổi, chỉ tách đoạn');
    assert.equal((await VUA()).color, 'rgb(255, 255, 0)', 'VUA màu vàng');
    assert.ok(r.filter((x) => x.t !== 'VUA').every((x) => x.color === 'rgb(255, 255, 255)'), 'các chữ khác giữ màu trắng');
    assert.equal(await ev(`editorStyle.color`), '#ffffff', 'màu chữ CHUNG của bài không đổi');
    assert.deepEqual(await ev(`seBlocks()[0]._rich.marks`), [{ s: VS, e: VS + 3, color: '#ffff00' }]);
    assert.equal(await ev(`getComputedStyle(document.getElementById('color-indicator')).backgroundColor`), 'rgb(255, 255, 0)', 'vạch chỉ thị theo màu vùng chọn');

    /* ---------- 2. đậm/nghiêng/gạch chân, font, cỡ riêng cho "VUA" ---------- */
    await ev(`document.getElementById('tb-bold').click()`); await sleep(150);   // bài mặc định đậm → bấm B = BỎ đậm riêng cho VUA
    assert.equal((await VUA()).weight, '400', 'B với vùng chọn: chỉ VUA hết đậm');
    assert.equal((await runs()).find((x) => x.t !== 'VUA').weight, '700', 'phần còn lại vẫn đậm');
    await ev(`document.getElementById('tb-italic').click()`); await ev(`document.getElementById('tb-underline').click()`); await sleep(150);
    let v = await VUA(); assert.equal(v.italic, 'italic'); assert.match(v.deco, /underline/);
    assert.equal(await ev(`document.getElementById('tb-italic').classList.contains('active')`), true, 'nút I sáng theo vùng chọn');
    await ev(`(() => { const s = document.getElementById('font-family'); s.value = 'Georgia'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(150);
    assert.match((await VUA()).font, /Georgia/);
    assert.doesNotMatch((await runs()).find((x) => x.t !== 'VUA').font, /Georgia/);
    const baseSize = (await runs()).find((x) => x.t !== 'VUA').size;
    await ev(`(() => { const i = document.getElementById('font-size-input'); i.value = '120'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
    v = await VUA(); assert.ok(v.size > baseSize * 1.5, `cỡ riêng của VUA lớn hơn (${v.size} vs ${baseSize})`);
    assert.equal(await ev(`editorStyle.fontSize`), '60px', 'cỡ chữ chung không đổi');

    /* ---------- 3. panel Text: bóng, viền, reset ---------- */
    await ev(`document.querySelector('#lyrics-editor-container .se-eye').click()`); await sleep(200);
    assert.match(await ev(`document.querySelector('#lyrics-editor-container .se-seg-scope b').textContent`), /VUA/);
    await ev(`(() => { const c = document.querySelector('.se-seg-panel .sp-ck[title="Bóng chữ"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
    assert.notEqual((await VUA()).shadow, 'none', 'bóng chữ riêng cho VUA');
    assert.equal((await runs()).find((x) => x.t !== 'VUA').shadow, 'none');
    await ev(`(() => { const c = document.querySelector('.se-seg-panel .sp-ck[title="Viền chữ"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
    assert.ok(parseFloat((await VUA()).stroke) > 0, 'viền chữ riêng');
    await app.screenshot(path.join(process.env.TEMP || os.tmpdir(), 'rich-1-format.png'));
    await btn('Reset formatting');
    await sleep(200);
    assert.equal((await runs()).length, 0, 'Reset formatting gỡ mọi định dạng riêng của vùng chọn → về chữ thuần');
    assert.deepEqual(await ev(`seBlocks()[0]._rich.marks`), []);

    /* ---------- 4. gõ chữ không làm lệch định dạng (tiếng Việt có dấu) ---------- */
    await selectText(0, 'VUA'); await pickStd('#ffff00');
    await ev(`(() => { const cd = document.querySelector('#lyrics-editor-container .lyrics-slide-content'); cd.focus(); const n = cd.firstChild; const r = document.createRange(); r.setStart(n, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await app.raw('Input.insertText', { text: 'Tiếng ' }); await sleep(250);
    assert.equal(await ev(`seBlocks()[0]._txt.startsWith('Tiếng Chúa')`), true);
    assert.equal((await VUA()).color, 'rgb(255, 255, 0)', 'gõ chèn phía trước: VUA vẫn đúng từ đó, vẫn vàng');
    assert.deepEqual(await ev(`seBlocks()[0]._rich.marks.map((m) => seBlocks()[0]._txt.slice(m.s, m.e))`), ['VUA']);
    await ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-content').innerHTML = document.querySelector('#lyrics-editor-container .lyrics-slide-content').innerHTML.replace('Tiếng ', '')`);
    await sleep(100);
    await ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-content').dispatchEvent(new Event('input', { bubbles: true }))`); await sleep(250);
    assert.deepEqual(await ev(`seBlocks()[0]._rich.marks.map((m) => seBlocks()[0]._txt.slice(m.s, m.e))`), ['VUA'], 'xoá phần vừa gõ: VUA vẫn đúng');

    /* ---------- 5. Undo / Redo ---------- */
    assert.equal(await ev(`document.getElementById('se-undo').disabled`), false);
    await ev(`seHistCommit()`);
    const nUndo = await ev(`seHist.idx`);
    await selectText(0, 'Hallelujah'.slice(0, 0) + 'Chúa'); await pickStd('#ff0000');   // thêm màu đỏ cho "Chúa"
    assert.equal((await runs()).find((x) => x.t === 'Chúa').color, 'rgb(255, 0, 0)');
    await ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-content').focus()`);
    await key('z', 'KeyZ', 90, 2); await sleep(300);
    assert.equal((await runs()).find((x) => x.t.startsWith('Chúa')).color, 'rgb(255, 255, 255)', 'Ctrl+Z: bỏ màu đỏ của "Chúa"');
    assert.equal((await VUA()).color, 'rgb(255, 255, 0)', '…nhưng VUA vẫn vàng');
    assert.equal(await ev(`document.getElementById('se-redo').disabled`), false, 'Redo khả dụng sau Undo');
    await ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-content').focus()`);
    await key('y', 'KeyY', 89, 2); await sleep(300);
    assert.equal((await runs()).find((x) => x.t === 'Chúa').color, 'rgb(255, 0, 0)', 'Ctrl+Y: làm lại');
    await click('#se-undo'); await sleep(300);
    assert.equal((await runs()).find((x) => x.t.startsWith('Chúa')).color, 'rgb(255, 255, 255)', 'nút Undo ở chân hộp');
    await click('#se-redo'); await sleep(300);
    assert.ok(nUndo >= 1);

    /* ---------- 6. nền Brush / Marker (panel Background) ---------- */
    await selectText(0, 'Chúa chính Ngài là'); await sleep(100);
    await ev(`document.querySelector('#lyrics-editor-container .se-eye').click()`); await sleep(200);
    await click('.se-seg-panel .se-seg-tab[data-seg-tab="bg"]'); await sleep(150);
    await click('.se-seg-panel .sp-pre[data-preset="brush-a"]'); await sleep(350);
    let bg = await ev(`(() => { const it = document.querySelector('#editor-text-box .rr-bg-layer .rr-bg-item'); if (!it) return null; const p = it.querySelector('svg path'); const t = document.getElementById('editor-preview-text');
      return { preset: it.dataset.preset, d: p && p.getAttribute('d').length, fill: p && p.getAttribute('fill'), opacity: getComputedStyle(it).opacity, w: it.offsetWidth, textOpacity: getComputedStyle(t).opacity, z: getComputedStyle(it.parentElement).zIndex, textZ: getComputedStyle(t).zIndex }; })()`);
    assert.ok(bg, 'có lớp nền brush phía sau chữ'); assert.equal(bg.preset, 'brush-a'); assert.ok(bg.d > 50); assert.equal(bg.fill, '#7c4dff'); assert.equal(bg.opacity, '0.8'); assert.ok(bg.w > 100);
    assert.equal(bg.textOpacity, '1'); assert.ok(+bg.textZ > +bg.z, 'lớp nền nằm DƯỚI chữ');
    await ev(`(() => { const r = document.querySelector('.se-seg-panel .sp-range'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(250);
    assert.equal(await ev(`getComputedStyle(document.querySelector('#editor-text-box .rr-bg-item')).opacity`), '0.4', 'độ mờ nền');
    assert.equal(await ev(`getComputedStyle(document.getElementById('editor-preview-text')).opacity`), '1', 'độ mờ nền KHÔNG làm mờ chữ');
    await app.screenshot(path.join(process.env.TEMP || os.tmpdir(), 'rich-2-brush.png'));
    // padding / xoay / thu phóng / vị trí
    const wBefore = await ev(`document.querySelector('#editor-text-box .rr-bg-item').offsetWidth`);
    await ev(`(() => { const n = [...document.querySelectorAll('.se-seg-panel .sp-num')]; const by = (t) => n.find((i) => i.title.startsWith(t)); const set = (i, v) => { i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); };
      set(by('Đệm'), 30); set(by('Xoay'), 5); set(by('Phóng'), 120); set(by('Dịch ngang'), 10); set(by('Dịch dọc'), -6); })()`); await sleep(300);
    const tf = await ev(`(() => { const it = document.querySelector('#editor-text-box .rr-bg-item'); return { w: it.offsetWidth, t: it.style.transform }; })()`);
    assert.ok(tf.w > wBefore, 'padding lớn hơn → nền rộng hơn'); assert.match(tf.t, /rotate\(5deg\)/); assert.match(tf.t, /scale\(1\.2\)/); assert.match(tf.t, /translate\(10px,\s*-6px\)/);
    // đổi sang Marker: mỗi dòng một dải
    await click('.se-seg-panel .sp-pre[data-preset="marker"]'); await sleep(300);
    const mk = await ev(`(() => { const it = document.querySelector('#editor-text-box .rr-bg-item'); return { preset: it.dataset.preset, strips: it.querySelectorAll(':scope > div svg path').length }; })()`);
    assert.equal(mk.preset, 'marker'); assert.ok(mk.strips >= 1);
    // nhiều lớp + thứ tự
    await selectText(0, 'VUA'); await sleep(100);
    await click('.se-seg-panel .sp-pre[data-preset="pill"]'); await sleep(300);
    assert.equal(await ev(`document.querySelectorAll('#editor-text-box .rr-bg-item').length`), 2, 'hai lớp nền cho hai vùng khác nhau');
    // HỒI QUY lỗi "chỉ chỉnh được 1 nền, cái thứ 2 không chỉnh được": mỗi lớp chỉnh ĐỘC LẬP
    const slider = (v) => ev(`(() => { const r = document.querySelector('.se-seg-panel .sp-range'); r.value = '${v}'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const ops = () => ev(`Object.fromEntries(seBlocks()[0]._rich.bgs.map((b) => [b.preset, b.opacity]))`);
    await slider(30); await sleep(250);
    assert.deepEqual(await ops(), { marker: 0.4, pill: 0.3 }, 'lớp thứ 2 (pill) chỉnh được, lớp thứ 1 (marker) giữ nguyên');
    await ev(`[...document.querySelectorAll('.se-seg-panel .sp-chip')].find((c) => /Marker/.test(c.textContent)).click()`); await sleep(150);
    await slider(90); await sleep(250);
    { const got = await ops(); assert.deepEqual(got, { marker: 0.9, pill: 0.3 }, 'chọn lại lớp 1 bằng chip rồi chỉnh: lớp 2 vẫn giữ nguyên — thực tế ' + JSON.stringify(got) + ' | chip đang chọn: ' + await ev(`(document.querySelector('.se-seg-panel .sp-chip.on') || {}).textContent`)); }
    await selectText(0, 'VUA'); await sleep(150);
    assert.match(await ev(`document.querySelector('.se-seg-panel .sp-chip.on').textContent`), /Dải bo tròn/, 'chọn lại vùng "VUA": panel tự trỏ về lớp của VUA');
    await slider(55); await sleep(250);
    assert.deepEqual(await ops(), { marker: 0.9, pill: 0.55 });
    const zs = await ev(`seBlocks()[0]._rich.bgs.map((b) => [b.preset, b.z])`);
    assert.deepEqual(zs.map((x) => x[0]).sort(), ['marker', 'pill']);
    const zOf = (preset) => ev(`seBlocks()[0]._rich.bgs.find((b) => b.preset === ${JSON.stringify(preset)}).z`);
    assert.ok((await zOf('pill')) > (await zOf('marker')), 'lớp thêm sau nằm trên');
    await btn('Xuống'); await sleep(250);
    assert.ok((await zOf('pill')) < (await zOf('marker')), 'nút Xuống đổi thứ tự lớp (pill xuống dưới marker)');
    const domOrder = await ev(`[...document.querySelectorAll('#editor-text-box .rr-bg-item')].map((x) => x.dataset.preset)`);
    assert.deepEqual(domOrder, ['pill', 'marker'], 'thứ tự trong DOM theo z');
    await btn('Thêm lớp'); await sleep(250);
    assert.equal(await ev(`seBlocks()[0]._rich.bgs.length`), 3, 'Thêm lớp: nhân thêm một lớp cho cùng vùng chữ');
    await btn('Xoá lớp'); await sleep(250);
    assert.equal(await ev(`seBlocks()[0]._rich.bgs.length`), 2);
    // bỏ lớp pill bằng "Không nền"
    await ev(`seBlocks()[0]._panel.selectBg(seBlocks()[0]._rich.bgs.findIndex((b) => b.preset === 'pill'))`);
    await sleep(100);
    await click('.se-seg-panel .sp-pre[data-preset="none"]'); await sleep(300);
    assert.equal(await ev(`seBlocks()[0]._rich.bgs.length`), 1, '"Không nền" xoá lớp đang chọn');
    // vùng chọn chỉ CHỒNG MỘT PHẦN lên lớp cũ ("là VUA" chạm "Chúa chính Ngài là"): bấm kiểu nền phải TẠO LỚP MỚI, không sửa nhầm lớp cũ
    await selectText(0, 'là VUA'); await sleep(150);
    await click('.se-seg-panel .sp-pre[data-preset="paper"]'); await sleep(300);
    assert.deepEqual(await ev(`seBlocks()[0]._rich.bgs.map((b) => b.preset).sort()`), ['marker', 'paper'], 'tạo lớp mới (giấy xé), lớp marker giữ nguyên');
    await btn('Xoá lớp'); await sleep(250);
    assert.deepEqual(await ev(`seBlocks()[0]._rich.bgs.map((b) => b.preset)`), ['marker']);

    /* ---------- 7. hoạt ảnh (panel Animation) ---------- */
    await selectText(0, 'VUA'); await sleep(100);
    await click('.se-seg-panel .se-seg-tab[data-seg-tab="anim"]'); await sleep(150);
    await setSel('.se-seg-panel .sp-form .sp-sel', 'zoom');   // chưa có hoạt ảnh nào: chỉ đổi giá trị mặc định của form
    await btn('Thêm hoạt ảnh'); await sleep(300);
    assert.deepEqual(await ev(`seBlocks()[0]._rich.anims.map((a) => [a.phase, a.type, a.s, a.e])`), [['in', 'zoom', VS, VS + 3]]);
    assert.equal(await ev(`document.querySelectorAll('#editor-preview-text .rr-an').length`), 1, 'VUA được bọc để chạy hoạt ảnh');
    await btn('Xem thử'); await sleep(120);
    const playing = await ev(`document.querySelector('#editor-preview-text .rr-an').getAnimations().length`);
    assert.ok(playing >= 1, 'hoạt ảnh Web Animations đang chạy: ' + playing);
    await sleep(900);
    // đổi sang typewriter (sửa hoạt ảnh đang chọn): mỗi ký tự một đơn vị
    await setSel('.se-seg-panel .sp-form .sp-sel', 'typewriter'); await sleep(300);
    assert.deepEqual(await ev(`seBlocks()[0]._rich.anims.map((a) => a.type)`), ['typewriter']);
    assert.equal(await ev(`document.querySelectorAll('#editor-preview-text .rr-unit').length`), 3, 'typewriter: mỗi ký tự của "VUA" một đơn vị');
    // thêm Emphasis rồi Exit cho cùng vùng chữ (Thêm = nhân bản hoạt ảnh đang chọn, sau đó đổi giai đoạn/kiểu)
    await btn('Thêm hoạt ảnh'); await sleep(150);
    await click('.se-seg-panel .sp-segb[data-phase="emph"]'); await sleep(200);
    await btn('Thêm hoạt ảnh'); await sleep(150);
    await click('.se-seg-panel .sp-segb[data-phase="out"]'); await sleep(250);
    assert.deepEqual(await ev(`seBlocks()[0]._rich.anims.map((a) => a.phase + ':' + a.type)`), ['in:typewriter', 'emph:pulse', 'out:fade'], 'đủ Entrance / Emphasis / Exit');
    // các thông số: thời lượng, trễ, lặp — đặt trên hoạt ảnh Emphasis
    await ev(`seBlocks()[0]._panel.selectAnim(1)`); await sleep(150);
    await ev(`(() => { const n = [...document.querySelectorAll('.se-seg-panel .sp-num')]; const by = (t) => n.find((i) => i.title.startsWith(t)); const set = (i, v) => { i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); };
      set(by('Thời lượng'), 900); set(by('Độ trễ'), 100); set(by('Số lần lặp'), 2); })()`); await sleep(250);
    const ex = await ev(`seBlocks()[0]._rich.anims[1]`);
    assert.equal(ex.phase, 'emph'); assert.equal(ex.dur, 900); assert.equal(ex.delay, 100); assert.equal(ex.repeat, 2);

    /* ---------- 8. lưu → mở lại → đổi slide: định dạng còn nguyên ---------- */
    const before = await ev(`JSON.stringify(seBlocks()[0]._rich)`);
    await ev(`saveSong(false)`); await sleep(900);
    const saved = await ev(`(async () => { const s = await window.electronAPI.loadSongs(); const x = s.find((y) => y.id === ${SONG_ID}); return { lyrics: x.lyrics, rich: x.rich }; })()`);
    assert.equal(saved.lyrics, LYRICS, 'lời lưu y nguyên (không lẫn định dạng)');
    assert.ok(saved.rich && saved.rich.v === 1 && saved.rich.slides[0], 'rich được lưu');
    const sl0 = saved.rich.slides[0];
    assert.equal(sl0.h.length, 8); assert.ok(sl0.marks.some((m) => BODY0.slice(m.s, m.e) === 'VUA' && m.color === '#ffff00'));
    assert.equal(sl0.bgs.length, 1); assert.equal(sl0.anims.length, 3);
    assert.equal(saved.rich.slides[1] || null, null, 'slide 2 không có định dạng');
    await ev(`closeSongEditor()`); await sleep(400);
    await open(SONG_ID);
    assert.equal((await VUA()).color, 'rgb(255, 255, 0)', 'mở lại: VUA vẫn vàng');
    assert.equal(await ev(`JSON.stringify(seBlocks()[0]._rich)`), before, 'mở lại: dữ liệu định dạng y hệt lúc trước khi lưu');
    await ev(`document.querySelectorAll('#lyrics-editor-container .lyrics-slide-content')[1].focus()`); await sleep(250);
    assert.equal((await runs()).length, 0, 'sang slide 2 (không định dạng): xem trước chữ thuần');
    assert.equal(await ev(`document.getElementById('editor-preview-text').textContent`), 'Hallelujah');
    await ev(`document.querySelectorAll('#lyrics-editor-container .lyrics-slide-content')[0].focus()`); await sleep(250);
    assert.equal((await VUA()).color, 'rgb(255, 255, 0)', 'quay lại slide 1: định dạng còn');
    // tab Slides: hình thu nhỏ cũng có màu + nền
    await ev(`setEditorTab('slides')`); await sleep(900);
    const thumb = await ev(`(() => { const t = document.querySelector('#slides-view-container .se-thumb'); const run = [...t.querySelectorAll('.rr-run')].find((s) => s.textContent === 'VUA'); return { color: run && getComputedStyle(run).color, bg: t.querySelectorAll('.rr-bg-item').length }; })()`);
    assert.equal(thumb.color, 'rgb(255, 255, 0)'); assert.ok(thumb.bg >= 1, 'hình thu nhỏ có cả lớp nền');
    await ev(`setEditorTab('words')`);
    // nhân đôi slide mang theo định dạng
    await ev(`seDuplicateSlide(0)`); await sleep(300);
    assert.deepEqual(await ev(`seBlocks().map((b) => b._rich.marks.length > 0)`), [true, true, false]);
    await ev(`seBlocks()[1].remove(); reindexSlides()`);
    await ev(`closeSongEditor()`); await sleep(300);

    /* ---------- 9. Preview = Projector (cửa sổ Live thật) ---------- */
    await ev(`(async () => { const s = await window.electronAPI.loadSongs(); const song = s.find((x) => x.id === ${SONG_ID}); addToSchedule(song); currentScheduleIndex = 0; loadToPreview(schedule[0]); await window.electronAPI.openLiveWindow({ x: 0, y: 0, width: 960, height: 540 }); })()`);
    await sleep(1500);
    const live = await app.attach(/live\.html/, 20000);
    await ev(`currentLiveScheduleIndex = 0; goLiveFromSlide(0)`);
    await sleep(2200);
    const runsOf = (sel, ctx) => `[...document.querySelectorAll(${q(sel)} + ' .rr-run')].map((s) => [s.textContent, s.style.cssText])`;
    const mainRuns = await ev(runsOf('#preview-lyrics-text'));
    const liveRuns = await live.ev(runsOf('#lyrics-text'));
    assert.ok(mainRuns.length > 1, 'cửa sổ chính có định dạng');
    assert.deepEqual(liveRuns, mainRuns, 'Preview = Projector: cùng các đoạn chữ và cùng kiểu từng đoạn');
    const liveVua = await live.ev(`(() => { const s = [...document.querySelectorAll('#lyrics-text .rr-run')].find((x) => x.textContent === 'VUA'); return getComputedStyle(s).color; })()`);
    assert.equal(liveVua, 'rgb(255, 255, 0)', 'màn chiếu: VUA màu vàng');
    const liveBg = await live.ev(`document.querySelectorAll('#text-box .rr-bg-layer .rr-bg-item').length`);
    assert.equal(liveBg, 1, 'màn chiếu có lớp nền');
    const liveBgBox = await live.ev(`(() => { const it = document.querySelector('#text-box .rr-bg-item'); const r = it.getBoundingClientRect(); const t = document.getElementById('lyrics-text').getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.left >= t.left - 60 && r.right <= t.right + 60 }; })()`);
    assert.ok(liveBgBox.w > 50 && liveBgBox.h > 10 && liveBgBox.inside, 'lớp nền nằm đúng quanh chữ trên màn chiếu: ' + JSON.stringify(liveBgBox));
    await live.screenshot(path.join(process.env.TEMP || os.tmpdir(), 'rich-3-live.png'));
    // chuyển slide: slide 2 không định dạng → màn chiếu về chữ thuần; hoạt ảnh "ra" của slide 1 chạy xong rồi mới đổi
    await ev(`goLiveSlide(1)`); await sleep(250);
    assert.match(await live.ev(`document.getElementById('lyrics-text').textContent`), /VUA/, 'đang chờ hoạt ảnh "ra" của slide 1: chưa đổi sang slide 2');
    await sleep(1400);
    assert.equal(await live.ev(`document.getElementById('lyrics-text').textContent`), 'Hallelujah');
    assert.equal(await live.ev(`document.querySelectorAll('#text-box .rr-bg-item').length`), 0, 'slide thường: lớp nền cũ đã dọn');
    await ev(`goLiveSlide(0)`); await sleep(1200);
    assert.equal(await live.ev(`[...document.querySelectorAll('#lyrics-text .rr-run')].some((s) => s.textContent === 'VUA' && getComputedStyle(s).color === 'rgb(255, 255, 0)')`), true, 'quay lại slide 1: định dạng trở lại');
    // đổi cỡ chữ chung khi đang chiếu: định dạng được dựng lại, không mất
    await ev(`(() => { currentLiveStyle = { ...currentLiveStyle, fontSize: '48px' }; sendToLiveWindow({ text: null, style: currentLiveStyle }); })()`); await sleep(600);
    assert.equal(await live.ev(`[...document.querySelectorAll('#lyrics-text .rr-run')].some((s) => s.textContent === 'VUA')`), true);
    live.close();

    /* ---------- 10. hợp âm: bỏ trên màn chiếu, vị trí định dạng dời đúng ---------- */
    await ev(`schedule = []; currentLiveIndex = -1; liveSlides = []; true`);
    await ev(`(async () => { const s = await window.electronAPI.loadSongs(); const song = JSON.parse(JSON.stringify(s.find((x) => x.id === ${CHORD_ID}))); const body = '[Am]Chúa là [G]VUA muôn đời'; const vs = body.indexOf('VUA');
      song.rich = { v: 1, slides: [{ h: RichModel.hashText(body), marks: [{ s: vs, e: vs + 3, color: '#00ff00' }], bgs: [], anims: [] }] };
      addToSchedule(song); currentScheduleIndex = 0; loadToPreview(schedule[0]); currentLiveScheduleIndex = 0; goLiveFromSlide(0); })()`);
    await sleep(900);
    const chordRuns = await ev(`[...document.querySelectorAll('#preview-lyrics-text .rr-run')].map((s) => [s.textContent, getComputedStyle(s).color])`);
    assert.equal(chordRuns.map((x) => x[0]).join(''), 'Chúa là VUA muôn đời', 'màn chiếu/xem trước bỏ [hợp âm]');
    assert.deepEqual(chordRuns.find((x) => x[0] === 'VUA'), ['VUA', 'rgb(0, 255, 0)'], 'định dạng dời đúng sang từ VUA sau khi bỏ hợp âm');

    /* ---------- 11. bài cũ (không rich) không bị đổi; Kinh Thánh không có định dạng ---------- */
    await open(OLD_ID);
    assert.equal((await runs()).length, 0);
    await ev(`saveSong(false)`); await sleep(700);
    const old = await ev(`(async () => { const s = await window.electronAPI.loadSongs(); const x = s.find((y) => y.id === ${OLD_ID}); return { has: 'rich' in x, lyrics: x.lyrics }; })()`);
    assert.equal(old.has, false, 'bài cũ lưu lại không phát sinh trường rich'); assert.equal(old.lyrics, 'Đoạn 1\nBài cũ dòng 1\nDòng 2\n\nĐiệp khúc\nHa-lê-lu-gia');
    await ev(`closeSongEditor()`); await sleep(200);
    await ev(`openSongEditor('Edit Bible', { id: ${BIBLE_ID}, type: 'bible', title: 'Giăng 3:16', lyrics: 'Vì Đức Chúa Trời yêu thương thế gian', style: ${JSON.stringify(style)} })`); await sleep(600);
    assert.equal(await ev(`document.querySelectorAll('#lyrics-editor-container .se-eye').length`), 0, 'Kinh Thánh: không có biểu tượng mắt/panel');
    assert.equal(await ev(`getComputedStyle(document.getElementById('bg-color-btn')).display`), 'none');
    assert.equal(await ev(`getComputedStyle(document.getElementById('reset-fmt-btn')).display`), 'none');
    await selectText(0, 'yêu thương'); await sleep(200);
    assert.equal(await ev(`seSel()`), null, 'Kinh Thánh: vùng chọn không kích hoạt định dạng riêng');
    await ev(`closeSongEditor()`);

    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
  } finally { await app.close(); }
});
