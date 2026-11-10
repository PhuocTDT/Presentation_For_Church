// Phần thuần của bộ render chữ giàu định dạng (src/editor/rich-render.js): đường viền brush/marker/paper, gom dòng, kế hoạch đoạn, keyframes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const RR = req('../src/editor/rich-render.js');
const RM = req('../src/editor/rich-model.js');

function bounds(d) {
  const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), n: nums.length };
}

test('đường viền: hợp lệ, nằm trong khung, xác định theo hạt giống, khác nhau giữa các hạt giống', () => {
  const W = 420, H = 90;
  const multi = /^M[-\d. LZM]+Z$/;                                   // brush: nhiều đường con (M … Z), chỉ có lệnh M/L/Z
  const smooth = /^M-?[\d.]+ -?[\d.]+( [QL]-?[\d. ]+)+ Z$/;           // marker / paper: một đường liền
  const cases = [
    ['brush-a', (sd) => RR.brushPath(W, H, sd, 0), multi, 8],
    ['brush-b', (sd) => RR.brushPath(W, H, sd, 1), multi, 8],
    ['marker', (sd) => RR.markerPath(W, 30, sd), smooth, 1],
    ['paper', (sd) => RR.paperPath(W, H, sd, 0), smooth, 1]
  ];
  for (const [name, fn, re, minSub] of cases) {
    const d = fn(12345);
    assert.match(d, re, name);
    assert.equal(fn(12345), d, name + ' xác định theo hạt giống');
    assert.notEqual(fn(777), d, name + ' đổi hạt giống → đổi hình');
    const b2 = bounds(d);
    assert.ok(b2.minX >= -1 && b2.maxX <= W + 8 && b2.minY >= -1 && b2.maxY <= H + 1, name + ' trong khung: ' + JSON.stringify(b2));
    assert.ok(!/NaN|Infinity|undefined/.test(d), name);
    assert.ok((d.match(/M/g) || []).length >= minSub, name + ' đủ đường con');
  }
  // vệt sơn gồm NHIỀU dải ngang (lông cọ), thân đặc phủ gần hết chiều cao, đuôi kéo ra gần mép phải
  const sub = (d) => (d.match(/M/g) || []).length;
  assert.ok(sub(RR.brushPath(W, H, 5, 0)) >= 14, 'nhiều dải lông cọ');
  const bb = bounds(RR.brushPath(W, H, 5, 0));
  assert.ok(bb.maxY - bb.minY > H * 0.85, 'thân phủ gần hết chiều cao');
  const reach = Math.max(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((sd) => bounds(RR.brushPath(W, H, sd, 0)).maxX));
  assert.ok(reach > W * 0.9, 'đuôi vệt (vài dải kéo dài thành sợi mảnh) ra gần mép phải: ' + reach);
  assert.ok(Math.max(...[1, 2, 3, 4, 5, 6].map((sd) => bounds(RR.brushPath(W, H, sd, 1)).maxX)) <= W, 'không tràn ra ngoài khung');
  // kích thước cực nhỏ vẫn hợp lệ
  for (const fn of [() => RR.brushPath(1, 1, 5, 0), () => RR.brushPath(1, 1, 5, 1), () => RR.markerPath(1, 1, 5), () => RR.paperPath(1, 1, 5)]) assert.ok(!/NaN/.test(fn()));
  assert.equal(RR.seedFrom('brush-a:0:3'), RR.seedFrom('brush-a:0:3')); assert.notEqual(RR.seedFrom('brush-a:0:3'), RR.seedFrom('brush-a:1:3'));
});

test('groupLineRects: gom các đoạn chữ cùng hàng, tách các hàng khác nhau, bỏ hình rỗng', () => {
  const R = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
  const lines = RR.groupLineRects([R(100, 50, 160, 90), R(10, 50, 100, 90), R(20, 100, 200, 140), R(5, 5, 5, 20), R(0, 0, 10, 0)]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { left: 10, top: 50, right: 160, bottom: 90 });
  assert.deepEqual(lines[1], { left: 20, top: 100, right: 200, bottom: 140 });
  assert.deepEqual(RR.unionRect(lines), { left: 10, top: 50, right: 200, bottom: 140 });
  // đoạn chữ cỡ khác nhau nhưng cùng hàng (lệch nhẹ theo chiều dọc) vẫn gom 1 dòng
  assert.equal(RR.groupLineRects([R(0, 50, 50, 90), R(50, 44, 120, 96)]).length, 1);
  assert.deepEqual(RR.groupLineRects([]), []);
});

