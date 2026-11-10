// E2E (app Electron thật) — hộp thoại "More Colors…": mở từ bảng màu, giữ màu hiện tại, spectrum/thanh sáng/RGB/HSL/HEX đồng bộ
// hai chiều, New/Current, OK áp dụng (+ vào Custom Colors), Cancel/Esc bỏ thay đổi, dùng chung cho Text Color và Background Color.
//   node --test test/color-dialog.e2e.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SONG_ID = 1700000000001;

test('More Colors…: hộp thoại RGB/HEX/spectrum riêng, dùng chung cho chữ và nền', async () => {
  const instanceId = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(instanceId);
  const ud = instanceUserDataDir(instanceId); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify([{ id: SONG_ID, type: 'song', title: 'Bài thử', lyrics: 'Đoạn 1\nChúa chính Ngài là VUA', style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ff0000' }, background: null }]));
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  const q = (sel) => JSON.stringify(sel);
  const ev = (x) => app.ev(x);
  const click = (sel) => ev(`document.querySelector(${q(sel)}).click()`);
  const val = (sel) => ev(`document.querySelector(${q(sel)}).value`);
  const typeInto = async (sel, text) => {   // gõ như người dùng: focus, chọn hết, gõ từng ký tự qua CDP
    await ev(`(() => { const i = document.querySelector(${q(sel)}); i.focus(); i.select(); })()`);
    await app.raw('Input.insertText', { text });
  };
  const dlgOpen = () => ev(`!!document.querySelector('.cd-dialog')`);
  const key = async (k, vk) => { await app.raw('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk }); await app.raw('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk }); };
  const mouse = async (type, x, y) => app.raw('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  try {
    await ev(`(async () => { const s = await window.electronAPI.loadSongs(); openSongEditor('Edit Song', s.find((x) => x.id === ${SONG_ID})); })()`); await sleep(700);

    // ---------- mở từ bảng Text Color; giữ nguyên màu hiện tại (#ff0000) ----------
    await click('#text-color-btn');
    assert.equal(await ev(`document.querySelector('.cp-more').disabled`), false, 'More Colors… đã khả dụng');
    await click('.cp-more');
    assert.equal(await dlgOpen(), true);
    assert.equal(await ev(`!!document.querySelector('.cp-pop')`), false, 'bảng thả xuống đóng khi mở hộp thoại');
    assert.deepEqual(await ev(`({ r: document.querySelectorAll('.cd-num')[0].value, g: document.querySelectorAll('.cd-num')[1].value, b: document.querySelectorAll('.cd-num')[2].value, hex: document.querySelector('.cd-hex').value,
      model: document.querySelector('.cd-model').value, labels: [...document.querySelectorAll('.cd-fields .cd-k')].map((x) => x.textContent),
      newC: getComputedStyle(document.querySelector('.cd-new')).backgroundColor, curC: getComputedStyle(document.querySelector('.cd-cur')).backgroundColor,
      isModal: document.querySelector('.cd-dialog').getAttribute('aria-modal'), hasCanvas: !!document.querySelector('.cd-spec canvas'), hasSlider: document.querySelector('.cd-val').getAttribute('role') })`),
      { r: '255', g: '0', b: '0', hex: '#FF0000', model: 'rgb', labels: ['Red:', 'Green:', 'Blue:'], newC: 'rgb(255, 0, 0)', curC: 'rgb(255, 0, 0)', isModal: 'true', hasCanvas: true, hasSlider: 'slider' }, 'giữ màu hiện tại; RGB mặc định; có spectrum + thanh sáng');
    await app.screenshot(path.join(process.env.TEMP || '.', 'color-dialog-1.png'));

    // ---------- HEX → RGB + New; Current giữ nguyên ----------
    await typeInto('.cd-hex', '#7030a0');
    assert.deepEqual(await ev(`({ rgb: [...document.querySelectorAll('.cd-num')].map((i) => i.value), newC: getComputedStyle(document.querySelector('.cd-new')).backgroundColor, curC: getComputedStyle(document.querySelector('.cd-cur')).backgroundColor })`),
      { rgb: ['112', '48', '160'], newC: 'rgb(112, 48, 160)', curC: 'rgb(255, 0, 0)' }, 'HEX → RGB, New đổi ngay, Current không đổi');
    // chưa bấm OK: chữ trong editor chưa đổi
    assert.equal(await ev(`editorStyle.color`), '#ff0000');

    // ---------- RGB → HEX + spectrum ----------
    await ev(`(() => { const i = document.querySelectorAll('.cd-num')[0]; i.focus(); i.select(); })()`); await app.raw('Input.insertText', { text: '10' });
    await ev(`(() => { const i = document.querySelectorAll('.cd-num')[1]; i.focus(); i.select(); })()`); await app.raw('Input.insertText', { text: '200' });
    await ev(`(() => { const i = document.querySelectorAll('.cd-num')[2]; i.focus(); i.select(); })()`); await app.raw('Input.insertText', { text: '30' });
    assert.equal(await val('.cd-hex'), '#0AC81E', 'RGB → HEX');
    const cross = await ev(`(() => { const c = document.querySelector('.cd-cross'), s = document.querySelector('.cd-spec').getBoundingClientRect(), r = c.getBoundingClientRect();
      return { hue: (r.left + r.width / 2 - s.left) / s.width * 360, sat: 1 - (r.top + r.height / 2 - s.top) / s.height }; })()`);
    assert.ok(Math.abs(cross.hue - 128) < 3 && cross.sat > 0.9, 'dấu chọn trên spectrum nhảy tới sắc xanh lá: ' + JSON.stringify(cross));

    // ---------- giá trị sai: viền đỏ + thông báo, KHÔNG đổi màu; OK bị chặn ----------
    await typeInto('.cd-hex', '#12345g');
    assert.deepEqual(await ev(`({ bad: document.querySelector('.cd-hex').classList.contains('bad'), msg: document.querySelector('.cd-err').textContent.length > 0, newC: getComputedStyle(document.querySelector('.cd-new')).backgroundColor })`),
      { bad: true, msg: true, newC: 'rgb(10, 200, 30)' });
    await click('.cd-btn.primary');
    assert.equal(await dlgOpen(), true, 'đang có ô sai → OK không đóng hộp');
    await ev(`document.querySelector('.cd-hex').blur()`);
    assert.equal(await val('.cd-hex'), '#0AC81E', 'rời ô sai → khôi phục theo màu đang chọn');
    await typeInto('.cd-num:nth-of-type(1)', '999');
    assert.equal(await ev(`document.querySelectorAll('.cd-num')[0].classList.contains('bad')`), true, 'RGB ngoài 0–255 bị đánh dấu sai');

    // ---------- spectrum bằng chuột: kéo → RGB + HEX cập nhật ----------
    const rects = await ev(`(() => { const s = document.querySelector('.cd-spec').getBoundingClientRect(), v = document.querySelector('.cd-val').getBoundingClientRect(); return { s: { x: s.left, y: s.top, w: s.width, h: s.height }, v: { x: v.left, y: v.top, w: v.width, h: v.height } }; })()`);
    await mouse('mousePressed', rects.s.x + rects.s.w * 0.5, rects.s.y + 2);   // hue 180 (cyan), sat ≈ 100%
    await mouse('mouseReleased', rects.s.x + rects.s.w * 0.5, rects.s.y + 2);
    const afterSpec = await ev(`({ hex: document.querySelector('.cd-hex').value, rgb: [...document.querySelectorAll('.cd-num')].map((i) => +i.value) })`);
    assert.ok(afterSpec.rgb[0] <= 6 && afterSpec.rgb[1] === afterSpec.rgb[2] && afterSpec.rgb[1] >= 195, 'bấm spectrum → sắc cyan, giữ độ sáng cũ (≈78%): ' + JSON.stringify(afterSpec));
    // thanh sáng: bấm nửa dưới → tối đi
    await mouse('mousePressed', rects.v.x + rects.v.w / 2, rects.v.y + rects.v.h * 0.5);
    await mouse('mouseReleased', rects.v.x + rects.v.w / 2, rects.v.y + rects.v.h * 0.5);
    const dark = await ev(`[...document.querySelectorAll('.cd-num')].map((i) => +i.value)`);
    assert.ok(dark[1] > 120 && dark[1] < 135 && dark[2] > 120 && dark[2] < 135, 'thanh sáng ở giữa → ~50%: ' + dark);
    // kéo thanh xuống đáy rồi nhả = đen; sắc độ vẫn nhớ khi kéo lên lại
    await mouse('mousePressed', rects.v.x + rects.v.w / 2, rects.v.y + rects.v.h - 1); await mouse('mouseReleased', rects.v.x + rects.v.w / 2, rects.v.y + rects.v.h - 1);
    assert.ok([...(await val('.cd-hex')).slice(1).match(/../g)].every((x) => parseInt(x, 16) <= 2), 'đáy thanh sáng ≈ đen: ' + await val('.cd-hex'));
    await mouse('mousePressed', rects.v.x + rects.v.w / 2, rects.v.y + 1); await mouse('mouseReleased', rects.v.x + rects.v.w / 2, rects.v.y + 1);
    const lit = await ev(`[...document.querySelectorAll('.cd-num')].map((i) => +i.value)`);
    assert.ok(lit[0] <= 6 && lit[1] >= 250 && lit[2] >= 250, 'kéo thanh sáng qua đen rồi lên lại vẫn giữ sắc cyan: ' + lit);

    // ---------- Color model HSL ----------
    await ev(`(() => { const s = document.querySelector('.cd-model'); s.value = 'hsl'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const hslUi = await ev(`({ labels: [...document.querySelectorAll('.cd-fields .cd-k')].map((x) => x.textContent), vals: [...document.querySelectorAll('.cd-num')].map((i) => +i.value) })`);
    assert.deepEqual(hslUi.labels, ['Hue:', 'Sat:', 'Lum:']); assert.equal(hslUi.vals[0], 180); assert.ok(hslUi.vals[1] >= 98); assert.equal(hslUi.vals[2], 50);
    await ev(`(() => { const i = document.querySelectorAll('.cd-num')[0]; i.focus(); i.select(); })()`); await app.raw('Input.insertText', { text: '270' });
    assert.equal(await val('.cd-hex'), '#8001FE', 'HSL(270, 99%, 50%) → HEX');
    await ev(`(() => { const s = document.querySelector('.cd-model'); s.value = 'rgb'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

    // ---------- Cancel: bỏ mọi thay đổi ----------
    await click('.cd-btn:not(.primary)');
    assert.equal(await dlgOpen(), false);
    assert.equal(await ev(`editorStyle.color`), '#ff0000', 'Cancel không đổi màu chữ');
    assert.deepEqual(await ev(`ColorPicker.getCustom()`), [], 'Cancel không thêm Custom Color');

    // ---------- Esc cũng huỷ, và trả focus ----------
    await click('#text-color-btn'); await click('.cp-more');
    await typeInto('.cd-hex', '#00ff00');
    await key('Escape', 27);
    assert.equal(await dlgOpen(), false);
    assert.equal(await ev(`editorStyle.color`), '#ff0000');
    assert.equal(await ev(`getComputedStyle(document.getElementById('song-editor-modal')).display`), 'flex', 'Esc chỉ đóng hộp thoại màu, không đóng hộp Edit Song');

    // ---------- OK: áp dụng cho chữ + thêm vào Custom Colors + vạch chỉ thị đổi ----------
    await click('#text-color-btn'); await click('.cp-more');
    await typeInto('.cd-hex', '#7030a0');
    await key('Enter', 13);   // Enter = OK
    assert.equal(await dlgOpen(), false);
    assert.equal(await ev(`editorStyle.color`), '#7030a0');
    assert.equal(await ev(`getComputedStyle(document.getElementById('editor-preview-text')).color`), 'rgb(112, 48, 160)');
    assert.equal(await ev(`getComputedStyle(document.getElementById('color-indicator')).backgroundColor`), 'rgb(112, 48, 160)', 'ô màu trên thanh công cụ cập nhật');
    assert.deepEqual(await ev(`ColorPicker.getCustom()`), ['#7030a0'], 'OK thêm màu vào Custom Colors');
    // mở lại hộp: Current = màu vừa áp dụng
    await click('#text-color-btn'); await click('.cp-more');
    assert.equal(await val('.cd-hex'), '#7030A0');
    assert.equal(await ev(`getComputedStyle(document.querySelector('.cd-cur')).backgroundColor`), 'rgb(112, 48, 160)');
    await key('Escape', 27);

    // ---------- dùng chung cho Background Color: Automatic → hộp bắt đầu từ màu dự phòng, Current đánh dấu "chưa đặt" ----------
    await click('#bg-color-btn'); await click('.cp-more');
    assert.equal(await ev(`document.querySelector('.cd-cur').classList.contains('auto')`), true);
    assert.match(await ev(`document.querySelector('.cd-dialog').getAttribute('aria-label')`), /Background/);
    await typeInto('.cd-hex', '#0070c0'); await click('.cd-btn.primary');
    assert.deepEqual(await ev(`({ on: editorStyle.boxStyle.enabled, c: editorStyle.boxStyle.backgroundColor, a: editorStyle.boxStyle.backgroundOpacity, text: editorStyle.color })`), { on: true, c: '#0070c0', a: 0.8, text: '#7030a0' });
    assert.equal(await ev(`getComputedStyle(document.getElementById('bg-color-indicator')).backgroundColor`), 'rgb(0, 112, 192)');
    assert.equal(await ev(`getComputedStyle(document.getElementById('editor-preview-text')).opacity`), '1', 'độ mờ nền không làm mờ chữ');
    assert.deepEqual(await ev(`ColorPicker.getCustom()`), ['#7030a0', '#0070c0'], 'cùng kho Custom Colors cho cả chữ và nền');

    // ---------- bấm nền mờ (ngoài hộp) = Cancel; Tab không thoát khỏi hộp ----------
    await click('#bg-color-btn'); await click('.cp-more');
    await mouse('mousePressed', 3, 3); await mouse('mouseReleased', 3, 3);
    assert.equal(await dlgOpen(), false, 'bấm vùng ngoài hộp = Cancel');
    await click('#bg-color-btn'); await click('.cp-more');
    for (let i = 0; i < 14; i++) await key('Tab', 9);
    assert.equal(await ev(`!!document.activeElement.closest('.cd-dialog')`), true, 'Tab quay vòng trong hộp thoại');
    await key('Escape', 27);
    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
  } finally { await app.close(); }
});
