// Phép biến đổi của mô hình định dạng giàu (src/editor/rich-model.js): luật nhãn, dời vị trí khi sửa chữ, cắt/dời,
// áp/gạt định dạng, bỏ hợp âm có ánh xạ, ghép/tách bài ↔ thẻ soạn thảo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const R = req('../src/editor/rich-model.js');

test('luật nhãn y hệt index.html splitSlideLabel và comm/setlist/slides.js (nhãn chỉ khi cả dòng là nhãn hoặc "Nhãn: lời")', () => {
  const cases = [
    ['Đoạn 1\nlời', { label: 'Đoạn 1', body: 'lời' }],
    ['Chorus x2\nlời', { label: 'Chorus x2', body: 'lời' }],
    ['Verse 1 (nhẹ)\nlời', { label: 'Verse 1 (nhẹ)', body: 'lời' }],
    ['Chorus: Ha-lê-lu-gia\ndòng 2', { label: 'Chorus', body: 'Ha-lê-lu-gia\ndòng 2' }],
    ['Kết thúc bằng lời cảm tạ\ndòng 2', { label: '', body: 'Kết thúc bằng lời cảm tạ\ndòng 2' }],
    ['Endless love\nx', { label: '', body: 'Endless love\nx' }],
    ['Đoạn đường dài', { label: '', body: 'Đoạn đường dài' }],
    ['Chỉ lời', { label: '', body: 'Chỉ lời' }]
  ];
  for (const [input, want] of cases) assert.deepEqual(R.splitLabel(input), want, input);
  // đối chiếu với bản của trang web (phải y hệt)
  const web = req('../comm/setlist/slides.js');
  for (const [input] of cases) { const w = web.splitSlides(input)[0]; const m = R.splitSlides(input)[0]; assert.equal(m.label, w.label, input); assert.equal(m.body, w.content, input); }
});

test('remapItems: chèn/xoá/thay chữ dời đúng các dải', () => {
  const m = (s, e) => ({ s, e, color: '#ff0000' });
  // "Chúa là VUA muôn đời" — dải trên "VUA" [8,11)
  const t = 'Chúa là VUA muôn đời';
  const vs = t.indexOf('VUA');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, 'XX' + t).map((x) => [x.s, x.e]), [[vs + 2, vs + 5]], 'chèn trước → dời sang phải');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, t + '!!!').map((x) => [x.s, x.e]), [[vs, vs + 3]], 'chèn sau → giữ nguyên');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, t.replace('VUA', 'VUXA')).map((x) => [x.s, x.e]), [[vs, vs + 4]], 'gõ thêm bên trong dải → dải dài ra');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, t.replace('VUA', 'VUAAA')).map((x) => [x.s, x.e]), [[vs, vs + 3]], 'gõ thêm ngay sau cuối dải → không thuộc dải');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, t.slice(0, vs) + 'ZZ' + t.slice(vs)).map((x) => [x.s, x.e]), [[vs + 2, vs + 5]], 'gõ thêm ngay trước đầu dải → dải bị đẩy sang phải');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, t.replace('VUA ', '')).map((x) => [x.s, x.e]), [], 'xoá hết chữ của dải → dải biến mất');
  assert.deepEqual(R.remapItems([m(0, 4)], t, t.slice(4)).length, 0, 'xoá đầu bao trọn dải');
  assert.deepEqual(R.remapItems([m(vs, vs + 3)], t, t.replace('VUA', 'V')).map((x) => [x.s, x.e]), [[vs, vs + 1]], 'thay bằng ngắn hơn');
  // giữ nguyên các khoá khác, không sửa đầu vào
  const src = [{ s: 1, e: 3, color: '#00ff00', bold: true }];
  const out = R.remapItems(src, 'abcdef', 'Xabcdef');
  assert.equal(out[0].bold, true); assert.equal(src[0].s, 1);
  // ngẫu nhiên: dải còn lại luôn nằm trong chữ mới và không rỗng
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
  for (let i = 0; i < 500; i++) {
    const a = Array.from({ length: 1 + rnd(30) }, () => 'abcde '[rnd(6)]).join('');
    let b = a; const op = rnd(3), at = rnd(a.length + 1);
    if (op === 0) b = a.slice(0, at) + 'XYZ'.slice(0, 1 + rnd(3)) + a.slice(at);
    else if (op === 1) b = a.slice(0, at) + a.slice(at + 1 + rnd(4));
    else b = a.slice(0, at) + 'Q' + a.slice(at + 1 + rnd(3));
    const s = rnd(a.length), e = s + 1 + rnd(a.length - s);
    for (const x of R.remapItems([{ s, e: Math.min(e, a.length) }], a, b)) assert.ok(x.s >= 0 && x.e <= b.length && x.e > x.s, `${a} → ${b}`);
  }
});

