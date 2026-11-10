// E2E (app Electron thật) — vỏ giao diện mới của hộp Edit Song: header xem trước + toàn màn hình, Help & Tips,
// biểu tượng mắt mở panel Text/Background/Animation, phạm vi áp dụng theo vùng chọn, và những thứ KHÔNG được hỏng
// (lưu lời nguyên vẹn, tab Slides, phím tắt toàn cục không chạy khi hộp đang mở).
//   node --test test/editor-shell.e2e.mjs      (mở cửa sổ Electron, ~30 giây)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});

const LYRICS = 'Đoạn 1\nChúa chính Ngài là VUA của muôn đời\nDòng hai\n\nĐiệp khúc\nHallelujah';

test('hộp Edit Song: header xem trước, Help & Tips, mắt + panel, phạm vi vùng chọn, lưu lời không đổi', async () => {
  const instanceId = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(instanceId);
  const ud = instanceUserDataDir(instanceId);
  fs.mkdirSync(ud, { recursive: true });
  const song = { id: 1700000000001, type: 'song', title: 'Bài thử', lyrics: LYRICS, style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' }, background: null };
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify([song]));
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  try {
    await app.ev(`(async () => { const songs = await window.electronAPI.loadSongs(); openSongEditor('Edit Song', songs.find((x) => x.id === 1700000000001)); })()`);
    await new Promise((r) => setTimeout(r, 800));

    // --- bố cục mới ---
    const layout = await app.ev(`(() => {
      const q = (s) => document.querySelector(s);
      const vis = (el) => !!el && el.getClientRects().length > 0;
      return {
        head: vis(q('#song-editor-modal .se-pv-head')), badge: (q('.se-live-badge') || {}).textContent, fs: vis(q('#se-fs-btn')),
        help: vis(q('#se-help-btn')), helpHidden: q('#se-help-pop').hidden,
        buttons: ['se-btn-cancel', 'se-btn-apply', 'se-btn-ok'].map((i) => vis(q('#' + i))),
        chip: vis(q('#se-preview-bgbar .se-bgchip')), eyes: document.querySelectorAll('#lyrics-editor-container .se-eye').length,
        oldHint: !!q('.se-hint')
      };
    })()`);
    assert.equal(layout.head, true); assert.equal(layout.badge, 'Live Preview'); assert.equal(layout.fs, true);
    assert.equal(layout.help, true); assert.equal(layout.helpHidden, true);
    assert.deepEqual(layout.buttons, [true, true, true]);
    assert.equal(layout.chip, true, 'chip chọn nền vẫn hiện trong header');
    assert.equal(layout.eyes, 2); assert.equal(layout.oldHint, false);
    await app.screenshot(path.join(os.tmpdir(), 'editor-shell-1.png'));

    // --- Help & Tips: mở/đóng bằng nút và bằng bấm ra ngoài ---
    await app.ev(`document.getElementById('se-help-btn').click()`);
    assert.equal(await app.ev(`!document.getElementById('se-help-pop').hidden && document.getElementById('se-help-btn').getAttribute('aria-expanded')`), 'true');
    await app.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 200, button: 'left', clickCount: 1 });
    await app.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 200, button: 'left', clickCount: 1 });
    assert.equal(await app.ev(`document.getElementById('se-help-pop').hidden`), true, 'bấm ra ngoài đóng Help');

    // --- mắt: mở panel (dựng lười: thẻ chưa mở chưa có dòng phạm vi), mỗi lần chỉ một thẻ, đổi tab ---
    await app.ev(`document.querySelectorAll('#lyrics-editor-container .se-eye')[0].click()`);
    let st = await app.ev(`(() => { const b = [...document.querySelectorAll('#lyrics-editor-container .lyrics-slide-block')]; return b.map((x) => ({ open: x.classList.contains('se-seg-open'), hidden: x.querySelector('.se-seg-panel').hidden, scope: (x.querySelector('.se-seg-scope b') || {}).textContent })); })()`);
    assert.deepEqual(st.map((x) => x.open), [true, false]); assert.equal(st[0].hidden, false); assert.equal(st[0].scope, 'cả đoạn');
    await app.ev(`document.querySelectorAll('#lyrics-editor-container .se-eye')[1].click()`);
    st = await app.ev(`[...document.querySelectorAll('#lyrics-editor-container .lyrics-slide-block')].map((x) => x.classList.contains('se-seg-open'))`);
    assert.deepEqual(st, [false, true], 'mở thẻ 2 thì thẻ 1 tự đóng');
    await app.ev(`document.querySelectorAll('#lyrics-editor-container .se-eye')[0].click()`);
    await app.ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-block .se-seg-tab[data-seg-tab="bg"]').click()`);
    const tabs = await app.ev(`(() => { const b = document.querySelector('#lyrics-editor-container .lyrics-slide-block'); return [...b.querySelectorAll('.se-seg-body')].map((x) => !x.hidden); })()`);
    assert.deepEqual(tabs, [false, true, false]);

    // --- phạm vi theo vùng chọn: tô chữ "VUA" trong thẻ 1 ---
    const sel = await app.ev(`(() => {
      const cd = document.querySelector('#lyrics-editor-container .lyrics-slide-content');
      cd.focus();
      const walker = document.createTreeWalker(cd, NodeFilter.SHOW_TEXT); let n, node, off;
      while ((n = walker.nextNode())) { const i = n.nodeValue.indexOf('VUA'); if (i >= 0) { node = n; off = i; break; } }
      const r = document.createRange(); r.setStart(node, off); r.setEnd(node, off + 3);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      const b = cd.closest('.lyrics-slide-block');
      return { got: seBlockSelection(b), inner: cd.innerText.trim() };
    })()`);
    await sleep(200);   // vùng chọn được ghi nhận qua selectionchange + 1 khung hình
    sel.scope = await app.ev(`document.querySelector('#lyrics-editor-container .lyrics-slide-block .se-seg-scope b').textContent`);
    const body0 = 'Chúa chính Ngài là VUA của muôn đời\nDòng hai';
    assert.equal(sel.inner, body0, 'ô sửa lời chứa đúng chữ của thẻ 1 (đã bỏ nhãn)');
    assert.equal(sel.got.body, body0);
    assert.equal(sel.got.s, body0.indexOf('VUA')); assert.equal(sel.got.e, body0.indexOf('VUA') + 3); assert.equal(sel.got.text, 'VUA');
    assert.match(sel.scope, /VUA/); assert.match(sel.scope, new RegExp(`ký tự ${body0.indexOf('VUA')}–${body0.indexOf('VUA') + 3}`));

    // bấm tab trong panel KHÔNG làm mất vùng tô chọn (mousedown bị chặn lấy focus)
    const box = await app.ev(`(() => { const r = document.querySelector('#lyrics-editor-container .se-seg-tab[data-seg-tab="anim"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await app.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await app.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    const keep = await app.ev(`(() => { const s = window.getSelection(); return { text: s.toString(), anim: !document.querySelector('#lyrics-editor-container .se-seg-body[data-seg-body="anim"]').hidden }; })()`);
    assert.equal(keep.text, 'VUA'); assert.equal(keep.anim, true);

    // --- vị trí khớp trên nhiều kiểu DOM mà contenteditable tạo ra (br, div, dòng trống, khoảng trắng đầu) ---
    const shapes = await app.ev(`(() => {
      const cd = document.querySelector('#lyrics-editor-container .lyrics-slide-content'); const out = [];
      const html = ['a<br>b<br>cd', '<div>a</div><div>b</div><div>cd</div>', 'a<div>b</div>cd', '<div>a</div><div><br></div><div>cd</div>', '  xin<br>chào  ', '<p>a</p><p>b</p>', 'a<br><br>b', '<div><div>x</div></div>y', 'a<div>b<br>c</div>d', '<ul><li>a</li><li>b</li></ul>c', '<div>a</div><br><div>b</div>'];
      for (const h of html) {
        cd.innerHTML = h;
        const full = seSerializeNodes(cd);
        out.push({ h, ser: full.trim(), inner: cd.innerText.trim() });
      }
      return out;
    })()`);
    for (const x of shapes) assert.equal(x.ser, x.inner, 'seSerializeNodes khác innerText ở: ' + x.h);

    // --- lưu lời: khôi phục lời gốc rồi lấy lại từ editor phải y hệt (panel/mắt không lẫn vào lời) ---
    const lyricsBack = await app.ev(`(() => { renderLyricsEditor(${JSON.stringify(LYRICS)}); return getLyricsFromEditor(); })()`);
    assert.equal(lyricsBack, LYRICS);

    // --- tab Slides vẫn chạy ---
    await app.ev(`setEditorTab('slides')`);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await app.ev(`document.querySelectorAll('#slides-view-container .se-thumb').length`), 2);
    await app.ev(`setEditorTab('words')`);

    // --- toàn màn hình xem trước (bấm bằng chuột THẬT: requestFullscreen cần thao tác người dùng, .click() bằng script không đủ) ---
    const realClick = async (sel) => {
      const p = await app.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await app.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      await app.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    };
    // fullscreenchange bắn ở khung hình kế tiếp; cửa sổ không ở tiền cảnh bị hạ tần số khung hình → chờ có giới hạn thay vì chờ cố định
    const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await app.ev(expr)) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
    await realClick('#se-fs-btn');
    await waitFor(`document.querySelector('#se-fs-btn .material-symbols-outlined').textContent === 'fullscreen_exit'`);
    const fsOn = await app.ev(`({ el: (document.fullscreenElement || {}).id, icon: document.querySelector('#se-fs-btn .material-symbols-outlined').textContent, w: document.getElementById('editor-preview-box').getBoundingClientRect().width, iw: innerWidth })`);
    assert.equal(fsOn.el, 'editor-preview-box'); assert.equal(fsOn.icon, 'fullscreen_exit');
    assert.ok(fsOn.w >= fsOn.iw - 2, `khung xem trước phải lấp đầy màn hình (w=${fsOn.w}, innerWidth=${fsOn.iw})`);
    const scale = await app.ev(`document.getElementById('editor-virtual-canvas').style.transform`);
    assert.match(scale, /scale\(([\d.]+)\)/); assert.ok(+scale.match(/scale\(([\d.]+)\)/)[1] > 1, 'canvas ảo phóng to theo màn hình: ' + scale);
    await app.ev(`seToggleFullscreen()`);   // thoát: nút nằm sau khung đang toàn màn hình nên gọi thẳng hàm (người dùng thật nhấn Esc/nút)
    await waitFor(`document.querySelector('#se-fs-btn .material-symbols-outlined').textContent === 'fullscreen'`);
    assert.equal(await app.ev(`document.fullscreenElement === null && document.querySelector('#se-fs-btn .material-symbols-outlined').textContent`), 'fullscreen');

    // --- phím tắt toàn cục không chạy khi hộp đang mở: Esc không xoá màn Live, mũi tên không chuyển slide Live ---
    const before = await app.ev(`currentLiveIndex`);
    await app.ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.__clearedLive = 0; const o = window.clearLive; window.clearLive = function () { window.__clearedLive++; return o.apply(this, arguments); }; liveSlides = [{ content: 'a' }, { content: 'b' }]; true`);
    await app.raw('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await app.raw('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await app.ev(`window.__clearedLive`), 0, 'Esc khi hộp soạn đang mở không được xoá màn Live');
    assert.equal(await app.ev(`currentLiveIndex`), before);

    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
  } finally { await app.close(); }
});
