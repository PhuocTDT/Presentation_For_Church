// Tải font Google về cục bộ để app không nạp font từ fonts.googleapis.com lúc chạy
// (riêng tư: không lộ IP người dùng; sẵn sàng: chạy được khi offline).
//
// Chạy 1 lần khi đổi danh sách font:  node scripts/fetch-google-fonts.js
// Kết quả (được commit): fonts/google/*.woff2 + src/css/google-fonts.css
// Chỉ giữ subset latin, latin-ext, vietnamese (app dùng cho tiếng Việt/Anh).
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const FONT_DIR = path.join(ROOT, 'fonts', 'google');
const CSS_OUT = path.join(ROOT, 'src', 'css', 'google-fonts.css');
const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'vietnamese']);
// UA trình duyệt hiện đại để Google trả về woff2 theo từng subset.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const CSS_URLS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap',
  'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Roboto:ital,wght@0,100..900;1,100..900&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&family=Montserrat:ital,wght@0,100..900;1,100..900&family=Oswald:wght@200..700&family=Raleway:ital,wght@0,100..900;1,100..900&family=Lobster&display=swap'
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(res.statusCode + ' ' + url)); res.resume(); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(CSS_OUT), { recursive: true });
  const downloaded = new Map(); // url -> tên file cục bộ
  const out = ['/* TỰ SINH bởi scripts/fetch-google-fonts.js — không sửa tay. Font: SIL OFL / Apache-2.0 (Google Fonts). */\n'];
  let materialClassEmitted = false;

  for (const cssUrl of CSS_URLS) {
    const css = (await get(cssUrl)).toString('utf8');
    // Mỗi khối: "/* subset */ @font-face { ... }"; khối Material không có subset ("fallback").
    const re = /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
    let m;
    while ((m = re.exec(css))) {
      const subset = m[1];
      let block = m[2];
      const isMaterial = /Material Symbols Outlined/.test(block);
      if (!isMaterial && !KEEP_SUBSETS.has(subset)) continue;
      const urlMatch = block.match(/url\((https:[^)]+\.woff2)\)/);
      if (!urlMatch) continue;
      const remote = urlMatch[1];
      if (!downloaded.has(remote)) {
        const base = path.basename(remote, '.woff2');
        const family = (block.match(/font-family:\s*'([^']+)'/) || [,'font'])[1].replace(/\s+/g, '');
        const name = `${family}-${base}.woff2`;
        fs.writeFileSync(path.join(FONT_DIR, name), await get(remote));
        downloaded.set(remote, name);
      }
      block = block.replace(remote, `../../fonts/google/${downloaded.get(remote)}`);
      out.push(`/* ${subset} */\n${block}\n`);
    }
    if (/Material Symbols Outlined/.test(css) && !materialClassEmitted) {
      const cls = css.match(/\.material-symbols-outlined\s*\{[^}]*\}/);
      if (cls) { out.push(cls[0] + '\n'); materialClassEmitted = true; }
    }
  }
  fs.writeFileSync(CSS_OUT, out.join('\n'));
  console.log(`OK: ${downloaded.size} file woff2 -> fonts/google, CSS -> src/css/google-fonts.css`);
})().catch((e) => { console.error(e); process.exit(1); });
