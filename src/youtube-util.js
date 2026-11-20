/* Tiện ích YouTube dùng chung cho main.js (require) và index.html (<script>).
 *
 * Nguyên tắc bảo mật (AuthZ cho dữ liệu không tin cậy): chuỗi người dùng dán vào KHÔNG bao giờ được ghép thẳng
 * vào URL/iframe. Chỉ trích đúng ID 11 ký tự [A-Za-z0-9_-] từ các dạng link của đúng host YouTube; mọi thứ
 * khác (host lạ, scheme lạ, ID sai độ dài) bị từ chối. URL nhúng luôn do hàm embedUrl() dựng lại từ ID sạch.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YouTubeUtil = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^[A-Za-z0-9_-]{11}$/;
  // youtube-nocookie = chế độ riêng tư của YouTube (không đặt cookie theo dõi khi chưa bấm phát).
  var EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
  var HOSTS = {
    'youtube.com': 1, 'www.youtube.com': 1, 'm.youtube.com': 1, 'music.youtube.com': 1,
    'youtube-nocookie.com': 1, 'www.youtube-nocookie.com': 1, 'youtu.be': 1
  };

  function isValidId(id) { return typeof id === 'string' && ID_RE.test(id); }

  function parseYouTubeId(input) {
    if (typeof input !== 'string') return null;
    var s = input.trim();
    if (!s || s.length > 300) return null;
    if (isValidId(s)) return s;                     // dán thẳng ID
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s; // "youtu.be/xxxx" không có scheme
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;      // chặn kiểu https://youtube.com@evil.com/...
    var host = u.hostname.toLowerCase();
    if (!HOSTS[host]) return null;
    var id = null;
    if (host === 'youtu.be') {
      id = u.pathname.split('/')[1] || '';
    } else if (u.pathname === '/watch') {
      id = u.searchParams.get('v') || '';
    } else {
      var m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m ? m[1] : '';
    }
    return isValidId(id) ? id : null;
  }

  // URL iframe: chỉ từ ID đã kiểm. rel=0: gợi ý cuối video chỉ lấy cùng kênh; iv_load_policy=3: ẩn chú thích.
  function embedUrl(id) {
    if (!isValidId(id)) return null;
    return EMBED_ORIGIN + '/embed/' + id + '?autoplay=1&enablejsapi=1&rel=0&playsinline=1&iv_load_policy=3&controls=0&disablekb=1';
  }

  function watchUrl(id) { return isValidId(id) ? 'https://www.youtube.com/watch?v=' + id : null; }

  return { isValidId: isValidId, parseYouTubeId: parseYouTubeId, embedUrl: embedUrl, watchUrl: watchUrl, EMBED_ORIGIN: EMBED_ORIGIN };
}));