test('planSegments: cắt theo biên mark VÀ biên animation, gắn đúng hoạt ảnh vào từng đoạn', () => {
  const text = 'Chúa chính Ngài là VUA của muôn đời';
  const vs = text.indexOf('VUA');
  const parts = RM.sanitizeParts({
    marks: [{ s: vs, e: vs + 3, color: '#ffd700' }],
    anims: [{ s: 0, e: 10, phase: 'in', type: 'fade' }, { s: vs, e: text.length, phase: 'emph', type: 'pulse' }]
  }, text);
  const plan = RR.planSegments(text, parts);
  assert.equal(plan.map((p) => p.text).join(''), text);
  const by = (t) => plan.find((p) => p.text === t);
  assert.deepEqual(by('VUA').anims, [1]); assert.equal(by('VUA').fmt.color, '#ffd700');
  assert.deepEqual(plan[0].anims, [0]);
  assert.deepEqual(plan[plan.length - 1].anims, [1]);
  assert.equal(plan.filter((p) => p.anims.length === 0).length >= 1, true);
  assert.deepEqual(RR.planSegments('abc', null).map((p) => p.text), ['abc']);
  assert.deepEqual(RR.planSegments('', null), []);
});

test('keyframesFor: đúng theo loại/giai đoạn/hướng, giá trị hợp lệ', () => {
  const A = (o) => ({ dir: 'up', ...o });
  assert.deepEqual(RR.keyframesFor(A({ phase: 'in', type: 'fade' })), [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(RR.keyframesFor(A({ phase: 'in', type: 'slide-up' }))[0].transform, 'translateY(0.5em)');
  assert.equal(RR.keyframesFor(A({ phase: 'in', type: 'slide-down' }))[0].transform, 'translateY(-0.5em)');
  assert.equal(RR.keyframesFor(A({ phase: 'in', type: 'slide-up', dir: 'left' }))[0].transform, 'translateX(0.5em)', 'dir left/right đổi trục');
  assert.equal(RR.keyframesFor(A({ phase: 'in', type: 'zoom' }))[0].transform, 'scale(0.6)');
  assert.equal(RR.keyframesFor(A({ phase: 'emph', type: 'pulse' })).length, 3);
  assert.match(RR.keyframesFor(A({ phase: 'emph', type: 'glow', color: '#ff0000' }))[1].textShadow, /#ff0000/);
  assert.deepEqual(RR.keyframesFor(A({ phase: 'emph', type: 'color', color: '#00ff00' }), 'rgb(255,255,255)'), [{ color: 'rgb(255,255,255)' }, { color: '#00ff00' }]);
  assert.equal(RR.keyframesFor(A({ phase: 'out', type: 'slide', dir: 'down' }))[1].transform, 'translateY(0.5em)');
  assert.equal(RR.keyframesFor(A({ phase: 'out', type: 'fade' }))[1].opacity, 0);
  for (const phase of Object.keys(RM.ANIM_TYPES)) for (const type of RM.ANIM_TYPES[phase]) {
    const kf = RR.keyframesFor(A({ phase, type }), '#fff');
    assert.ok(Array.isArray(kf) && kf.length >= 2, phase + '/' + type);
  }
});

test('mọi loại hoạt ảnh/nền trong mô hình đều có cách dựng (không loại nào bị bỏ sót)', () => {
  for (const p of RM.BG_PRESETS) assert.ok(['brush-a', 'brush-b', 'paper', 'pill', 'marker'].includes(p));
  for (const t of ['typewriter', 'char', 'word']) assert.ok(RR.UNIT_TYPES[t], t);
});
