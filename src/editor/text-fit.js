/* Tự co chữ cho vừa khung — DÙNG CHUNG cho cửa sổ chính (xem trước trong Edit Song, Preview, màn giám sát) và cửa sổ Live
 * (live.html). Trước đây mỗi cửa sổ có một bản riêng (bên chính có giới hạn số dòng đếm bằng công thức chiều cao, bên Live
 * không) → cùng một slide ra cỡ chữ / chỗ ngắt dòng khác nhau. Nay một hàm duy nhất ⇒ Preview = Projector.
 *
 *   TextFit.fit(el, textBox, opts) → cỡ chữ cuối (px), đã ghi vào el.style.fontSize và viền chữ el.style.webkitTextStroke
 *     opts.fontSize         cỡ gốc (px)
 *     opts.strokeWidth/strokeColor  viền chữ gốc (co theo tỉ lệ cỡ chữ)
 *     opts.autoFit          false = giữ cỡ gốc
 *     opts.maxLines         giới hạn số dòng HIỂN THỊ (mặc định 5); nếu nội dung có nhiều dòng CỨNG hơn thì nới bằng số dòng cứng
 *     opts.reserveNextVerse true = đáy khối chữ không được vượt opts.safeBottom (đơn vị khung ảo 960x540)
 *
 * Số dòng được ĐẾM THẬT từ hình học các dòng (Range.getClientRects), không ước bằng chiều cao ÷ (cỡ × line-height): chữ có
 * cỡ riêng to hơn làm dòng cao hơn công thức → trước đây bị tưởng là quá số dòng và co nhỏ hơn màn chiếu. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextFit = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SAFE_BOTTOM = 488;   // thanh next verse bắt đầu ở ~y=491 của khung ảo 960x540

  // Gom các hình chữ nhật (mỗi mảnh chữ trên một dòng) thành số DÒNG: sắp theo tâm dọc, mảnh có tâm nằm dưới đáy dòng hiện tại
  // thì sang dòng mới. Mảnh cỡ to/nhỏ khác nhau trên cùng một dòng vẫn chồng lấn nhau theo chiều dọc nên tính là một dòng. Thuần.
  function groupLines(rects) {
    var rs = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r && r.width > 0.5 && r.bottom - r.top > 0.5) rs.push({ c: (r.top + r.bottom) / 2, b: r.bottom });
    }
    rs.sort(function (a, b) { return a.c - b.c; });
    var n = 0, bottom = -Infinity;
    rs.forEach(function (r) {
      if (r.c > bottom) { n++; bottom = r.b; } else if (r.b > bottom) bottom = r.b;
    });
    return n;
  }

  function lineCount(el) {
    if (typeof document === 'undefined') return 0;
    var rects = [], w = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */), n, rg = document.createRange();
    while ((n = w.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.replace(/\s+/g, '')) continue;
      var p = n.parentElement;
      if (p && p.closest && p.closest('.chord-mark')) continue;   // hợp âm vẽ phía trên dòng, không phải một dòng lời
      rg.selectNodeContents(n);
      var list = rg.getClientRects();
      for (var i = 0; i < list.length; i++) rects.push(list[i]);
    }
    return groupLines(rects);
  }

  function measureOverflow(el, textBox) {
    if (!el || !textBox) return false;
    if (textBox.clientWidth <= 0 || textBox.clientHeight <= 0) return false;
    return Math.ceil(el.scrollWidth) > Math.ceil(textBox.clientWidth) || Math.ceil(el.scrollHeight) > Math.ceil(textBox.clientHeight);
  }

  // đáy khối chữ trong khung ảo, đo bằng hình học layout (không phụ thuộc tỉ lệ thu phóng của khung)
  function textBottomInCanvas(el, textBox) {
    var centered = /translateY\(\s*-50%\s*\)/.test(textBox.style.transform || '');
    var boxTop = textBox.offsetTop - (centered ? textBox.offsetHeight / 2 : 0);
    return boxTop + el.offsetTop + el.offsetHeight;
  }

  function hardLineCount(el) {
    return String(el.innerText || el.textContent || '').split('\n').filter(function (l) { return l.trim() !== ''; }).length;
  }

  function fit(el, textBox, opts) {
    if (!el || !textBox) return 0;
    opts = opts || {};
    var base = Math.max(8, Math.round(Number(opts.fontSize) || 80));
    var minFs = Math.max(8, Math.min(base, 10));
    var stroke0 = Math.max(0, Number(opts.strokeWidth) || 0), strokeColor = opts.strokeColor || '#000000';
    function setSize(fs) {
      el.style.fontSize = fs + 'px';
      el.style.webkitTextStroke = Math.max(0, Math.round(stroke0 * (fs / base))) + 'px ' + strokeColor;
    }
    setSize(base);
    if (opts.autoFit === false || !el.textContent || !el.textContent.trim()) return base;

    var maxLines = Math.max(opts.maxLines > 0 ? opts.maxLines : 5, hardLineCount(el));
    var safeBottom = opts.safeBottom > 0 ? opts.safeBottom : SAFE_BOTTOM;
    function overflows() {
      if (measureOverflow(el, textBox)) return true;
      if (lineCount(el) > maxLines) return true;
      if (opts.reserveNextVerse && textBottomInCanvas(el, textBox) > safeBottom) return true;
      return false;
    }
    if (!overflows()) return base;
    // cỡ LỚN NHẤT còn vừa (tìm nhị phân; không cỡ nào vừa thì dùng cỡ nhỏ nhất)
    var lo = minFs, hi = base - 1, best = minFs;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      setSize(mid);
      if (!overflows()) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    setSize(best);
    return best;
  }

  return { fit: fit, groupLines: groupLines, lineCount: lineCount, measureOverflow: measureOverflow, textBottomInCanvas: textBottomInCanvas, SAFE_BOTTOM: SAFE_BOTTOM };
}));
