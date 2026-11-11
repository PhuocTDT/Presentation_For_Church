// Mô hình định dạng giàu (src/editor/rich-model.js) + việc lọc `rich` trong migrateItem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const R = req('../src/editor/rich-model.js');
const { migrateItem } = req('../src/schema.js');

const LYRICS = 'Đoạn 1\nChúa chính Ngài là VUA của muôn đời\nDòng hai\n\nĐiệp khúc\nHallelujah';
const body0 = 'Chúa chính Ngài là VUA của muôn đời\nDòng hai';
const at = (t, s) => { const i = body0.indexOf(t); return i; };
const vuaS = body0.indexOf('VUA');

function goodRich(extra = {}) {
  return { v: 1, slides: [{ h: R.hashText(body0), marks: [{ s: vuaS, e: vuaS + 3, color: '#FFD700', bold: true }], bgs: [], anims: [], ...extra }] };
}

test('splitSlides khớp cách index.html tách slide và nhãn', () => {
  const s = R.splitSlides(LYRICS);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { label: 'Đoạn 1', body: body0 });
  assert.deepEqual(s[1], { label: 'Điệp khúc', body: 'Hallelujah' });
  assert.deepEqual(R.splitSlides('a\n  \nb').map((x) => x.body), ['a', 'b']);
  assert.deepEqual(R.splitSlides('\n\n  \n'), []);
  assert.deepEqual(R.splitSlides('Dòng không nhãn\nDòng 2'), [{ label: '', body: 'Dòng không nhãn\nDòng 2' }]);
});

test('hashText ổn định (FNV-1a 32-bit)', () => {
  assert.equal(R.hashText('a'), 'e40c292c');
  assert.equal(R.hashText(''), '811c9dc5');
  assert.notEqual(R.hashText('abc'), R.hashText('abd'));
});

test('sanitizeRich giữ dữ liệu hợp lệ và chuẩn hoá màu', () => {
  const info = {};
  const out = R.sanitizeRich(goodRich(), LYRICS, info);
  assert.equal(info.dropped, 0);
  assert.equal(out.v, 1);
  assert.deepEqual(out.slides[0].marks, [{ s: vuaS, e: vuaS + 3, color: '#ffd700', bold: true }]);
  assert.equal(out.slides.length, 1); // null cuối được cắt
});

test('chữ đổi → chỉ slide đó mất định dạng, báo số slide bị bỏ', () => {
  const rich = goodRich();
  const info = {};
  assert.equal(R.sanitizeRich(rich, LYRICS.replace('VUA', 'Vua'), info), null);
  assert.equal(info.dropped, 1);
  // slide 2 có định dạng, slide 1 chữ đổi → giữ slide 2
  const two = { v: 1, slides: [rich.slides[0], { h: R.hashText('Hallelujah'), marks: [{ s: 0, e: 5, italic: true }] }] };
  const out = R.sanitizeRich(two, LYRICS.replace('VUA', 'Vua'), info);
  assert.equal(out.slides[0], null);
  assert.deepEqual(out.slides[1].marks, [{ s: 0, e: 5, italic: true }]);
  assert.equal(info.dropped, 1);
});

test('đầu vào độc hại bị loại, không rò khoá lạ', () => {
  const evil = {
    v: 1,
    slides: [{
      h: R.hashText(body0),
      marks: [
        { s: 0, e: 4, color: 'red; background:url(http://x)' },
        { s: 0, e: 4, color: '#12345' },
        { s: 0, e: 4, font: 'Arial"; } body{display:none' },
        { s: 0, e: 4, font: '</style><script>alert(1)</script>' },
        { s: 5, e: 2, bold: true },
        { s: -5, e: 9999, size: 99999, color: '#abcdef', __proto__: { polluted: 1 }, evil: 'x' },
        { s: 'a', e: 3, bold: true },
        null, 'x', 5
      ],
      bgs: [
        { s: 0, e: 4, preset: '<svg onload=alert(1)>' },
        { s: 0, e: 4, preset: 'brush-a', color: 'javascript:1', opacity: 'NaN', rotation: 9999, scale: -3, dx: 1e9 }
      ],
      anims: [
        { s: 0, e: 4, phase: 'in', type: 'typewriter', dur: 1e12, delay: -1, ease: 'url(x)', dir: 'sideways', repeat: 1e9 },
        { s: 0, e: 4, phase: 'in', type: 'spin' },
        { s: 0, e: 4, phase: 'exit', type: 'fade' }
      ],
      polluted: true
    }]
  };
  const out = R.sanitizeRich(evil, LYRICS);
  const sl = out.slides[0];
  assert.equal(({}).polluted, undefined);
  assert.equal(sl.polluted, undefined);
  assert.equal(sl.marks.length, 1);
  assert.deepEqual(sl.marks[0], { s: 0, e: body0.length, size: 500, color: '#abcdef' });
  assert.equal(sl.marks[0].evil, undefined);
  assert.equal(sl.bgs.length, 1);
  assert.equal(sl.bgs[0].color, '#7c4dff');
  assert.equal(sl.bgs[0].opacity, 0.8);
  assert.equal(sl.bgs[0].rotation, 45);
  assert.equal(sl.bgs[0].scale, 0.5);
  assert.equal(sl.bgs[0].dx, 300);
  assert.equal(sl.anims.length, 1);
  // hiệu ứng VÀO không được lặp (lặp làm chữ chớp tắt / "mất chữ" trên màn chiếu) → repeat luôn 1
  assert.deepEqual(sl.anims[0], { s: 0, e: 4, phase: 'in', type: 'typewriter', dur: 10000, delay: 0, ease: 'ease-out', dir: 'up', stagger: 60, repeat: 1 });
});

