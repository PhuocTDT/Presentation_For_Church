/* i18n nhẹ cho cửa sổ operator (index.html): tiếng Việt (gốc, mặc định) ↔ tiếng Anh.
   Cách làm: văn bản gốc trong index.html/JS vẫn là tiếng Việt. Khi chọn "en", bộ máy dịch TRỰC TIẾP trên DOM:
   tra từ điển (src/i18n/en.js) theo nguyên văn tiếng Việt cho text node + thuộc tính title/placeholder/aria-label/alt,
   rồi theo dõi DOM (MutationObserver) để dịch cả nội dung do JS dựng động. Đổi về "vi" thì khôi phục nguyên văn.
   KHÔNG dịch nội dung người dùng: lời bài hát, tên bài, thẻ slide, tin nhắn của band, ô nhập. */
(function (global) {
  'use strict';
  var dict = {}, rules = [], byId = {};
  var lang = 'vi';
  var observer = null;
  // Vùng chứa nội dung của NGƯỜI DÙNG/dữ liệu — không bao giờ dịch.
  var SKIP = 'script,style,textarea,input,[contenteditable="true"],[data-no-i18n],#lyrics-editor-container,' +
    '#preview-slides-container,#live-slides-container,tr[data-library-key],[data-schedule-item],.text-layer-box,' +
    '.bp-msg:not(.sys),.bp-sl-sub,#bpOnlineList,#song-title-input,.se-slide-text';
  // Thuộc tính title/placeholder/aria-label là chữ GIAO DIỆN kể cả trên <input>/<textarea> → chỉ loại các vùng chứa nội dung người dùng.
  var SKIP_ATTR = SKIP.replace('textarea,input,', '');
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function lookup(key, el) {
    if (!key) return null;
    var id = el && el.id;
    if (id && Object.prototype.hasOwnProperty.call(byId, id) && Object.prototype.hasOwnProperty.call(dict, key)) return byId[id];
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    for (var i = 0; i < rules.length; i++) {
      var m = key.match(rules[i].re);
      if (m) return key.replace(rules[i].re, rules[i].to);
    }
    return null;
  }

  function skipped(el) { return !el || (el.closest && el.closest(SKIP)); }

  // ---- text node ----
  function tx(node) {
    if (lang !== 'en') return;
    var v = node.nodeValue;
    if (node.__en !== undefined && v === node.__en) return;            // chính là bản dịch ta vừa ghi
    var parent = node.parentElement;
    if (!parent || skipped(parent)) { delete node.__vi; delete node.__en; return; }
    var key = norm(v);
    var out = lookup(key, parent);
    if (out == null) { delete node.__vi; delete node.__en; return; }
    node.__vi = v;
    node.__en = v.match(/^\s*/)[0] + out + v.match(/\s*$/)[0];
    node.nodeValue = node.__en;
  }

  // ---- thuộc tính ----
  function at(el, name) {
    if (lang !== 'en' || !el.getAttribute) return;
    var v = el.getAttribute(name);
    if (v == null) return;
    var st = el.__i18nA || (el.__i18nA = {});
    if (st[name] && st[name].en === v) return;
    if (el.closest && el.closest(SKIP_ATTR)) { delete st[name]; return; }
    var out = lookup(norm(v), el);
    if (out == null) { delete st[name]; return; }
    st[name] = { vi: v, en: out };
    el.setAttribute(name, out);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { tx(root); return; }
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SKIP)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) tx(n);
    var sel = '[title],[placeholder],[aria-label],[alt]';
    if (root.matches && root.matches(sel)) ATTRS.forEach(function (a) { at(root, a); });
    root.querySelectorAll(sel).forEach(function (el) { ATTRS.forEach(function (a) { at(el, a); }); });
  }

  function restore(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      if (n.__en !== undefined && n.nodeValue === n.__en && n.__vi !== undefined) n.nodeValue = n.__vi;
      delete n.__vi; delete n.__en;
    }
    root.querySelectorAll('*').forEach(function (el) {
      var st = el.__i18nA; if (!st) return;
      Object.keys(st).forEach(function (a) { if (el.getAttribute(a) === st[a].en) el.setAttribute(a, st[a].vi); });
      delete el.__i18nA;
    });
  }

  function onMutations(muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
      else if (m.type === 'characterData') tx(m.target);
      else if (m.type === 'attributes') at(m.target, m.attributeName);
    }
    observer.takeRecords();   // bỏ các bản ghi do chính việc dịch vừa tạo ra
  }

  function startObserver() {
    if (observer || !global.MutationObserver) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function stopObserver() { if (observer) { observer.disconnect(); observer = null; } }

  var API = {
    get lang() { return lang; },
    // Đăng ký từ điển cho một ngôn ngữ (hiện chỉ 'en'); gọi trước hoặc sau set() đều được.
    register: function (pack) {
      if (!pack || pack.lang !== 'en') return;
      dict = pack.dict || {}; byId = pack.byId || {};
      rules = (pack.rules || []).map(function (r) { return { re: new RegExp(r[0]), to: r[1] }; });
      if (lang === 'en') walk(document.body);
    },
    set: function (l) {
      l = l === 'en' ? 'en' : 'vi';
      document.documentElement.setAttribute('lang', l);   // luôn đúng ngôn ngữ đang dùng (index.html gốc ghi sẵn lang="en")
      if (l === lang && (l === 'vi' || observer)) return;
      lang = l;
      if (l === 'en') { walk(document.body); startObserver(); }
      else { stopObserver(); restore(document.body); }
      try { global.dispatchEvent(new CustomEvent('i18n-change', { detail: { lang: l } })); } catch (e) { /* bỏ qua */ }
    },
    // Dịch một chuỗi tiếng Việt do JS tự dựng (không đi qua DOM); không có bản dịch → trả nguyên văn.
    t: function (vi) {
      if (lang !== 'en') return vi;
      var out = lookup(norm(vi), null);
      return out == null ? vi : out;
    }
  };
  global.I18N = API;
})(typeof window !== 'undefined' ? window : globalThis);
