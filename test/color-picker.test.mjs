// Phần thuần của bảng chọn màu kiểu Office (src/editor/color-picker.js): chuyển màu, bảng Theme, kho Custom Colors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CP = createRequire(import.meta.url)('../src/editor/color-picker.js');

const near = (a, b, tol = 3) => {
  const x = CP.hexToRgb(a), y = CP.hexToRgb(b);
  return Math.abs(x.r - y.r) <= tol && Math.abs(x.g - y.g) <= tol && Math.abs(x.b - y.b) <= tol;
};
function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('normalizeHex: nhận #rgb/#rrggbb/rrggbb, từ chối phần còn lại', () => {
  assert.equal(CP.normalizeHex('#FFAA00'), '#ffaa00');
  assert.equal(CP.normalizeHex('ffaa00'), '#ffaa00');
  assert.equal(CP.normalizeHex(' #F0a '), '#ff00aa');
  for (const bad of ['', '#12345', '#1234567', '#gggggg', 'red', 'rgb(1,2,3)', null, undefined, 5, {}, '#ff00aa; x']) assert.equal(CP.normalizeHex(bad), null, String(bad));
});

test('hex ↔ rgb ↔ hsl ↔ hsv khứ hồi đúng trên toàn bộ màu tiêu biểu và 3000 màu ngẫu nhiên', () => {
  const samples = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#4472c4', '#7030a0'];
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 3000; i++) samples.push(CP.rgbToHex(rnd() * 255, rnd() * 255, rnd() * 255));
  for (const hex of samples) {
    const { r, g, b } = CP.hexToRgb(hex);
    assert.equal(CP.rgbToHex(r, g, b), hex);
    const hsl = CP.rgbToHsl(r, g, b); const a = CP.hslToRgb(hsl.h, hsl.s, hsl.l);
    assert.deepEqual([a.r, a.g, a.b], [r, g, b], 'hsl ' + hex);
    const hsv = CP.rgbToHsv(r, g, b); const c = CP.hsvToRgb(hsv.h, hsv.s, hsv.v);
    assert.deepEqual([c.r, c.g, c.b], [r, g, b], 'hsv ' + hex);
  }
  assert.deepEqual(CP.rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.equal(CP.rgbToHex(300, -5, 'x'), '#ff0000');
});

test('tint đúng số Office đã biết (±3): Accent 1 #4472c4 Lighter 80% ≈ #dae3f3, Darker 25% ≈ #2f5597; trắng Darker 5% = #f2f2f2; đen Lighter 50% ≈ #7f7f7f', () => {
  assert.ok(near(CP.tint('#4472c4', 0.2, 0.8), '#dae3f3'), CP.tint('#4472c4', 0.2, 0.8));
  assert.ok(near(CP.tint('#4472c4', 0.75, 0), '#2f5597'), CP.tint('#4472c4', 0.75, 0));
  assert.equal(CP.tint('#ffffff', 0.95, 0), '#f2f2f2');
  assert.ok(near(CP.tint('#000000', 0.5, 0.5), '#7f7f7f', 1));
  assert.equal(CP.tint('xyz', 0.5, 0), null);
});

test('buildThemeGrid: 10 cột gốc + 5 hàng sắc độ, màu hợp lệ, sắc độ sáng dần/tối dần đúng chiều', () => {
  const g = CP.buildThemeGrid();
  assert.equal(g.base.length, 10); assert.equal(g.rows.length, 5);
  for (const row of g.rows) { assert.equal(row.length, 10); for (const c of row) assert.ok(CP.normalizeHex(c.hex) && c.label, JSON.stringify(c)); }
  const lum = (h) => { const { r, g: gg, b } = CP.hexToRgb(h); return 0.299 * r + 0.587 * gg + 0.114 * b; };
  const accent = 4; // Blue
  const col = g.rows.map((r) => lum(r[accent].hex));
  assert.ok(col[0] > col[1] && col[1] > col[2] && col[2] > lum(g.base[accent].hex) && lum(g.base[accent].hex) > col[3] && col[3] > col[4], 'Lighter 80/60/40 > gốc > Darker 25/50: ' + col);
  const white = g.rows.map((r) => lum(r[0].hex)); for (let i = 1; i < 5; i++) assert.ok(white[i] < white[i - 1], 'cột trắng tối dần');
  const black = g.rows.map((r) => lum(r[1].hex)); for (let i = 1; i < 5; i++) assert.ok(black[i] < black[i - 1], 'cột đen: từ xám sáng về đen');
  // theme sai (không đủ 10) → dùng mặc định, màu sai trong 1 cột → cột đó dùng mặc định
  assert.deepEqual(CP.buildThemeGrid([{ hex: '#123456' }]).base, g.base);
  const t = CP.DEFAULT_THEME.map((c) => ({ ...c })); t[4] = { name: 'X', hex: 'nope' };
  assert.equal(CP.buildThemeGrid(t).base[4].hex, CP.DEFAULT_THEME[4].hex);
});

