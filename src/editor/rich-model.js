/* Mô hình văn bản giàu định dạng cho bài hát (Edit Song).
 *
 * Nguyên tắc: `song.lyrics` VẪN là chuỗi thuần (slide cách nhau bằng dòng trống, nhãn ở dòng đầu,
 * hợp âm [Am] chèn trong chữ) — mọi nơi khác (nhập/xuất, thay thế hàng loạt, đồng bộ lên điện thoại,
 * /setlist/, tìm kiếm) tiếp tục chỉ đọc chuỗi đó. Định dạng nằm ở trường tuỳ chọn `song.rich`:
 *
 *   rich = { v: 1, slides: [ null | { h, marks: [...], bgs: [...], anims: [...] } ] }
 *
 *   - slides[i] ứng với slide thứ i của splitSlides(lyrics); `h` = mã băm phần chữ (body) của slide đó.
 *     Chữ bị sửa ở nơi khác (web, thay thế hàng loạt…) → `h` lệch → CHỈ slide đó mất định dạng, không sai chữ.
 *   - Mọi vị trí (s, e) là chỉ số UTF-16 trong `body` (chữ slide đã bỏ nhãn đầu, có cả [hợp âm]), nửa mở [s, e).
 *   - marks: định dạng chữ theo khoảng; áp theo thứ tự mảng, cái sau đè cái trước.
 *   - bgs: lớp nền (brush/marker/...) phía sau một khoảng chữ. Độ mờ chỉ nằm ở lớp nền.
 *   - anims: hiệu ứng cho một khoảng chữ.
 *
 * `rich` đến từ file nhập/đồng bộ nên KHÔNG tin cậy: sanitizeRich dựng object MỚI từ danh sách cho phép,
 * giới hạn số lượng/miền giá trị, không bao giờ giữ lại khoá lạ. File này chạy được cả trong trình duyệt
 * (window.RichModel) lẫn Node (require) để test bằng `node --test`. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RichModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var LIMITS = { slides: 300, marks: 300, bgs: 12, anims: 30 };
  var BG_PRESETS = ['brush-a', 'brush-b', 'paper', 'pill', 'marker'];
  var ANIM_TYPES = {
    in: ['fade', 'slide-up', 'slide-down', 'zoom', 'typewriter', 'word', 'char'],
    emph: ['pulse', 'glow', 'scale', 'color'],
    out: ['fade', 'slide', 'zoom']
  };
  var EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
  var DIRS = ['up', 'down', 'left', 'right'];

  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var FONT_RE = /^[\w \-.À-ɏ]{1,60}$/; // giống safeFamily của /setlist/: không cho dấu nháy, ngoặc, chấm phẩy

  // PHẢI giống hệt index.html (splitSlideLabel) và comm/setlist/slides.js (stripLabel): dòng đầu là NHÃN khi cả dòng là nhãn
  // ("Verse 1", "Điệp khúc", "Chorus x2", "Kết") hoặc "Nhãn: lời" (giữ phần lời). "Kết thúc…/Endless…" KHÔNG phải nhãn.
  var LABEL_WORDS = 'Verse|Chorus|Bridge|Pre-Chorus|Tag|End|Đoạn|Điệp khúc|Kết';
  var LABEL_ONLY_RE = new RegExp('^(?:' + LABEL_WORDS + ')(?:\\s*\\d+)?(?:\\s*(?:[x×]\\s*\\d+|\\d+\\s*[x×]))?(?:\\s*\\([^)]*\\))?\\s*[:.\\-]?\\s*$', 'i');
  var LABEL_INLINE_RE = new RegExp('^((?:' + LABEL_WORDS + ')(?:\\s*\\d+)?)\\s*:\\s*(\\S.*)$', 'i');

  function splitLabel(text) {
    var t = String(text == null ? '' : text);
    var nlAt = t.indexOf('\n');
    var first = (nlAt === -1 ? t : t.slice(0, nlAt)).trim();
    var rest = nlAt === -1 ? '' : t.slice(nlAt + 1);
    if (LABEL_ONLY_RE.test(first)) return { label: first, body: rest.trim() };
    var m = LABEL_INLINE_RE.exec(first);
    if (m) return { label: m[1].trim(), body: (m[2] + (rest ? '\n' + rest : '')).trim() };
    return { label: '', body: t.trim() };
  }

  function splitSlides(lyrics) {
    return String(lyrics == null ? '' : lyrics).split(/\n\s*\n/)
      .filter(function (s) { return s.trim() !== ''; })
      .map(function (s) { return splitLabel(s.trim()); });
  }

  // FNV-1a 32-bit trên code unit UTF-16 → 8 ký tự hex. Chỉ để phát hiện chữ đã đổi, không phải mật mã.
  function hashText(str) {
    var h = 0x811c9dc5;
    var s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* ---------- làm sạch ---------- */
  function num(v, min, max, def, integer) {
    var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (!isFinite(n)) return def;
    if (integer) n = Math.round(n);
    return Math.min(max, Math.max(min, n));
  }
  function color(v) { return (typeof v === 'string' && COLOR_RE.test(v)) ? v.toLowerCase() : null; }
  function oneOf(v, list, def) { return (typeof v === 'string' && list.indexOf(v) !== -1) ? v : def; }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  // Ranh giới "ký tự người đọc thấy" (grapheme): không cắt giữa chữ + dấu rời (Telex/NFD) hay cặp surrogate.
  var segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  function boundaryFinder(body) {
    var set = null;
    if (segmenter) {
      set = Object.create(null);
      set[0] = true; set[body.length] = true;
      var it = segmenter.segment(body)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) set[r.value.index] = true;
    }
    return function snap(i) {
      if (i <= 0) return 0;
      if (i >= body.length) return body.length;
      if (set) { while (i > 0 && !set[i]) i--; return i; }
      var c = body.charCodeAt(i), p = body.charCodeAt(i - 1);
      return (c >= 0xDC00 && c <= 0xDFFF && p >= 0xD800 && p <= 0xDBFF) ? i - 1 : i;
    };
  }

  function range(o, body, snap) {
    var s = num(o.s, 0, body.length, NaN, true), e = num(o.e, 0, body.length, NaN, true);
    if (isNaN(s) || isNaN(e)) return null;
    s = snap(s); e = snap(e);
    return s < e ? { s: s, e: e } : null;
  }

  function cleanMark(o, body, snap) {
    if (!isObj(o)) return null;
    var r = range(o, body, snap); if (!r) return null;
    var m = { s: r.s, e: r.e }, has = false, c;
    if ((c = color(o.color))) { m.color = c; has = true; }
    ['bold', 'italic', 'underline'].forEach(function (k) { if (typeof o[k] === 'boolean') { m[k] = o[k]; has = true; } });
    if (o.size != null) { var sz = num(o.size, 8, 500, NaN, true); if (!isNaN(sz)) { m.size = sz; has = true; } }
    if (typeof o.font === 'string' && FONT_RE.test(o.font)) { m.font = o.font; has = true; }
    if (isObj(o.shadow)) {
      var sc = color(o.shadow.color);
      if (sc) { m.shadow = { x: num(o.shadow.x, -50, 50, 0), y: num(o.shadow.y, -50, 50, 0), blur: num(o.shadow.blur, 0, 100, 0), color: sc }; has = true; }
    }
    if (isObj(o.stroke)) {
      var tc = color(o.stroke.color), w = num(o.stroke.w, 0, 40, NaN);
      if (tc && !isNaN(w)) { m.stroke = { w: w, color: tc }; has = true; }
    }
    return has ? m : null;
  }

  function cleanBg(o, body, snap) {
    if (!isObj(o)) return null;
    var r = range(o, body, snap); if (!r) return null;
    var preset = oneOf(o.preset, BG_PRESETS, null); if (!preset) return null;
    return {
      s: r.s, e: r.e, preset: preset,
      color: color(o.color) || '#7c4dff',
      opacity: num(o.opacity, 0, 1, 0.8),
      radius: num(o.radius, 0, 60, 12),
      padding: num(o.padding, -40, 80, 12),         // đệm theo CHIỀU CAO (mỗi phía, px); ÂM = nền thấp hơn dòng chữ
      rotation: num(o.rotation, -45, 45, 0),
      scale: num(o.scale, 0.5, 3, 1),               // giãn CHIỀU NGANG (tỉ lệ so với bề ngang chữ)
      dx: num(o.dx, -300, 300, 0),
      dy: num(o.dy, -300, 300, 0),
      z: num(o.z, 0, 20, 0, true),
      thick: num(o.thick, 0.15, 1, 0.6),          // độ dày dải marker (tỉ lệ chiều cao dòng)
      shape: num(o.shape, 0, 9, 0, true)          // biến thể hình dạng (hạt giống của đường viền)
    };
  }

  function cleanAnim(o, body, snap) {
    if (!isObj(o)) return null;
    var r = range(o, body, snap); if (!r) return null;
    var phase = oneOf(o.phase, ['in', 'emph', 'out'], null); if (!phase) return null;
    var type = oneOf(o.type, ANIM_TYPES[phase], null); if (!type) return null;
    var a = {
      s: r.s, e: r.e, phase: phase, type: type,
      dur: num(o.dur, 0, 10000, 600, true),
      delay: num(o.delay, 0, 30000, 0, true),
      ease: oneOf(o.ease, EASINGS, 'ease-out'),
      dir: oneOf(o.dir, DIRS, 'up'),
      stagger: num(o.stagger, 0, 2000, 60, true),
      repeat: num(o.repeat, -1, 100, 1, true) // -1 = lặp vô hạn
    };
    var c = color(o.color); if (c) a.color = c;
    return a;
  }

  function cleanList(list, cap, fn, body, snap) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length && out.length < cap; i++) {
      var x = fn(list[i], body, snap);
      if (x) out.push(x);
    }
    return out;
  }

  // Làm sạch {marks,bgs,anims} của MỘT slide theo chữ `body` (không kiểm mã băm). Dùng cho nơi hiển thị (xem trước/Live)
  // để dù dữ liệu đến từ đâu cũng không bao giờ áp giá trị ngoài danh sách cho phép.
  function sanitizeParts(parts, body) {
    body = String(body == null ? '' : body);
    var p = isObj(parts) ? parts : {};
    var snap = boundaryFinder(body);
    return {
      marks: cleanList(p.marks, LIMITS.marks, cleanMark, body, snap),
      bgs: cleanList(p.bgs, LIMITS.bgs, cleanBg, body, snap),
      anims: cleanList(p.anims, LIMITS.anims, cleanAnim, body, snap)
    };
  }
  function partsEmpty(p) { return !p || (!p.marks.length && !p.bgs.length && !p.anims.length); }

  // Trả về rich đã làm sạch (object MỚI) hoặc null nếu không còn gì dùng được. `info.dropped` = số slide
  // có định dạng nhưng bị bỏ vì chữ đã đổi (để giao diện báo cho người dùng).
  function sanitizeRich(rich, lyrics, info) {
    if (info) info.dropped = 0;
    if (!isObj(rich) || rich.v !== VERSION || !Array.isArray(rich.slides)) return null;
    var slides = splitSlides(lyrics);
    var out = [], any = false;
    for (var i = 0; i < slides.length && i < LIMITS.slides; i++) {
      var r = rich.slides[i];
      if (!isObj(r)) { out.push(null); continue; }
      var body = slides[i].body;
      if (r.h !== hashText(body)) { out.push(null); if (info) info.dropped++; continue; }
      var parts = sanitizeParts(r, body);
      if (partsEmpty(parts)) { out.push(null); continue; }
      out.push({ h: r.h, marks: parts.marks, bgs: parts.bgs, anims: parts.anims });
      any = true;
    }
    if (!any) return null;
    while (out.length && out[out.length - 1] === null) out.pop();
    return { v: VERSION, slides: out };
  }

  // Dựng phần rich của 1 slide từ dữ liệu soạn thảo (editor gọi khi lưu). Có chạy qua bộ làm sạch.
  function makeSlideRich(body, parts) {
    parts = parts || {};
    var rich = { v: VERSION, slides: [{ h: hashText(body), marks: parts.marks || [], bgs: parts.bgs || [], anims: parts.anims || [] }] };
    var clean = sanitizeRich(rich, body);
    return clean ? clean.slides[0] : null;
  }

  /* ---------- dựng các đoạn chữ ---------- */
  var FMT_KEYS = ['color', 'bold', 'italic', 'underline', 'size', 'font', 'shadow', 'stroke'];

  function fmtEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Cắt body thành các đoạn liên tiếp tại mọi biên của mark (và `extraCuts`), mỗi đoạn mang định dạng gộp từ mọi mark phủ nó
  // (mark sau đè mark trước). KHÔNG gộp đoạn kề nhau.
  function rawRuns(body, marks, extraCuts) {
    body = String(body == null ? '' : body);
    var n = body.length;
    if (!n) return [];
    var list = Array.isArray(marks) ? marks : [];
    var cuts = { 0: true };
    cuts[n] = true;
    list.forEach(function (m) {
      if (m && m.s > 0 && m.s < n) cuts[m.s] = true;
      if (m && m.e > 0 && m.e < n) cuts[m.e] = true;
    });
    (extraCuts || []).forEach(function (c) { if (c > 0 && c < n) cuts[c] = true; });
    var pts = Object.keys(cuts).map(Number).sort(function (a, b) { return a - b; });
    var runs = [];
    for (var i = 0; i + 1 < pts.length; i++) {
      var s = pts[i], e = pts[i + 1], fmt = {};
      for (var k = 0; k < list.length; k++) {
        var m = list[k];
        if (!m || !(m.s <= s && m.e >= e)) continue;
        for (var j = 0; j < FMT_KEYS.length; j++) if (m[FMT_KEYS[j]] !== undefined) fmt[FMT_KEYS[j]] = m[FMT_KEYS[j]];
      }
      runs.push({ s: s, e: e, text: body.slice(s, e), fmt: fmt });
    }
    return runs;
  }
  function mergeRuns(runs, body) {
    var out = [];
    runs.forEach(function (r) {
      var prev = out[out.length - 1];
      if (prev && fmtEqual(prev.fmt, r.fmt)) { prev.e = r.e; prev.text = body.slice(prev.s, r.e); }
      else out.push({ s: r.s, e: r.e, text: r.text, fmt: r.fmt });
    });
    return out;
  }
  // Đoạn đã gộp: không có mark → đúng 1 đoạn, fmt rỗng.
  function buildRuns(body, marks) { body = String(body == null ? '' : body); return mergeRuns(rawRuns(body, marks), body); }

  /* ---------- biến đổi dải (s,e) khi chữ thay đổi ---------- */
  function commonPrefix(a, b) { var n = Math.min(a.length, b.length), i = 0; while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; return i; }

  // Dời mọi dải (marks/bgs/anims: đều có s,e) theo thay đổi chữ oldText → newText (so khớp tiền tố/hậu tố chung).
  // Vị trí trước vùng đổi giữ nguyên, sau vùng đổi dời theo độ lệch; nằm TRONG vùng đổi: đầu → đầu vùng, cuối → hết chữ mới.
  // Gõ thêm ngay SAU cuối dải hoặc ngay TRƯỚC đầu dải thì chữ mới KHÔNG thuộc dải.
  function remapItems(items, oldText, newText) {
    oldText = String(oldText == null ? '' : oldText); newText = String(newText == null ? '' : newText);
    if (!Array.isArray(items) || !items.length || oldText === newText) return items || [];
    var p = commonPrefix(oldText, newText);
    var maxSuf = Math.min(oldText.length, newText.length) - p, suf = 0;
    while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) === newText.charCodeAt(newText.length - 1 - suf)) suf++;
    var oldMidEnd = oldText.length - suf, newMid = newText.length - p - suf, delta = newText.length - oldText.length;
    function map(x, isEnd) {
      if (x < p) return x;
      if (x >= oldMidEnd) {
        // chèn thuần đúng tại biên: chữ mới đứng NGOÀI dải (cuối dải không dài ra; đầu dải bị đẩy sang phải)
        if (x === p && oldMidEnd === p) return isEnd ? x : x + delta;
        return x + delta;
      }
      if (x === p) return x;
      return isEnd ? p + newMid : p;
    }
    var out = [];
    items.forEach(function (it) {
      var s = map(it.s, false), e = map(it.e, true);
      if (e > s && s < newText.length) { var c = {}; for (var k in it) c[k] = it[k]; c.s = s; c.e = Math.min(e, newText.length); out.push(c); }
    });
    return out;
  }
  // Giữ phần [from, to) của các dải, dời về gốc `from`.
  function sliceItems(items, from, to) {
    var out = [];
    (items || []).forEach(function (it) {
      var s = Math.max(it.s, from), e = Math.min(it.e, to);
      if (e > s) { var c = {}; for (var k in it) c[k] = it[k]; c.s = s - from; c.e = e - from; out.push(c); }
    });
    return out;
  }
  // Dời mọi dải thêm `delta` rồi kẹp vào [0, len]; dải rỗng bị bỏ.
  function shiftItems(items, delta, len) {
    var out = [];
    (items || []).forEach(function (it) {
      var s = Math.max(0, Math.min(len, it.s + delta)), e = Math.max(0, Math.min(len, it.e + delta));
      if (e > s) { var c = {}; for (var k in it) c[k] = it[k]; c.s = s; c.e = e; out.push(c); }
    });
    return out;
  }
  function mapParts(parts, fn) {
    parts = parts || {};
    return { marks: fn(parts.marks || []), bgs: fn(parts.bgs || []), anims: fn(parts.anims || []) };
  }
  function remapParts(parts, oldText, newText) { return mapParts(parts, function (l) { return remapItems(l, oldText, newText); }); }
  function sliceParts(parts, from, to) { return mapParts(parts, function (l) { return sliceItems(l, from, to); }); }
  function shiftParts(parts, delta, len) { return mapParts(parts, function (l) { return shiftItems(l, delta, len); }); }

  /* ---------- áp / gạt định dạng chữ (luôn trả về danh sách mark CHÍNH TẮC, không chồng lấn) ---------- */
  function marksFromRuns(runs) {
    var out = [];
    runs.forEach(function (r) { if (Object.keys(r.fmt).length) { var m = { s: r.s, e: r.e }; for (var k in r.fmt) m[k] = r.fmt[k]; out.push(m); } });
    return out;
  }
  // patch: { key: value } — value === undefined gỡ khoá đó trong khoảng [s, e).
  function applyMarkPatch(marks, body, s, e, patch) {
    body = String(body == null ? '' : body);
    s = Math.max(0, Math.min(body.length, s | 0)); e = Math.max(0, Math.min(body.length, e | 0));
    if (s >= e) return Array.isArray(marks) ? marks.slice() : [];
    var runs = rawRuns(body, marks, [s, e]);
    runs.forEach(function (r) {
      if (r.s < s || r.e > e) return;
      for (var k in patch) { if (patch[k] === undefined) delete r.fmt[k]; else r.fmt[k] = patch[k]; }
    });
    return marksFromRuns(mergeRuns(runs, body));
  }
  function clearMarks(marks, body, s, e) {
    var patch = {}; FMT_KEYS.forEach(function (k) { patch[k] = undefined; });
    return applyMarkPatch(marks, body, s, e, patch);
  }
  // Giá trị CHUNG của từng khoá định dạng trong [s, e) — undefined = không đặt; MIXED = có chỗ đặt khác nhau.
  var MIXED = { mixed: true };
  function fmtSummary(marks, body, s, e) {
    var runs = rawRuns(body, marks, [s, e]).filter(function (r) { return r.s >= s && r.e <= e; });
    var out = {};
    FMT_KEYS.forEach(function (k) {
      var first, set = false, mixed = false;
      runs.forEach(function (r) {
        var v = r.fmt[k]; var jv = JSON.stringify(v);
        if (!set) { first = jv; set = true; } else if (first !== jv) mixed = true;
      });
      out[k] = mixed ? MIXED : (set && first !== undefined ? JSON.parse(first) : undefined);
    });
    return out;
  }
  // Bật/tắt một cờ (bold/italic/underline) trên [s, e): nếu TOÀN BỘ khoảng đang bật (theo giá trị hiệu lực: mark hoặc `base`)
  // thì tắt, ngược lại bật.
  function toggleFlag(marks, body, s, e, key, base) {
    var runs = rawRuns(body, marks, [s, e]).filter(function (r) { return r.s >= s && r.e <= e; });
    var allOn = runs.length > 0 && runs.every(function (r) { return (r.fmt[key] !== undefined ? r.fmt[key] : !!base) === true; });
    var patch = {}; patch[key] = !allOn;
    return applyMarkPatch(marks, body, s, e, patch);
  }

  /* ---------- bỏ [hợp âm] có ánh xạ vị trí (màn chiếu không hiện hợp âm) ---------- */
  function stripChordsMapped(text, parts) {
    text = String(text == null ? '' : text);
    var re = /\[.*?\]/g, m, cuts = [];
    while ((m = re.exec(text))) cuts.push([m.index, m.index + m[0].length]);
    if (!cuts.length) return { text: text, parts: parts || { marks: [], bgs: [], anims: [] } };
    var out = '', last = 0;
    cuts.forEach(function (c) { out += text.slice(last, c[0]); last = c[1]; });
    out += text.slice(last);
    function map(x) {
      var removed = 0;
      for (var i = 0; i < cuts.length; i++) {
        var c = cuts[i];
        if (x >= c[1]) removed += c[1] - c[0];
        else if (x > c[0]) { removed += x - c[0]; break; }
        else break;
      }
      return x - removed;
    }
    function fn(list) {
      var o = [];
      (list || []).forEach(function (it) { var s = map(it.s), e = map(it.e); if (e > s) { var c = {}; for (var k in it) c[k] = it[k]; c.s = s; c.e = e; o.push(c); } });
      return o;
    }
    return { text: out, parts: mapParts(parts, fn) };
  }

  /* ---------- ghép / tách bài ↔ các thẻ của trình soạn ---------- */
  // blocks: [{ label, text, parts, partsText }]
  //   text      = chữ của thẻ đúng như sẽ lưu (innerText.trim())
  //   parts     = {marks,bgs,anims} có vị trí tính trên `partsText` (mặc định = text)
  // → { lyrics, rich }  (thẻ rỗng bị bỏ, như getLyricsFromEditor). `rich` căn theo splitSlides(lyrics) và đã làm sạch.
  function composeSong(blocks) {
    var entries = [], slides = [], any = false;
    (blocks || []).forEach(function (b) {
      var label = String(b.label == null ? '' : b.label).trim();
      var text = String(b.text == null ? '' : b.text).trim();
      var entry = label ? (label + '\n' + text).trim() : text;
      if (entry === '') return;
      entries.push(entry);
      var parsed = splitSlides(entry)[0];
      if (!parsed) { slides.push(null); return; }
      var parts = b.parts || { marks: [], bgs: [], anims: [] };
      if (b.partsText != null && String(b.partsText) !== text) parts = remapParts(parts, String(b.partsText), text);
      // body (chữ slide theo luật nhãn) luôn là hậu tố/tiền tố của text: dời theo độ lệch độ dài
      var shifted = shiftParts(parts, parsed.body.length - text.length, parsed.body.length);
      var sl = makeSlideRich(parsed.body, shifted);
      if (sl) any = true;
      slides.push(sl);
    });
    while (slides.length && slides[slides.length - 1] === null) slides.pop();
    return { lyrics: entries.join('\n\n'), rich: any ? { v: VERSION, slides: slides } : null };
  }
  // Ngược lại: lời + rich → [{ label, body, parts }] (parts luôn có dạng {marks,bgs,anims}; thẻ trống nếu không có slide).
  function decomposeSong(lyrics, rich) {
    var slides = splitSlides(lyrics);
    var clean = rich ? sanitizeRich(rich, lyrics) : null;
    return slides.map(function (sl, i) {
      var r = clean && clean.slides[i];
      return { label: sl.label, body: sl.body, parts: r ? { marks: r.marks, bgs: r.bgs, anims: r.anims } : { marks: [], bgs: [], anims: [] } };
    });
  }

  // Lấy phần rich của slide thứ i nếu còn khớp chữ hiện tại (dùng ở nơi hiển thị khi không muốn tin dữ liệu đã lưu).
  function slideRich(rich, lyrics, index) {
    var clean = sanitizeRich(rich, lyrics);
    return clean && clean.slides[index] ? clean.slides[index] : null;
  }

  return {
    VERSION: VERSION, LIMITS: LIMITS, BG_PRESETS: BG_PRESETS, ANIM_TYPES: ANIM_TYPES, EASINGS: EASINGS, DIRS: DIRS, FMT_KEYS: FMT_KEYS, MIXED: MIXED,
    splitLabel: splitLabel, splitSlides: splitSlides, hashText: hashText,
    sanitizeRich: sanitizeRich, sanitizeParts: sanitizeParts, partsEmpty: partsEmpty, makeSlideRich: makeSlideRich, slideRich: slideRich,
    buildRuns: buildRuns, rawRuns: rawRuns,
    remapItems: remapItems, sliceItems: sliceItems, shiftItems: shiftItems, remapParts: remapParts, sliceParts: sliceParts, shiftParts: shiftParts,
    applyMarkPatch: applyMarkPatch, clearMarks: clearMarks, toggleFlag: toggleFlag, fmtSummary: fmtSummary,
    stripChordsMapped: stripChordsMapped, composeSong: composeSong, decomposeSong: decomposeSong
  };
}));
