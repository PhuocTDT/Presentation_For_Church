// E2E (app Electron thật) — Ngôn ngữ giao diện Việt/Anh: chọn ở Cài đặt → Chung, đổi thử ngay, Huỷ khôi phục đúng nguyên văn,
// Lưu → settings.json + nhớ sau khi mở lại, nội dung người dùng KHÔNG bị dịch, chuỗi do JS dựng động vẫn được dịch,
// và giá trị lạ trong settings.json bị làm sạch.
//   node --test test/i18n.e2e.mjs      (mở cửa sổ Electron, ~1 phút)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const instances = []; const copies = [];
after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
});
// Tên bài cố ý trùng một chuỗi giao diện ("Xóa") để chứng minh nội dung người dùng không bị dịch.
const SONGS = [{ id: 1700000000001, type: 'song', title: 'Xóa', lyrics: 'Dòng một\nDòng hai\n\nĐiệp khúc\nHallelujah', style: { fontFamily: 'CMG Sans', fontSize: '60px', color: '#ffffff' }, background: null }];

async function open(id) {
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId: id });
  await app.raw('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  return app;
}
const snap = (app) => app.ev(`({
  lang: document.documentElement.getAttribute('lang'), saved: globalSettings.language, api: I18N.lang,
  nav: [...document.querySelectorAll('#settings-modal .stg-nav-item')].map((e) => e.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 3),
  search: document.getElementById('stgSearchInput').getAttribute('placeholder'), title: document.querySelector('#settings-modal .stg-head h1').textContent.trim(),
  sel: document.getElementById('settings-language').value,
  schedTitle: (document.querySelector('[data-schedule-item] .truncate') || {}).textContent
})`);
const VI_NAV = ['Chung', 'Giao diện', 'Hiển thị Live'];

