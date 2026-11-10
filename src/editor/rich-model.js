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
  // Giống hệt labelPattern + stripLabel + tách slide của index.html (loadToPreview, bài không phải Kinh Thánh).
  var LABEL_RE = /^(Verse|Chorus|Bridge|Pre-Chorus|Tag|End|Đoạn|Điệp khúc|Kết)/i;

  function splitSlides(lyrics) {
    return String(lyrics == null ? '' : lyrics).split(/\n\s*\n/)
      .filter(function (s) { return s.trim() !== ''; })
      .map(function (s) {
        var t = s.trim();
        var lines = t.split('\n');
        if (lines.length > 0 && LABEL_RE.test(lines[0].trim())) {
          return { label: lines[0].trim(), body: lines.slice(1).join('\n').trim() };
        }
        return { label: '', body: t };
      });
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
      padding: num(o.padding, 0, 80, 12),
      rotation: num(o.rotation, -45, 45, 0),
      scale: num(o.scale, 0.5, 2, 1),
      dx: num(o.dx, -300, 300, 0),
      dy: num(o.dy, -300, 300, 0),
      z: num(o.z, 0, 20, 0, true)
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
      var snap = boundaryFinder(body);
      var marks = cleanList(r.marks, LIMITS.marks, cleanMark, body, snap);
      var bgs = cleanList(r.bgs, LIMITS.bgs, cleanBg, body, snap);
      var anims = cleanList(r.anims, LIMITS.anims, cleanAnim, body, snap);
      if (!marks.length && !bgs.length && !anims.length) { out.push(null); continue; }
      out.push({ h: r.h, marks: marks, bgs: bgs, anims: anims });
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

  // Cắt body thành các đoạn liên tiếp, mỗi đoạn có định dạng gộp từ mọi mark phủ nó (mark sau đè mark trước).
  // Đoạn kề nhau cùng định dạng được gộp lại. Không có mark → đúng 1 đoạn, fmt rỗng.
  function buildRuns(body, marks) {
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
    var pts = Object.keys(cuts).map(Number).sort(function (a, b) { return a - b; });
    var runs = [];
    for (var i = 0; i + 1 < pts.length; i++) {
      var s = pts[i], e = pts[i + 1], fmt = {};
      for (var k = 0; k < list.length; k++) {
        var m = list[k];
        if (!m || !(m.s <= s && m.e >= e)) continue;
        for (var j = 0; j < FMT_KEYS.length; j++) if (m[FMT_KEYS[j]] !== undefined) fmt[FMT_KEYS[j]] = m[FMT_KEYS[j]];
      }
      var prev = runs[runs.length - 1];
      if (prev && JSON.stringify(prev.fmt) === JSON.stringify(fmt)) { prev.e = e; prev.text = body.slice(prev.s, e); }
      else runs.push({ s: s, e: e, text: body.slice(s, e), fmt: fmt });
    }
    return runs;
  }

  // Lấy phần rich của slide thứ i nếu còn khớp chữ hiện tại (dùng ở nơi hiển thị khi không muốn tin dữ liệu đã lưu).
  function slideRich(rich, lyrics, index) {
    var clean = sanitizeRich(rich, lyrics);
    return clean && clean.slides[index] ? clean.slides[index] : null;
  }

  return {
    VERSION: VERSION, LIMITS: LIMITS, BG_PRESETS: BG_PRESETS, ANIM_TYPES: ANIM_TYPES,
    splitSlides: splitSlides, hashText: hashText, sanitizeRich: sanitizeRich,
    makeSlideRich: makeSlideRich, buildRuns: buildRuns, slideRich: slideRich
  };
}));