test('sliceItems / shiftItems: cắt, dời, kẹp', () => {
  const items = [{ s: 2, e: 8, bold: true }, { s: 10, e: 14 }];
  assert.deepEqual(R.sliceItems(items, 5, 12), [{ s: 0, e: 3, bold: true }, { s: 5, e: 7 }]);
  assert.deepEqual(R.sliceItems(items, 8, 10), []);
  assert.deepEqual(R.shiftItems(items, -3, 20), [{ s: 0, e: 5, bold: true }, { s: 7, e: 11 }]);
  assert.deepEqual(R.shiftItems(items, 10, 12), [{ s: 12, e: 12 }].filter((x) => x.e > x.s), 'đẩy ra ngoài chữ → bỏ');
  assert.deepEqual(R.shiftItems(items, -20, 30), []);
});

test('applyMarkPatch: áp, đè, gỡ khoá, gộp đoạn kề, kết quả chính tắc (không chồng lấn)', () => {
  const body = 'abcdefghij';
  let m = R.applyMarkPatch([], body, 2, 5, { color: '#ff0000' });
  assert.deepEqual(m, [{ s: 2, e: 5, color: '#ff0000' }]);
  m = R.applyMarkPatch(m, body, 4, 8, { bold: true });
  assert.deepEqual(m, [{ s: 2, e: 4, color: '#ff0000' }, { s: 4, e: 5, color: '#ff0000', bold: true }, { s: 5, e: 8, bold: true }]);
  m = R.applyMarkPatch(m, body, 2, 8, { color: '#00ff00' });
  assert.deepEqual(R.buildRuns(body, m).map((r) => [r.text, r.fmt.color, r.fmt.bold]),
    [['ab', undefined, undefined], ['cd', '#00ff00', undefined], ['e', '#00ff00', true], ['fgh', '#00ff00', true].slice(0, 2).length ? ['fgh', '#00ff00', true] : null, ['ij', undefined, undefined]].filter(Boolean)
      .reduce((acc, r) => { const p = acc[acc.length - 1]; if (p && p[1] === r[1] && p[2] === r[2]) p[0] += r[0]; else acc.push(r.slice()); return acc; }, []));
  // gỡ khoá màu trong khoảng
  const cleared = R.applyMarkPatch(m, body, 3, 6, { color: undefined });
  const runs = R.buildRuns(body, cleared);
  assert.equal(runs.find((r) => r.s <= 3 && r.e > 3).fmt.color, undefined);
  assert.equal(runs.find((r) => r.s <= 7 && r.e > 7).fmt.color, '#00ff00');
  // không chồng lấn, theo thứ tự
  for (const mm of [m, cleared]) for (let i = 1; i < mm.length; i++) assert.ok(mm[i].s >= mm[i - 1].e);
  // gộp: áp cùng định dạng cho 2 khoảng kề nhau → 1 mark
  const merged = R.applyMarkPatch(R.applyMarkPatch([], body, 0, 3, { italic: true }), body, 3, 6, { italic: true });
  assert.deepEqual(merged, [{ s: 0, e: 6, italic: true }]);
  // khoảng rỗng / ngoài chữ không đổi gì
  assert.deepEqual(R.applyMarkPatch([], body, 5, 5, { bold: true }), []);
  assert.deepEqual(R.applyMarkPatch([], body, 20, 30, { bold: true }), []);
});