test('Standard Colors: đúng 10 màu theo thứ tự yêu cầu', () => {
  assert.deepEqual(CP.STANDARD_COLORS.map((c) => c.name), ['Red', 'Orange', 'Yellow', 'Light Green', 'Green', 'Cyan', 'Light Blue', 'Blue', 'Dark Blue', 'Purple']);
  for (const c of CP.STANDARD_COLORS) assert.ok(CP.normalizeHex(c.hex));
});

test('Custom Colors: thêm, không trùng (không phân biệt hoa/thường, #rgb ≡ #rrggbb), xoá, lưu bền qua "khởi động lại"', () => {
  const st = fakeStorage();
  let s = CP.createCustomStore(st);
  assert.deepEqual(s.list(), []);
  assert.equal(s.add('#7030A0').added, true);
  assert.equal(s.add('#7030a0').added, false, 'trùng hoa/thường');
  assert.equal(s.add('#f0a').added, true);
  assert.equal(s.add('#FF00AA').added, false, '#f0a ≡ #ff00aa');
  assert.equal(s.add('đỏ').ok, false);
  assert.deepEqual(s.list(), ['#7030a0', '#ff00aa']);
  // "khởi động lại": kho mới đọc cùng storage
  s = CP.createCustomStore(st);
  assert.deepEqual(s.list(), ['#7030a0', '#ff00aa']);
  assert.deepEqual(s.remove('#7030A0'), ['#ff00aa']);
  assert.deepEqual(CP.createCustomStore(st).list(), ['#ff00aa']);
  assert.deepEqual(s.remove('#123456'), ['#ff00aa'], 'xoá màu không có không lỗi');
});

test('Custom Colors: đầy thì bỏ màu CŨ nhất; dữ liệu hỏng trong storage được bỏ qua, không làm sập', () => {
  const s = CP.createCustomStore(fakeStorage(), 'k', 3);
  ['#000001', '#000002', '#000003', '#000004'].forEach((h) => s.add(h));
  assert.deepEqual(s.list(), ['#000002', '#000003', '#000004']);
  for (const raw of ['{not json', '"x"', '{"a":1}', 'null', '[1,{},"#12","#ABCDEF","#abcdef",null]']) {
    const st = fakeStorage({ k: raw }); const x = CP.createCustomStore(st, 'k', 3);
    assert.ok(Array.isArray(x.list())); assert.ok(x.list().every((h) => /^#[0-9a-f]{6}$/.test(h)));
  }
  assert.deepEqual(CP.createCustomStore(fakeStorage({ k: '[1,{},"#12","#ABCDEF","#abcdef",null]' }), 'k').list(), ['#abcdef']);
  // storage ném lỗi khi ghi: add vẫn trả danh sách đúng
  const bad = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(CP.createCustomStore(bad, 'k').add('#112233').list, ['#112233']);
});

test('setTheme chỉ nhận đúng 10 màu hợp lệ; loadTheme đọc lại và bỏ qua dữ liệu hỏng', () => {
  const st = fakeStorage();
  const t = CP.DEFAULT_THEME.map((c, i) => ({ name: c.name, hex: i === 4 ? '#112233' : c.hex, kind: c.kind }));
  assert.equal(CP.setTheme(t, st), true);
  assert.equal(CP.loadTheme(st)[4].hex, '#112233');
  assert.equal(CP.setTheme(t.slice(0, 9), st), false);
  assert.equal(CP.setTheme(t.map((c, i) => (i === 0 ? { hex: 'nope' } : c)), st), false);
  assert.equal(CP.loadTheme(fakeStorage({ 'se.colorTheme.v1': '{bad' }))[4].hex, CP.DEFAULT_THEME[4].hex);
});
