/* Chia/chuẩn hoá lời bài hát cho trang /setlist/ — logic THUẦN (không đụng DOM) để
 * test được bằng Node. PHẢI khớp quy tắc của desktop và của relay:
 *  - desktop: index.html (getLyricsFromEditor, loadToPreview, stripLabel, stripChords)
 *  - relay:   cloud/worker/src/room-relay.js (normalizeSongLyrics)
 * Quy tắc ngắt slide: MỘT hoặc nhiều dòng trống ("Enter đôi") = 1 ngắt slide; lưu
 * thành đúng "\n\n". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SetlistSlides = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LYRICS_MAX = 6000;   // = SONG_LYRICS_MAX ở relay, MAX_LYRICS_CHARS ở worker.js
  var TITLE_MAX = 200;

  // Y HỆT desktop (index.html labelPattern) — cố ý KHÔNG neo `$`/`\b` để preview
  // khớp màn chiếu thật, kể cả khi dòng đầu "Kết…/End…" bị coi là nhãn.
  var LABEL_RE = /^(Verse|Chorus|Bridge|Pre-Chorus|Tag|End|Đoạn|Điệp khúc|Kết)/i;

  function normalizeLyrics(raw) {
    var text = String(raw == null ? '' : raw)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return text.split(/\n\s*\n/)
      .map(function (blk) {
        return blk.split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).join('\n').trim();
      })
      .filter(Boolean)
      .join('\n\n');
  }

  function normalizeTitle(raw) {
    return String(raw == null ? '' : raw).replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  }

  function stripLabel(text) {
    var lines = String(text).split('\n');
    if (lines.length > 0 && LABEL_RE.test(lines[0].trim())) {
      return { label: lines[0].trim(), content: lines.slice(1).join('\n').trim() };
    }
    return { label: '', content: String(text).trim() };
  }

  // [Am]chord trong lời chỉ để operator xem; màn chiếu bỏ đi (index.html stripChords).
  function stripChords(text) { return String(text).replace(/\[.*?\]/g, ''); }

  // Lời -> danh sách slide [{label, content}] đúng như desktop (loadToPreview).
  function splitSlides(lyrics) {
    return String(lyrics == null ? '' : lyrics).split(/\n\s*\n/)
      .filter(function (s) { return s.trim() !== ''; })
      .map(function (s) { return stripLabel(s.trim()); });
  }

  var DEFAULT_STYLE = {
    fontFamily: 'CMG Sans', fontSize: 80, color: '#ffffff',
    textAlign: 'center', verticalAlign: 'middle',
    textStrokeWidth: 5, textStrokeColor: '#000000'
  };

  // Style rút gọn do desktop đẩy lên (/library) -> style đủ dùng cho preview.
  function resolveStyle(st) {
    var out = {};
    for (var k in DEFAULT_STYLE) out[k] = DEFAULT_STYLE[k];
    if (st && typeof st === 'object') {
      if (st.fontFamily) out.fontFamily = String(st.fontFamily);
      var px = parseInt(st.fontSize, 10);
      if (px > 0) out.fontSize = Math.min(px, 300);
      if (st.color) out.color = String(st.color);
      if (['left', 'center', 'right', 'justify'].indexOf(st.textAlign) !== -1) out.textAlign = st.textAlign;
      if (['top', 'center', 'middle', 'bottom'].indexOf(st.verticalAlign) !== -1) out.verticalAlign = st.verticalAlign;
      var sw = Number(st.textStrokeWidth);
      if (isFinite(sw) && sw >= 0) out.textStrokeWidth = Math.min(sw, 30);
      if (st.textStrokeColor) out.textStrokeColor = String(st.textStrokeColor);
    }
    return out;
  }

  // Bỏ dấu + đ->d + chữ thường để tìm kiếm tiếng Việt không dấu.
  function searchNorm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  }

  // webId phải khớp /^[A-Za-z0-9_-]{8,64}$/ (relay kiểm tra lại).
  function newWebId() {
    var buf = new Uint8Array(12);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : require('node:crypto').webcrypto).getRandomValues(buf);
    return 'web-' + Array.prototype.map.call(buf, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  return {
    LYRICS_MAX: LYRICS_MAX, TITLE_MAX: TITLE_MAX, DEFAULT_STYLE: DEFAULT_STYLE,
    normalizeLyrics: normalizeLyrics, normalizeTitle: normalizeTitle,
    stripLabel: stripLabel, stripChords: stripChords, splitSlides: splitSlides,
    resolveStyle: resolveStyle, searchNorm: searchNorm, newWebId: newWebId
  };
});
