// website/privacy.html phải khớp với hành vi thật của code (thời hạn lưu, số tin giữ lại…) và không có script.
//   node --test test/privacy-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const page = read('website/privacy.html');
const relay = read('cloud/worker/src/room-relay.js');
const worker = read('cloud/worker/src/worker.js');
const days = (re, src, label) => {
  const m = re.exec(src); assert.ok(m, 'không tìm thấy hằng số ' + label);
  return Number(m[1]);
};

test('trang có đủ hai ngôn ngữ, mục lục và liên hệ', () => {
  assert.match(page, /<section id="vi">/); assert.match(page, /<section id="en">/);
  assert.match(page, /Chính sách quyền riêng tư/); assert.match(page, /Privacy Policy/);
  assert.match(page, /PhuocTDT/);
  assert.match(page, /mailto:/);
});

test('CSP của trang chặn script và không cho nguồn ngoài', () => {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page);
  assert.ok(csp, 'thiếu CSP');
  assert.match(csp[1], /default-src 'none'/);
  assert.ok(!/script-src/.test(csp[1]), 'không cần script-src');
  assert.ok(!/https?:/.test(csp[1].replace(/frame-ancestors[^;]*/, '')), 'CSP không được cho nguồn ngoài');
  assert.ok(!/<script\b/i.test(page), 'trang không được có <script>');
});

test('mọi ô điền còn lại chỉ là {{CONTACT_EMAIL}} (cổng scripts/check-privacy-page.js chặn đăng khi còn)', () => {
  const left = new Set(page.match(/\{\{[A-Z_]+\}\}/g) || []);
  assert.deepEqual([...left].filter((x) => x !== '{{CONTACT_EMAIL}}'), []);
});

test('thời hạn lưu trong chính sách khớp hằng số trong code', () => {
  // setlist: 7 ngày
  assert.equal(days(/const TTL_SECONDS = (\d+) \* 24 \* 60 \* 60;/, worker, 'TTL setlist'), 7);
  // thư viện đồng bộ: 30 ngày
  assert.equal(days(/const LIBRARY_TTL_SECONDS = (\d+) \* 24 \* 60 \* 60;/, worker, 'TTL thư viện'), 30);
  // bài hát đã xử lý: 7 ngày
  assert.equal(days(/const SONG_RESOLVED_TTL_MS = (\d+) \* 24 \* 60 \* 60 \* 1000;/, relay, 'TTL bài hát đã duyệt'), 7);
  // số tin giữ lại: 120
  assert.equal(days(/const RING_MAX = (\d+);/, relay, 'RING_MAX'), 120);
  // ảnh hợp âm 4 ngày: đặt bằng lifecycle rule trên bucket (wrangler.toml ghi chú), kiểm bằng chú thích
  assert.match(read('cloud/worker/wrangler.toml'), /expire-4d|4 ngày/);
  for (const [vi, en] of [['120 tin', 'latest 120'], ['7 ngày', '7 days'], ['30 ngày', '30 days'], ['4 ngày', '4 days']]) {
    assert.ok(page.includes(vi), 'bản tiếng Việt thiếu "' + vi + '"');
    assert.ok(page.includes(en), 'bản tiếng Anh thiếu "' + en + '"');
  }
});

test('những khẳng định "không có" trong chính sách đúng với ứng dụng desktop', () => {
  const html = read('index.html') + read('live.html');
  assert.ok(!/api\.qrserver\.com|googletagmanager|google-analytics|cloudflareinsights|segment\.|mixpanel|sentry/i.test(html), 'giao diện desktop gọi dịch vụ phân tích/QR bên ngoài');
  assert.ok(!/https?:\/\/fonts\.googleapis\.com/.test(html), 'giao diện desktop vẫn tải phông từ Google');
});

test('quyền xóa: relay có đường xóa dữ liệu phòng và identity có đường xóa tài khoản', () => {
  assert.match(relay, /p === '\/admin\/purge'/);
  assert.match(read('cloud/identity/src/worker.js'), /AdminDeleteUser/);
});
