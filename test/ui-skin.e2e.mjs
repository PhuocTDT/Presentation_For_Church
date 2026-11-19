// E2E (app Electron thật) — Skin giao diện cửa sổ operator: chọn trong Cài đặt → "Giao diện", xem trước, lưu/hủy,
// nhớ qua lần mở lại, dữ liệu xấu bị làm sạch, và các thứ KHÔNG được đổi (Cổ điển giữ nguyên, màn Live không nạp skin).
//   node --test test/ui-skin.e2e.mjs      (mở cửa sổ Electron, ~1 phút)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});

const SONGS = [1, 2].map((n) => ({ id: 1700000000000 + n, type: 'song', title: 'Bài thử ' + n, lyrics: `Dòng ${n} một\nDòng ${n} hai\n\nĐiệp khúc ${n}\nHallelujah`, style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' }, background: null }));

async function open(instanceId) {
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  await app.raw('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  return app;
}
const root = (app) => app.ev(`({ skin: document.documentElement.getAttribute('data-ui-skin'), hdr: document.documentElement.getAttribute('data-ui-hdr'), dark: document.documentElement.classList.contains('dark'), saved: globalSettings.uiSkin + '/' + globalSettings.uiHeader })`);
const readSettings = (id) => JSON.parse(fs.readFileSync(path.join(instanceUserDataDir(id), 'settings.json'), 'utf8'));

test('Cổ điển là mặc định (không đổi giao diện); chọn + xem trước + Lưu/Hủy + nhớ qua lần mở lại', async () => {
  const id = 'e2e-skin-' + Math.random().toString(36).slice(2, 8); instances.push(id);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  let app = await open(id);
  try {
    // --- mặc định: giao diện hiện tại, không thuộc tính skin ---
    let r = await root(app);
    assert.equal(r.skin, null, 'Cổ điển không được đặt data-ui-skin'); assert.equal(r.saved, 'classic/e');
    const classicHdr = await app.ev(`getComputedStyle(document.querySelector('.panel > div:first-child')).backgroundColor`);
    assert.equal(classicHdr, 'rgb(30, 41, 59)', 'header Cổ điển phải giữ slate-800 như cũ');

    // --- tab Giao diện có 8 phong cách + 5 kiểu header + khung xem trước ---
    await app.ev(`openSettings(); document.querySelector('#settings-modal [data-tab="giaodien"]').click()`);
    await sleep(300);
    const pane = await app.ev(`({ cards: document.querySelectorAll('#uiSkinGrid [data-skin]').length, chips: document.querySelectorAll('#uiHdrRow [data-hdr]').length,
      chipsDisabled: document.querySelectorAll('#uiHdrRow [data-hdr]:disabled').length, pressed: document.querySelector('#uiSkinGrid [aria-pressed="true"]').dataset.skin,
      prevSkin: document.getElementById('uiPreview').getAttribute('data-ui-skin'), prevPanels: document.querySelectorAll('#uiPreview .uip-p').length })`);
    assert.equal(pane.cards, 8); assert.equal(pane.chips, 5); assert.equal(pane.pressed, 'classic'); assert.equal(pane.prevSkin, 'classic');
    assert.equal(pane.chipsDisabled, 5, 'Cổ điển không có lựa chọn header');
    assert.equal(pane.prevPanels, 6);

    // --- chọn Midnight + header B: chỉ cập nhật XEM TRƯỚC, cửa sổ chính chưa đổi ---
    await app.ev(`document.querySelector('#uiSkinGrid [data-skin="midnight"]').click(); document.querySelector('#uiHdrRow [data-hdr="b"]').click()`);
    const prev = await app.ev(`({ s: document.getElementById('uiPreview').getAttribute('data-ui-skin'), h: document.getElementById('uiPreview').getAttribute('data-ui-hdr'),
      chipsDisabled: document.querySelectorAll('#uiHdrRow [data-hdr]:disabled').length,
      hdrBg: getComputedStyle(document.querySelector('#uiPreview .uip-h')).backgroundColor })`);
    assert.deepEqual([prev.s, prev.h, prev.chipsDisabled], ['midnight', 'b', 0]);
    assert.equal(prev.hdrBg, 'rgb(28, 40, 69)', 'xem trước dùng đúng token header B của Midnight');
    // cửa sổ chính phía sau đổi THỬ ngay (chỉ thuộc tính trên <html>), nhưng cài đặt đã lưu chưa đổi
    r = await root(app);
    assert.deepEqual([r.skin, r.hdr, r.dark], ['midnight', 'b', true], 'đổi thử trực tiếp trên cửa sổ chính');
    assert.equal(r.saved, 'classic/e', 'đổi thử không được ghi vào cài đặt');

    // --- Hủy: khôi phục giao diện cũ, và saveSettings() chạy từ chỗ khác KHÔNG ghi đè bằng lựa chọn bỏ dở ---
    await app.ev(`closeSettings(true)`);
    r = await root(app);
    assert.deepEqual([r.skin, r.hdr, r.dark], [null, null, false], 'Huỷ phải khôi phục Cổ điển (kể cả class dark)');
    await app.ev(`saveSettings()`); await sleep(300);
    r = await root(app); assert.equal(r.skin, null); assert.equal(readSettings(id).uiSkin, 'classic');

    // --- chọn lại rồi Lưu ---
    await app.ev(`openSettings(); document.querySelector('#settings-modal [data-tab="giaodien"]').click(); document.querySelector('#uiSkinGrid [data-skin="midnight"]').click(); document.querySelector('#uiHdrRow [data-hdr="b"]').click()`);
    await app.ev(`saveSettings()`); await sleep(500);
    r = await root(app);
    assert.deepEqual([r.skin, r.hdr, r.dark], ['midnight', 'b', true], 'skin tối ép class dark');
    const st = readSettings(id); assert.equal(st.uiSkin, 'midnight'); assert.equal(st.uiHeader, 'b');
    assert.deepEqual(app.exceptions, [], 'không có exception: ' + JSON.stringify(app.exceptions).slice(0, 300));
    await app.close();

    // --- mở lại: skin được nhớ ---
    app = await open(id);
    r = await root(app);
    assert.deepEqual([r.skin, r.hdr, r.dark], ['midnight', 'b', true], 'sau khi mở lại vẫn là Midnight/B');
  } finally { await app.close(); }
});

test('skin áp vào giao diện thật: panel bo góc, header thấp, màu chọn, nút chính; Live không nạp skin', async () => {
  const id = 'e2e-skin-' + Math.random().toString(36).slice(2, 8); instances.push(id);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'light', uiSkin: 'mist', uiHeader: 'e' }));
  const app = await open(id);
  try {
    await app.ev(`(async () => { await new Promise(r => setTimeout(r, 500)); addToSchedule(songLibrary[0]); addToSchedule(songLibrary[1]); selectScheduleItem(1); selectItemInLibrary(songLibrary[0]); })()`);
    await sleep(600);
    const m = await app.ev(`(() => { const cs = (s, p) => getComputedStyle(document.querySelector(s))[p];
      const hdr = document.querySelector('.panel > div:first-child');
      return { skin: document.documentElement.getAttribute('data-ui-skin'), dark: document.documentElement.classList.contains('dark'),
        bodyBg: cs('body', 'backgroundColor'), panelR: cs('.panel', 'borderTopLeftRadius'), hdrH: Math.round(hdr.getBoundingClientRect().height), hdrBg: getComputedStyle(hdr).backgroundColor,
        topBar: cs('.panel', 'borderTopColor'), sel: cs('[data-schedule-item].bg-blue-500', 'backgroundColor'), selText: cs('[data-schedule-item].bg-blue-500', 'color'),
        goLive: cs('button[onclick="goLiveFromPreview()"]', 'backgroundColor'), liveBtn: cs('button[onclick="liveCurrent()"]', 'backgroundColor'),
        libSel: (() => { const r = [...document.querySelectorAll('tbody tr[data-library-key]')].find((x) => x.style.backgroundColor); return r ? getComputedStyle(r).backgroundColor : 'không có hàng được chọn'; })(),
        monSubH: Math.round(document.querySelector('.panel .h-8.shrink-0').getBoundingClientRect().height), tabIco: !!document.querySelector('#bandPanelTab .ico'), tabW: Math.round(document.getElementById('bandPanelTab').getBoundingClientRect().width),
        footerR: cs('body > footer', 'borderTopLeftRadius'), tab: cs('#bandPanelTab', 'backgroundColor') };
    })()`);
    assert.equal(m.skin, 'mist'); assert.equal(m.dark, false);
    assert.equal(m.bodyBg, 'rgb(228, 235, 238)'); assert.equal(m.panelR, '12px'); assert.equal(m.hdrH, 24);
    assert.equal(m.hdrBg, 'rgba(0, 0, 0, 0)', 'kiểu E: header không tô màu');
    assert.equal(m.topBar, 'rgb(13, 148, 136)', 'kiểu E: vạch màu nhấn trên đầu thẻ');
    assert.equal(m.sel, 'rgb(185, 231, 223)'); assert.equal(m.selText, 'rgb(3, 63, 57)');
    assert.equal(m.goLive, 'rgb(13, 148, 136)', 'Go Live dùng màu nhấn'); assert.equal(m.liveBtn, 'rgb(239, 75, 72)', 'nút Live dùng màu LIVE');
    assert.equal(m.libSel, 'rgb(185, 231, 223)', 'hàng bài đang chọn trong thư viện đổi theo màu chọn của skin (style JS dạng rgb)');
    assert.equal(m.monSubH, 22, 'thanh Screen Monitor là thanh con mảnh, không phải header');
    assert.ok(m.tabIco && m.tabW <= 30, 'nút Chat có icon và gọn (rộng ' + m.tabW + 'px)');
    assert.equal(m.footerR, '12px'); assert.equal(m.tab, 'rgb(224, 138, 0)', 'nút Kênh Band có màu riêng (hổ phách trong Mist)');

    // đang lưu Mist: mở Cài đặt, thử Candy → cửa sổ chính thành Candy; Huỷ → trở lại đúng Mist/E
    await app.ev(`openSettings(); document.querySelector('#settings-modal [data-tab="giaodien"]').click(); document.querySelector('#uiSkinGrid [data-skin="candy"]').click()`);
    await sleep(200);
    assert.equal(await app.ev(`document.documentElement.getAttribute('data-ui-skin')`), 'candy');
    await app.ev(`closeSettings(true)`); await sleep(200);
    const kept = await app.ev(`({ s: document.documentElement.getAttribute('data-ui-skin'), h: document.documentElement.getAttribute('data-ui-hdr') })`);
    assert.deepEqual([kept.s, kept.h], ['mist', 'e'], 'Huỷ giữ nguyên skin ĐÃ LƯU, không phải skin đang thử');

    // đổi sang kiểu A → header tô màu đậm; Studio → viền màu theo khu vực
    await app.ev(`globalSettings.uiHeader = 'a'; applySettings()`); await sleep(200);
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('.panel > div:first-child')).backgroundColor`), 'rgb(15, 90, 84)');
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('.panel .h-8.shrink-0')).backgroundColor`), 'rgba(0, 0, 0, 0)', 'kiểu header A không được tô thanh con Screen Monitor');
    await app.ev(`globalSettings.uiSkin = 'studio'; applySettings()`); await sleep(200);
    const stu = await app.ev(`({ dark: document.documentElement.classList.contains('dark'), top2: getComputedStyle(document.querySelectorAll('.panel')[1]).borderTopColor })`);
    assert.equal(stu.dark, true); assert.equal(stu.top2, 'rgb(34, 211, 238)', 'Studio: Preview có viền cyan');
    // quay lại Cổ điển: sạch thuộc tính, giao diện gốc trở lại
    await app.ev(`globalSettings.uiSkin = 'classic'; applySettings()`); await sleep(200);
    const back = await app.ev(`({ skin: document.documentElement.getAttribute('data-ui-skin'), hdr: document.documentElement.getAttribute('data-ui-hdr'), bg: getComputedStyle(document.querySelector('.panel > div:first-child')).backgroundColor })`);
    assert.deepEqual([back.skin, back.hdr, back.bg], [null, null, 'rgb(30, 41, 59)']);
    assert.deepEqual(app.exceptions, [], 'không có exception');
  } finally { await app.close(); }

  // Live (màn chiếu) KHÔNG nạp skin
  assert.ok(!/ui-themes/.test(fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8')), 'live.html không được nạp ui-themes.css');
});

test('cài đặt xấu/cũ được làm sạch: skin lạ → Cổ điển, header lạ → E, file cũ không có trường skin vẫn chạy', async () => {
  const id = 'e2e-skin-' + Math.random().toString(36).slice(2, 8); instances.push(id);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'dark', uiSkin: 'evil"><img src=x onerror=alert(1)>', uiHeader: 'z' }));
  let app = await open(id);
  try {
    let r = await root(app);
    assert.equal(r.skin, null); assert.equal(r.saved, 'classic/e'); assert.equal(r.dark, true, 'Dark Mode cũ (Cổ điển) vẫn hoạt động');
    await app.close();
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'light' }));   // file cũ: chưa có uiSkin/uiHeader
    app = await open(id);
    r = await root(app);
    assert.equal(r.saved, 'classic/e'); assert.equal(r.skin, null);
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});