test('lặp chỉ dành cho hiệu ứng nhấn: vào/ra luôn 1 lần, nhấn được kẹp 1–100 hoặc ∞', () => {
  const mk = (a) => R.sanitizeRich({ v: 1, slides: [{ h: R.hashText(body0), marks: [], bgs: [], anims: [Object.assign({ s: 0, e: 4 }, a)] }] }, LYRICS).slides[0].anims[0];
  assert.equal(mk({ phase: 'in', type: 'char', repeat: -1 }).repeat, 1);
  assert.equal(mk({ phase: 'in', type: 'fade', repeat: 5 }).repeat, 1);
  assert.equal(mk({ phase: 'out', type: 'fade', repeat: -1 }).repeat, 1);
  assert.equal(mk({ phase: 'emph', type: 'pulse', repeat: -1 }).repeat, -1);
  assert.equal(mk({ phase: 'emph', type: 'pulse', repeat: 1e9 }).repeat, 100);
  assert.equal(mk({ phase: 'emph', type: 'glow', repeat: 3 }).repeat, 3);
});

test('giới hạn số lượng và kiểu dữ liệu sai', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ s: 0, e: 3, color: '#ffffff' }));
  const out = R.sanitizeRich({ v: 1, slides: [{ h: R.hashText(body0), marks: many }] }, LYRICS);
  assert.equal(out.slides[0].marks.length, R.LIMITS.marks);
  for (const bad of [null, undefined, 5, 'x', [], { v: 2, slides: [] }, { v: 1 }, { v: 1, slides: 'x' }, { v: 1, slides: [null] }]) {
    assert.equal(R.sanitizeRich(bad, LYRICS), null);
  }
  // slide thừa so với lời hiện tại bị bỏ
  assert.equal(R.sanitizeRich({ v: 1, slides: [null, null, { h: 'x', marks: [] }] }, LYRICS), null);
});

test('không sửa đầu vào', () => {
  const rich = goodRich();
  const snap = JSON.stringify(rich);
  R.sanitizeRich(rich, LYRICS);
  assert.equal(JSON.stringify(rich), snap);
});

test('offset không cắt giữa chữ và dấu rời (NFD) hay cặp surrogate', () => {
  const nfd = 'Ngài é xin';          // "é" = e + dấu rời
  const lyr = nfd;
  const h = R.hashText(nfd);
  const iE = nfd.indexOf('é');
  const out = R.sanitizeRich({ v: 1, slides: [{ h, marks: [{ s: iE + 1, e: iE + 3, color: '#ff0000' }] }] }, lyr);
  // s rơi giữa "e" và dấu rời → lùi về đầu "é"
  assert.equal(out.slides[0].marks[0].s, iE);
  const emoji = 'Ab😀cd';
  const out2 = R.sanitizeRich({ v: 1, slides: [{ h: R.hashText(emoji), marks: [{ s: 3, e: 5, bold: true }] }] }, emoji);
  assert.equal(out2.slides[0].marks[0].s, 2);
});

