// Phần thuần của src/editor/text-fit.js: đếm số DÒNG từ các mảnh chữ (Range.getClientRects) — kể cả khi một dòng có chữ cỡ khác nhau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TF = require('../src/editor/text-fit.js');
const R = (top, h, w = 50) => ({ top, bottom: top + h, width: w });

test('groupLines: các mảnh cùng dòng (kể cả cỡ chữ khác nhau) tính là MỘT dòng', () => {
  assert.equal(TF.groupLines([]), 0);
  assert.equal(TF.groupLines([R(0, 80), R(5, 70), R(-4, 90)]), 1, 'chữ cỡ riêng to/nhỏ trên cùng dòng');
  assert.equal(TF.groupLines([R(0, 80), R(84, 80), R(168, 80)]), 3);
  // dòng có chữ cỡ to làm dòng cao hơn → vẫn đúng số dòng (công thức chiều cao ÷ (cỡ × 1.4) từng đếm sai trường hợp này)
  assert.equal(TF.groupLines([R(0, 83), R(-6, 95), R(83, 83), R(166, 83), R(249, 83), R(243, 95), R(332, 83)]), 5);
  // thứ tự lộn xộn, mảnh rỗng bị bỏ qua
  assert.equal(TF.groupLines([R(168, 80), R(0, 80), R(84, 80), R(10, 0), R(90, 80, 0)]), 3);
  assert.equal(TF.SAFE_BOTTOM, 488);
});
