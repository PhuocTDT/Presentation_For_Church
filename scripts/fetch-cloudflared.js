// Tải sẵn binary `cloudflared` chính thức từ Cloudflare (GitHub Releases) vào
// vendor/cloudflared/<platform>/ để đóng gói cùng app (electron-builder
// extraResources) — người dùng tải app về không cần tự cài cloudflared.
//
// Chạy tự động qua "postinstall" (npm install) + trước khi build. Không phá
// vỡ install nếu tải lỗi (offline, firewall…): chỉ cảnh báo rồi thoát 0 — app
// vẫn chạy bình thường, chỉ là tính năng tunnel tự động sẽ không có (giống
// như trước khi có tính năng này).
//
// Không thêm dependency nào — chỉ dùng https/fs có sẵn của Node.

const https = require('https');
const fs = require('fs');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'cloudflared');
const MIN_SIZE_BYTES = 10 * 1024 * 1024; // sanity check: binary thật ~60-90MB, trang lỗi HTML thì bé tí

const TARGETS = {
  win: {
    url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
    outDir: path.join(VENDOR_DIR, 'win'),
    outFile: 'cloudflared.exe'
  }
  // mac (darwin): file .tgz cần giải nén — chưa làm, build:mac tạm thời
  // không có tunnel tự động cho tới khi bổ sung.
};

function download(url, destPath, redirectsLeft) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft < 0) return reject(new Error('Quá nhiều lần redirect'));
    https.get(url, { headers: { 'User-Agent': 'presentation-for-church-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} khi tải ${url}`));
      }
      const tmp = destPath + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close((err) => {
          if (err) return reject(err);
          fs.renameSync(tmp, destPath);
          resolve();
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchOne(key, target) {
  const dest = path.join(target.outDir, target.outFile);
  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size;
    if (size >= MIN_SIZE_BYTES) {
      console.log(`[fetch-cloudflared] ${key}: đã có sẵn (${(size / 1024 / 1024).toFixed(1)}MB), bỏ qua.`);
      return;
    }
    console.log(`[fetch-cloudflared] ${key}: file cũ có vẻ hỏng (${size} bytes), tải lại.`);
    fs.unlinkSync(dest);
  }
  fs.mkdirSync(target.outDir, { recursive: true });
  console.log(`[fetch-cloudflared] ${key}: đang tải từ ${target.url} ...`);
  await download(target.url, dest, 5);
  const size = fs.statSync(dest).size;
  if (size < MIN_SIZE_BYTES) {
    fs.unlinkSync(dest);
    throw new Error(`File tải về quá nhỏ (${size} bytes) — có thể không phải binary thật.`);
  }
  console.log(`[fetch-cloudflared] ${key}: xong (${(size / 1024 / 1024).toFixed(1)}MB) -> ${dest}`);
}

async function main() {
  const only = process.argv[2]; // vd: "win" để chỉ tải 1 platform (dùng trong CI/build script)
  const keys = only ? [only] : Object.keys(TARGETS);
  for (const key of keys) {
    const target = TARGETS[key];
    if (!target) { console.warn(`[fetch-cloudflared] Chưa hỗ trợ platform "${key}", bỏ qua.`); continue; }
    try {
      await fetchOne(key, target);
    } catch (e) {
      console.warn(`[fetch-cloudflared] KHÔNG tải được cho ${key}: ${e.message}`);
      console.warn('[fetch-cloudflared] App vẫn cài đặt/chạy bình thường — chỉ thiếu tunnel tự động đóng gói sẵn.');
    }
  }
}

main();