test('buildRuns: tách đúng 3 đoạn quanh "VUA", mark sau đè mark trước, gộp đoạn kề cùng định dạng', () => {
  const runs = R.buildRuns(body0, [{ s: vuaS, e: vuaS + 3, color: '#ffd700', bold: true }]);
  assert.equal(runs.length, 3);
  assert.equal(runs[0].text + runs[1].text + runs[2].text, body0);
  assert.equal(runs[1].text, 'VUA');
  assert.deepEqual(runs[1].fmt, { color: '#ffd700', bold: true });
  assert.deepEqual(runs[0].fmt, {});

  const over = R.buildRuns('abcdef', [{ s: 0, e: 6, color: '#111111' }, { s: 2, e: 4, color: '#222222' }]);
  assert.deepEqual(over.map((r) => [r.text, r.fmt.color]), [['ab', '#111111'], ['cd', '#222222'], ['ef', '#111111']]);

  const merged = R.buildRuns('abcdef', [{ s: 0, e: 3, bold: true }, { s: 3, e: 6, bold: true }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'abcdef');

  assert.deepEqual(R.buildRuns('', [{ s: 0, e: 1, bold: true }]), []);
  assert.deepEqual(R.buildRuns('abc', null).map((r) => r.text), ['abc']);
});

test('makeSlideRich dựng + làm sạch, rỗng → null', () => {
  const sl = R.makeSlideRich('Xin chào', { marks: [{ s: 0, e: 3, color: '#00ff00' }] });
  assert.equal(sl.h, R.hashText('Xin chào'));
  assert.equal(R.makeSlideRich('Xin chào', {}), null);
  assert.equal(R.makeSlideRich('Xin chào', { marks: [{ s: 0, e: 3, color: 'bad' }] }), null);
});

test('migrateItem: bài cũ (không có rich) cho kết quả y hệt schema.js gốc trên main', () => {
  const original = req('child_process').execFileSync('git', ['show', 'main:src/schema.js'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', original)(m, m.exports, (p) => req(p));
  const baseline = m.exports.migrateItem;
  const fixtures = [
    { id: 1, title: 'Bài cũ', lyrics: 'a\n\nb', style: { fontColor: '#fff', fontSize: 40 } },
    { id: 2, title: 'pt', lyrics: 'x', style: { fontSize: '30pt', textBox: { left: 10 } } },
    { id: 3, title: 'Kinh Thánh', type: 'bible', lyrics: 'v1\n\nv2' },
    { id: 4, title: 'Không style', lyrics: 'y', background: 'sai' },
    { id: 5, title: 'Có nền', lyrics: 'z', background: { mediaName: 'a.jpg' } }
  ];
  const fs = req('node:fs');
  try { fixtures.push(...JSON.parse(fs.readFileSync(new URL('../data/songs.json', import.meta.url), 'utf8')).slice(0, 400)); } catch (e) { /* repo không có thư viện mẫu: bỏ qua */ }
  for (const f of fixtures) {
    const a = JSON.stringify(baseline(JSON.parse(JSON.stringify(f))));
    const b = JSON.stringify(migrateItem(JSON.parse(JSON.stringify(f))));
    assert.equal(b, a, 'khác hành vi cũ ở bài id=' + f.id);
    assert.equal('rich' in migrateItem(f), false);
  }
});

test('migrateItem: bài hát giữ rich hợp lệ, lọc rich bẩn, bỏ rich khi chữ đổi', () => {
  const song = { id: 2, title: 'VUA', lyrics: LYRICS, rich: goodRich() };
  const m = migrateItem(song);
  assert.deepEqual(m.rich.slides[0].marks, [{ s: vuaS, e: vuaS + 3, color: '#ffd700', bold: true }]);
  assert.equal(migrateItem({ ...song, lyrics: LYRICS + '\n\nThêm' }).rich.slides.length, 1); // slide 1 không đổi nên còn
  assert.equal('rich' in migrateItem({ ...song, lyrics: LYRICS.replace('VUA', 'Vua') }), false);
  assert.equal('rich' in migrateItem({ ...song, rich: { v: 1, slides: [{ h: 'x', marks: [{ s: 0, e: 1, bold: true }] }] } }), false);
  assert.equal('rich' in migrateItem({ ...song, rich: 'x' }), false);
});

test('migrateItem: Kinh Thánh không bao giờ mang rich', () => {
  const bible = { id: 3, title: 'Giăng 3:16', type: 'bible', lyrics: LYRICS, rich: goodRich() };
  assert.equal('rich' in migrateItem(bible), false);
});

test('migrateItem idempotent: chạy 2 lần cho cùng kết quả', () => {
  const once = migrateItem({ id: 2, title: 'VUA', lyrics: LYRICS, rich: goodRich() });
  assert.deepEqual(migrateItem(once), once);
});