test('toggleFlag: bật nếu chưa đủ, tắt nếu toàn bộ đang bật; tính cả giá trị nền của bài (base)', () => {
  const body = 'abcdefghij';
  let m = R.toggleFlag([], body, 2, 6, 'bold', false);
  assert.deepEqual(m, [{ s: 2, e: 6, bold: true }]);
  m = R.toggleFlag(m, body, 2, 6, 'bold', false);
  assert.deepEqual(m, [{ s: 2, e: 6, bold: false }], 'tắt = ghi rõ false (để thắng được kiểu chữ chung của bài)');
  // bài mặc định đậm (base=true): toggle lần đầu phải TẮT đậm
  m = R.toggleFlag([], body, 2, 6, 'bold', true);
  assert.deepEqual(m, [{ s: 2, e: 6, bold: false }]);
  // hỗn hợp (1 phần đã đậm) → bật hết
  const part = R.applyMarkPatch([], body, 2, 4, { italic: true });
  assert.deepEqual(R.buildRuns(body, R.toggleFlag(part, body, 2, 8, 'italic', false)).filter((r) => r.fmt.italic).map((r) => [r.s, r.e]), [[2, 8]]);
});

test('clearMarks + fmtSummary', () => {
  const body = 'abcdefghij';
  let m = R.applyMarkPatch([], body, 0, 6, { color: '#ff0000', bold: true });
  m = R.applyMarkPatch(m, body, 3, 9, { size: 40 });
  assert.equal(R.fmtSummary(m, body, 0, 3).color, '#ff0000');
  assert.equal(R.fmtSummary(m, body, 0, 3).size, undefined);
  assert.equal(R.fmtSummary(m, body, 0, 9).color, R.MIXED);
  assert.equal(R.fmtSummary(m, body, 3, 6).size, 40);
  assert.equal(R.fmtSummary(m, body, 7, 9).bold, undefined);
  const c = R.clearMarks(m, body, 2, 7);
  assert.equal(R.fmtSummary(c, body, 2, 7).color, undefined); assert.equal(R.fmtSummary(c, body, 2, 7).size, undefined);
  assert.equal(R.fmtSummary(c, body, 0, 2).color, '#ff0000'); assert.equal(R.fmtSummary(c, body, 7, 9).size, 40);
});

test('stripChordsMapped: bỏ [hợp âm] và dời dải đúng chỗ', () => {
  const text = '[Am]Chúa là [G]VUA muôn';
  const vs = text.indexOf('VUA');
  const out = R.stripChordsMapped(text, { marks: [{ s: vs, e: vs + 3, color: '#ffd700' }], bgs: [], anims: [] });
  assert.equal(out.text, 'Chúa là VUA muôn');
  assert.equal(out.text.slice(out.parts.marks[0].s, out.parts.marks[0].e), 'VUA');
  // dải phủ cả hợp âm: co lại còn phần chữ
  const o2 = R.stripChordsMapped(text, { marks: [{ s: 0, e: text.length, bold: true }], bgs: [], anims: [] });
  assert.deepEqual([o2.parts.marks[0].s, o2.parts.marks[0].e], [0, o2.text.length]);
  // dải chỉ nằm trong hợp âm → biến mất
  assert.deepEqual(R.stripChordsMapped(text, { marks: [{ s: 1, e: 3, bold: true }], bgs: [], anims: [] }).parts.marks, []);
  assert.equal(R.stripChordsMapped('không hợp âm', null).text, 'không hợp âm');
});

