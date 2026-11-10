// E2E (app Electron thật) — bảng chọn màu kiểu Office dùng chung cho Text Color và Background Color trong hộp Edit Song:
// thứ tự mục, chọn màu, Automatic, Custom Colors (thêm / không trùng / xoá / lưu bền qua khởi động lại), bàn phím, nền sau khối chữ.
//   node --test test/color-picker.e2e.mjs      (mở cửa sổ Electron, ~40 giây)
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
const OPEN = `(async () => { const s = await window.electronAPI.loadSongs(); openSongEditor('Edit Song', s.find((x) => x.id === ${SONG_ID})); })()`;

test('bảng màu Office: bố cục, chọn màu, Automatic, Custom Colors, bàn phím, nền sau khối chữ, lưu bền', async () => {
  const instanceId = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(instanceId);
  const ud = instanceUserDataDir(instanceId); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify([{ id: SONG_ID, type: 'song', title: 'Bài thử', lyrics: 'Đoạn 1\nChúa chính Ngài là VUA\n\nĐiệp khúc\nHallelujah', style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' }, background: null }]));
  const copy = makeAppCopy(); copies.push(copy);

  let app = await launchApp({ appDir: copy.dir, instanceId });
  try {
    await app.ev(OPEN); await sleep(700);
    await app.ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-content').focus()`);   // để xem trước có chữ

    const popOpen = () => app.ev(`!!document.querySelector('.cp-pop')`);
    const click = (sel) => app.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const styleOf = () => app.ev(`({ color: editorStyle.color, box: editorStyle.boxStyle })`);

    // ---------- 1. bố cục: đúng thứ tự Automatic → Theme → Standard → Custom → More, Custom NGAY DƯỚI Standard ----------
    await click('#text-color-btn');
    assert.equal(await popOpen(), true);
    const layout = await app.ev(`(() => {
      const kids = [...document.querySelector('.cp-pop').children].map((c) => c.className.split(' ')[0] + (c.classList.contains('cp-h') ? ':' + c.textContent : ''));
      const q = (s) => document.querySelectorAll('.cp-pop ' + s).length;
      return { kids, base: q('.cp-base .cp-sw'), tint: q('.cp-tint .cp-sw'), tintRows: q('.cp-tint'), std: q('.cp-std .cp-sw'),
        autoSel: document.querySelector('.cp-auto').classList.contains('sel'), more: document.querySelector('.cp-more').disabled,
        stdNames: [...document.querySelectorAll('.cp-std .cp-sw')].map((b) => b.title.split(' · ')[0]) };
    })()`);
    assert.deepEqual(layout.kids, ['cp-auto', 'cp-h:Theme Colors', 'cp-theme', 'cp-h:Standard Colors', 'cp-row', 'cp-h:Custom Colors', 'cp-row', 'cp-sep', 'cp-more']);
    assert.equal(layout.base, 10); assert.equal(layout.tint, 50); assert.equal(layout.tintRows, 5); assert.equal(layout.std, 10);
    assert.deepEqual(layout.stdNames, ['Red', 'Orange', 'Yellow', 'Light Green', 'Green', 'Cyan', 'Light Blue', 'Blue', 'Dark Blue', 'Purple']);
    assert.equal(layout.autoSel, true, 'màu chữ mặc định → Automatic được đánh dấu');
    assert.equal(layout.more, false, 'More Colors… mở hộp thoại RGB/HEX riêng');
    assert.equal(await app.ev(`document.querySelector('#text-color-btn').getAttribute('aria-expanded')`), 'true');
    await app.screenshot(path.join(process.env.TEMP || '.', 'color-picker-1.png'));

    // ---------- 2. chọn màu chuẩn: áp cho chữ, đóng bảng, vạch chỉ thị đổi, xem trước đổi màu ----------
    await click('.cp-std .cp-sw[data-hex="#ff0000"]');
    assert.equal(await popOpen(), false, 'chọn xong thì đóng bảng');
    assert.equal((await styleOf()).color, '#ff0000');
    assert.equal(await app.ev(`getComputedStyle(document.getElementById('editor-preview-text')).color`), 'rgb(255, 0, 0)');
    assert.equal(await app.ev(`getComputedStyle(document.getElementById('color-indicator')).backgroundColor`), 'rgb(255, 0, 0)');

    // mở lại: ô đỏ được đánh dấu, Automatic không
    await click('#text-color-btn');
    assert.deepEqual(await app.ev(`({ sel: [...document.querySelectorAll('.cp-pop .cp-sw.sel')].map((b) => b.dataset.hex), auto: document.querySelector('.cp-auto').classList.contains('sel') })`), { sel: ['#ff0000'], auto: false });

    // ---------- 3. Custom Colors: + thêm màu đang chọn; bấm lại không trùng; thêm màu khác ----------
    const customHexes = () => app.ev(`[...document.querySelectorAll('.cp-pop .cp-custom .cp-sw')].map((b) => b.dataset.hex)`);
    assert.deepEqual(await customHexes(), []);
    await click('.cp-custom .cp-add'); await click('.cp-custom .cp-add');
    assert.deepEqual(await customHexes(), ['#ff0000'], 'không trùng');
    // chọn 1 màu theme (hàng sắc độ) rồi mở lại và thêm
    const tintHex = await app.ev(`document.querySelectorAll('.cp-pop .cp-tint')[1].querySelectorAll('.cp-sw')[4].dataset.hex`);
    await click('.cp-tint:nth-of-type(3) .cp-sw:nth-child(5)');
    assert.equal((await styleOf()).color, tintHex);
    await click('#text-color-btn'); await click('.cp-custom .cp-add');
    assert.deepEqual(await customHexes(), ['#ff0000', tintHex]);
    assert.equal(await app.ev(`document.querySelector('.cp-custom .cp-add').title.includes('${tintHex.toUpperCase()}')`), true, 'nút + cho biết màu sẽ thêm');

    // chọn lại 1 màu Custom → áp dụng
    await click('.cp-custom .cp-sw[data-hex="#ff0000"]');
    assert.equal((await styleOf()).color, '#ff0000');

    // ---------- 4. xoá Custom: nút × và phím Delete ----------
    await click('#text-color-btn');
    await click(`.cp-custom .cp-sw[data-hex="${tintHex}"] + .cp-x`);
    assert.deepEqual(await customHexes(), ['#ff0000']);
    await app.ev(`document.querySelector('.cp-custom .cp-sw[data-hex="#ff0000"]').focus()`);
    await app.raw('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await app.raw('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    assert.deepEqual(await customHexes(), [], 'Delete xoá màu đang focus');
    assert.equal(await app.ev(`document.activeElement.classList.contains('cp-add')`), true, 'focus chuyển sang nút + khi hết màu');

    // ---------- 5. Automatic: khôi phục màu chữ mặc định ----------
    await click('.cp-auto');
    assert.equal((await styleOf()).color, '#ffffff');
    assert.equal(await app.ev(`getComputedStyle(document.getElementById('editor-preview-text')).color`), 'rgb(255, 255, 255)');

    // ---------- 6. bàn phím: Enter mở bảng và focus vào bên trong; mũi tên di chuyển; Esc đóng và trả focus ----------
    await app.ev(`document.getElementById('text-color-btn').focus()`);
    await app.raw('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await app.raw('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(150);
    assert.equal(await popOpen(), true);
    assert.equal(await app.ev(`!!document.activeElement.closest('.cp-pop')`), true, 'mở bằng bàn phím → focus vào trong bảng');
    assert.equal(await app.ev(`document.activeElement.classList.contains('cp-auto')`), true, 'Automatic đang chọn → focus ở đó');
    const key = (k, vk) => app.raw('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk });
    await app.ev(`document.querySelector('.cp-base .cp-sw').focus()`);
    await key('ArrowRight', 39);
    assert.equal(await app.ev(`document.activeElement.dataset.hex === document.querySelectorAll('.cp-base .cp-sw')[1].dataset.hex`), true, '→ sang ô kế bên');
    await key('ArrowDown', 40);
    assert.equal(await app.ev(`document.activeElement.closest('.cp-tint') === document.querySelectorAll('.cp-tint')[0] && [...document.activeElement.parentNode.children].indexOf(document.activeElement) === 1`), true, '↓ xuống hàng sắc độ đầu, cùng cột');
    await key('ArrowUp', 38);
    assert.equal(await app.ev(`!!document.activeElement.closest('.cp-base')`), true, '↑ về hàng gốc');
    await key('Escape', 27);
    assert.equal(await popOpen(), false);
    assert.equal(await app.ev(`document.activeElement.id`), 'text-color-btn', 'Esc trả focus về nút');
    assert.equal(await app.ev(`!!document.getElementById('song-editor-modal') && getComputedStyle(document.getElementById('song-editor-modal')).display`), 'flex', 'Esc không đóng hộp Edit Song');

    // bấm ra ngoài đóng bảng; bấm lại đúng nút đang mở = đóng
    await click('#text-color-btn');
    await app.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 400, button: 'left', clickCount: 1 });
    await app.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 400, button: 'left', clickCount: 1 });
    assert.equal(await popOpen(), false, 'bấm ra ngoài');
    await click('#text-color-btn'); await click('#text-color-btn');
    assert.equal(await popOpen(), false, 'bấm lại nút = đóng');

    // ---------- 7. Background Color: CÙNG bảng; Automatic = bỏ nền; độ mờ nền KHÔNG làm mờ chữ ----------
    await click('#bg-color-btn');
    assert.equal(await app.ev(`document.querySelector('.cp-auto').classList.contains('sel')`), true, 'chưa có nền → Automatic');
    assert.equal(await app.ev(`document.querySelectorAll('.cp-pop .cp-theme .cp-sw').length`), 60, 'cùng bảng với Text Color');
    assert.equal(await app.ev(`document.querySelector('.cp-pop').getAttribute('aria-label')`), 'Background Color');
    await click('.cp-std .cp-sw[data-hex="#0070c0"]');
    const bg = await styleOf();
    assert.equal(bg.box.enabled, true); assert.equal(bg.box.backgroundColor, '#0070c0'); assert.equal(bg.box.backgroundOpacity, 0.8);
    assert.equal(bg.color, '#ffffff', 'đổi nền không đổi màu chữ');
    const look = await app.ev(`(() => { const layer = document.querySelector('#editor-text-box .text-box-style-layer'); const t = document.getElementById('editor-preview-text');
      return { layerBg: getComputedStyle(layer).backgroundColor, layerDisp: getComputedStyle(layer).display, textOpacity: getComputedStyle(t).opacity, textColor: getComputedStyle(t).color,
               ind: getComputedStyle(document.getElementById('bg-color-indicator')).backgroundColor }; })()`);
    assert.equal(look.layerDisp, 'block'); assert.equal(look.layerBg, 'rgba(0, 112, 192, 0.8)');
    assert.equal(look.textOpacity, '1', 'độ mờ nền không ảnh hưởng độ mờ chữ'); assert.equal(look.textColor, 'rgb(255, 255, 255)');
    assert.equal(look.ind, 'rgb(0, 112, 192)');
    await click('#bg-color-btn');
    assert.equal(await app.ev(`document.querySelector('.cp-std .cp-sw.sel').dataset.hex`), '#0070c0');
    await click('.cp-auto');
    assert.equal((await styleOf()).box.enabled, false);
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('#editor-text-box .text-box-style-layer')).display`), 'none', 'Automatic bỏ nền');
    assert.equal(await app.ev(`document.getElementById('bg-color-indicator').classList.contains('none')`), true);

    // ---------- 8. lưu bài: màu chữ + nền vào song.style; mở lại thấy đúng ----------
    await click('#text-color-btn'); await click('.cp-std .cp-sw[data-hex="#ffff00"]');
    await click('#bg-color-btn'); await click('.cp-std .cp-sw[data-hex="#7030a0"]');
    await click('#text-color-btn'); await click('.cp-custom .cp-add');   // lưu #ffff00 vào Custom để kiểm tra lưu bền
    await app.ev(`saveSong(true)`); await sleep(800);
    const saved = await app.ev(`(async () => { const s = await window.electronAPI.loadSongs(); const x = s.find((y) => y.id === ${SONG_ID}); return { color: x.style.color, box: x.style.boxStyle, lyrics: x.lyrics }; })()`);
    assert.equal(saved.color, '#ffff00'); assert.equal(saved.box.enabled, true); assert.equal(saved.box.backgroundColor, '#7030a0');
    assert.equal(saved.lyrics, 'Đoạn 1\nChúa chính Ngài là VUA\n\nĐiệp khúc\nHallelujah', 'lời không đổi');
    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));

    await sleep(6000);   // chờ localStorage kịp ghi xuống đĩa trước khi tắt app
  } finally { await app.close(); }

  // ---------- 9. khởi động lại app: Custom Colors và màu đã lưu vẫn còn ----------
  app = await launchApp({ appDir: copy.dir, instanceId });
  try {
    await app.ev(OPEN); await sleep(700);
    assert.equal(await app.ev(`editorStyle.color`), '#ffff00');
    assert.equal(await app.ev(`seBoxBgCurrent()`), '#7030a0');
    await app.ev(`document.getElementById('text-color-btn').click()`);
    assert.deepEqual(await app.ev(`[...document.querySelectorAll('.cp-pop .cp-custom .cp-sw')].map((b) => b.dataset.hex)`), ['#ffff00'], 'Custom Colors sống qua khởi động lại');
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});
