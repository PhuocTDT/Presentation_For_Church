// Hoạt ảnh KHÔNG được làm mất chữ: chạy bộ render thật (cùng code với cửa sổ Live) qua mọi tổ hợp kiểu × giai đoạn × lặp × chồng lớp;
// sau khi hiệu ứng "vào" kết thúc, lấy mẫu nhiều lần — mọi ký tự phải nhìn thấy (độ mờ hiệu dụng ≥ 0.9).
// Hồi quy: (1) hiệu ứng vào có Lặp/∞ làm ký tự chớp tắt (trên màn chiếu thấy "mất chữ"); (2) typewriter dùng easing steps()
// có lúc giữ ký tự ẩn hẳn ở khung cuối.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

test('hoạt ảnh: sau hiệu ứng vào, mọi ký tự đều hiện (mọi kiểu × lặp × chồng lớp)', { timeout: 300000 }, async () => {
  const id = 'e2e-' + Math.random().toString(36).slice(2, 8);
  const ud = instanceUserDataDir(id); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'songs.json'), '[]');
  const copy = makeAppCopy();
  process.env.E2E_CDP_TIMEOUT_MS = process.env.E2E_CDP_TIMEOUT_MS || '280000';   // một lần evaluate chạy hết ~106 tổ hợp (2–3 phút)
  const app = await launchApp({ appDir: copy.dir, instanceId: id });
  try {
    const res = await app.ev(`(async () => {
      const T = 'đến muôn thu không đổi thay\\nđến muôn thu không dời lay';
      const IN = RichModel.ANIM_TYPES.in, EM = RichModel.ANIM_TYPES.emph;
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:900px;font-size:40px;z-index:99999;background:#000;color:#fff'; document.body.appendChild(host);
      const box = document.createElement('div'); host.appendChild(box);
      const eff = (n) => { let o = 1, e = n.parentElement; while (e && e !== host) { o *= +getComputedStyle(e).opacity; e = e.parentElement; } return o; };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const cases = [];
      for (const t of IN) for (const rep of [1, 3, -1]) cases.push({ name: 'in:' + t + ' lặp ' + rep, anims: [{ s: 9, e: 41, phase: 'in', type: t, dur: 300, stagger: 20, repeat: rep }] });
      for (const t of EM) for (const rep of [1, -1]) cases.push({ name: 'emph:' + t + ' lặp ' + rep, anims: [{ s: 9, e: 41, phase: 'emph', type: t, dur: 300, repeat: rep, color: '#ffd966' }] });
      for (const a of IN) for (const b of IN) cases.push({ name: 'in:' + a + ' + in:' + b, anims: [{ s: 0, e: 30, phase: 'in', type: a, dur: 200, stagger: 10 }, { s: 12, e: 50, phase: 'in', type: b, dur: 200, stagger: 10 }] });
      for (const a of IN) for (const b of EM) cases.push({ name: 'in:' + a + ' + emph:' + b, anims: [{ s: 0, e: 50, phase: 'in', type: a, dur: 200, stagger: 10 }, { s: 9, e: 41, phase: 'emph', type: b, dur: 200, repeat: -1 }] });
      const fails = [];
      for (const c of cases) {
        const parts = { marks: [{ s: 13, e: 27, color: '#ffff00', bold: true }, { s: 40, e: 54, color: '#ffff00', bold: true }], bgs: [], anims: c.anims };
        RichRender.render(box, T, parts, { baseSize: 40, animate: true });
        const h = box._richHandle; h.play('in'); h.play('emph');
        // TUA thời gian xác định (không phụ thuộc cửa sổ có đang vẽ khung hình hay không): dừng mọi hoạt ảnh rồi đặt currentTime
        // = lúc hiệu ứng vào đã xong + k·37ms, đo độ mờ thực tế của từng ký tự ở mỗi thời điểm.
        const running = box.getAnimations({ subtree: true });
        running.forEach((an) => an.pause());
        const settle = h.phaseDuration('in') + 100;
        let worst = 1, where = '';
        for (let k = 0; k < 12; k++) {
          running.forEach((an) => { an.currentTime = settle + k * 37; });
          const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let n;
          while ((n = w.nextNode())) { if (!n.nodeValue.trim()) continue; const o = eff(n); if (o < worst) { worst = o; where = n.nodeValue + ' @' + (settle + k * 37) + 'ms'; } }
        }
        // chữ phải còn đủ (không mất ký tự khi tách đơn vị hoạt ảnh)
        if (box.textContent !== T) fails.push(c.name + ': chữ bị đổi "' + box.textContent + '"');
        if (worst < 0.9) fails.push(c.name + ': "' + where + '" độ mờ ' + worst.toFixed(2));
        h.stop();
      }
      host.remove();
      return { total: cases.length, fails };
    })()`);
    assert.ok(res.total >= 100, 'đủ tổ hợp: ' + res.total);
    assert.deepEqual(res.fails, [], 'ký tự bị ẩn sau hiệu ứng vào');
    assert.deepEqual(app.exceptions, [], 'không có lỗi JS: ' + JSON.stringify(app.exceptions));
  } finally {
    await app.close();
    try { copy.cleanup(); } catch (e) { /* bỏ qua */ }
    try { removeInstanceUserData(id); } catch (e) { /* bỏ qua */ }
  }
});
