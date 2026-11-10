/* Hộp thoại "More Colors…" (kiểu hộp "Colors" của Office) — một hộp thoại ĐỘC LẬP với bảng màu thả xuống,
 * dùng chung cho Text Color và Background Color (và các nơi chọn màu về sau).
 *
 *   - Spectrum 2D lớn: trục ngang = sắc độ (hue), trục dọc = độ đậm (saturation); thanh trượt dọc bên phải = độ sáng (value).
 *   - Color model: RGB (mặc định, 0–255) hoặc HSL; ô HEX 6 chữ số; cả ba đồng bộ HAI CHIỀU với spectrum.
 *   - Xem trước: New (màu đang chọn, đổi theo thời gian thực) và Current (màu đang áp dụng, giữ nguyên đến khi bấm OK).
 *   - OK áp dụng màu; Cancel / Esc / nút × bỏ mọi thay đổi chưa xác nhận.
 * Phần thuần (toạ độ spectrum ↔ màu, đọc ô nhập) chạy được trong Node để test. */
(function (root, factory) {
  var CP = (typeof module === 'object' && module.exports) ? require('./color-picker.js') : root.ColorPicker;
  if (typeof module === 'object' && module.exports) module.exports = factory(root, CP);
  else root.ColorDialog = factory(root, CP);
}(typeof self !== 'undefined' ? self : this, function (root, CP) {
  'use strict';

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /* ===================== phần thuần ===================== */
  // Điểm (x,y) trong spectrum w×h → {h,s}: ngang = hue 0–360, dọc = saturation 1 (trên) → 0 (dưới).
  function pointToHs(x, y, w, h) {
    return { h: clamp(x / w, 0, 1) * 360, s: 1 - clamp(y / h, 0, 1) };
  }
  function hsToPoint(hue, sat, w, h) {
    return { x: clamp(((hue % 360) + 360) % 360 / 360, 0, 1) * w, y: (1 - clamp(sat, 0, 1)) * h };
  }
  // Vị trí y trên thanh trượt dọc (0 = trên cùng = sáng nhất) ↔ value 0–1
  function sliderToValue(y, h) { return 1 - clamp(y / h, 0, 1); }
  function valueToSlider(v, h) { return (1 - clamp(v, 0, 1)) * h; }

  // Đọc ô số: chỉ nhận số nguyên trong [min,max]; sai → null
  function parseChannel(text, min, max) {
    var t = String(text == null ? '' : text).trim();
    if (!/^-?\d+$/.test(t)) return null;
    var n = parseInt(t, 10);
    return n >= min && n <= max ? n : null;
  }
  // Ô HEX: nhận "#rrggbb" hoặc "rrggbb" (6 chữ số). Cho phép gõ dở (không báo lỗi) bằng isPartialHex.
  function parseHex6(text) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(text == null ? '' : text).trim());
    return m ? '#' + m[1].toLowerCase() : null;
  }
  function isPartialHex(text) { return /^#?[0-9a-fA-F]{0,6}$/.test(String(text == null ? '' : text).trim()); }

  // Trạng thái màu của hộp thoại: giữ h,s,v làm gốc để màu xám/đen không làm mất sắc độ khi kéo thanh sáng.
  function stateFromHex(hex, prev) {
    var rgb = CP.hexToRgb(hex) || { r: 255, g: 255, b: 255 };
    var hsv = CP.rgbToHsv(rgb.r, rgb.g, rgb.b);
    var h = hsv.h, s = hsv.s;
    if (prev && (hsv.s === 0 || hsv.v === 0)) { h = prev.h; if (hsv.v === 0) s = prev.s; }   // xám/đen: giữ hue (và độ đậm khi đen)
    return { h: h, s: s, v: hsv.v };
  }
  function hexFromState(st) { var c = CP.hsvToRgb(st.h, st.s, st.v); return CP.rgbToHex(c.r, c.g, c.b); }

  /* ===================== giao diện ===================== */
  var dlg = null;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function close(restore) {
    if (!dlg) return;
    var d = dlg; dlg = null;
    document.removeEventListener('keydown', d.onKey, true);
    if (d.backdrop.parentNode) d.backdrop.parentNode.removeChild(d.backdrop);
    if (restore && d.prevFocus && d.prevFocus.focus && document.contains(d.prevFocus)) d.prevFocus.focus();
  }

  // opts: { color: '#rrggbb'|null (màu đang áp dụng), fallback?: '#rrggbb' (khi color null), title?, onOK(hex), onCancel? }
  function open(opts) {
    opts = opts || {};
    if (dlg) close(false);
    var current = CP.normalizeHex(opts.color);
    var start = current || CP.normalizeHex(opts.fallback) || '#ffffff';
    var st = stateFromHex(start, null);
    var model = 'rgb';

    var backdrop = el('div', 'cd-backdrop');
    var box = el('div', 'cd-dialog'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', opts.title || 'Colors');
    var head = el('div', 'cd-title');
    head.appendChild(el('span', null, opts.title || 'Colors'));
    var xbtn = el('button', 'cd-x'); xbtn.type = 'button'; xbtn.title = 'Đóng (Esc)'; xbtn.setAttribute('aria-label', 'Đóng'); xbtn.textContent = '×';
    head.appendChild(xbtn); box.appendChild(head);

    var body = el('div', 'cd-body');
    // ---- trái: spectrum + thanh sáng ----
    var left = el('div', 'cd-left');
    left.appendChild(el('div', 'cd-label', 'Colors:'));
    var pick = el('div', 'cd-pick');
    var SW = 256, SH = 192;
    var spec = el('div', 'cd-spec'); spec.tabIndex = 0; spec.setAttribute('role', 'application');
    spec.setAttribute('aria-label', 'Bảng màu: trái–phải đổi sắc, trên–dưới đổi độ đậm. Dùng phím mũi tên.');
    var canvas = document.createElement('canvas'); canvas.width = SW; canvas.height = SH;
    var dim = el('div', 'cd-dim'), cross = el('div', 'cd-cross');
    spec.appendChild(canvas); spec.appendChild(dim); spec.appendChild(cross);
    var val = el('div', 'cd-val'); val.tabIndex = 0; val.setAttribute('role', 'slider'); val.setAttribute('aria-orientation', 'vertical');
    val.setAttribute('aria-valuemin', '0'); val.setAttribute('aria-valuemax', '100'); val.setAttribute('aria-label', 'Độ sáng');
    var valGrad = el('div', 'cd-valgrad'), thumb = el('div', 'cd-thumb');
    val.appendChild(valGrad); val.appendChild(thumb);
    pick.appendChild(spec); pick.appendChild(val); left.appendChild(pick); body.appendChild(left);

    // vẽ spectrum 1 lần (độ sáng 100%); độ sáng hiện tại phủ lên bằng lớp .cd-dim
    var ctx = canvas.getContext('2d'), img = ctx.createImageData(SW, SH);
    for (var y = 0; y < SH; y++) for (var x = 0; x < SW; x++) {
      var c = CP.hsvToRgb(x / SW * 360, 1 - y / SH, 1), i = (y * SW + x) * 4;
      img.data[i] = c.r; img.data[i + 1] = c.g; img.data[i + 2] = c.b; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    // ---- phải: model, ô số, hex, xem trước ----
    var right = el('div', 'cd-right');
    var mrow = el('label', 'cd-row'); mrow.appendChild(el('span', 'cd-k', 'Color model:'));
    var sel = el('select', 'cd-model');
    [['rgb', 'RGB'], ['hsl', 'HSL']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    mrow.appendChild(sel); right.appendChild(mrow);
    var fields = el('div', 'cd-fields'); right.appendChild(fields);
    var inputs = [];
    for (var k = 0; k < 3; k++) {
      var row = el('label', 'cd-row'), lab = el('span', 'cd-k'), inp = el('input', 'cd-num');
      inp.type = 'text'; inp.inputMode = 'numeric'; inp.maxLength = 3; inp.autocomplete = 'off'; inp.spellcheck = false;
      row.appendChild(lab); row.appendChild(inp); fields.appendChild(row); inputs.push({ row: row, lab: lab, inp: inp });
    }
    var hrow = el('label', 'cd-row'); hrow.appendChild(el('span', 'cd-k', 'Hex:'));
    var hex = el('input', 'cd-hex'); hex.type = 'text'; hex.maxLength = 7; hex.autocomplete = 'off'; hex.spellcheck = false;
    hex.setAttribute('aria-label', 'Mã màu HEX (6 chữ số)'); hrow.appendChild(hex); right.appendChild(hrow);
    var hexErr = el('div', 'cd-err'); hexErr.setAttribute('role', 'alert'); right.appendChild(hexErr);
    var prev = el('div', 'cd-prev');
    var pn = el('div', 'cd-pcol'), pc = el('div', 'cd-pcol');
    pn.appendChild(el('span', 'cd-k', 'New')); pc.appendChild(el('span', 'cd-k', 'Current'));
    var newSw = el('div', 'cd-sw cd-new'), curSw = el('div', 'cd-sw cd-cur');
    curSw.style.backgroundColor = start; curSw.title = current ? 'Màu đang áp dụng: ' + current.toUpperCase() : 'Chưa đặt màu (Automatic)';
    if (!current) curSw.classList.add('auto');
    pn.appendChild(newSw); pc.appendChild(curSw); prev.appendChild(pn); prev.appendChild(pc); right.appendChild(prev);
    body.appendChild(right); box.appendChild(body);

    var foot = el('div', 'cd-foot');
    var cancel = el('button', 'cd-btn'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    var ok = el('button', 'cd-btn primary'); ok.type = 'button'; ok.textContent = 'OK';
    foot.appendChild(cancel); foot.appendChild(ok); box.appendChild(foot);
    backdrop.appendChild(box);

    /* ---- đồng bộ ---- */
    function curHex() { return hexFromState(st); }
    function writeFields(skip) {
      var hx = curHex(), rgb = CP.hexToRgb(hx);
      if (model === 'rgb') {
        ['Red', 'Green', 'Blue'].forEach(function (n, i) { inputs[i].lab.textContent = n + ':'; });
        [rgb.r, rgb.g, rgb.b].forEach(function (v, i) { if (skip !== inputs[i].inp) inputs[i].inp.value = String(v); });
      } else {
        var hsl = CP.rgbToHsl(rgb.r, rgb.g, rgb.b);
        ['Hue', 'Sat', 'Lum'].forEach(function (n, i) { inputs[i].lab.textContent = n + ':'; });
        [Math.round(hsl.h) % 360, Math.round(hsl.s * 100), Math.round(hsl.l * 100)].forEach(function (v, i) { if (skip !== inputs[i].inp) inputs[i].inp.value = String(v); });
      }
      if (skip !== hex) { hex.value = hx.toUpperCase(); hex.classList.remove('bad'); hexErr.textContent = ''; }
    }
    function paint(skipField) {
      var hx = curHex();
      var p = hsToPoint(st.h, st.s, SW, SH);
      cross.style.left = (p.x / SW * 100) + '%'; cross.style.top = (p.y / SH * 100) + '%';
      dim.style.opacity = String(1 - st.v);
      valGrad.style.background = 'linear-gradient(to bottom, ' + hexFromState({ h: st.h, s: st.s, v: 1 }) + ', #000)';
      thumb.style.top = (valueToSlider(st.v, 100)) + '%';
      val.setAttribute('aria-valuenow', String(Math.round(st.v * 100)));
      newSw.style.backgroundColor = hx; newSw.title = 'Màu mới: ' + hx.toUpperCase();
      writeFields(skipField);
    }

    function setFromSpectrum(e) {
      var r = spec.getBoundingClientRect(), hs = pointToHs(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      st.h = hs.h; st.s = hs.s; paint();
    }
    function setFromSlider(e) {
      var r = val.getBoundingClientRect(); st.v = sliderToValue(e.clientY - r.top, r.height); paint();
    }
    function drag(target, fn) {
      target.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); target.focus(); target.setPointerCapture(e.pointerId); fn(e);
        function mv(ev) { fn(ev); }
        function up(ev) { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); try { target.releasePointerCapture(ev.pointerId); } catch (x) { /* đã nhả */ } }
        target.addEventListener('pointermove', mv); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
      });
    }
    drag(spec, setFromSpectrum); drag(val, setFromSlider);
    spec.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.01, used = true;
      if (e.key === 'ArrowLeft') st.h = (st.h - step * 360 + 360) % 360;
      else if (e.key === 'ArrowRight') st.h = (st.h + step * 360) % 360;
      else if (e.key === 'ArrowUp') st.s = clamp(st.s + step, 0, 1);
      else if (e.key === 'ArrowDown') st.s = clamp(st.s - step, 0, 1);
      else used = false;
      if (used) { e.preventDefault(); paint(); }
    });
    val.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.01, used = true;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') st.v = clamp(st.v + step, 0, 1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') st.v = clamp(st.v - step, 0, 1);
      else if (e.key === 'Home') st.v = 1; else if (e.key === 'End') st.v = 0; else used = false;
      if (used) { e.preventDefault(); paint(); }
    });

    sel.addEventListener('change', function () { model = sel.value; paint(); });
    function onNumInput() {
      var vals = inputs.map(function (x) { return x.inp.value; });
      var rgb;
      if (model === 'rgb') {
        var r = parseChannel(vals[0], 0, 255), g = parseChannel(vals[1], 0, 255), b = parseChannel(vals[2], 0, 255);
        inputs.forEach(function (x, i) { x.inp.classList.toggle('bad', [r, g, b][i] === null); });
        if (r === null || g === null || b === null) return;
        rgb = { r: r, g: g, b: b };
      } else {
        var H = parseChannel(vals[0], 0, 360), S = parseChannel(vals[1], 0, 100), L = parseChannel(vals[2], 0, 100);
        inputs.forEach(function (x, i) { x.inp.classList.toggle('bad', [H, S, L][i] === null); });
        if (H === null || S === null || L === null) return;
        rgb = CP.hslToRgb(H % 360, S / 100, L / 100);
      }
      st = stateFromHex(CP.rgbToHex(rgb.r, rgb.g, rgb.b), st);
      paint(document.activeElement);
    }
    inputs.forEach(function (x) {
      x.inp.addEventListener('input', onNumInput);
      x.inp.addEventListener('blur', function () { inputs.forEach(function (y) { y.inp.classList.remove('bad'); }); writeFields(null); });
      x.inp.addEventListener('keydown', function (e) {   // ↑/↓ chỉnh từng đơn vị (Shift = 10)
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        var max = model === 'rgb' ? 255 : (inputs.indexOf(x) === 0 ? 360 : 100), cur = parseChannel(x.inp.value, 0, max);
        if (cur === null) return;
        x.inp.value = String(clamp(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, max)); onNumInput();
      });
    });
    hex.addEventListener('input', function () {
      var v = hex.value.trim(), parsed = parseHex6(v);
      if (parsed) { st = stateFromHex(parsed, st); hex.classList.remove('bad'); hexErr.textContent = ''; paint(hex); }
      else if (isPartialHex(v) && v.replace('#', '').length < 6) { hex.classList.remove('bad'); hexErr.textContent = ''; }   // đang gõ dở
      else { hex.classList.add('bad'); hexErr.textContent = 'Mã HEX gồm 6 chữ số 0–9, A–F (ví dụ #7030A0).'; }
    });
    hex.addEventListener('blur', function () { hex.classList.remove('bad'); hexErr.textContent = ''; hex.value = curHex().toUpperCase(); });

    /* ---- đóng / xác nhận ---- */
    function cancelAll() { var cb = opts.onCancel; close(true); if (cb) cb(); }
    function accept() {
      if (hex.classList.contains('bad') || inputs.some(function (x) { return x.inp.classList.contains('bad'); })) return;   // đang có ô sai → không áp dụng
      var out = curHex(), cb = opts.onOK; close(true); if (cb) cb(out);
    }
    cancel.addEventListener('click', cancelAll); xbtn.addEventListener('click', cancelAll); ok.addEventListener('click', accept);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) { e.preventDefault(); cancelAll(); } });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelAll(); return; }
      if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); e.stopPropagation(); accept(); return; }
      if (e.key === 'Tab') {   // giữ focus trong hộp thoại
        var f = Array.prototype.slice.call(box.querySelectorAll('button, select, input, [tabindex="0"]')).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    dlg = { backdrop: backdrop, onKey: onKey, prevFocus: document.activeElement };
    document.body.appendChild(backdrop);
    paint();
    spec.focus();
    return { hex: curHex };
  }

  return {
    pointToHs: pointToHs, hsToPoint: hsToPoint, sliderToValue: sliderToValue, valueToSlider: valueToSlider,
    parseChannel: parseChannel, parseHex6: parseHex6, isPartialHex: isPartialHex, stateFromHex: stateFromHex, hexFromState: hexFromState,
    open: open, close: function () { close(true); }, isOpen: function () { return !!dlg; }
  };
}));