test('composeSong ↔ decomposeSong: khứ hồi giữ đúng định dạng, kể cả khi nhãn lệch luật', () => {
  const blocks = [
    { label: 'Đoạn 1', text: 'Chúa chính Ngài là VUA\nDòng hai', parts: { marks: [{ s: 19, e: 22, color: '#ffd700', bold: true }], bgs: [{ s: 0, e: 18, preset: 'brush-a' }], anims: [] } },
    { label: '', text: '', parts: null },                                   // thẻ rỗng bị bỏ
    { label: 'Intro', text: 'Mở đầu VUA', parts: { marks: [{ s: 7, e: 10, color: '#ff0000' }], bgs: [], anims: [] } },   // nhãn KHÔNG hợp lệ → thành dòng lời
    { label: '', text: 'Chorus: Ha-lê-lu-gia', parts: { marks: [{ s: 8, e: 20, italic: true }], bgs: [], anims: [] } }, // "Chorus:" bị nhận là nhãn
    { label: 'Điệp khúc', text: 'Hallelujah', parts: { marks: [{ s: 0, e: 5, underline: true }], bgs: [], anims: [{ s: 0, e: 10, phase: 'in', type: 'fade' }] } }
  ];
  assert.equal(blocks[0].text.indexOf('VUA'), 19);
  const { lyrics, rich } = R.composeSong(blocks);
  const slides = R.splitSlides(lyrics);
  assert.equal(slides.length, 4);
  assert.equal(rich.slides.length, 4);
  const word = (i, key) => { const sl = rich.slides[i], b = slides[i].body, m = sl[key][0]; return b.slice(m.s, m.e); };
  assert.equal(word(0, 'marks'), 'VUA');
  assert.equal(slides[0].body.slice(rich.slides[0].bgs[0].s, rich.slides[0].bgs[0].e), 'Chúa chính Ngài là');
  assert.equal(word(1, 'marks'), 'VUA', 'nhãn "Intro" không hợp lệ: nhãn thành dòng đầu của lời, vị trí dời theo');
  assert.equal(slides[1].body, 'Intro\nMở đầu VUA');
  assert.equal(word(2, 'marks'), 'Ha-lê-lu-gia', '"Chorus: lời": nhãn tách ra, vị trí dời lùi');
  assert.equal(slides[2].label, 'Chorus');
  assert.equal(word(3, 'marks'), 'Halle');
  // tách lại
  const back = R.decomposeSong(lyrics, rich);
  assert.equal(back.length, 4);
  assert.equal(back[0].label, 'Đoạn 1');
  assert.deepEqual(back[0].parts.marks.map((m) => back[0].body.slice(m.s, m.e)), ['VUA']);
  assert.equal(back[3].parts.anims[0].type, 'fade');
  // rich bị chữ đổi → decompose bỏ định dạng đúng slide
  const edited = lyrics.replace('Hallelujah', 'Halleluya');
  assert.equal(R.decomposeSong(edited, rich)[3].parts.marks.length, 0);
  assert.equal(R.decomposeSong(edited, rich)[0].parts.marks.length, 1);
  // không có định dạng nào → rich null
  assert.equal(R.composeSong([{ label: 'Đoạn 1', text: 'abc', parts: { marks: [], bgs: [], anims: [] } }]).rich, null);
});

test('composeSong: parts tính trên partsText khác text (DOM lạ) được dời theo diff', () => {
  const out = R.composeSong([{ label: '', text: 'Xin  chào VUA', partsText: 'Xin chào VUA', parts: { marks: [{ s: 9, e: 12, color: '#ff0000' }], bgs: [], anims: [] } }]);
  const body = R.splitSlides(out.lyrics)[0].body;
  assert.equal(body.slice(out.rich.slides[0].marks[0].s, out.rich.slides[0].marks[0].e), 'VUA');
});

test('sanitizeParts: dùng cho nơi hiển thị — kẹp giá trị, không cần mã băm', () => {
  const p = R.sanitizeParts({ marks: [{ s: 0, e: 3, color: '#ABCDEF', size: 1 }, { s: 0, e: 3, color: 'x' }], bgs: [{ s: 0, e: 3, preset: 'marker', thick: 9, shape: 99 }], anims: [] }, 'abcdef');
  assert.deepEqual(p.marks, [{ s: 0, e: 3, color: '#abcdef', size: 8 }]);
  assert.equal(p.bgs[0].thick, 1); assert.equal(p.bgs[0].shape, 9);
  assert.deepEqual(R.sanitizeParts(null, 'abc'), { marks: [], bgs: [], anims: [] });
});

test('rich-model chạy được trong trình duyệt (UMD không phụ thuộc Node)', () => {
  const src = fs.readFileSync(new URL('../src/editor/rich-model.js', import.meta.url), 'utf8');
  assert.ok(!/\brequire\(|process\.|__dirname/.test(src.replace(/\/\*[\s\S]*?\*\//, '')), 'không dùng API riêng của Node');
});
