// E2E (app Electron thật) — DUYỆT MỌI Ô ĐIỀU KHIỂN của panel Text / Background / Animation: mỗi ô phải (1) đổi đúng dữ liệu, (2) HIỂN THỊ
// trạng thái đã chọn (ô tick có dấu tick, nút bật có màu, chip/kiểu nền đang chọn được tô), (3) không gây lỗi JS.
//   node --test test/seg-panel-controls.e2e.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const RM = createRequire(import.meta.url)('../src/editor/rich-model.js');
const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SONG_ID = 1700000000001;
const LY = 'Đoạn 1\nNày là lòng khát khao\nXin Cha Ngài làm tươi mới luôn';
const TARGET = 'lòng khát khao';

test('mọi ô điều khiển của panel Text/Background/Animation: đổi đúng dữ liệu VÀ hiển thị đúng', async () => {
  const instanceId = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(instanceId);
  const ud = instanceUserDataDir(instanceId); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify([{ id: SONG_ID, type: 'song', title: 'Bài thử', lyrics: LY, style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' }, background: null }]));
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  const ev = (x) => app.ev(x);
  const q = (x) => JSON.stringify(x);
  const rich = () => ev(`seBlocks()[0]._rich`);
  const marks = async () => (await rich()).marks;
  const P = '.se-seg-panel';
  const fire = (sel, value, type = 'input') => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('khong thay ' + ${q(sel)}); e.value = ${q(String(value))}; e.dispatchEvent(new Event(${q(type)}, { bubbles: true })); })()`);
  const num = (titleStart, v) => ev(`(() => { const i = [...document.querySelectorAll('${P} .sp-num')].find((x) => x.title.startsWith(${q(titleStart)})); if (!i) throw new Error('khong thay o ' + ${q(titleStart)}); i.value = ${q(String(v))}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const btn = (label) => ev(`(() => { const b = [...document.querySelectorAll('${P} button.sp-btn')].find((x) => x.lastElementChild && x.lastElementChild.textContent.trim() === ${q(label)}); if (!b) throw new Error('khong thay nut ' + ${q(label)}); b.click(); })()`);
  const tab = (name) => ev(`document.querySelector('${P} .se-seg-tab[data-seg-tab="${name}"]').click()`);
  const settle = () => sleep(160);
  const check = async (title, on) => {   // đặt ô tick như người dùng bấm, rồi trả về trạng thái HIỂN THỊ
    await ev(`(() => { const c = document.querySelector('${P} .sp-ck[title=${q(title)}]'); if (c.checked !== ${on}) c.click(); })()`); await settle();
  };
  // ô tick "trông như đã chọn": nền chàm + có dấu tick (::after) — chứ không chỉ checked=true
  const ckLooks = (title) => ev(`(() => { const c = document.querySelector('${P} .sp-ck[title=${q(title)}]'); const s = getComputedStyle(c); return { checked: c.checked, bg: s.backgroundColor, tick: getComputedStyle(c, '::after').content !== 'none', w: c.offsetWidth }; })()`);
  const INDIGO = 'rgb(80, 72, 229)';
  const pickStdFromPopup = async (hex) => { await ev(`document.querySelector('.cp-std .cp-sw[data-hex="${hex}"]').click()`); await settle(); };
  try {
    await ev(`(async () => { window.__s = await window.electronAPI.loadSongs(); return 1; })()`);
    await ev(`openSongEditor('Edit Song', window.__s.find((x) => x.id === ${SONG_ID}))`); await sleep(800);
    await ev(`(() => { const cd = document.querySelector('#lyrics-editor-container .lyrics-slide-content'); cd.focus(); const w = document.createTreeWalker(cd, NodeFilter.SHOW_TEXT); let n, h;
      while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(${q(TARGET)}); if (i >= 0) { h = [n, i]; break; } }
      const r = document.createRange(); r.setStart(h[0], h[1]); r.setEnd(h[0], h[1] + ${TARGET.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cd.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
    await sleep(300);
    await ev(`document.querySelector('#lyrics-editor-container .se-eye').click()`); await sleep(300);
    assert.match(await ev(`document.querySelector('${P} .se-seg-scope b').textContent`), new RegExp(TARGET));

    /* ================= TEXT ================= */
    // font
    await fire(`${P} .sp-sel`, 'Georgia', 'change'); await settle();
    assert.equal((await marks())[0].font, 'Georgia');
    await fire(`${P} .sp-sel`, '', 'change'); await settle();
    assert.equal((await marks()).some((m) => m.font), false, 'chọn "(mặc định của bài)" gỡ font riêng');
    // cỡ
    await num('Cỡ chữ', 90); await settle(); assert.equal((await marks())[0].size, 90);
    await num('Cỡ chữ', ''); await settle(); assert.equal((await marks()).some((m) => m.size), false, 'để trống = theo bài');
    // B / I / U: dữ liệu + nút BẬT phải có màu
    for (const [cls, key] of [['i', 'italic'], ['u', 'underline']]) {
      await ev(`document.querySelector('${P} .sp-tg.${cls}').click()`); await settle();
      assert.equal((await marks())[0][key], true, key);
      assert.equal(await ev(`getComputedStyle(document.querySelector('${P} .sp-tg.${cls}')).backgroundColor`), INDIGO, 'nút ' + key + ' bật phải được tô màu');
      await ev(`document.querySelector('${P} .sp-tg.${cls}').click()`); await settle();
      assert.equal(await ev(`getComputedStyle(document.querySelector('${P} .sp-tg.${cls}')).backgroundColor`) === INDIGO, false, 'tắt thì hết màu');
    }
    await ev(`document.querySelector('${P} .sp-tg.b').click()`); await settle();   // bài mặc định đậm → bấm B = bỏ đậm riêng
    assert.equal((await marks()).find((m) => 'bold' in m).bold, false);
    assert.equal(await ev(`document.querySelector('${P} .sp-tg.b').classList.contains('on')`), false);
    // màu chữ (bảng màu dùng chung)
    await ev(`document.querySelector('${P} .sp-cb').click()`); await settle();
    assert.equal(await ev(`!!document.querySelector('.cp-pop')`), true, 'nút màu mở bảng màu');
    await pickStdFromPopup('#ff0000');
    assert.equal((await marks()).find((m) => m.color).color, '#ff0000');
    assert.equal(await ev(`getComputedStyle(document.querySelector('${P} .sp-cb .sp-sw')).backgroundColor`), 'rgb(255, 0, 0)', 'ô màu hiện đúng màu đã chọn');
    // bóng chữ: ô tick hiển thị + các ô số
    let ck = await ckLooks('Bóng chữ'); assert.equal(ck.checked, false); assert.notEqual(ck.bg, INDIGO);
    await check('Bóng chữ', true);
    ck = await ckLooks('Bóng chữ'); assert.deepEqual([ck.checked, ck.bg, ck.tick, ck.w], [true, INDIGO, true, 15], 'ô tick Bóng chữ phải HIỂN THỊ dấu tick: ' + JSON.stringify(ck));
    await num('Lệch ngang', 5); await num('Lệch dọc', 6); await num('Độ nhoè', 7); await settle();
    const sh = (await marks()).find((m) => m.shadow).shadow;
    assert.deepEqual([sh.x, sh.y, sh.blur], [5, 6, 7]);
    await ev(`document.querySelectorAll('${P} .sp-cb')[1].click()`); await settle(); await pickStdFromPopup('#0070c0');
    assert.equal((await marks()).find((m) => m.shadow).shadow.color, '#0070c0');
    await check('Bóng chữ', false);
    assert.equal((await marks()).some((m) => m.shadow), false); assert.notEqual((await ckLooks('Bóng chữ')).bg, INDIGO);
    // viền chữ
    await check('Viền chữ', true);
    ck = await ckLooks('Viền chữ'); assert.deepEqual([ck.checked, ck.bg, ck.tick], [true, INDIGO, true], 'ô tick Viền chữ phải HIỂN THỊ dấu tick');
    await num('Độ dày viền', 8); await settle(); assert.equal((await marks()).find((m) => m.stroke).stroke.w, 8);
    await ev(`document.querySelectorAll('${P} .sp-cb')[2].click()`); await settle(); await pickStdFromPopup('#ffff00');
    assert.equal((await marks()).find((m) => m.stroke).stroke.color, '#ffff00');
    await check('Viền chữ', false); assert.equal((await marks()).some((m) => m.stroke), false);
    // reset
    await btn('Reset formatting'); await settle();
    assert.deepEqual(await marks(), [], 'Reset formatting gỡ hết định dạng của vùng chọn');

    /* ================= BACKGROUND ================= */
    await tab('bg'); await settle();
    const presets = ['brush-a', 'paper', 'pill', 'marker', 'brush-b'];
    for (const id of presets) {
      await ev(`document.querySelector('${P} .sp-pre[data-preset="${id}"]').click()`); await settle();
      const bgs = (await rich()).bgs;
      assert.equal(bgs.length, 1, id + ': chỉ 1 lớp (đổi kiểu của lớp đang chọn)'); assert.equal(bgs[0].preset, id);
      assert.equal(await ev(`document.querySelector('${P} .sp-pre[data-preset="${id}"]').classList.contains('on')`), true, 'kiểu đang dùng được tô: ' + id);
      assert.equal(await ev(`getComputedStyle(document.querySelector('${P} .sp-pre[data-preset="${id}"]')).borderTopColor`), INDIGO, 'viền chàm cho kiểu đang chọn');
      assert.equal(await ev(`document.querySelectorAll('#editor-text-box .rr-bg-item').length`), 1, id + ' được vẽ');
    }
    await ev(`document.querySelector('${P} .sp-pre[data-preset="pill"]').click()`); await settle();
    // màu nền
    await ev(`document.querySelector('${P} .sp-form .sp-cb').click()`); await settle(); await pickStdFromPopup('#00b050');
    assert.equal((await rich()).bgs[0].color, '#00b050');
    // độ mờ: thanh trượt <-> ô số đồng bộ
    await fire(`${P} .sp-range`, 35); await settle();
    assert.equal((await rich()).bgs[0].opacity, 0.35);
    assert.equal(await ev(`[...document.querySelectorAll('${P} .sp-num')].find((x) => x.title.startsWith('Độ mờ')).value`), '35', 'ô số theo thanh trượt');
    await num('Độ mờ', 60); await settle();
    assert.equal(await ev(`document.querySelector('${P} .sp-range').value`), '60', 'thanh trượt theo ô số');
    assert.equal((await rich()).bgs[0].opacity, 0.6);
    // đệm / cỡ / xoay / hình / X / Y / bo góc
    for (const [t, key, v, want] of [['Đệm', 'padding', 30, 30], ['Cỡ: ', 'scale', 150, 1.5], ['Xoay', 'rotation', -12, -12], ['Biến thể', 'shape', 4, 4], ['Dịch ngang', 'dx', 25, 25], ['Dịch dọc', 'dy', -9, -9], ['Bo góc', 'radius', 20, 20]]) {
      await num(t, v); await settle();
      assert.equal((await rich()).bgs[0][key], want, t);
    }
    // giá trị ngoài biên bị kẹp, không vỡ
    await num('Cỡ: ', 9999); await settle(); assert.equal((await rich()).bgs[0].scale, 3, 'Cỡ tối đa 300%');
    await num('Cỡ: ', 100); await settle();
    // marker: ô "Dày %" chỉ hiện với marker
    await ev(`document.querySelector('${P} .sp-pre[data-preset="marker"]').click()`); await settle();
    assert.equal(await ev(`[...document.querySelectorAll('${P} .sp-num')].find((x) => x.title.startsWith('Độ dày dải')).offsetParent !== null`), true, 'marker có ô độ dày');
    await num('Độ dày dải', 40); await settle(); assert.equal((await rich()).bgs[0].thick, 0.4);
    assert.equal(await ev(`[...document.querySelectorAll('${P} .sp-num')].find((x) => x.title.startsWith('Bo góc')).offsetParent === null`), true, 'marker không có ô bo góc');
    // nhiều lớp: Thêm lớp, Lên, Xuống, chip, Reset, Xoá lớp
    await btn('Thêm lớp'); await settle();
    assert.equal((await rich()).bgs.length, 2);
    assert.equal(await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip').length`), 2, 'có chip cho từng lớp');
    assert.equal(await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip.on').length`), 1, 'chip lớp đang chọn được tô');
    const zs = async () => (await rich()).bgs.map((b) => b.z);
    const [z0, z1] = await zs(); assert.ok(z1 > z0);
    await btn('Xuống'); await settle(); const [y0, y1] = await zs(); assert.ok(y1 < y0, 'Xuống đổi thứ tự');
    await btn('Lên'); await settle(); const [w0, w1] = await zs(); assert.ok(w1 > w0, 'Lên đổi thứ tự');
    await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip')[0].click()`); await settle();
    assert.equal(await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip')[0].classList.contains('on')`), true, 'bấm chip chọn lớp đó');
    await num('Đệm', 33); await settle(); assert.equal((await rich()).bgs[0].padding, 33); assert.notEqual((await rich()).bgs[1].padding, 33, 'chỉ sửa lớp đang chọn');
    await btn('Reset'); await settle(); assert.equal((await rich()).bgs[0].padding, 12, 'Reset đưa thông số về mặc định');
    await btn('Xoá lớp'); await settle(); assert.equal((await rich()).bgs.length, 1);
    await ev(`document.querySelector('${P} .sp-pre[data-preset="none"]').click()`); await settle();
    assert.equal((await rich()).bgs.length, 0, '"Không nền" xoá lớp'); assert.equal(await ev(`document.querySelectorAll('#editor-text-box .rr-bg-item').length`), 0);

    /* ================= ANIMATION ================= */
    await tab('anim'); await settle();
    await btn('Thêm hoạt ảnh'); await settle();
    assert.equal((await rich()).anims.length, 1);
    for (const phase of Object.keys(RM.ANIM_TYPES)) {
      await ev(`document.querySelector('${P} .sp-segb[data-phase="${phase}"]').click()`); await settle();
      assert.equal(await ev(`document.querySelector('${P} .sp-segb[data-phase="${phase}"]').classList.contains('on')`), true);
      assert.equal(await ev(`getComputedStyle(document.querySelector('${P} .sp-segb[data-phase="${phase}"]')).backgroundColor`), INDIGO, 'giai đoạn đang chọn được tô');
      const offered = await ev(`[...document.querySelectorAll('${P} .sp-form .sp-sel')][0].options.length`);
      assert.equal(offered, RM.ANIM_TYPES[phase].length, phase + ': đủ kiểu');
      for (const type of RM.ANIM_TYPES[phase]) {
        await fire(`${P} .sp-form .sp-sel`, type, 'change'); await settle();
        const a = (await rich()).anims[0]; assert.deepEqual([a.phase, a.type], [phase, type]);
        // hiển thị: kiểu nào có hoạt ảnh thì phần chữ phải có phần tử bao (wrapper/unit)
        assert.ok(await ev(`document.querySelectorAll('#editor-preview-text .rr-an, #editor-preview-text .rr-unit').length`) >= 1, phase + '/' + type + ' được dựng');
        // Stagger chỉ dùng cho word/char/typewriter; Hướng cho slide; Màu cho glow/color
        const ui = await ev(`(() => { const n = (t) => [...document.querySelectorAll('${P} .sp-num')].find((x) => x.title.startsWith(t)); return { stag: !n('Trễ giữa').disabled, dir: ![...document.querySelectorAll('${P} .sp-sel')].find((x) => x.options[0] && x.options[0].value === 'up').disabled, col: !document.querySelectorAll('${P} .sp-cb')[document.querySelectorAll('${P} .sp-cb').length - 1].disabled }; })()`);
        assert.equal(ui.stag, ['word', 'char', 'typewriter'].includes(type), type + ': Stagger');
        assert.equal(ui.dir, /slide/.test(type), type + ': Hướng');
        assert.equal(ui.col, ['glow', 'color'].includes(type), type + ': Màu');
      }
    }
    await ev(`document.querySelector('${P} .sp-segb[data-phase="in"]').click()`); await settle(); await fire(`${P} .sp-form .sp-sel`, 'slide-up', 'change'); await settle();
    // thông số
    await num('Thời lượng', 1200); await num('Độ trễ', 300); await settle();
    await ev(`(() => { const s = [...document.querySelectorAll('${P} .sp-sel')].filter((x) => x.options[0] && x.options[0].value === 'linear')[0]; s.value = 'ease-in-out'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await settle();
    await ev(`(() => { const s = [...document.querySelectorAll('${P} .sp-sel')].filter((x) => x.options[0] && x.options[0].value === 'up')[0]; s.value = 'left'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await settle();
    await num('Số lần lặp', 3); await settle();
    let a = (await rich()).anims[0];
    assert.deepEqual([a.dur, a.delay, a.ease, a.dir, a.repeat], [1200, 300, 'ease-in-out', 'left', 3]);
    // ∞: ô tick hiển thị + ô "Lặp" bị khoá
    assert.equal((await ckLooks('Lặp vô hạn')).bg === INDIGO, false);
    await check('Lặp vô hạn', true);
    ck = await ckLooks('Lặp vô hạn'); assert.deepEqual([ck.checked, ck.bg, ck.tick], [true, INDIGO, true], 'ô tick ∞ phải HIỂN THỊ dấu tick: ' + JSON.stringify(ck));
    assert.equal((await rich()).anims[0].repeat, -1);
    assert.equal(await ev(`[...document.querySelectorAll('${P} .sp-num')].find((x) => x.title.startsWith('Số lần lặp')).disabled`), true, 'bật ∞ thì ô Lặp bị khoá');
    await check('Lặp vô hạn', false); assert.equal((await rich()).anims[0].repeat, 1);
    // nhiều hoạt ảnh + chip + Xem thử + Xoá
    await btn('Thêm hoạt ảnh'); await settle();
    assert.equal((await rich()).anims.length, 2);
    assert.equal(await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip').length`), 2);
    await btn('Xem thử'); await sleep(250);
    assert.ok(await ev(`document.querySelectorAll('#editor-preview-text .rr-an').length`) >= 1);
    await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip')[0].click()`); await settle();
    assert.equal(await ev(`document.querySelectorAll('${P} .sp-chips .sp-chip')[0].classList.contains('on')`), true);
    await btn('Xoá'); await settle(); assert.equal((await rich()).anims.length, 1);

    /* ================= chung ================= */
    // ba tab chuyển được và mỗi tab hiện đúng nội dung
    for (const t of ['text', 'bg', 'anim', 'text']) {
      await tab(t); await settle();
      const vis = await ev(`[...document.querySelectorAll('${P} .se-seg-body')].filter((x) => !x.hidden).map((x) => x.dataset.segBody)`);
      assert.deepEqual(vis, [t]);
      assert.equal(await ev(`document.querySelector('${P} .se-seg-tab[data-seg-tab="${t}"]').classList.contains('active')`), true);
    }
    // thẻ có panel mở được cuộn vào vùng nhìn thấy (nút cuối panel không bị che)
    await tab('bg'); await settle();
    await ev(`document.querySelector('#lyrics-editor-container').scrollTop = 0`);
    await ev(`document.querySelector('#lyrics-editor-container .se-eye').click()`); await settle();   // đóng
    await ev(`document.querySelector('#lyrics-editor-container .se-eye').click()`); await sleep(300);   // mở lại
    const vis = await ev(`(() => { const b = document.querySelector('#lyrics-editor-container .lyrics-slide-block').getBoundingClientRect(), c = document.getElementById('lyrics-editor-container').getBoundingClientRect(); return { bTop: b.top, bBottom: b.bottom, cTop: c.top, cBottom: c.bottom }; })()`);
    assert.ok(vis.bTop >= vis.cTop - 2 && (vis.bBottom <= vis.cBottom + 2 || vis.bTop <= vis.cTop + 2), 'mở panel: thẻ được cuộn vào vùng nhìn thấy (nằm trọn, hoặc dính mép trên nếu cao hơn khung): ' + JSON.stringify(vis));
    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
  } finally { await app.close(); }
});
