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
        monPanel: (() => { const sec = document.querySelector('#bottom-row > section:nth-of-type(3)'); const med = document.querySelector('#bottom-row > section:nth-of-type(2)'); return { own: !!sec && !!sec.querySelector('#media-monitor-output-box'), mediaHasNone: !med.querySelector('#media-monitor-output-box'), hdrH: Math.round(sec.firstElementChild.getBoundingClientRect().height), n: document.querySelectorAll('#bottom-row > section').length, aligned: Math.abs(sec.getBoundingClientRect().left - document.querySelector('#top-row > section:nth-of-type(3)').getBoundingClientRect().left) < 3 }; })(), tabIco: !!document.querySelector('#bandPanelTab .ico'), tabW: Math.round(document.getElementById('bandPanelTab').getBoundingClientRect().width), tabClears: document.getElementById('bandPanelTab').getBoundingClientRect().bottom <= document.querySelector('#bottom-row > section:nth-of-type(1)').getBoundingClientRect().top, tabFont: getComputedStyle(document.getElementById('bandPanelTab')).fontSize,
        footerR: cs('body > footer', 'borderTopLeftRadius'), tab: cs('#bandPanelTab', 'backgroundColor') };
    })()`);
    assert.equal(m.skin, 'mist'); assert.equal(m.dark, false);
    assert.equal(m.bodyBg, 'rgb(228, 235, 238)'); assert.equal(m.panelR, '12px'); assert.equal(m.hdrH, 26);
    assert.equal(m.hdrBg, 'rgba(0, 0, 0, 0)', 'kiểu E: header không tô màu');
    assert.equal(m.topBar, 'rgb(13, 148, 136)', 'kiểu E: vạch màu nhấn trên đầu thẻ');
    assert.equal(m.sel, 'rgb(185, 231, 223)'); assert.equal(m.selText, 'rgb(3, 63, 57)');
    assert.equal(m.goLive, 'rgb(13, 148, 136)', 'Go Live dùng màu nhấn'); assert.equal(m.liveBtn, 'rgb(239, 75, 72)', 'nút Live dùng màu LIVE');
    assert.equal(m.libSel, 'rgb(185, 231, 223)', 'hàng bài đang chọn trong thư viện đổi theo màu chọn của skin (style JS dạng rgb)');
    assert.deepEqual(m.monPanel, { own: true, mediaHasNone: true, hdrH: 26, n: 3, aligned: true }, 'Screen Monitor là panel RIÊNG (header 26px), không lồng trong Media, thẳng cột với Live');
    assert.ok(m.tabIco && m.tabW >= 24 && m.tabW <= 32, 'nút Chat có icon và nhỏ gọn (rộng ' + m.tabW + 'px)');
    assert.equal(m.tabFont, '15px', 'chữ Chat to hơn');
    assert.equal(m.tabClears, true, 'nút Chat nằm trên header thư viện, không che chữ Songs');
    assert.equal(m.footerR, '12px'); assert.equal(m.tab, 'rgb(224, 138, 0)', 'nút Kênh Band có màu riêng (hổ phách trong Mist)');

    // khung Kênh Band mở theo mẫu: thẻ bo góc nằm dưới thanh menu, có dòng số người online cố định, nút Xóa/Kết nối là icon
    const bp = await app.ev(`(() => { document.getElementById('bandPanel').classList.add('open'); document.body.classList.add('bp-open');
      const p = document.getElementById('bandPanel'), cs = getComputedStyle(p), bar = document.getElementById('appMenubar').getBoundingClientRect(), line = document.getElementById('bpOnlineLine');
      const r = { top: Math.round(p.getBoundingClientRect().top), barBottom: Math.round(bar.bottom), radius: cs.borderTopLeftRadius, bodyPad: getComputedStyle(document.body).paddingLeft,
        mainLeft: getComputedStyle(document.getElementById('main-container')).marginLeft, line: line.textContent, lineShown: getComputedStyle(line).display !== 'none',
        clearIcon: getComputedStyle(document.getElementById('bpClear'), '::before').content, linkIcon: getComputedStyle(document.getElementById('bpDetailsToggle'), '::before').content,
        headH: Math.round(document.querySelector('#bandPanel .bp-head').getBoundingClientRect().height), goBg: getComputedStyle(document.getElementById('bpToggle')).backgroundColor, titleCss: (() => { const c = getComputedStyle(document.querySelector('#bandPanel .bp-title')); return [c.fontSize, c.textTransform, c.letterSpacing].join('|'); })(), tabTop: getComputedStyle(document.getElementById('bandPanelTab')).top };
      document.getElementById('bandPanel').classList.remove('open'); document.body.classList.remove('bp-open'); return r; })()`);
    assert.ok(bp.top >= bp.barBottom - 1, 'khung Kênh Band nằm DƯỚI thanh menu (top ' + bp.top + ' ≥ ' + bp.barBottom + ')');
    assert.equal(bp.radius, '12px'); assert.equal(bp.bodyPad, '0px', 'thanh menu chạy hết chiều ngang (không dịch bằng padding body)'); assert.equal(bp.mainLeft, '340px');
    assert.match(bp.line, /thành viên đang online$/); assert.equal(bp.lineShown, true); assert.equal(bp.headH, 26);
    assert.deepEqual([bp.clearIcon, bp.linkIcon], ['"delete_sweep"', '"link"'], 'Xóa/Kết nối là icon');
    assert.equal(bp.goBg, 'rgb(47, 138, 85)', 'nút Bắt đầu: xanh lá có khung');
    assert.deepEqual(await app.ev(`['Phước Hạnh Channel', 'phước hạnh   CHANNEL ', 'Channel', 'Nhóm Channel Hát', ''].map(window.__bandDisplayName)`),
      ['Phước Hạnh', 'phước hạnh', 'Channel', 'Nhóm Channel Hát', ''], 'tên phòng bỏ chữ Channel ở cuối, không làm rỗng tên');
    // danh sách thư viện kiểu Sage: hàng bo góc, thụt lề, hàng đang chọn có thanh trái
    const rows = await app.ev(`(() => { const r = [...document.querySelectorAll('tbody tr[data-library-key]')].find((x) => x.style.backgroundColor); const c = r && getComputedStyle(r);
      return r ? { radius: c.borderTopLeftRadius, margin: c.marginLeft, bar: c.boxShadow.includes('inset') } : null; })()`);
    assert.deepEqual(rows, { radius: '8px', margin: '6px', bar: true }, 'hàng thư viện đang chọn: bo góc 8px, thụt lề 6px, có thanh trái'); 
    assert.equal(bp.titleCss, '11px|none|normal', 'tên phòng: chữ thường, 11px, không giãn chữ (đọc đủ, không bị cắt)');

    // thanh menu tùy biến (thay thanh gốc của HĐH): có logo/tên app/5 menu thật/phiên bản, bo 2 góc DƯỚI; submenu mở bằng IPC
    for (let i = 0; i < 20 && !(await app.ev(`document.querySelectorAll('#ambMenus button').length`)); i++) await sleep(150);
    const mb = await app.ev(`(() => { const b = document.getElementById('appMenubar'), cs = getComputedStyle(b);
      return { shown: !b.hidden && cs.display !== 'none', labels: [...b.querySelectorAll('#ambMenus button')].map((x) => x.textContent.trim()), h: Math.round(b.getBoundingClientRect().height),
        rBottom: cs.borderBottomLeftRadius, rTop: cs.borderTopLeftRadius, brand: b.querySelector('.amb-brand').textContent, ver: document.getElementById('ambVer').textContent }; })()`);
    assert.equal(mb.shown, true); assert.deepEqual(mb.labels, ['File', 'Edit', 'View', 'Channel', 'Trợ giúp'], 'nút lấy từ menu thật');
    assert.equal(mb.h, 28); assert.equal(mb.rBottom, '12px'); assert.equal(mb.rTop, '0px', 'chỉ bo 2 góc dưới'); assert.equal(mb.brand, 'Presentation For Church'); assert.match(mb.ver, /^v\d/);
    assert.deepEqual(await app.ev(`electronAPI.appMenuLabels()`), mb.labels);
    assert.equal(await app.ev(`electronAPI.appMenuPopup(99, 0, 0)`), false, 'chỉ số menu không tồn tại → không mở gì');

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
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('#bottom-row > section:nth-of-type(3)').firstElementChild).backgroundColor`), 'rgb(15, 90, 84)', 'header Screen Monitor theo kiểu header như mọi panel');
    // nút ON/OFF của monitor và nút câu tiếp theo vẫn chạy sau khi tách panel
    const mon = await app.ev(`(() => { toggleMonitor('media'); const off = document.getElementById('btn-toggle-media-monitor').textContent.trim(); const hidden = document.getElementById('media-monitor-output-box').classList.contains('hidden'); toggleMonitor('media'); return { off, hidden, on: document.getElementById('btn-toggle-media-monitor').textContent.trim() }; })()`);
    assert.deepEqual(mon, { off: 'OFF', hidden: true, on: 'ON' });
    await app.ev(`globalSettings.uiSkin = 'studio'; applySettings()`); await sleep(200);
    const stu = await app.ev(`({ dark: document.documentElement.classList.contains('dark'), top2: getComputedStyle(document.querySelectorAll('.panel')[1]).borderTopColor })`);
    assert.equal(stu.dark, true); assert.equal(stu.top2, 'rgb(34, 211, 238)', 'Studio: Preview có viền cyan');
    // nút Chat khi có tin chưa đọc: dài ra thì mọc lên trên (không đè header "Songs"), có nhịp tim + 2 vòng sóng
    const unread = await app.ev(`(() => { const t = document.getElementById('bandPanelTab'), top0 = t.getBoundingClientRect().bottom; t.classList.add('has-unread'); document.getElementById('bandPanelTabCount').textContent = '12';
      const r = t.getBoundingClientRect(), hdr = document.querySelector('#bottom-row > section:nth-of-type(1)').getBoundingClientRect();
      const out = { bottomSame: Math.abs(r.bottom - top0) < 1.5, clears: r.bottom <= hdr.top, anim: getComputedStyle(t).animationName, wave: getComputedStyle(t, '::before').animationName + '|' + getComputedStyle(t, '::after').animationName };
      t.classList.remove('has-unread'); return out; })()`);
    assert.deepEqual(unread, { bottomSame: true, clears: true, anim: 'bpTabBeat', wave: 'bpTabWave|bpTabWave' }, 'nút Chat có tin mới: neo cạnh dưới, không đè Songs, có heartbeat + sóng lan');
    // header Library theo mẫu: chỉ 1 nút "bài mới" (Import/Export ẩn, vẫn có ở menu File); ô tìm kiếm cao 22px
    const lh = await app.ev(`(() => { const d = (id) => getComputedStyle(document.getElementById(id)).display; return { nb: d('header-newsong-btn'), imp: d('header-import-btn'), exp: d('header-export-btn'), search: getComputedStyle(document.getElementById('library-search')).height }; })()`);
    assert.deepEqual(lh, { nb: 'flex', imp: 'none', exp: 'none', search: '22px' }, 'header Library: 1 nút bài mới, tìm kiếm 22px');
    // mục đang chọn KHÔNG in đậm (chữ đậm rộng hơn → câu dài rớt dòng); nhãn ON AIR là viên thuốc đỏ như mẫu
    const w = await app.ev(`(() => { const r = [...document.querySelectorAll('tbody tr[data-library-key]')].find((x) => x.style.backgroundColor), s = document.querySelector('[data-schedule-item].bg-blue-500'), sl = document.querySelector('#live-slides-container > div > div:last-child, #preview-slides-container > div > div:last-child');
      const chip = document.querySelector('#live-slides-container [class*="text-[7px]"]');
      return { lib: r && getComputedStyle(r.querySelector('td')).fontWeight, sch: s && getComputedStyle(s.querySelector('span,div')).fontWeight, slide: sl && getComputedStyle(sl).fontWeight, chipRadius: chip && getComputedStyle(chip).borderTopLeftRadius, chipBg: chip && getComputedStyle(chip).backgroundColor }; })()`);
    assert.deepEqual([w.lib, w.sch, w.slide].filter((x) => x != null), ['500', '500', '500'].slice(0, [w.lib, w.sch, w.slide].filter((x) => x != null).length), 'mục đang chọn không in đậm ' + JSON.stringify(w)); assert.ok(w.sch === '500' && w.slide === '500', 'Schedule + slide đang chọn: ' + JSON.stringify(w));
    if (w.chipRadius) { assert.equal(w.chipRadius, '99px', 'ON AIR là viên thuốc'); assert.notEqual(w.chipBg, 'rgba(255, 255, 255, 0.2)', 'ON AIR không còn ô xám mờ'); }
    // pop-up / hộp thoại theo skin (Studio, tối): Cài đặt, Edit Song (màu nhấn), hộp Tailwind (Kinh Thánh), hộp thoại trong trang, menu chuột phải
    const pop = await app.ev(`(() => {
      const col = (el, v) => { const p = document.createElement('i'); p.style.color = 'var(' + v + ')'; el.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
      const root = document.documentElement, rootAcc = (() => { const p = document.createElement('i'); p.style.color = 'var(--u-accent)'; root.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })();
      const bible = document.querySelector('#bible-selector-modal > div'); document.getElementById('bible-selector-modal').style.display = 'flex';
      askConfirm('Xoá thử?', { danger: true, okText: 'Xoá' });
      const dlg = document.querySelector('.ws-dialog'), dbtn = dlg && dlg.querySelector('.ws-rv-btn:not(.danger)');
      const r = {
        rootAcc, stgAcc: col(document.getElementById('settings-modal'), '--stg-accent'), seAcc: col(document.getElementById('song-editor-modal'), '--se-accent'),
        stgSurface: col(document.getElementById('settings-modal'), '--stg-surface'),
        bibleBg: getComputedStyle(bible).backgroundColor, panelBg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
        dlgBg: dlg && getComputedStyle(dlg).backgroundColor, dlgBtn: dbtn && getComputedStyle(dbtn).backgroundColor, dlgRadius: dlg && getComputedStyle(dlg).borderTopLeftRadius,
        ctxBg: getComputedStyle(document.getElementById('context-menu')).backgroundColor };
      document.getElementById('bible-selector-modal').style.display = 'none'; document.querySelectorAll('.ws-dialog-ov').forEach((n) => n.remove());
      return r; })()`);
    assert.equal(pop.stgAcc, pop.rootAcc, 'Cài đặt dùng màu nhấn của skin'); assert.equal(pop.seAcc, pop.rootAcc, 'Edit Song dùng màu nhấn của skin');
    assert.notEqual(pop.stgSurface, 'rgb(26, 24, 48)', 'Cài đặt không còn nền tím mặc định');
    assert.equal(pop.bibleBg, pop.panelBg, 'hộp Kinh Thánh (class Tailwind) cùng màu nền panel của skin');
    assert.equal(pop.dlgBg, pop.panelBg, 'hộp thoại xác nhận theo màu panel của skin'); assert.notEqual(pop.dlgBtn, 'rgb(255, 255, 255)', 'nút Hủy của hộp thoại không còn trắng');
    assert.equal(pop.dlgRadius, '12px', 'hộp thoại bo góc theo skin'); assert.notEqual(pop.ctxBg, 'rgb(255, 255, 255)', 'menu chuột phải theo skin');
    // quay lại Cổ điển: sạch thuộc tính, giao diện gốc trở lại
    await app.ev(`globalSettings.uiSkin = 'classic'; applySettings()`); await sleep(200);
    assert.deepEqual(await app.ev(`['header-newsong-btn', 'header-import-btn'].map((id) => getComputedStyle(document.getElementById(id)).display)`), ['none', 'flex'], 'Cổ điển: header Library giữ Import/Export, không có nút bài mới');
    await app.ev(`globalSettings.uiSkin = 'studio'; applySettings()`); await sleep(200);
    await app.ev(`globalSettings.uiSkin = 'classic'; applySettings()`); await sleep(200);
    const back = await app.ev(`({ skin: document.documentElement.getAttribute('data-ui-skin'), hdr: document.documentElement.getAttribute('data-ui-hdr'), bg: getComputedStyle(document.querySelector('.panel > div:first-child')).backgroundColor })`);
    assert.deepEqual([back.skin, back.hdr, back.bg], [null, null, 'rgb(30, 41, 59)']);
    assert.equal(await app.ev(`document.getElementById('appMenubar').hidden`), true, 'Cổ điển: ẩn thanh menu tùy biến (dùng lại thanh gốc của HĐH)');
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
