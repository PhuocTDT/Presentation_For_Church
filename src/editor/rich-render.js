/* Bộ render DÙNG CHUNG cho chữ giàu định dạng: khung xem trước trong hộp Edit Song, hình thu nhỏ, xem trước/màn giám sát
 * của cửa sổ chính và cửa sổ Live (live.html) đều gọi đúng các hàm này → "Preview = Projector".
 *
 *   RichRender.render(el, text, parts, opts)  dựng chữ thành các <span> (màu, đậm/nghiêng/gạch chân, cỡ, font, bóng, viền)
 *                                             + các đơn vị hoạt ảnh; trả về handle { relayout, play, playOut, stop, ... }
 *   handle.relayout()                         vẽ lại các lớp nền (brush/marker/…) sau khi bố cục/cỡ chữ thay đổi
 *   handle.play('in'|'emph'|'out')            chạy hoạt ảnh theo giai đoạn (Web Animations API, không thư viện)
 *
 * `text` phải là chữ sẽ HIỂN THỊ (đã bỏ [hợp âm] nếu là màn chiếu) và `parts` có vị trí tính trên đúng chuỗi đó
 * (RichModel.stripChordsMapped lo việc này). Mọi giá trị định dạng đều được RichModel.sanitizeParts lọc trước khi áp.
 * Phần thuần (đường viền brush/marker/paper, gom dòng, kế hoạch đoạn) chạy được trong Node để test. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var RM = node ? require('./rich-model.js') : root.RichModel;
  var BS = node ? require('./brush-shapes.js') : root.BrushShapes;
  if (node) module.exports = factory(root, RM, BS);
  else root.RichRender = factory(root, RM, BS);
}(typeof self !== 'undefined' ? self : this, function (root, RM, BS) {
  'use strict';

  /* ===================== phần thuần ===================== */
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function r1(n) { return Math.round(n * 10) / 10; }

  // PRNG xác định (mulberry32) — cùng hạt giống cho cùng hình, để Preview/Live/lần mở sau luôn vẽ giống nhau.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFrom(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Đường cong khép kín đi qua các điểm bằng Q (trung điểm) → viền mềm, "hữu cơ".
  function smoothClosed(pts) {
    var n = pts.length, d = '';
    function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    var m0 = mid(pts[n - 1], pts[0]);
    d += 'M' + r1(m0[0]) + ' ' + r1(m0[1]);
    for (var i = 0; i < n; i++) {
      var p = pts[i], m = mid(p, pts[(i + 1) % n]);
      d += ' Q' + r1(p[0]) + ' ' + r1(p[1]) + ' ' + r1(m[0]) + ' ' + r1(m[1]);
    }
    return d + ' Z';
  }

  // Nét cọ (vệt sơn): dùng HÌNH THẬT từ bộ vector mẫu (src/editor/brush-shapes.js) — vệt mềm (variant 0) hoặc cọ khô
  // (variant 1). Mỗi hình đã chuẩn hoá: hình chữ nhật lớn nhất nằm trọn trong thân = [0,1000]², nên kéo nó vào hộp w×h
  // thì chữ luôn được che kín; sợi/đuôi/mảnh vụn nằm ngoài hộp (SVG overflow:visible). Chọn hình theo hạt giống.
  var shapeToks = {};
  function brushCount(variant) { var l = BS && BS[variant === 1 ? 'dry' : 'smooth']; return l ? l.length : 0; }
  function brushPath(w, h, seed, variant) {
    w = Math.max(8, w); h = Math.max(8, h);
    var kind = variant === 1 ? 'dry' : 'smooth', n = brushCount(variant);
    if (!n) return 'M0 0 L' + r1(w) + ' 0 L' + r1(w) + ' ' + r1(h) + ' L0 ' + r1(h) + ' Z';
    var idx = (seed >>> 0) % n, key = kind + idx;
    var toks = shapeToks[key] || (shapeToks[key] = BS[kind][idx].match(/[MLZ]|-?\d+(?:\.\d+)?/g));
    var sx = w / 1000, sy = h / 1000, out = [], k = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t === 'M' || t === 'L' || t === 'Z') { out.push(t); k = 0; continue; }
      out.push(r1(k++ % 2 === 0 ? +t * sx : +t * sy));
    }
    return out.join(' ').replace(/([MLZ]) /g, '$1').replace(/ ([MZ])/g, '$1');
  }

  // Dải marker: gần như chữ nhật, hai đầu hơi bo và lệch, mép trên/dưới lệch nhẹ.
  function markerPath(w, h, seed) {
    w = Math.max(8, w); h = Math.max(4, h);
    var rnd = rng(seed), pts = [], steps = Math.max(3, Math.round(w / 60)), j = h * 0.07;
    pts.push([w * 0.01, h * (0.25 + rnd() * 0.1)]);
    for (var i = 0; i <= steps; i++) pts.push([w * (0.02 + 0.96 * i / steps), rnd() * j]);
    pts.push([w * (0.995 - rnd() * 0.01), h * (0.3 + rnd() * 0.1)]);
    pts.push([w * (0.995 - rnd() * 0.01), h * (0.7 + rnd() * 0.1)]);
    for (var k = steps; k >= 0; k--) pts.push([w * (0.02 + 0.96 * k / steps), h - rnd() * j]);
    pts.push([w * 0.01, h * (0.7 + rnd() * 0.1)]);
    return smoothClosed(pts);
  }

  // Giấy xé: mép trái/phải răng cưa, mép trên/dưới thẳng lệch nhẹ.
  function paperPath(w, h, seed, offset) {
    w = Math.max(12, w); h = Math.max(8, h);
    var rnd = rng(seed), d, teeth = Math.max(4, Math.round(h / 9)), tw = Math.max(2, Math.min(7, w * 0.015)), o = offset || 0;
    d = 'M' + r1(tw + o) + ' ' + r1(rnd() * 2);
    d += ' L' + r1(w - tw + o) + ' ' + r1(rnd() * 2);
    for (var i = 1; i <= teeth; i++) d += ' L' + r1(w - rnd() * tw + o) + ' ' + r1(h * i / teeth);
    d += ' L' + r1(tw + o) + ' ' + r1(h - rnd() * 2);
    for (var j = teeth - 1; j >= 0; j--) d += ' L' + r1(rnd() * tw + o) + ' ' + r1(h * j / teeth);
    return d + ' Z';
  }

  // Gom các hình chữ nhật của từng đoạn chữ thành các DÒNG (cùng hàng ngang), mỗi dòng một hộp bao.
  function groupLineRects(rects) {
    var list = rects.filter(function (r) { return r.width > 0 && r.height > 0; }).map(function (r) { return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    list.sort(function (a, b) { return a.top - b.top || a.left - b.left; });
    var lines = [];
    list.forEach(function (r) {
      var cy = (r.top + r.bottom) / 2, h = r.bottom - r.top, line = null;
      for (var i = lines.length - 1; i >= 0; i--) {
        var L = lines[i], lcy = (L.top + L.bottom) / 2;
        if (Math.abs(cy - lcy) < Math.max(h, L.bottom - L.top) * 0.5) { line = L; break; }
      }
      if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
      else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
    return lines.sort(function (a, b) { return a.top - b.top; });
  }
  function unionRect(lines) {
    var u = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    lines.forEach(function (l) { u.left = Math.min(u.left, l.left); u.top = Math.min(u.top, l.top); u.right = Math.max(u.right, l.right); u.bottom = Math.max(u.bottom, l.bottom); });
    return u;
  }

  // Kế hoạch dựng: các đoạn liên tiếp, mỗi đoạn có định dạng + danh sách hoạt ảnh phủ nó.
  function planSegments(text, parts) {
    parts = parts || { marks: [], bgs: [], anims: [] };
    var cuts = [];
    (parts.anims || []).forEach(function (a) { cuts.push(a.s, a.e); });
    return RM.rawRuns(text, parts.marks || [], cuts).map(function (r) {
      var an = [];
      (parts.anims || []).forEach(function (a, i) { if (a.s <= r.s && a.e >= r.e) an.push(i); });
      return { s: r.s, e: r.e, text: r.text, fmt: r.fmt, anims: an };
    });
  }

  var TRANSFORM_TYPES = { 'slide-up': 1, 'slide-down': 1, zoom: 1, slide: 1, pulse: 1, scale: 1, word: 1 };
  var UNIT_TYPES = { typewriter: 'char', char: 'char', word: 'word' };

  // Khung hình (keyframes) cho 1 hoạt ảnh. Thuần để test.
  function keyframesFor(a, startColor) {
    var d = a.dir, t = a.type, off = '0.5em';
    function slideFrom(typeDir) {
      var dir = (d === 'left' || d === 'right') ? d : typeDir;
      var map = { up: 'translateY(' + off + ')', down: 'translateY(-' + off + ')', left: 'translateX(' + off + ')', right: 'translateX(-' + off + ')' };
      return map[dir];
    }
    if (a.phase === 'in') {
      if (t === 'fade' || t === 'typewriter') return [{ opacity: 0 }, { opacity: 1 }];
      if (t === 'slide-up') return [{ opacity: 0, transform: slideFrom('up') }, { opacity: 1, transform: 'none' }];
      if (t === 'slide-down') return [{ opacity: 0, transform: slideFrom('down') }, { opacity: 1, transform: 'none' }];
      if (t === 'zoom') return [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }];
      return [{ opacity: 0, transform: 'translateY(0.3em)' }, { opacity: 1, transform: 'none' }];   // word / char
    }
    if (a.phase === 'emph') {
      var c = a.color || '#ffd966';
      if (t === 'pulse') return [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }];
      if (t === 'glow') return [{ textShadow: '0 0 0 rgba(255,255,255,0)' }, { textShadow: '0 0 0.3em #fff, 0 0 0.7em ' + c }, { textShadow: '0 0 0 rgba(255,255,255,0)' }];
      if (t === 'scale') return [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }];
      return [{ color: startColor || '#ffffff' }, { color: c }];   // color
    }
    // out
    var outMap = { up: 'translateY(-' + off + ')', down: 'translateY(' + off + ')', left: 'translateX(-' + off + ')', right: 'translateX(' + off + ')' };
    if (t === 'slide') return [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: outMap[d] || outMap.up }];
    if (t === 'zoom') return [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6)' }];
    return [{ opacity: 1 }, { opacity: 0 }];
  }

  /* ===================== giao diện (chỉ trình duyệt) ===================== */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var uid = 0;
  var segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  function graphemes(s) {
    if (!segmenter) return Array.from(s);
    var out = [], it = segmenter.segment(s)[Symbol.iterator]();
    for (var r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
    return out;
  }

  function applyFmt(span, fmt, base) {
    var st = span.style, size = fmt.size ? fmt.size : base;
    if (fmt.color) st.color = fmt.color;
    if (fmt.bold !== undefined) st.fontWeight = fmt.bold ? 'bold' : 'normal';
    if (fmt.italic !== undefined) st.fontStyle = fmt.italic ? 'italic' : 'normal';
    if (fmt.underline !== undefined) st.textDecoration = fmt.underline ? 'underline' : 'none';
    if (fmt.size && base > 0) st.fontSize = (fmt.size / base) + 'em';
    if (fmt.font) st.fontFamily = '"' + fmt.font + '", "CMG Sans", sans-serif';
    if (fmt.shadow) st.textShadow = (fmt.shadow.x / size) + 'em ' + (fmt.shadow.y / size) + 'em ' + (fmt.shadow.blur / size) + 'em ' + fmt.shadow.color;
    if (fmt.stroke) { st.webkitTextStroke = (fmt.stroke.w / size) + 'em ' + fmt.stroke.color; st.paintOrder = 'stroke fill'; }
  }

  function makeSvg(w, h) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + r1(w) + ' ' + r1(h));
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;';
    return svg;
  }
  function svgPath(d, fill) { var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); return p; }

  function ensureBgLayer(textBox) {
    var layer = textBox.querySelector(':scope > .rr-bg-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'rr-bg-layer';
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;';
      var style = textBox.querySelector(':scope > .text-box-style-layer');
      if (style && style.nextSibling) textBox.insertBefore(layer, style.nextSibling);
      else if (style) textBox.appendChild(layer);
      else textBox.insertBefore(layer, textBox.firstChild || null);
    }
    return layer;
  }

  function gradientEnd(hex) {   // màu thứ 2 của dải gradient: lệch sắc ~45° và sáng hơn một chút
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 510, h = 0, sat = 0;
    if (d > 0) {
      sat = d / 255 / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return 'hsl(' + Math.round((h + 45) % 360) + ',' + Math.round(clamp(sat, 0.45, 1) * 100) + '%,' + Math.round(clamp(l + 0.12, 0.3, 0.8) * 100) + '%)';
  }

  // opts: { baseSize: px của cỡ chữ gốc (để đổi cỡ riêng sang em, tự co theo khi chữ tự thu nhỏ), animate: true → ẩn trước các đơn vị "vào" }
  function render(el, text, parts, opts) {
    opts = opts || {};
    text = String(text == null ? '' : text);
    parts = RM.sanitizeParts(parts, text);
    var base = opts.baseSize > 0 ? opts.baseSize : 0;
    var preHide = !!opts.animate && typeof Element !== 'undefined' && !!Element.prototype.animate;   // không có WAAPI thì không ẩn (khỏi kẹt ở trạng thái ẩn)
    el.textContent = '';
    var nodes = [];            // [{ node, start, len }] để đổi vị trí chữ → (text node, offset)
    var anims = [];            // [{ a, targets: [el], units: bool }]
    parts.anims.forEach(function (a) { anims.push({ a: a, targets: [] }); });
    var plan = planSegments(text, parts);

    function addText(parent, str, start) {
      var tn = document.createTextNode(str); parent.appendChild(tn);
      nodes.push({ node: tn, start: start, len: str.length });
      return tn;
    }

    plan.forEach(function (seg) {
      var span = document.createElement('span'); span.className = 'rr-run';
      applyFmt(span, seg.fmt, base);
      var holder = span;
      var unitAnim = null, wrappers = [];
      seg.anims.forEach(function (i) {
        var a = parts.anims[i];
        if (UNIT_TYPES[a.type] && !unitAnim) { unitAnim = i; return; }
        wrappers.push(i);
      });
      wrappers.forEach(function (i) {
        var a = parts.anims[i], w = document.createElement('span'); w.className = 'rr-an';
        if (TRANSFORM_TYPES[a.type]) w.style.display = 'inline-block';
        holder.appendChild(w); holder = w; anims[i].targets.push(w);
        if (a.phase === 'in' && preHide) w.style.opacity = '0';
      });
      if (unitAnim !== null) {
        var ua = parts.anims[unitAnim], kind = UNIT_TYPES[ua.type], pos = seg.s;
        var pieces = kind === 'char' ? graphemes(seg.text) : seg.text.split(/(\s+)/).filter(function (p) { return p !== ''; });
        pieces.forEach(function (p) {
          var isSpace = kind === 'word' && /^\s+$/.test(p);
          if (isSpace) { addText(holder, p, pos); }
          else {
            var u = document.createElement('span'); u.className = 'rr-unit';
            if (kind === 'word') u.style.display = 'inline-block';
            if (ua.phase === 'in' && preHide) u.style.opacity = '0';
            holder.appendChild(u); addText(u, p, pos); anims[unitAnim].targets.push(u);
          }
          pos += p.length;
        });
      } else {
        addText(holder, seg.text, seg.s);
      }
      el.appendChild(span);
    });
    if (!plan.length) addText(el, '', 0);

    var handle = { el: el, text: text, parts: parts, nodes: nodes, running: [], bgLayer: null, base: base };

    // Đổi vị trí chữ → (text node, offset). Điểm đầu thuộc node chứa nó; điểm cuối thuộc node mà nó nằm ở cuối.
    function locate(offset, isEnd) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.len && (isEnd ? (offset > n.start && offset <= n.start + n.len) : (offset >= n.start && offset < n.start + n.len))) return { node: n.node, offset: offset - n.start };
      }
      var last = nodes[nodes.length - 1];
      return last ? { node: last.node, offset: last.len } : null;
    }
    handle.rects = function (s, e) {
      var a = locate(s, false), b = locate(e, true);
      if (!a || !b) return [];
      var rg = document.createRange();
      try { rg.setStart(a.node, clamp(a.offset, 0, a.node.length)); rg.setEnd(b.node, clamp(b.offset, 0, b.node.length)); } catch (x) { return []; }
      return Array.prototype.slice.call(rg.getClientRects());
    };

    /* ---- lớp nền ---- */
    handle.relayout = function () {
      var textBox = el.parentElement;
      if (!textBox) return;
      var layer = handle.bgLayer = ensureBgLayer(textBox);
      layer.textContent = '';
      if (!parts.bgs.length || !text) return;
      var lr = layer.getBoundingClientRect();
      var scale = layer.offsetWidth ? lr.width / layer.offsetWidth : 1;
      if (!(scale > 0) || !isFinite(scale)) return;
      parts.bgs.map(function (b, i) { return { b: b, i: i }; })
        .sort(function (x, y) { return x.b.z - y.b.z || x.i - y.i; })
        .forEach(function (it) { drawBg(layer, lr, scale, it.b); });
    };
    function drawBg(layer, lr, scale, bg) {
      var lines = groupLineRects(handle.rects(bg.s, bg.e));
      if (!lines.length) return;
      lines = lines.map(function (l) { return { left: (l.left - lr.left) / scale, right: (l.right - lr.left) / scale, top: (l.top - lr.top) / scale, bottom: (l.bottom - lr.top) / scale }; });
      // Đệm = tăng CHIỀU CAO (mỗi phía thêm `padding` px, âm = thấp hơn dòng chữ; luôn giữ tối thiểu 4px); Cỡ = tăng CHIỀU NGANG (bề ngang chữ × scale, giữ tâm); lề ngang cố định ~10px
      // mỗi đầu để đầu cọ không cắt vào chữ. Xoay quanh tâm; dịch X/Y.
      var U = unionRect(lines), pad = bg.padding, HM = 10;
      var cx = (U.left + U.right) / 2, cy = (U.top + U.bottom) / 2;
      var box = document.createElement('div'); box.className = 'rr-bg-item'; box.dataset.preset = bg.preset;
      var W = (U.right - U.left) * bg.scale + HM * 2, H = Math.max(4, (U.bottom - U.top) + pad * 2);
      var BL = cx - W / 2, BT = cy - H / 2;
      box.style.cssText = 'position:absolute;pointer-events:none;left:' + r1(BL) + 'px;top:' + r1(BT) + 'px;width:' + r1(W) + 'px;height:' + r1(H) + 'px;' +
        'opacity:' + bg.opacity + ';transform-origin:50% 50%;transform:translate(' + bg.dx + 'px,' + bg.dy + 'px) rotate(' + bg.rotation + 'deg);';
      var seed = seedFrom(bg.preset + ':' + bg.shape + ':' + bg.s);
      var svg;
      if (bg.preset === 'brush-a' || bg.preset === 'brush-b') {
        // hạt giống theo vị trí lớp + "Hình": đổi Hình 0→1→2… luôn đổi sang mẫu kế tiếp
        svg = makeSvg(W, H);
        svg.appendChild(svgPath(brushPath(W, H, seedFrom(bg.preset + ':' + bg.s) + bg.shape, bg.preset === 'brush-b' ? 1 : 0), bg.color));
        box.appendChild(svg);
      } else if (bg.preset === 'paper') {
        svg = makeSvg(W, H);
        svg.appendChild(svgPath(paperPath(W, H, seed + 1, 3), 'rgba(0,0,0,0.18)'));   // lớp dưới lệch (giấy chồng giấy)
        svg.appendChild(svgPath(paperPath(W, H, seed, 0), bg.color));
        box.appendChild(svg);
      } else if (bg.preset === 'pill') {
        svg = makeSvg(W, H);
        var gid = 'rr-g' + (++uid), defs = document.createElementNS(SVGNS, 'defs'), lg = document.createElementNS(SVGNS, 'linearGradient');
        lg.setAttribute('id', gid); lg.setAttribute('x1', '0'); lg.setAttribute('y1', '0'); lg.setAttribute('x2', '1'); lg.setAttribute('y2', '0');
        [['0', bg.color], ['1', gradientEnd(bg.color)]].forEach(function (s) { var st = document.createElementNS(SVGNS, 'stop'); st.setAttribute('offset', s[0]); st.setAttribute('stop-color', s[1]); lg.appendChild(st); });
        defs.appendChild(lg); svg.appendChild(defs);
        var rect = document.createElementNS(SVGNS, 'rect'); rect.setAttribute('x', 0); rect.setAttribute('y', 0); rect.setAttribute('width', r1(W)); rect.setAttribute('height', r1(H));
        var rr = Math.min(bg.radius, H / 2, W / 2); rect.setAttribute('rx', r1(rr)); rect.setAttribute('ry', r1(rr)); rect.setAttribute('fill', 'url(#' + gid + ')');
        svg.appendChild(rect); box.appendChild(svg);
      } else {   // marker: một dải riêng cho từng dòng, ở phần dưới dòng chữ
        lines.forEach(function (l, li) {
          var lh = l.bottom - l.top, sh = Math.max(4, lh * bg.thick + pad), top = l.top + (lh - lh * bg.thick) * 0.8 - (sh - lh * bg.thick) * 0.5;
          var w = (l.right - l.left) * bg.scale + HM * 2, x0 = (l.left + l.right) / 2 - w / 2;
          var holder = document.createElement('div');
          holder.style.cssText = 'position:absolute;left:' + r1(x0 - BL) + 'px;top:' + r1(top - BT) + 'px;width:' + r1(w) + 'px;height:' + r1(sh) + 'px;';
          var s2 = makeSvg(w, sh); s2.appendChild(svgPath(markerPath(w, sh, seed + li * 17), bg.color)); holder.appendChild(s2); box.appendChild(holder);
        });
      }
      layer.appendChild(box);
    }

    /* ---- hoạt ảnh ---- */
    function stopAll() { handle.running.forEach(function (an) { try { an.cancel(); } catch (x) { /* đã xong */ } }); handle.running = []; }
    handle.stop = function () {
      stopAll();
      anims.forEach(function (it) { if (it.a.phase === 'in') it.targets.forEach(function (t) { t.style.opacity = ''; }); });
    };
    handle.hasPhase = function (phase) { return anims.some(function (it) { return it.a.phase === phase && it.targets.length; }); };
    // Thời gian tối đa (ms) của một giai đoạn — nơi gọi dùng để chờ hoạt ảnh "ra" trước khi đổi slide.
    handle.phaseDuration = function (phase) {
      var max = 0;
      anims.forEach(function (it) {
        if (it.a.phase !== phase) return;
        var n = it.targets.length, per = UNIT_TYPES[it.a.type] ? it.a.stagger * Math.max(0, n - 1) : 0;
        max = Math.max(max, it.a.delay + per + it.a.dur * (it.a.repeat === -1 ? 1 : Math.max(1, it.a.repeat)));
      });
      return max;
    };
    handle.play = function (phase) {
      if (typeof Element === 'undefined' || !Element.prototype.animate) return Promise.resolve();
      var done = [];
      anims.forEach(function (it) {
        var a = it.a; if (a.phase !== phase) return;
        var unit = !!UNIT_TYPES[a.type];
        it.targets.forEach(function (t, idx) {
          var startColor = a.type === 'color' ? getComputedStyle(t).color : null;
          var delay = a.delay + (unit ? idx * a.stagger : 0);
          var dur = a.type === 'typewriter' ? 1 : a.dur;
          var easing = a.type === 'typewriter' ? 'steps(1, end)' : a.ease;
          var keep = a.phase === 'out' || a.phase === 'in' || a.type === 'scale' || a.type === 'color';
          var an;
          try {
            an = t.animate(keyframesFor(a, startColor), { duration: dur, delay: delay, easing: easing, iterations: a.repeat === -1 ? Infinity : Math.max(1, a.repeat), fill: keep ? 'both' : 'backwards' });
          } catch (x) { return; }
          if (a.phase === 'in') t.style.opacity = '';   // WAAPI (fill both) giữ trạng thái đầu cho tới hết thời gian chờ
          handle.running.push(an);
          if (a.repeat !== -1) done.push(an.finished.catch(function () { /* bị huỷ */ }));
        });
      });
      return Promise.all(done).then(function () { /* xong */ });
    };
    handle.playOut = function () { return handle.play('out'); };
    // Phát lại từ đầu (dùng trong trình soạn): đặt lại trạng thái ẩn rồi chạy "vào" + "nhấn"
    handle.replay = function () {
      stopAll();
      anims.forEach(function (it) { if (it.a.phase === 'in') it.targets.forEach(function (t) { t.style.opacity = '0'; }); });
      return Promise.all([handle.play('in'), handle.play('emph')]);
    };

    // font tải xong sau lúc dựng làm đổi số đo chữ → vẽ lại lớp nền cho khớp
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (el._richHandle === handle) handle.relayout(); });
    el._richHandle = handle;
    return handle;
  }

  // Dọn handle cũ khi phần tử chuyển sang chữ thường
  function clear(el) {
    if (el && el._richHandle) { try { el._richHandle.stop(); } catch (x) { /* bỏ qua */ } el._richHandle = null; }
    var box = el && el.parentElement, layer = box && box.querySelector(':scope > .rr-bg-layer');
    if (layer) layer.textContent = '';
  }

  return {
    // thuần
    rng: rng, seedFrom: seedFrom, brushPath: brushPath, brushCount: brushCount, markerPath: markerPath, paperPath: paperPath,
    groupLineRects: groupLineRects, unionRect: unionRect, planSegments: planSegments, keyframesFor: keyframesFor,
    TRANSFORM_TYPES: TRANSFORM_TYPES, UNIT_TYPES: UNIT_TYPES,
    // giao diện
    render: render, clear: clear, ensureBgLayer: ensureBgLayer, gradientEnd: gradientEnd
  };
}));
