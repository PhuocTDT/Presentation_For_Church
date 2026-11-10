/* Bảng chọn màu kiểu Microsoft Office — DÙNG CHUNG cho "Text Color" và "Background Color" (và các ô chọn màu về sau).
 *
 * Thứ tự cố định trong bảng thả xuống:  Automatic → Theme Colors → Standard Colors → Custom Colors → More Colors…
 *   - Automatic: onPick(null) — nơi gọi quyết định "mặc định/kế thừa" là gì (chữ: màu chữ mặc định; nền: bỏ nền).
 *   - Theme Colors: hàng màu gốc + 5 hàng sắc độ (sáng/tối) theo cột, thuật toán lumMod/lumOff như Office.
 *   - Standard Colors: một hàng 10 màu.
 *   - Custom Colors: NGAY DƯỚI Standard; nút + thêm "màu đang chọn", bấm × (hoặc phím Delete) để xoá, không trùng,
 *     lưu bền trong localStorage (sống qua lần khởi động lại app).
 *   - More Colors…: gọi onMore(màuHiệnTại) nếu nơi gọi cung cấp (hộp thoại RGB/HEX riêng); không có thì nút bị khoá.
 * Phần thuần (chuyển màu, bảng theme, kho Custom) chạy được trong Node để test; phần giao diện chỉ chạy trong trình duyệt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ColorPicker = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ===================== phần thuần: màu ===================== */
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // '#rgb' | '#rrggbb' | 'rrggbb' → '#rrggbb' (chữ thường), sai định dạng → null
  function normalizeHex(v) {
    if (typeof v !== 'string') return null;
    var m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v.trim());
    if (!m) return null;
    var h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }
  function hexToRgb(hex) {
    var h = normalizeHex(hex);
    if (!h) return null;
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
  }
  function rgbToHex(r, g, b) {
    function c(x) { var n = Math.round(clamp(Number(x) || 0, 0, 255)); return ('0' + n.toString(16)).slice(-2); }
    return '#' + c(r) + c(g) + c(b);
  }
  // h: 0–360, s/l/v: 0–1
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: clamp(s, 0, 1), l: l };
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  // Sắc độ kiểu Office: L' = L·lumMod + lumOff (trong không gian HSL).
  function tint(hex, lumMod, lumOff) {
    var rgb = hexToRgb(hex); if (!rgb) return null;
    var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    var o = hslToRgb(hsl.h, hsl.s, clamp(hsl.l * lumMod + (lumOff || 0), 0, 1));
    return rgbToHex(o.r, o.g, o.b);
  }

  /* ===================== bảng màu ===================== */
  // 10 cột theme: 2 nền (sáng), 2 chữ, 6 nhấn. `kind` quyết định kiểu sắc độ ở 5 hàng dưới.
  var DEFAULT_THEME = [
    { name: 'White', hex: '#ffffff', kind: 'white' },
    { name: 'Black', hex: '#000000', kind: 'black' },
    { name: 'Light Gray', hex: '#e7e6e6', kind: 'lightbg' },
    { name: 'Dark Blue-Gray', hex: '#44546a', kind: 'accent' },
    { name: 'Blue', hex: '#4472c4', kind: 'accent' },
    { name: 'Red', hex: '#e0463c', kind: 'accent' },
    { name: 'Gold', hex: '#f2b01e', kind: 'accent' },
    { name: 'Green', hex: '#4caf50', kind: 'accent' },
    { name: 'Orange', hex: '#ed7d31', kind: 'accent' },
    { name: 'Teal', hex: '#2bb3b1', kind: 'accent' }
  ];
  // [nhãn, lumMod, lumOff] cho 5 hàng sắc độ
  var TINT_ROWS = {
    white: [['Darker 5%', 0.95, 0], ['Darker 15%', 0.85, 0], ['Darker 25%', 0.75, 0], ['Darker 35%', 0.65, 0], ['Darker 50%', 0.5, 0]],
    black: [['Lighter 50%', 0.5, 0.5], ['Lighter 35%', 0.65, 0.35], ['Lighter 25%', 0.75, 0.25], ['Lighter 15%', 0.85, 0.15], ['Lighter 5%', 0.95, 0.05]],
    lightbg: [['Darker 10%', 0.9, 0], ['Darker 25%', 0.75, 0], ['Darker 50%', 0.5, 0], ['Darker 75%', 0.25, 0], ['Darker 90%', 0.1, 0]],
    accent: [['Lighter 80%', 0.2, 0.8], ['Lighter 60%', 0.4, 0.6], ['Lighter 40%', 0.6, 0.4], ['Darker 25%', 0.75, 0], ['Darker 50%', 0.5, 0]]
  };
  var STANDARD_COLORS = [
    { name: 'Red', hex: '#ff0000' }, { name: 'Orange', hex: '#ff9900' }, { name: 'Yellow', hex: '#ffff00' },
    { name: 'Light Green', hex: '#92d050' }, { name: 'Green', hex: '#00b050' }, { name: 'Cyan', hex: '#00e5ff' },
    { name: 'Light Blue', hex: '#00b0f0' }, { name: 'Blue', hex: '#0070c0' }, { name: 'Dark Blue', hex: '#002060' },
    { name: 'Purple', hex: '#7030a0' }
  ];

  // → { base: [{name,hex}] ×10, rows: [ [{name,hex,label}] ×10 ] ×5 }  (rows[i][c] = hàng sắc độ i của cột c)
  function buildThemeGrid(theme) {
    var cols = (Array.isArray(theme) && theme.length === 10 ? theme : DEFAULT_THEME).map(function (c, i) {
      var hex = normalizeHex(c && c.hex) || DEFAULT_THEME[i].hex;
      return { name: (c && c.name) || DEFAULT_THEME[i].name, hex: hex, kind: (c && TINT_ROWS[c.kind]) ? c.kind : DEFAULT_THEME[i].kind };
    });
    var rows = [];
    for (var r = 0; r < 5; r++) {
      rows.push(cols.map(function (c) {
        var t = TINT_ROWS[c.kind][r];
        return { name: c.name, label: t[0], hex: tint(c.hex, t[1], t[2]) };
      }));
    }
    return { base: cols.map(function (c) { return { name: c.name, hex: c.hex }; }), rows: rows };
  }

  /* ===================== kho lưu bền (Custom Colors, theme) ===================== */
  var CUSTOM_KEY = 'se.customColors.v1';
  var THEME_KEY = 'se.colorTheme.v1';
  var CUSTOM_MAX = 10;

  function memoryStorage() {
    var m = {};
    return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  }
  function defaultStorage() {
    try { if (root && root.localStorage) { root.localStorage.getItem('__cp_probe__'); return root.localStorage; } } catch (e) { /* bị chặn */ }
    return memoryStorage();
  }

  // Kho màu tuỳ chỉnh: danh sách hex chuẩn hoá, không trùng (không phân biệt hoa/thường), mới nhất ở CUỐI, tối đa `max`
  // (đầy thì bỏ màu CŨ nhất, như Office). Chịu được dữ liệu hỏng (JSON sai, phần tử lạ).
  function createCustomStore(storage, key, max) {
    storage = storage || defaultStorage(); key = key || CUSTOM_KEY; max = max || CUSTOM_MAX;
    function read() {
      var raw = null;
      try { raw = JSON.parse(storage.getItem(key) || '[]'); } catch (e) { raw = []; }
      var out = [];
      (Array.isArray(raw) ? raw : []).forEach(function (v) { var h = normalizeHex(v); if (h && out.indexOf(h) === -1) out.push(h); });
      return out.slice(-max);
    }
    function write(list) { try { storage.setItem(key, JSON.stringify(list)); } catch (e) { /* đầy/bị chặn: bỏ qua, danh sách vẫn đúng trong phiên */ } }
    return {
      list: read,
      add: function (hex) {
        var h = normalizeHex(hex); if (!h) return { ok: false, list: read() };
        var list = read();
        if (list.indexOf(h) !== -1) return { ok: true, added: false, hex: h, list: list };
        list.push(h); list = list.slice(-max); write(list);
        return { ok: true, added: true, hex: h, list: list };
      },
      remove: function (hex) {
        var h = normalizeHex(hex); var list = read().filter(function (x) { return x !== h; }); write(list); return list;
      }
    };
  }

  var customStore = null;   // tạo lười để không đụng localStorage khi chỉ nạp file
  function store() { return customStore || (customStore = createCustomStore()); }

  function loadTheme(storage) {
    storage = storage || defaultStorage();
    try {
      var t = JSON.parse(storage.getItem(THEME_KEY) || 'null');
      if (Array.isArray(t) && t.length === 10) {
        var ok = t.every(function (c) { return c && normalizeHex(c.hex); });
        if (ok) return t.map(function (c, i) { return { name: String(c.name || DEFAULT_THEME[i].name).slice(0, 30), hex: normalizeHex(c.hex), kind: TINT_ROWS[c.kind] ? c.kind : DEFAULT_THEME[i].kind }; });
      }
    } catch (e) { /* hỏng → dùng mặc định */ }
    return DEFAULT_THEME.map(function (c) { return { name: c.name, hex: c.hex, kind: c.kind }; });
  }
  var activeTheme = null;
  function theme() { return activeTheme || (activeTheme = loadTheme()); }
  // Đổi bộ màu Theme (10 màu gốc) và lưu lại; sắc độ tự tính lại. Trả về true nếu hợp lệ.
  function setTheme(list, storage) {
    if (!Array.isArray(list) || list.length !== 10 || !list.every(function (c) { return c && normalizeHex(c.hex); })) return false;
    activeTheme = list.map(function (c, i) { return { name: String(c.name || DEFAULT_THEME[i].name).slice(0, 30), hex: normalizeHex(c.hex), kind: TINT_ROWS[c.kind] ? c.kind : DEFAULT_THEME[i].kind }; });
    try { (storage || defaultStorage()).setItem(THEME_KEY, JSON.stringify(activeTheme)); } catch (e) { /* bỏ qua */ }
    return true;
  }

  /* ===================== giao diện (chỉ trình duyệt) ===================== */
  var pop = null, popState = null;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function icon(name) { var s = el('span', 'material-symbols-outlined'); s.textContent = name; s.setAttribute('aria-hidden', 'true'); return s; }

  function close(returnFocus) {
    if (!pop) return;
    var st = popState;
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('resize', onWinChange);
    window.removeEventListener('blur', onWinChange);
    if (pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null; popState = null;
    if (st && st.anchor) {
      st.anchor.setAttribute('aria-expanded', 'false');
      if (returnFocus && st.anchor.focus) st.anchor.focus();
    }
  }
  function onDocDown(e) {
    if (!pop) return;
    if (pop.contains(e.target) || (popState.anchor && popState.anchor.contains(e.target))) return;
    close(false);
  }
  function onWinChange() { close(false); }

  function place() {
    var a = popState.anchor.getBoundingClientRect(), r = pop.getBoundingClientRect(), pad = 8;
    var left = clamp(a.left, pad, Math.max(pad, window.innerWidth - r.width - pad));
    var top = a.bottom + 4;
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, a.top - r.height - 4);   // hết chỗ phía dưới → mở lên trên
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }

  // Chuyển focus theo hướng mũi tên tới ô gần nhất (lưới theme có 10 cột, các hàng khác ít hơn → dùng toạ độ thật).
  function moveFocus(from, key) {
    var items = Array.prototype.slice.call(pop.querySelectorAll('button.cp-sw, button.cp-auto, button.cp-add, button.cp-more:not([disabled])'));
    var fr = from.getBoundingClientRect(), fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2, best = null, bestScore = Infinity;
    items.forEach(function (it) {
      if (it === from) return;
      var r = it.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - fx, dy = y - fy;
      var ok = key === 'ArrowRight' ? dx > 2 && Math.abs(dy) < 6
        : key === 'ArrowLeft' ? dx < -2 && Math.abs(dy) < 6
        : key === 'ArrowDown' ? dy > 2 : dy < -2;
      if (!ok) return;
      var score = (key === 'ArrowRight' || key === 'ArrowLeft') ? Math.abs(dx) : Math.abs(dy) * 1000 + Math.abs(dx);
      if (score < bestScore) { bestScore = score; best = it; }
    });
    if (best) best.focus();
  }

  function swatch(hex, label, current, pick) {
    var b = el('button', 'cp-sw'); b.type = 'button';
    b.style.backgroundColor = hex; b.dataset.hex = hex;
    b.title = label + ' · ' + hex.toUpperCase(); b.setAttribute('aria-label', label + ' ' + hex.toUpperCase());
    if (current && current === hex) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); }
    var rgb = hexToRgb(hex); if (rgb && (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 150) b.classList.add('light');   // dấu chọn đổi sang tối trên nền sáng
    b.addEventListener('click', function () { pick(hex); });
    return b;
  }

  // opts: { anchor, current: ()=>hex|null, automatic: {label, hex}|false, onPick(hex|null), onMore(hexHiệnTại)?, title?, fromKeyboard? }
  function open(opts) {
    if (!opts || !opts.anchor) return null;
    var wasSame = pop && popState && popState.anchor === opts.anchor;
    close(false);
    if (wasSame) return null;   // bấm lại đúng nút đang mở = đóng

    var cur = function () { var c = opts.current ? opts.current() : null; return normalizeHex(c); };
    var autoCfg = opts.automatic === false ? null : (opts.automatic || { label: 'Automatic' });
    popState = { anchor: opts.anchor, opts: opts };
    pop = el('div', 'cp-pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', opts.title || 'Chọn màu');
    opts.anchor.setAttribute('aria-expanded', 'true');

    function pick(hex) { var cb = opts.onPick; close(true); if (cb) cb(hex); }

    // A. Automatic
    if (autoCfg) {
      var ab = el('button', 'cp-auto'); ab.type = 'button';
      var asw = el('span', 'cp-auto-sw'); if (autoCfg.hex) asw.style.backgroundColor = autoCfg.hex; else asw.classList.add('none');
      ab.appendChild(asw); ab.appendChild(el('span', 'cp-auto-lb', autoCfg.label || 'Automatic'));
      if (cur() === null) { ab.classList.add('sel'); ab.setAttribute('aria-pressed', 'true'); }
      ab.addEventListener('click', function () { pick(null); });
      pop.appendChild(ab);
    }

    // B. Theme Colors
    pop.appendChild(el('div', 'cp-h', 'Theme Colors'));
    var grid = buildThemeGrid(theme()), tg = el('div', 'cp-theme');
    var c0 = cur();
    var base = el('div', 'cp-row cp-base');
    grid.base.forEach(function (c) { base.appendChild(swatch(c.hex, c.name, c0, pick)); });
    tg.appendChild(base);
    grid.rows.forEach(function (row) {
      var rr = el('div', 'cp-row cp-tint');
      row.forEach(function (c) { rr.appendChild(swatch(c.hex, c.name + ', ' + c.label, c0, pick)); });
      tg.appendChild(rr);
    });
    pop.appendChild(tg);

    // C. Standard Colors
    pop.appendChild(el('div', 'cp-h', 'Standard Colors'));
    var std = el('div', 'cp-row cp-std');
    STANDARD_COLORS.forEach(function (c) { std.appendChild(swatch(c.hex, c.name, c0, pick)); });
    pop.appendChild(std);

    // D. Custom Colors — NGAY DƯỚI Standard Colors
    pop.appendChild(el('div', 'cp-h', 'Custom Colors'));
    var custom = el('div', 'cp-row cp-custom');
    function currentForAdd() { return cur() || normalizeHex(autoCfg && autoCfg.hex) || null; }
    function renderCustom(flashHex) {
      custom.textContent = '';
      var sel = cur();
      store().list().forEach(function (hex) {
        var cell = el('div', 'cp-cw');
        var sw = swatch(hex, 'Custom', sel, pick); sw.classList.add('cp-cust');
        if (flashHex && flashHex === hex) sw.classList.add('flash');
        sw.title = 'Custom · ' + hex.toUpperCase() + ' (bấm × hoặc Delete để xoá)';
        sw.addEventListener('keydown', function (e) {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault(); e.stopPropagation();
            var next = cell.nextSibling && cell.nextSibling.querySelector('button.cp-sw') || cell.previousSibling && cell.previousSibling.querySelector('button.cp-sw');
            store().remove(hex); renderCustom();
            var addBtn = custom.querySelector('button.cp-add');
            var target = next && document.contains(next) ? custom.querySelector('button.cp-sw[data-hex="' + next.dataset.hex + '"]') : addBtn;
            if (target) target.focus();
          }
        });
        var x = el('button', 'cp-x'); x.type = 'button'; x.tabIndex = -1; x.title = 'Xoá màu này'; x.setAttribute('aria-label', 'Xoá màu ' + hex.toUpperCase());
        x.appendChild(icon('close'));
        x.addEventListener('click', function (e) { e.stopPropagation(); store().remove(hex); renderCustom(); });
        cell.appendChild(sw); cell.appendChild(x); custom.appendChild(cell);
      });
      var add = el('button', 'cp-add'); add.type = 'button';
      var cv = currentForAdd();
      add.disabled = !cv;
      add.title = cv ? 'Thêm màu đang chọn (' + cv.toUpperCase() + ') vào Custom Colors' : 'Chưa có màu để thêm';
      add.setAttribute('aria-label', 'Thêm màu đang chọn vào Custom Colors');
      add.appendChild(icon('add'));
      add.addEventListener('click', function () { var r = store().add(currentForAdd()); renderCustom(r.ok ? r.hex : null); });
      custom.appendChild(add);
    }
    renderCustom();
    pop.appendChild(custom);

    // E. More Colors…
    pop.appendChild(el('div', 'cp-sep'));
    var more = el('button', 'cp-more'); more.type = 'button';
    more.appendChild(icon('palette')); more.appendChild(el('span', null, 'More Colors...'));
    if (typeof opts.onMore === 'function') {
      more.addEventListener('click', function () { var cb = opts.onMore, c = cur(); close(false); cb(c); });
    } else { more.disabled = true; more.title = 'Chưa khả dụng'; }
    pop.appendChild(more);

    // giữ nguyên vùng chữ đang tô chọn ở nơi khác: bấm vào bảng KHÔNG lấy focus
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (/^Arrow(Left|Right|Up|Down)$/.test(e.key) && e.target.matches && e.target.matches('button')) { e.preventDefault(); moveFocus(e.target, e.key); }
    });

    pop.style.visibility = 'hidden';
    document.body.appendChild(pop);
    place();
    pop.style.visibility = '';
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('resize', onWinChange);
    window.addEventListener('blur', onWinChange);
    if (opts.fromKeyboard) {
      var first = pop.querySelector('button.sel') || pop.querySelector('button.cp-auto') || pop.querySelector('button.cp-sw');
      if (first) first.focus();
    }
    return pop;
  }

  return {
    // thuần
    normalizeHex: normalizeHex, hexToRgb: hexToRgb, rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl, hslToRgb: hslToRgb, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb, tint: tint,
    DEFAULT_THEME: DEFAULT_THEME, STANDARD_COLORS: STANDARD_COLORS, buildThemeGrid: buildThemeGrid,
    createCustomStore: createCustomStore, loadTheme: loadTheme, CUSTOM_KEY: CUSTOM_KEY, CUSTOM_MAX: CUSTOM_MAX,
    // dùng chung
    getCustom: function () { return store().list(); },
    addCustom: function (hex) { return store().add(hex); },
    removeCustom: function (hex) { return store().remove(hex); },
    getTheme: function () { return theme().map(function (c) { return { name: c.name, hex: c.hex, kind: c.kind }; }); },
    setTheme: setTheme,
    // giao diện
    open: open, close: function () { close(false); }, isOpen: function () { return !!pop; }
  };
}));
