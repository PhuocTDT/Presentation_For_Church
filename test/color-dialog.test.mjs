// Phần thuần của hộp thoại "More Colors…" (src/editor/color-dialog.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const CD = req('../src/editor/color-dialog.js');
const CP = req('../src/editor/color-picker.js');

test('spectrum: điểm ↔ (hue, saturation) khứ hồi, kẹp trong khung', () => {
  const w = 256, h = 192;
  assert.deepEqual(CD.pointToHs(0, 0, w, h), { h: 0, s: 1 });
  assert.deepEqual(CD.pointToHs(w, h, w, h), { h: 360, s: 0 });
  assert.deepEqual(CD.pointToHs(-50, 9999, w, h), { h: 0, s: 0 }, 'ngoài khung bị kẹp');
  for (const [x, y] of [[10, 20], [128, 96], [250, 190], [77, 3]]) {
    const hs = CD.pointToHs(x, y, w, h), p = CD.hsToPoint(hs.h, hs.s, w, h);
    assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, `${x},${y}`);
  }
  assert.equal(CD.sliderToValue(0, 100), 1); assert.equal(CD.sliderToValue(100, 100), 0); assert.equal(CD.sliderToValue(25, 100), 0.75);
  assert.equal(CD.valueToSlider(0.75, 100), 25);
});

test('ô số: chỉ nhận số nguyên trong miền; ô HEX: 6 chữ số, có/không có #', () => {
  assert.equal(CD.parseChannel('255', 0, 255), 255); assert.equal(CD.parseChannel(' 0 ', 0, 255), 0);
  for (const bad of ['256', '-1', '1.5', 'abc', '', '1e2', '０１']) assert.equal(CD.parseChannel(bad, 0, 255), null, bad);
  assert.equal(CD.parseChannel('360', 0, 360), 360);
  assert.equal(CD.parseHex6('#7030A0'), '#7030a0'); assert.equal(CD.parseHex6('7030a0'), '#7030a0');
  for (const bad of ['#703', '#7030a', '#7030a00', '#gggggg', '', 'red']) assert.equal(CD.parseHex6(bad), null, bad);
  assert.equal(CD.isPartialHex('#70'), true); assert.equal(CD.isPartialHex(''), true); assert.equal(CD.isPartialHex('#12345g'), false);
});

test('đồng bộ HEX ↔ RGB ↔ spectrum: khứ hồi chính xác trên 2000 màu; xám/đen giữ sắc độ', () => {
  let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 2000; i++) {
    const hex = CP.rgbToHex(rnd() * 255, rnd() * 255, rnd() * 255);
    assert.equal(CD.hexFromState(CD.stateFromHex(hex, null)), hex, hex);
  }
  // kéo thanh sáng qua màu xám/đen không làm mất hue/saturation đang chọn
  const prev = { h: 200, s: 0.8, v: 0.9 };
  const black = CD.stateFromHex('#000000', prev);
  assert.equal(black.h, 200); assert.equal(black.s, 0.8); assert.equal(black.v, 0);
  const gray = CD.stateFromHex('#808080', prev);
  assert.equal(gray.h, 200); assert.equal(gray.s, 0);
  const back = CD.hexFromState({ h: black.h, s: black.s, v: 1 });
  assert.equal(CD.stateFromHex(back, null).s > 0.7, true);
  assert.equal(CD.hexFromState(CD.stateFromHex('zzz')), '#ffffff', 'hex sai → trắng');
});
