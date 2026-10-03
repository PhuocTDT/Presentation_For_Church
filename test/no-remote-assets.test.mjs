// Giao diện desktop (index.html, live.html) PHẢI chạy khi không có Internet và không nạp
// script/CSS/font/ảnh từ nguồn ngoài (lỗi gốc: Tailwind Play CDN + Google Fonts → mất hết
// UI trên máy mới cài khi offline). Test này chặn việc vô tình đưa lại phụ thuộc ngoài.
//   node --test test/no-remote-assets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['index.html', 'live.html'];
const REMOTE = /^(https?:)?\/\//i;

for (const page of PAGES) {
  test(`${page}: không có <script src>, <link href>, <img src>, <source src>, <iframe> trỏ ra ngoài`, () => {
    const html = read(page);
    const bad = [];
    for (const m of html.matchAll(/<(script|link|img|source|iframe|video|audio)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      if (REMOTE.test(m[2])) bad.push(`${m[1]} → ${m[2]}`);
    }
    assert.deepEqual(bad, []);
  });

  test(`${page}: CSS không @import / url() ra ngoài`, () => {
    const html = read(page);
    const bad = [];
    for (const m of html.matchAll(/@import\s+(?:url\()?["']?(https?:[^"')\s]+)/gi)) bad.push('@import ' + m[1]);
    for (const m of html.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/gi)) bad.push('url() ' + m[1]);
    assert.deepEqual(bad, []);
  });

  test(`${page}: có CSP và không cho nguồn ngoài trong script-src/style-src/font-src`, () => {
    const html = read(page);
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i.exec(html);
    assert.ok(m, 'thiếu CSP <meta>');
    for (const dir of ['script-src', 'style-src', 'font-src']) {
      const d = new RegExp(`${dir}\\s+([^;]+)`).exec(m[1]);
      assert.ok(d, 'thiếu ' + dir);
      assert.ok(!/https?:/.test(d[1]), `${dir} cho phép nguồn ngoài: ${d[1]}`);
    }
  });
}

test('index.html nạp CSS tĩnh Tailwind + font cục bộ, và các file đó tồn tại', () => {
  const html = read('index.html');
  for (const rel of ['src/css/tailwind.generated.css', 'src/css/google-fonts.css']) {
    assert.ok(html.includes(rel), `index.html không nạp ${rel}`);
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `thiếu file ${rel} (chạy npm run build:css)`);
  }
  assert.ok(!/tailwind\.config\s*=|cdn\.tailwindcss\.com/.test(html), 'còn dấu vết Tailwind Play CDN');
});

test('google-fonts.css chỉ tham chiếu file font có thật trong fonts/google/', () => {
  const css = read('src/css/google-fonts.css');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ''));
  assert.ok(urls.length > 0);
  const missing = [];
  for (const u of urls) {
    assert.ok(!REMOTE.test(u), 'url() ngoài trong google-fonts.css: ' + u);
    if (!fs.existsSync(path.resolve(ROOT, 'src/css', u))) missing.push(u);
  }
  assert.deepEqual(missing, []);
});

test('class Tailwind trong index.html đều đã có trong CSS build (nhắc chạy npm run build:css khi thêm class mới)', () => {
  const html = read('index.html');
  const css = read('src/css/tailwind.generated.css');
  // Chỉ kiểm tra một mẫu class tiện ích đặc trưng được dùng nhiều; không thay cho việc build lại.
  const samples = ['flex', 'items-center', 'rounded-md', 'bg-blue-500', 'text-white'];
  for (const c of samples) {
    if (new RegExp(`class(Name)?=["'\`][^"'\`]*\\b${c}\\b`).test(html)) {
      assert.ok(css.includes('.' + c.replace(/[:/[\]]/g, '\\$&')), `CSS build thiếu .${c} — chạy npm run build:css`);
    }
  }
});
