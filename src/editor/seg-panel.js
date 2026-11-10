/* Panel Text / Background / Animation của một thẻ lời (mở bằng biểu tượng mắt trong hộp Edit Song).
 *
 *   SegPanel.mount(host, api) → { refresh() }
 *
 * Panel làm việc trên "phạm vi" = vùng chữ đang tô chọn trong thẻ (hoặc cả thẻ nếu không tô gì) và trên
 * parts = { marks, bgs, anims } của thẻ (xem rich-model.js). Mọi thay đổi đi qua api.commit(parts): nơi gọi làm sạch,
 * lưu vào thẻ, vẽ lại xem trước và ghi lịch sử Undo/Redo. Panel KHÔNG tự đụng DOM của trình soạn.
 *
 * api:
 *   getText()        chữ của thẻ (đã trim) — hệ toạ độ của parts
 *   getParts()       parts hiện tại
 *   scope()          { s, e, whole } vùng áp dụng hiện tại
 *   commit(parts)    áp dụng parts mới
 *   style()          kiểu chữ chung của bài (để biết giá trị mặc định: đậm/nghiêng/gạch chân/cỡ chữ)
 *   fonts()          danh sách tên font
 *   pickColor(anchor, currentHexOrNull, onPick(hexOrNull), { automaticLabel, title })
 *   replay()         phát thử hoạt ảnh trong khung xem trước */
