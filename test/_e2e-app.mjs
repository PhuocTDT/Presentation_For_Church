// Helper e2e: chạy app Electron THẬT từ một bản sao tạm KHÔNG có data/ (đúng như bản phát hành
// không đóng gói dữ liệu), dùng thư mục dữ liệu riêng (--instance), điều khiển qua DevTools Protocol.
// Hộp thoại mở file được giả lập bằng hàng đợi file (không thể bấm dialog native trong test).
//
// Lưu ý đặt tên: KHÔNG đặt file .js/.cjs cạnh thư mục có cùng tên gốc — Node ưu tiên "<tên>.js" hơn
// thư mục "<tên>/" khi `electron <thư mục>` và sẽ chạy nhầm file (đã gây vòng lặp sinh tiến trình).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'));
const APP_FILES = ['main.js', 'preload.js', 'index.html', 'live.html', 'package.json'];
const APP_DIRS = ['src', 'comm', 'fonts', 'templates']; // KHÔNG có data/ và media/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function appDataRoot() { return process.env.APPDATA; }

// Bản sao app (không data) trong thư mục tạm; trả về { dir, cleanup }
export function makeAppCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-e2e-app-'));
  for (const f of APP_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  for (const d of APP_DIRS) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  // bootstrap: giả lập dialog.showOpenDialog theo hàng đợi trong file, rồi nạp main.js thật
  fs.writeFileSync(path.join(dir, 'e2e-bootstrap.cjs'), `
const { dialog, shell } = require('electron');
shell.openPath = async () => ''; // không mở Explorer thật khi test
const fs = require('fs');
const qf = process.env.E2E_DIALOG_QUEUE;
dialog.showOpenDialog = async () => {
  let q = []; try { q = JSON.parse(fs.readFileSync(qf, 'utf8')); } catch (e) {}
  const next = q.shift(); try { fs.writeFileSync(qf, JSON.stringify(q)); } catch (e) {}
  return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
};
require('./main.js');
`);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.main = 'e2e-bootstrap.cjs';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  // node_modules (mammoth cho .docx) qua junction — KHÔNG sao chép; khi dọn phải gỡ junction TRƯỚC để không đụng thư mục thật.
  const nm = path.join(dir, 'node_modules');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), nm, 'junction');
  return {
    dir,
    cleanup: () => {
      try { fs.rmdirSync(nm); } catch (e) { /* đã gỡ */ }
      if (fs.existsSync(nm)) throw new Error('không gỡ được junction node_modules, dừng để không xóa nhầm');
      safeRm(dir, os.tmpdir(), 'pfc-e2e-app-');
    }
  };
}

function safeRm(target, mustBeInside, mustContain) {
  const t = path.resolve(target);
  if (!t.startsWith(path.resolve(mustBeInside) + path.sep) || !t.includes(mustContain)) throw new Error('từ chối xóa ngoài phạm vi: ' + t);
  fs.rmSync(t, { recursive: true, force: true });
}

// Thư mục dữ liệu của instance (khớp logic main.js: `${app.name}-instance-${id}` trong appData)
export function instanceUserDataDir(instanceId) {
  // Ở chế độ dev (app chưa đóng gói) main.js đặt tên là 'easyworship-app-dev' → '<tên>-instance-<id>'.
  return path.join(appDataRoot(), `easyworship-app-dev-instance-${instanceId}`);
}
export function removeInstanceUserData(instanceId) {
  const dir = instanceUserDataDir(instanceId);
  safeRm(dir, appDataRoot(), 'instance-e2e');
}

export async function launchApp({ appDir, instanceId, dialogQueue = [] }) {
  const queueFile = path.join(appDir, 'dialog-queue.json');
  fs.writeFileSync(queueFile, JSON.stringify(dialogQueue));
  const port = 9400 + Math.floor(Math.random() * 500);
  const env = { ...process.env, E2E_DIALOG_QUEUE: queueFile };
  delete env.ELECTRON_RUN_AS_NODE;
  let log = '';
  const child = spawn(ELECTRON, [appDir, '--remote-debugging-port=' + port, '--instance=' + instanceId], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page' && /index\.html/.test(x.url)); } catch (e) { /* chưa sẵn sàng */ }
  }
  if (!target) { child.kill(); throw new Error('app không mở được cửa sổ\n' + log.slice(-1500)); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = new Map(); const exceptions = []; const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Log.entryAdded') logs.push(m.params.entry.level + ': ' + String(m.params.entry.text).slice(0, 300) + ' ' + (m.params.entry.url || ''));
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || '').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await sleep(5000); // đợi renderer khởi tạo xong (initializeData + autosync chạy trong main trước đó)

  return {
    log: () => log,
    port,
    raw: send, // gửi lệnh CDP thô tới cửa sổ chính
    // Nối thêm vào một cửa sổ khác của app (ví dụ live.html) theo regex URL
    async attach(urlRe, waitMs = 15000) {
      let t = null;
      for (let i = 0; i < waitMs / 500 && !t; i++) {
        try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page' && urlRe.test(x.url)); } catch (e) { /* chưa sẵn sàng */ }
        if (!t) await sleep(500);
      }
      if (!t) throw new Error('không thấy cửa sổ khớp ' + urlRe);
      const w2 = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r) => { w2.onopen = r; });
      let n = 0; const p2 = new Map();
      w2.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && p2.has(m.id)) { p2.get(m.id)(m); p2.delete(m.id); } };
      const send2 = (method, params = {}) => new Promise((r) => { const i = ++n; p2.set(i, r); w2.send(JSON.stringify({ id: i, method, params })); });
      await send2('Runtime.enable'); await send2('Page.enable');
      return {
        raw: send2,
        async ev(expr) { const r = await send2('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; },
        async screenshot(file) { const s = await send2('Page.captureScreenshot', { format: 'png' }); if (s.result) fs.writeFileSync(file, Buffer.from(s.result.data, 'base64')); },
        close() { try { w2.close(); } catch (e) { /* đã đóng */ } }
      };
    },
    exceptions,
    logs,
    // chạy biểu thức trong renderer (await được Promise), trả về giá trị JSON
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error('renderer: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result.result.value;
    },
    pushDialog(paths) {
      const q = JSON.parse(fs.readFileSync(queueFile, 'utf8')); q.push(paths); fs.writeFileSync(queueFile, JSON.stringify(q));
    },
    async screenshot(file) { const s = await send('Page.captureScreenshot', { format: 'png' }); if (s.result) fs.writeFileSync(file, Buffer.from(s.result.data, 'base64')); },
    async close() {
      try { ws.close(); } catch (e) {}
      try { child.kill(); } catch (e) {}
      // dừng cả cây tiến trình Electron của lần chạy này
      try { spawn('taskkill', ['/F', '/PID', String(child.pid), '/T'], { stdio: 'ignore' }); } catch (e) {}
      await sleep(1500);
    }
  };
}