test('mặc định tiếng Việt; chọn English đổi thử ngay, Huỷ khôi phục; Lưu → nhớ qua lần mở lại; nội dung người dùng không bị dịch', async () => {
  const id = 'e2e-i18n-' + Math.random().toString(36).slice(2, 8); instances.push(id);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  let app = await open(id);
  try {
    await app.ev(`(async () => { await new Promise(r => setTimeout(r, 500)); addToSchedule(songLibrary[0]); selectScheduleItem(0); })()`);
    // --- mặc định ---
    await app.ev(`openSettings()`); await sleep(300);
    let s = await snap(app);
    assert.deepEqual([s.lang, s.saved, s.api, s.sel], ['vi', 'vi', 'vi', 'vi']); assert.deepEqual(s.nav, VI_NAV);
    assert.equal(s.title, 'Cài đặt'); assert.equal(s.search, 'Tìm cài đặt...');
    const viTexts = await app.ev(`[...document.querySelectorAll('#settings-modal .stg-label')].map((e) => e.textContent)`);

    // --- chọn English: đổi thử NGAY (chưa lưu) ---
    await app.ev(`(() => { const l = document.getElementById('settings-language'); l.value = 'en'; l.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
    s = await snap(app);
    assert.deepEqual([s.lang, s.api, s.saved], ['en', 'en', 'vi'], 'đổi thử, chưa ghi vào cài đặt');
    assert.deepEqual(s.nav, ['General', 'Appearance', 'Live display']); assert.equal(s.title, 'Settings'); assert.equal(s.search, 'Search settings...');
    assert.equal(s.schedTitle, 'Xóa', 'tên bài của người dùng KHÔNG được dịch dù trùng chuỗi giao diện');
    // chuỗi do JS dựng động (sau khi đã chọn English) cũng được dịch; vùng data-no-i18n thì không
    const dyn = await app.ev(`(async () => {
      const a = document.createElement('div'); a.id = 'dyn-a'; a.textContent = 'Chưa có ai kết nối.'; document.body.appendChild(a);
      const b = document.createElement('div'); b.setAttribute('data-no-i18n', ''); b.id = 'dyn-b'; b.textContent = 'Chưa có ai kết nối.'; document.body.appendChild(b);
      const c = document.createElement('button'); c.id = 'dyn-c'; c.setAttribute('title', 'Xoá ảnh này'); document.body.appendChild(c);
      await new Promise((r) => setTimeout(r, 150));
      const d = document.createElement('div'); d.id = 'dyn-d'; d.textContent = 'Đã export 7 bài hát.'; document.body.appendChild(d);
      await new Promise((r) => setTimeout(r, 150));
      return { a: a.textContent, b: b.textContent, c: c.getAttribute('title'), d: d.textContent };
    })()`);
    assert.deepEqual(dyn, { a: 'No one is connected.', b: 'Chưa có ai kết nối.', c: 'Delete this image', d: 'Exported 7 songs.' });

    // --- Huỷ: quay về đúng nguyên văn tiếng Việt, ô chọn về 'vi' ---
    await app.ev(`closeSettings(true)`); await sleep(300);
    await app.ev(`openSettings()`); await sleep(300);
    s = await snap(app);
    assert.deepEqual([s.lang, s.api, s.saved, s.sel], ['vi', 'vi', 'vi', 'vi']); assert.deepEqual(s.nav, VI_NAV); assert.equal(s.search, 'Tìm cài đặt...');
    assert.deepEqual(await app.ev(`[...document.querySelectorAll('#settings-modal .stg-label')].map((e) => e.textContent)`), viTexts, 'khôi phục y nguyên văn bản gốc');
    // saveSettings() chạy từ chỗ khác sau khi Huỷ không được ghi English
    await app.ev(`closeSettings(true)`); await app.ev(`saveSettings()`); await sleep(300);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).language, 'en');

    // --- chọn English rồi Lưu ---
    await app.ev(`openSettings(); (() => { const l = document.getElementById('settings-language'); l.value = 'en'; l.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await app.ev(`saveSettings()`); await sleep(500);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).language, 'en');
    assert.equal((await snap(app)).lang, 'en');
    assert.deepEqual(app.exceptions, [], 'không có exception');
    await app.close();

    // --- mở lại: vẫn English ---
    app = await open(id);
    await app.ev(`openSettings()`); await sleep(300);
    s = await snap(app);
    assert.deepEqual([s.lang, s.saved, s.sel], ['en', 'en', 'en']); assert.deepEqual(s.nav, ['General', 'Appearance', 'Live display']);
    assert.equal(s.schedTitle === undefined || s.schedTitle === 'Xóa', true);

    // --- quay lại Tiếng Việt rồi Lưu: khôi phục nguyên văn ---
    await app.ev(`(() => { const l = document.getElementById('settings-language'); l.value = 'vi'; l.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await app.ev(`saveSettings()`); await sleep(500);
    await app.ev(`openSettings()`); await sleep(300);
    s = await snap(app);
    assert.deepEqual([s.lang, s.saved], ['vi', 'vi']); assert.deepEqual(s.nav, VI_NAV);
    assert.deepEqual(await app.ev(`[...document.querySelectorAll('#settings-modal .stg-label')].map((e) => e.textContent)`), viTexts);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).language, 'vi');
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});

test('giá trị ngôn ngữ lạ / file cũ không có trường language → tiếng Việt', async () => {
  const id = 'e2e-i18n-' + Math.random().toString(36).slice(2, 8); instances.push(id);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(SONGS));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'light', language: 'fr<script>' }));
  let app = await open(id);
  try {
    assert.deepEqual(await app.ev(`({ s: globalSettings.language, l: document.documentElement.getAttribute('lang'), api: I18N.lang })`), { s: 'vi', l: 'vi', api: 'vi' });
    await app.close();
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'light' }));
    app = await open(id);
    assert.equal(await app.ev(`globalSettings.language`), 'vi');
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});
