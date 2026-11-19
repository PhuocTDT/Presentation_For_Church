// Unit test i18n (Việt → Anh): từ điển phủ HẾT chữ tiếng Việt tĩnh trong index.html, quy tắc regex hợp lệ,
// và bảng dịch menu hệ điều hành trong main.js phủ hết nhãn tiếng Việt.
//   node --test test/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { DICT, RULES, BYID } = require(path.join(ROOT, 'src/i18n/en.js'));
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const norm = (s) => dec(s).replace(/\s+/g, ' ').trim();
const translatable = (key) => Object.prototype.hasOwnProperty.call(DICT, key) || RULES.some((r) => new RegExp(r[0]).test(key));

// Chuỗi tiếng Việt CỐ Ý không dịch: nội dung mẫu/ví dụ của người dùng, không phải chữ giao diện.
// 'Tiếng Việt' = tên ngôn ngữ trong ô chọn ngôn ngữ: luôn hiện bằng chính ngôn ngữ đó (ô có data-no-i18n).
const ALLOW = new Set(['Ta nhận thấy con là người tốt nhất trong thời đại này.', 'Tiếng Việt']);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');

test('từ điển: khóa đã chuẩn hóa khoảng trắng, giá trị không rỗng, quy tắc regex biên dịch được', () => {
  for (const [k, v] of Object.entries(DICT)) {
    assert.equal(k, norm(k), 'khóa phải đã gom khoảng trắng: ' + JSON.stringify(k));
    assert.ok(typeof v === 'string' && v.trim(), 'bản dịch rỗng cho: ' + k);
  }
  for (const [re, to] of RULES) { assert.doesNotThrow(() => new RegExp(re)); assert.equal(typeof to, 'string'); }
  assert.deepEqual(Object.keys(BYID), ['bpClear']);
});

test('MỌI chữ tiếng Việt tĩnh trong index.html (text node + title/placeholder/aria-label/alt) đều có bản dịch', () => {
  const missing = [];
  for (const m of body.matchAll(/>([^<>]+)</g)) { const t = norm(m[1]); if (t && VI.test(t) && !ALLOW.has(t) && !translatable(t)) missing.push('text: ' + t); }
  for (const m of body.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) { const t = norm(m[1]); if (VI.test(t) && !ALLOW.has(t) && !translatable(t)) missing.push('attr: ' + t); }
  assert.deepEqual([...new Set(missing)], [], 'Thiếu bản dịch (thêm vào src/i18n/en.js):\n' + [...new Set(missing)].join('\n'));
});

test('tab Giao diện/ngôn ngữ: các chuỗi do JS dựng (tên skin, mô tả, kiểu header) có bản dịch', () => {
  for (const vi of ['Cổ điển', 'GỐC', 'SÁNG', 'TỐI', 'NHIỀU MÀU', 'TỐI · MÀU', 'Đậm', 'Đặc', 'Sáng', 'Vạch', 'Giao diện hiện tại của ứng dụng',
    'Ngôn ngữ', 'Chung', 'Hủy', 'Huỷ', 'Xóa', 'Xoá', 'Lưu', 'Đóng', 'Bắt đầu', 'Dừng']) assert.ok(translatable(vi), 'thiếu: ' + vi);
  assert.equal(DICT['Chung'], 'General'); assert.equal(DICT['Cài đặt'], 'Settings'); assert.equal(DICT['Giao diện'], 'Appearance');
});

test('quy tắc chuỗi động: khớp toàn chuỗi và giữ tham số', () => {
  const apply = (s) => { for (const [re, to] of RULES) { const r = new RegExp(re); if (r.test(s)) return s.replace(r, to); } return null; };
  assert.equal(apply('Đã export 12 bài hát.'), 'Exported 12 songs.');
  assert.equal(apply('(3 ảnh)'), '(3 images)');
  assert.equal(apply('Xóa template "Bible White Box"?'), 'Delete template "Bible White Box"?');
  assert.equal(apply('Bạn có chắc chắn muốn xóa "Cháy lên vì gió,"?'), 'Are you sure you want to delete "Cháy lên vì gió,"?');
  assert.equal(apply('Câu hoàn toàn khác'), null, 'không có quy tắc → không đụng tới');
});

test('menu hệ điều hành (main.js): MENU_EN phủ hết nhãn tiếng Việt và translateMenuTemplate dịch đệ quy', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const a = main.indexOf('const MENU_EN = {'); const b = main.indexOf('function setupMenu(win)');
  assert.ok(a > 0 && b > a, 'không thấy MENU_EN/translateMenuTemplate trong main.js');
  const ctx = vm.createContext({}); vm.runInContext(main.slice(a, b) + '\nthis.MENU_EN = MENU_EN; this.fn = translateMenuTemplate;', ctx);
  const labels = [...main.matchAll(/label:\s*'([^']*)'/g)].map((m) => m[1]).filter((t) => VI.test(t));
  assert.ok(labels.length >= 15, 'tìm thấy ' + labels.length + ' nhãn');
  const miss = labels.filter((l) => !Object.prototype.hasOwnProperty.call(ctx.MENU_EN, l));
  assert.deepEqual(miss, [], 'nhãn menu chưa có bản dịch: ' + miss.join(' | '));
  const tpl = [{ label: 'File', submenu: [{ label: 'Cài đặt...' }, { type: 'separator' }, { label: 'Thoát ứng dụng' }] }, { label: 'Trợ giúp', submenu: [{ label: 'Liên hệ hỗ trợ' }] }];
  const en = ctx.fn(JSON.parse(JSON.stringify(tpl)), 'en');
  assert.deepEqual([en[0].submenu[0].label, en[0].submenu[2].label, en[1].label, en[1].submenu[0].label], ['Settings...', 'Quit', 'Help', 'Contact Support']);
  const vi = ctx.fn(JSON.parse(JSON.stringify(tpl)), 'vi');
  assert.deepEqual(vi, tpl, 'ngôn ngữ vi → không đổi gì');
});

test('live.html không nạp i18n (màn chiếu không có chữ giao diện cần dịch)', () => {
  assert.ok(!/i18n/.test(fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8')));
});