(function (root, factory) {
  var RM = (typeof module === 'object' && module.exports) ? require('./rich-model.js') : root.RichModel;
  var RR = (typeof module === 'object' && module.exports) ? require('./rich-render.js') : root.RichRender;
  if (typeof module === 'object' && module.exports) module.exports = factory(root, RM, RR);
  else root.SegPanel = factory(root, RM, RR);
}(typeof self !== 'undefined' ? self : this, function (root, RM, RR) {
  'use strict';

  var PRESETS = [
    { id: 'none', label: 'Không nền' },
    { id: 'brush-a', label: 'Brush', color: '#7c4dff' },
    { id: 'paper', label: 'Giấy xé', color: '#efe3c8' },
    { id: 'pill', label: 'Dải bo tròn', color: '#5b8cff' },
    { id: 'marker', label: 'Marker', color: '#ffe04d' },
    { id: 'brush-b', label: 'Brush khô', color: '#e0463c' }
  ];
  var BG_DEFAULT = { opacity: 0.8, radius: 12, padding: 12, rotation: 0, scale: 1, dx: 0, dy: 0, thick: 0.6, shape: 0 };
  var PHASES = [['in', 'Entrance'], ['emph', 'Emphasis'], ['out', 'Exit']];
  var TYPE_LABEL = {
    fade: 'Fade', 'slide-up': 'Slide Up', 'slide-down': 'Slide Down', zoom: 'Zoom', typewriter: 'Typewriter', word: 'Word by Word', char: 'Character by Character',
    pulse: 'Pulse', glow: 'Glow', scale: 'Scale', color: 'Color Transition', slide: 'Slide Out'
  };
  var DIR_LABEL = { up: 'Lên', down: 'Xuống', left: 'Trái', right: 'Phải' };
  var EASE_LABEL = { linear: 'Linear', ease: 'Ease', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in-out' };
  var AN_DEFAULT = { dur: 600, delay: 0, ease: 'ease-out', dir: 'up', stagger: 60, repeat: 1 };
  var UNIT_TYPE = { typewriter: 1, word: 1, char: 1 };

  function h(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') n.className = props[k]; else if (k === 'text') n.textContent = props[k];
      else if (k === 'dataset') for (var d in props[k]) n.dataset[d] = props[k][d];
      else if (k in n && k !== 'list') try { n[k] = props[k]; } catch (e) { n.setAttribute(k, props[k]); } else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function snippet(text, s, e) { var t = String(text).slice(s, e).replace(/\s+/g, ' ').trim(); return t.length > 22 ? t.slice(0, 22) + '…' : t; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mount(host, api) {
    host.textContent = '';
    var st = { tab: 'text', bgSel: -1, anSel: -1, bgUser: false, anUser: false };
    var ctl = {};          // các control, để refresh() đặt lại giá trị

    /* ---------- tiện ích dựng control ---------- */
    function row(label, control, cls) { return h('label', { class: 'sp-row ' + (cls || '') }, [h('span', { class: 'sp-k', text: label }), control]); }
    function num(min, max, step, onInput, title) {
      var i = h('input', { type: 'number', class: 'sp-num', min: String(min), max: String(max), step: String(step || 1), title: title || '' });
      i.addEventListener('input', function () { if (i.value === '') return onInput(null, i); var v = Number(i.value); if (isFinite(v)) onInput(clamp(v, min, max), i); });
      return i;
    }
    function setVal(input, v, placeholder) {
      if (document.activeElement === input) return;
      input.value = v == null ? '' : String(v);
      input.placeholder = placeholder == null ? '' : String(placeholder);
    }
    function sel(options, onChange) {
      var s = h('select', { class: 'sp-sel' }, options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      s.addEventListener('change', function () { onChange(s.value); });
      return s;
    }
    function toggle(label, title, onClick) {
      var b = h('button', { type: 'button', class: 'sp-tg', title: title || label }, [h('span', { text: label })]);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', onClick); return b;
    }
    function colorBtn(onClick, title) {
      var sw = h('span', { class: 'sp-sw' }), b = h('button', { type: 'button', class: 'sp-cb', title: title || 'Chọn màu', 'aria-haspopup': 'dialog' }, [sw, h('span', { class: 'material-symbols-outlined', text: 'expand_more' })]);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function (e) { onClick(b, e); });
      b.set = function (hex, mixed) { sw.style.backgroundColor = hex || ''; sw.classList.toggle('none', !hex); sw.classList.toggle('mixed', !!mixed); };
      return b;
    }
    function action(label, icon, onClick, cls) {
      var b = h('button', { type: 'button', class: 'sp-btn ' + (cls || '') }, [icon ? h('span', { class: 'material-symbols-outlined', text: icon }) : null, h('span', { text: label })]);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', onClick); return b;
    }

    function parts() { var p = api.getParts() || {}; return { marks: (p.marks || []).slice(), bgs: (p.bgs || []).map(clone), anims: (p.anims || []).map(clone) }; }
    function apply(p) { api.commit(p); }

    /* ==================== tab Text ==================== */
    var tText = h('div', { class: 'sp-tab se-seg-body', dataset: { tab: 'text', segBody: 'text' } });
    function patchText(patch) {
      var sc = api.scope(), p = parts(), text = api.getText();
      p.marks = RM.applyMarkPatch(p.marks, text, sc.s, sc.e, patch); apply(p);
    }
    function flag(key, base) {
      var sc = api.scope(), p = parts();
      p.marks = RM.toggleFlag(p.marks, api.getText(), sc.s, sc.e, key, base); apply(p);
    }
    var fontSel = sel([['', '(mặc định của bài)']].concat(api.fonts().map(function (f) { return [f, f]; })), function (v) { patchText({ font: v === '' ? undefined : v }); });
    var sizeIn = num(8, 500, 1, function (v) { patchText({ size: v === null ? undefined : Math.round(v) }); }, 'Cỡ chữ (px trên khung 960×540); để trống = theo bài');
    var bB = toggle('B', 'Đậm', function () { flag('bold', api.style().fontWeight === 'bold'); });
    var bI = toggle('I', 'Nghiêng', function () { flag('italic', api.style().fontStyle === 'italic'); });
    var bU = toggle('U', 'Gạch chân', function () { flag('underline', api.style().textDecoration === 'underline'); });
    bB.classList.add('b'); bI.classList.add('i'); bU.classList.add('u');
    var colB = colorBtn(function (btn) {
      var sm = summary(); api.pickColor(btn, typeof sm.color === 'string' ? sm.color : null, function (hex) { patchText({ color: hex === null ? undefined : hex }); }, { automaticLabel: 'Automatic', title: 'Text Color' });
    }, 'Màu chữ (phần đang chọn)');
    var shOn = h('input', { type: 'checkbox', class: 'sp-ck', title: 'Bóng chữ' });
    var shCol = colorBtn(function (btn) {
      api.pickColor(btn, (summary().shadow || {}).color || '#000000', function (hex) { patchShadow({ color: hex || '#000000' }); }, { automaticLabel: 'Mặc định (đen)', title: 'Màu bóng' });
    }, 'Màu bóng');
    var shX = num(-50, 50, 1, function (v) { patchShadow({ x: v == null ? 0 : v }); }, 'Lệch ngang (px)');
    var shY = num(-50, 50, 1, function (v) { patchShadow({ y: v == null ? 0 : v }); }, 'Lệch dọc (px)');
    var shB = num(0, 100, 1, function (v) { patchShadow({ blur: v == null ? 0 : v }); }, 'Độ nhoè (px)');
    function patchShadow(p) {
      var cur = summary().shadow, base = (cur && typeof cur === 'object' && cur.color) ? cur : { x: 2, y: 2, blur: 4, color: '#000000' };
      patchText({ shadow: Object.assign({}, base, p) });
    }
    shOn.addEventListener('change', function () { patchText({ shadow: shOn.checked ? { x: 2, y: 2, blur: 4, color: '#000000' } : undefined }); });
    var stOn = h('input', { type: 'checkbox', class: 'sp-ck', title: 'Viền chữ' });
    var stCol = colorBtn(function (btn) {
      api.pickColor(btn, (summary().stroke || {}).color || '#000000', function (hex) { patchStroke({ color: hex || '#000000' }); }, { automaticLabel: 'Mặc định (đen)', title: 'Màu viền chữ' });
    }, 'Màu viền');
    var stW = num(0, 40, 1, function (v) { patchStroke({ w: v == null ? 0 : v }); }, 'Độ dày viền (px)');
    function patchStroke(p) {
      var cur = summary().stroke, base = (cur && typeof cur === 'object' && cur.color) ? cur : { w: 3, color: '#000000' };
      patchText({ stroke: Object.assign({}, base, p) });
    }
    stOn.addEventListener('change', function () { patchText({ stroke: stOn.checked ? { w: 3, color: '#000000' } : undefined }); });
    var resetBtn = action('Reset formatting', 'format_clear', function () {
      var sc = api.scope(), p = parts(); p.marks = RM.clearMarks(p.marks, api.getText(), sc.s, sc.e); apply(p);
    }, 'ghost');

    tText.appendChild(h('div', { class: 'sp-line' }, [row('Font', fontSel, 'grow'), row('Cỡ', sizeIn, 'w60')]));
    tText.appendChild(h('div', { class: 'sp-line' }, [h('div', { class: 'sp-tgs' }, [bB, bI, bU]), row('Màu chữ', colB)]));
    tText.appendChild(h('div', { class: 'sp-line' }, [h('label', { class: 'sp-row' }, [shOn, h('span', { class: 'sp-k', text: 'Bóng' })]), shCol, row('X', shX, 'w50'), row('Y', shY, 'w50'), row('Nhoè', shB, 'w50')]));
    tText.appendChild(h('div', { class: 'sp-line' }, [h('label', { class: 'sp-row' }, [stOn, h('span', { class: 'sp-k', text: 'Viền' })]), stCol, row('Dày', stW, 'w50'), h('span', { class: 'sp-spacer' }), resetBtn]));
    Object.assign(ctl, { fontSel: fontSel, sizeIn: sizeIn, bB: bB, bI: bI, bU: bU, colB: colB, shOn: shOn, shCol: shCol, shX: shX, shY: shY, shB: shB, stOn: stOn, stCol: stCol, stW: stW });

    function summary() { var sc = api.scope(); return RM.fmtSummary(api.getParts().marks || [], api.getText(), sc.s, sc.e); }

    /* ==================== tab Background ==================== */
    var tBg = h('div', { class: 'sp-tab se-seg-body', dataset: { tab: 'bg', segBody: 'bg' } });
    var gallery = h('div', { class: 'sp-gallery', role: 'group', 'aria-label': 'Kiểu nền' });
    var presetBtns = {};
    PRESETS.forEach(function (pr) {
      var b = h('button', { type: 'button', class: 'sp-pre', title: pr.label, 'aria-label': pr.label, dataset: { preset: pr.id } });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.appendChild(presetThumb(pr));
      b.addEventListener('click', function () { choosePreset(pr); });
      gallery.appendChild(b); presetBtns[pr.id] = b;
    });
    function presetThumb(pr) {
      var box = h('span', { class: 'sp-pt' });
      if (pr.id === 'none') { box.classList.add('none'); return box; }
      var svgNS = 'http://www.w3.org/2000/svg', W = 64, H = 26, svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.setAttribute('preserveAspectRatio', 'none');
      function path(d, fill) { var p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); svg.appendChild(p); }
      var seed = RR.seedFrom(pr.id + ':0:0');
      if (pr.id === 'paper') { path(RR.paperPath(W, H, seed + 1, 2), 'rgba(0,0,0,.18)'); path(RR.paperPath(W - 2, H, seed, 0), pr.color); }
      else if (pr.id === 'marker') path(RR.markerPath(W, H * 0.55, seed), pr.color), svg.lastChild.setAttribute('transform', 'translate(0,' + (H * 0.3) + ')');
      else if (pr.id === 'pill') {
        var d = document.createElementNS(svgNS, 'defs'), lg = document.createElementNS(svgNS, 'linearGradient');
        lg.setAttribute('id', 'sp-pg'); [['0', pr.color], ['1', RR.gradientEnd(pr.color)]].forEach(function (s) { var t = document.createElementNS(svgNS, 'stop'); t.setAttribute('offset', s[0]); t.setAttribute('stop-color', s[1]); lg.appendChild(t); });
        d.appendChild(lg); svg.appendChild(d);
        var r = document.createElementNS(svgNS, 'rect'); r.setAttribute('width', W); r.setAttribute('height', H); r.setAttribute('rx', 13); r.setAttribute('fill', 'url(#sp-pg)'); svg.appendChild(r);
      } else path(RR.brushPath(W, H, seed, pr.id === 'brush-b' ? 1 : 0), pr.color);
      box.appendChild(svg); return box;
    }

    var layers = h('div', { class: 'sp-chips', 'aria-label': 'Các lớp nền của thẻ' });
    var bgCol = colorBtn(function (btn) {
      var b = curBg(); if (!b) return;
      api.pickColor(btn, b.color, function (hex) { if (hex) updBg({ color: hex }); }, { automaticLabel: null, title: 'Background Color' });
    }, 'Màu nền');
    var bgOp = num(0, 100, 1, function (v) { if (v !== null) updBg({ opacity: v / 100 }); }, 'Độ mờ nền 0–100% (không ảnh hưởng độ mờ chữ)');
    var bgOpR = h('input', { type: 'range', class: 'sp-range', min: '0', max: '100', step: '1', 'aria-label': 'Độ mờ nền' });
    bgOpR.addEventListener('input', function () { updBg({ opacity: Number(bgOpR.value) / 100 }); });
    var bgRad = num(0, 60, 1, function (v) { if (v !== null) updBg({ radius: v }); }, 'Bo góc (px) — cho dải bo tròn');
    var bgPad = num(0, 80, 1, function (v) { if (v !== null) updBg({ padding: v }); }, 'Đệm: tăng CHIỀU CAO của nền (px mỗi phía)');
    var bgRot = num(-45, 45, 1, function (v) { if (v !== null) updBg({ rotation: v }); }, 'Xoay (độ)');
    var bgScl = num(50, 300, 1, function (v) { if (v !== null) updBg({ scale: v / 100 }); }, 'Cỡ: tăng CHIỀU NGANG của nền (% so với bề ngang chữ)');
    var bgDx = num(-300, 300, 1, function (v) { if (v !== null) updBg({ dx: v }); }, 'Dịch ngang (px)');
    var bgDy = num(-300, 300, 1, function (v) { if (v !== null) updBg({ dy: v }); }, 'Dịch dọc (px)');
    var bgThk = num(15, 100, 1, function (v) { if (v !== null) updBg({ thick: v / 100 }); }, 'Độ dày dải marker (% chiều cao dòng)');
    var bgShp = num(0, 9, 1, function (v) { if (v !== null) updBg({ shape: Math.round(v) }); }, 'Biến thể hình dạng 0–9');
    var bgUp = action('Lên', 'arrow_upward', function () { moveBg(1); }, 'ghost');
    var bgDown = action('Xuống', 'arrow_downward', function () { moveBg(-1); }, 'ghost');
    var bgDel = action('Xoá lớp', 'delete', function () { delBg(); }, 'ghost danger');
    var bgAdd = action('Thêm lớp', 'layers', function () { addBgLayer(); }, 'ghost');
    bgAdd.title = 'Thêm một lớp nền nữa cho cùng phần chữ (xếp chồng lên lớp đang chọn)';
    var bgReset = action('Reset', 'restart_alt', function () { var b = curBg(); if (b) updBg(Object.assign({}, BG_DEFAULT)); }, 'ghost');

    tBg.appendChild(h('div', { class: 'sp-scope-hint', text: 'Chọn kiểu nền cho phần đang chọn:' }));
    tBg.appendChild(gallery);
    tBg.appendChild(layers);
    var bgForm = h('div', { class: 'sp-form' }, [
      h('div', { class: 'sp-line' }, [row('Màu nền', bgCol), row('Độ mờ', bgOpR, 'grow'), h('span', { class: 'sp-pc' }, [bgOp, h('span', { text: '%' })])]),
      h('div', { class: 'sp-line' }, [row('Đệm ↕', bgPad, 'w60'), row('Cỡ ↔', bgScl, 'w60'), row('Xoay', bgRot, 'w60'), row('Hình', bgShp, 'w50')]),
      h('div', { class: 'sp-line' }, [row('X', bgDx, 'w60'), row('Y', bgDy, 'w60'), row('Bo góc', bgRad, 'w60', 'rad'), row('Dày %', bgThk, 'w60', 'thk')]),
      h('div', { class: 'sp-line' }, [bgUp, bgDown, bgAdd, h('span', { class: 'sp-spacer' }), bgReset, bgDel])
    ]);
    tBg.appendChild(bgForm);
    Object.assign(ctl, { bgCol: bgCol, bgOp: bgOp, bgOpR: bgOpR, bgRad: bgRad, bgPad: bgPad, bgRot: bgRot, bgScl: bgScl, bgDx: bgDx, bgDy: bgDy, bgThk: bgThk, bgShp: bgShp });

    function curBg() { var p = api.getParts(); return p.bgs && p.bgs[st.bgSel] ? p.bgs[st.bgSel] : null; }
    function updBg(patch) {
      var p = parts(); if (!p.bgs[st.bgSel]) return;
      Object.assign(p.bgs[st.bgSel], patch); apply(p);
    }
    function choosePreset(pr) {
      var p = parts(), sc = api.scope();
      if (pr.id === 'none') {
        if (st.bgSel >= 0 && p.bgs[st.bgSel]) { p.bgs.splice(st.bgSel, 1); st.bgSel = -1; st.bgUser = false; apply(p); }
        return;
      }
      if (st.bgSel >= 0 && p.bgs[st.bgSel]) { p.bgs[st.bgSel].preset = pr.id; apply(p); return; }
      if (p.bgs.length >= RM.LIMITS.bgs) return;
      var z = p.bgs.reduce(function (m, b) { return Math.max(m, b.z); }, -1) + 1;
      p.bgs.push(Object.assign({ s: sc.s, e: sc.e, preset: pr.id, color: pr.color, z: Math.min(20, z) }, BG_DEFAULT));
      st.bgSel = p.bgs.length - 1; st.bgUser = true; apply(p);
    }
    function addBgLayer() {
      var p = parts(), b = p.bgs[st.bgSel];
      if (!b || p.bgs.length >= RM.LIMITS.bgs) return;
      var other = b.preset === 'marker' ? PRESETS[1] : PRESETS[4];   // lớp mới khác kiểu để thấy rõ khi chồng (Brush ↔ Marker)
      var c = clone(b); c.preset = other.id; c.color = other.color;
      c.z = Math.min(20, p.bgs.reduce(function (m, x) { return Math.max(m, x.z); }, -1) + 1);
      p.bgs.push(c); st.bgSel = p.bgs.length - 1; st.bgUser = true; apply(p);
    }
    function delBg() { var p = parts(); if (!p.bgs[st.bgSel]) return; p.bgs.splice(st.bgSel, 1); st.bgSel = -1; st.bgUser = false; apply(p); }
    function moveBg(dir) {   // dir +1 = lên trên (z lớn hơn), -1 = xuống dưới
      var p = parts(); if (!p.bgs[st.bgSel]) return;
      var order = p.bgs.map(function (b, i) { return { b: b, i: i }; }).sort(function (a, b) { return a.b.z - b.b.z || a.i - b.i; });
      var pos = order.findIndex(function (o) { return o.i === st.bgSel; }), to = clamp(pos + dir, 0, order.length - 1);
      if (to === pos) return;
      var mv = order.splice(pos, 1)[0]; order.splice(to, 0, mv);
      order.forEach(function (o, k) { o.b.z = Math.min(20, k); });
      apply(p);
    }

    /* ==================== tab Animation ==================== */
    var tAn = h('div', { class: 'sp-tab se-seg-body', dataset: { tab: 'anim', segBody: 'anim' } });
    var anForm = Object.assign({ phase: 'in', type: 'fade' }, AN_DEFAULT);   // giá trị form khi chưa chọn hoạt ảnh nào (dùng cho lần "Thêm" kế tiếp)
    var phaseBar = h('div', { class: 'sp-seg', role: 'tablist' }, PHASES.map(function (ph) {
      var b = h('button', { type: 'button', class: 'sp-segb', role: 'tab', dataset: { phase: ph[0] }, text: ph[1] });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { setPhase(ph[0]); });
      return b;
    }));
    var anType = sel([['fade', 'Fade']], function (v) { setAn({ type: v }); });
    var anDur = num(0, 10000, 50, function (v) { if (v !== null) setAn({ dur: v }); }, 'Thời lượng (ms)');
    var anDelay = num(0, 30000, 50, function (v) { if (v !== null) setAn({ delay: v }); }, 'Độ trễ (ms)');
    var anEase = sel(RM.EASINGS.map(function (e) { return [e, EASE_LABEL[e]]; }), function (v) { setAn({ ease: v }); });
    var anDir = sel(RM.DIRS.map(function (d) { return [d, DIR_LABEL[d]]; }), function (v) { setAn({ dir: v }); });
    var anStag = num(0, 2000, 10, function (v) { if (v !== null) setAn({ stagger: v }); }, 'Trễ giữa từng từ/ký tự (ms)');
    var anRep = num(1, 100, 1, function (v) { if (v !== null) setAn({ repeat: Math.round(v) }); }, 'Số lần lặp');
    var anInf = h('input', { type: 'checkbox', class: 'sp-ck', title: 'Lặp vô hạn' });
    anInf.addEventListener('change', function () { setAn({ repeat: anInf.checked ? -1 : 1 }); });
    var anCol = colorBtn(function (btn) {
      var a = formValues(); api.pickColor(btn, a.color || null, function (hex) { setAn({ color: hex || undefined }); }, { automaticLabel: 'Mặc định (vàng)', title: 'Màu hiệu ứng' });
    }, 'Màu (Glow / Color Transition)');
    var anList = h('div', { class: 'sp-chips', 'aria-label': 'Các hoạt ảnh của thẻ' });
    var anAdd = action('Thêm hoạt ảnh', 'add', function () { addAn(); }, 'primary');
    anAdd.title = 'Thêm hoạt ảnh cho phần đang chọn (nếu đang chọn một hoạt ảnh thì nhân bản nó để chỉnh tiếp)';
    var anPlay = action('Xem thử', 'play_arrow', function () { api.replay(); }, 'ghost');
    var anDel = action('Xoá', 'delete', function () { delAn(); }, 'ghost danger');
    tAn.appendChild(h('div', { class: 'sp-scope-hint', text: 'Hoạt ảnh cho phần đang chọn:' }));
    tAn.appendChild(phaseBar);
    tAn.appendChild(h('div', { class: 'sp-form' }, [
      h('div', { class: 'sp-line' }, [row('Kiểu', anType, 'grow'), row('Hướng', anDir, 'w90')]),
      h('div', { class: 'sp-line' }, [row('Thời lượng', anDur, 'w70'), row('Trễ', anDelay, 'w70'), row('Easing', anEase, 'grow')]),
      h('div', { class: 'sp-line' }, [row('Stagger', anStag, 'w70', 'stag'), row('Lặp', anRep, 'w60'), h('label', { class: 'sp-row' }, [anInf, h('span', { class: 'sp-k', text: '∞' })]), row('Màu', anCol)]),
      h('div', { class: 'sp-line' }, [anAdd, anPlay, h('span', { class: 'sp-spacer' }), anDel])
    ]));
    tAn.appendChild(anList);
    Object.assign(ctl, { anType: anType, anDur: anDur, anDelay: anDelay, anEase: anEase, anDir: anDir, anStag: anStag, anRep: anRep, anInf: anInf, anCol: anCol });

    function curAn() { var p = api.getParts(); return p.anims && p.anims[st.anSel] ? p.anims[st.anSel] : null; }
    function typesFor(phase) { return RM.ANIM_TYPES[phase]; }
    function formValues() { return curAn() || anForm; }
    function setPhase(phase) {
      var a = curAn();
      if (a) { var p = parts(); var t = p.anims[st.anSel]; t.phase = phase; if (typesFor(phase).indexOf(t.type) === -1) t.type = typesFor(phase)[0]; apply(p); }
      else { anForm.phase = phase; if (typesFor(phase).indexOf(anForm.type) === -1) anForm.type = typesFor(phase)[0]; refresh(); }
    }
    function setAn(patch) {
      var a = curAn();
      if (a) { var p = parts(); Object.assign(p.anims[st.anSel], patch); apply(p); }
      else { Object.assign(anForm, patch); refresh(); }
    }
    function addAn() {
      var p = parts(), sc = api.scope(); if (p.anims.length >= RM.LIMITS.anims) return;
      var sel = p.anims[st.anSel];
      var item = Object.assign({}, sel ? sel : anForm, { s: sc.s, e: sc.e });   // đang chọn một hoạt ảnh → nhân bản để chỉnh tiếp
      if (!item.color) delete item.color;
      p.anims.push(item); st.anSel = p.anims.length - 1; st.anUser = true; apply(p);
    }
    function delAn() { var p = parts(); if (!p.anims[st.anSel]) return; p.anims.splice(st.anSel, 1); st.anSel = -1; st.anUser = false; apply(p); }

    /* ==================== khung chung: tab + danh sách chip ==================== */
    var tabs = h('div', { class: 'se-seg-tabs', role: 'tablist' });
    var bodies = h('div', { class: 'sp-bodies' }, [tText, tBg, tAn]);
    var scopeLine = h('div', { class: 'sp-scope se-seg-scope' });
    host.appendChild(scopeLine); host.appendChild(bodies);

    function chips(container, items, selIdx, label, onSelect) {
      container.textContent = '';
      items.forEach(function (it, i) {
        var c = h('button', { type: 'button', class: 'sp-chip' + (i === selIdx ? ' on' : ''), title: label(it, i) }, [h('span', { text: label(it, i) })]);
        c.addEventListener('mousedown', function (e) { e.preventDefault(); });
        c.addEventListener('click', function () { onSelect(i); });
        container.appendChild(c);
      });
    }

    /* ==================== làm mới giao diện theo dữ liệu ==================== */
    // Lớp/hoạt ảnh đang chọn: do người dùng chọn tay (còn hiệu lực chừng nào vùng áp dụng chưa đổi), hoặc TRÙNG ĐÚNG phạm vi.
    // Vùng chọn chỉ chạm một phần lớp khác thì KHÔNG tự chọn lớp đó (nếu không, bấm kiểu nền sẽ sửa nhầm lớp cũ thay vì tạo lớp mới).
    function bestIndex(list, sc, current, user) {
      if (user && list[current]) return current;
      return list.findIndex(function (x) { return x.s === sc.s && x.e === sc.e; });
    }
    function refresh() {
      var p = api.getParts() || { marks: [], bgs: [], anims: [] }, sc = api.scope(), text = api.getText();
      // đổi vùng áp dụng (tô chọn chỗ khác) → bỏ lựa chọn lớp nền/hoạt ảnh do người dùng chọn tay ở vùng cũ
      var scopeKey = sc.s + ':' + sc.e;
      if (st.scopeKey !== scopeKey) { st.scopeKey = scopeKey; st.bgUser = false; st.anUser = false; }
      // phạm vi
      scopeLine.textContent = '';
      scopeLine.appendChild(document.createTextNode('Áp dụng cho: '));
      scopeLine.appendChild(h('b', { text: sc.whole ? 'cả đoạn' : '“' + snippet(text, sc.s, sc.e) + '” (ký tự ' + sc.s + '–' + sc.e + ')' }));

      // Text
      var sm = RM.fmtSummary(p.marks || [], text, sc.s, sc.e), base = api.style();
      var MIX = RM.MIXED;
      if (typeof sm.font === 'string' && !Array.prototype.some.call(ctl.fontSel.options, function (o) { return o.value === sm.font; })) ctl.fontSel.appendChild(h('option', { value: sm.font, text: sm.font }));
      ctl.fontSel.value = typeof sm.font === 'string' ? sm.font : ''; if (sm.font === MIX) ctl.fontSel.selectedIndex = 0;
      setVal(ctl.sizeIn, typeof sm.size === 'number' ? sm.size : null, sm.size === MIX ? '—' : parseInt(base.fontSize, 10) || '');
      [['bB', 'bold', base.fontWeight === 'bold'], ['bI', 'italic', base.fontStyle === 'italic'], ['bU', 'underline', base.textDecoration === 'underline']].forEach(function (f) {
        var v = sm[f[1]], on = v === MIX ? false : (v !== undefined ? !!v : f[2]);
        ctl[f[0]].classList.toggle('on', on); ctl[f[0]].setAttribute('aria-pressed', String(on));
      });
      ctl.colB.set(typeof sm.color === 'string' ? sm.color : (sm.color === MIX ? null : base.color), sm.color === MIX);
      var sh = sm.shadow && sm.shadow !== MIX ? sm.shadow : null, so = sm.stroke && sm.stroke !== MIX ? sm.stroke : null;
      ctl.shOn.checked = !!sh; ctl.shOn.indeterminate = sm.shadow === MIX;
      ctl.shCol.set(sh ? sh.color : '#000000'); setVal(ctl.shX, sh ? sh.x : null); setVal(ctl.shY, sh ? sh.y : null); setVal(ctl.shB, sh ? sh.blur : null);
      [ctl.shCol, ctl.shX, ctl.shY, ctl.shB].forEach(function (c) { c.disabled = !sh; });
      ctl.stOn.checked = !!so; ctl.stOn.indeterminate = sm.stroke === MIX;
      ctl.stCol.set(so ? so.color : '#000000'); setVal(ctl.stW, so ? so.w : null);
      [ctl.stCol, ctl.stW].forEach(function (c) { c.disabled = !so; });

      // Background
      st.bgSel = bestIndex(p.bgs || [], sc, st.bgSel, st.bgUser);
      var bg = (p.bgs || [])[st.bgSel] || null;
      Object.keys(presetBtns).forEach(function (id) {
        var on = bg ? bg.preset === id : id === 'none'; presetBtns[id].classList.toggle('on', on); presetBtns[id].setAttribute('aria-pressed', String(on));
      });
      chips(layers, p.bgs || [], st.bgSel, function (b) { return (PRESETS.find(function (x) { return x.id === b.preset; }) || {}).label + ' · ' + snippet(text, b.s, b.e); }, function (i) { st.bgSel = i; st.bgUser = true; refresh(); });
      layers.style.display = (p.bgs || []).length ? '' : 'none';
      bgForm.style.display = bg ? '' : 'none';
      if (bg) {
        ctl.bgCol.set(bg.color); ctl.bgOpR.value = String(Math.round(bg.opacity * 100)); setVal(ctl.bgOp, Math.round(bg.opacity * 100));
        setVal(ctl.bgPad, bg.padding); setVal(ctl.bgRot, bg.rotation); setVal(ctl.bgScl, Math.round(bg.scale * 100));
        setVal(ctl.bgDx, bg.dx); setVal(ctl.bgDy, bg.dy); setVal(ctl.bgRad, bg.radius); setVal(ctl.bgThk, Math.round(bg.thick * 100)); setVal(ctl.bgShp, bg.shape);
        ctl.bgRad.closest('.sp-row').style.display = (bg.preset === 'pill' || bg.preset === 'paper') ? '' : 'none';
        ctl.bgThk.closest('.sp-row').style.display = bg.preset === 'marker' ? '' : 'none';
      }

      // Animation
      st.anSel = bestIndex(p.anims || [], sc, st.anSel, st.anUser);
      var an = (p.anims || [])[st.anSel] || null, fv = formValues();
      Array.prototype.forEach.call(phaseBar.children, function (b) { var on = b.dataset.phase === fv.phase; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      var types = typesFor(fv.phase);
      if (ctl.anType.dataset.phase !== fv.phase) { ctl.anType.textContent = ''; types.forEach(function (t) { ctl.anType.appendChild(h('option', { value: t, text: TYPE_LABEL[t] })); }); ctl.anType.dataset.phase = fv.phase; }
      ctl.anType.value = fv.type;
      setVal(ctl.anDur, fv.dur); setVal(ctl.anDelay, fv.delay); ctl.anEase.value = fv.ease; ctl.anDir.value = fv.dir;
      setVal(ctl.anStag, fv.stagger); setVal(ctl.anRep, fv.repeat === -1 ? null : fv.repeat); ctl.anInf.checked = fv.repeat === -1; ctl.anRep.disabled = fv.repeat === -1;
      ctl.anCol.set(fv.color || null);
      ctl.anStag.disabled = !UNIT_TYPE[fv.type]; ctl.anStag.closest('.sp-row').classList.toggle('dim', !UNIT_TYPE[fv.type]);
      ctl.anDir.disabled = !(fv.type === 'slide' || /^slide-/.test(fv.type));
      ctl.anCol.disabled = !(fv.type === 'glow' || fv.type === 'color');
      anDel.style.display = an ? '' : 'none';
      chips(anList, p.anims || [], st.anSel, function (a) { return (PHASES.find(function (x) { return x[0] === a.phase; }) || [])[1] + ' · ' + TYPE_LABEL[a.type] + ' · ' + snippet(text, a.s, a.e); }, function (i) { st.anSel = i; st.anUser = true; refresh(); });
      anList.style.display = (p.anims || []).length ? '' : 'none';
    }

    function setTab(name) {
      st.tab = name;
      Array.prototype.forEach.call(host.parentElement ? host.parentElement.querySelectorAll('.se-seg-tab') : [], function (b) { b.classList.toggle('active', b.dataset.segTab === name); });
      [tText, tBg, tAn].forEach(function (t) { t.hidden = t.dataset.tab !== name; });
    }
    setTab('text'); refresh();
    return { refresh: refresh, resetUser: function () { st.bgUser = false; st.anUser = false; }, state: function () { return { bgSel: st.bgSel, bgUser: st.bgUser, anSel: st.anSel, anUser: st.anUser }; }, setTab: setTab, tab: function () { return st.tab; }, selectBg: function (i) { st.bgSel = i; st.bgUser = true; refresh(); }, selectAnim: function (i) { st.anSel = i; st.anUser = true; refresh(); } };
  }

  return { mount: mount, PRESETS: PRESETS, BG_DEFAULT: BG_DEFAULT, AN_DEFAULT: AN_DEFAULT };
}));
