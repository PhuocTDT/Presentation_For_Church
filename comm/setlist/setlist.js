/* Trang /setlist/ — soạn setlist, tạo bài hát mới (gửi duyệt), xem trước slide.
 * Cùng origin với relay (channel.worship-official.link) nên gọi API không cần CORS.
 * Xác thực: ID phòng + mật khẩu phòng -> token (giống phone /m/). Mọi ghi vào thư
 * viện máy chiếu đều đi qua hộp chờ duyệt của operator, KHÔNG ghi trực tiếp. */
(function () {
  'use strict';
  var S = window.SetlistSlides;
  var API = location.origin;
  var LS_KEY = 'setlist.v1';
  var PHONE_LS_KEY = 'bandcomm.v1';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- trạng thái ---------------- */
  function randHex(n) {
    var b = new Uint8Array(n); crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function loadState() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { s = {}; }
    if (!s.profileId) {
      // Cùng người dùng với phone /m/ (cùng origin) -> cùng profileId để "bài của tôi" nhất quán.
      try { var p = JSON.parse(localStorage.getItem(PHONE_LS_KEY) || '{}'); if (p && p.profileId) s.profileId = p.profileId; } catch (e) {}
      if (!s.profileId) s.profileId = 'p-' + randHex(8);
    }
    if (!Array.isArray(s.slDraft)) s.slDraft = [];
    return s;
  }
  var state = loadState();
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---------------- tiện ích ---------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var toastTimer = null;
  function toast(msg, type) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (type === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 3500);
  }
  function setStatus(id, msg, type) { var n = $(id); n.textContent = msg || ''; n.className = 'status' + (type ? ' ' + type : ''); }
  function roomPath(p) { return API + '/api/room/' + encodeURIComponent(state.roomCode) + p; }

  // Gọi API phòng kèm token. 401 = token hết hạn/bị thu hồi -> về màn đăng nhập.
  function callRoom(path, opts) {
    opts = opts || {};
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch(roomPath(path) + sep + 'token=' + encodeURIComponent(state.token || ''), {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { logout('Phiên đăng nhập đã hết hạn, vui lòng vào lại phòng.'); }
        return { ok: r.ok, status: r.status, body: j };
      });
    });
  }

  /* ---------------- đăng nhập ---------------- */
  var params = new URLSearchParams(location.search);
  var urlRoom = (params.get('room') || params.get('r') || '').trim().toUpperCase();

  function showLogin(err) {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('loginErr').textContent = err || '';
    $('roomCode').value = urlRoom || state.roomCode || '';
    $('yourName').value = state.name || '';
    $('roomPassword').value = '';
    (urlRoom || state.roomCode ? $('roomPassword') : $('roomCode')).focus();
  }

  function doLogin() {
    var code = $('roomCode').value.trim().toUpperCase();
    var pw = $('roomPassword').value.trim();
    var name = $('yourName').value.trim();
    $('loginErr').textContent = '';
    if (!/^[A-Z0-9]{4,10}$/.test(code)) { $('loginErr').textContent = 'ID phòng gồm 4–10 ký tự chữ/số.'; return; }
    if (!/^[a-zA-Z0-9]{4,12}$/.test(pw)) { $('loginErr').textContent = 'Vui lòng nhập mật khẩu phòng (4–12 ký tự).'; return; }
    if (!name) { $('loginErr').textContent = 'Vui lòng nhập tên của bạn.'; return; }
    $('loginBtn').disabled = true;
    fetch(API + '/api/room/' + encodeURIComponent(code) + '/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, code: code, password: pw, profileId: state.profileId })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        $('loginBtn').disabled = false;
        if (!res.ok) { $('loginErr').textContent = (res.j && res.j.error) || 'Không vào được phòng. Kiểm tra ID và mật khẩu.'; return; }
        state.roomCode = code;
        state.token = res.j.token;
        state.name = res.j.name || name;
        state.roomName = (res.j.room && res.j.room.name) || 'Kênh Band';
        state.cloudRoomId = res.j.cloudRoomId || code;
        save();
        try { history.replaceState({}, document.title, location.pathname); } catch (e) {}
        urlRoom = '';
        enterApp();
      }).catch(function () {
        $('loginBtn').disabled = false;
        $('loginErr').textContent = 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
      });
  }

  function logout(msg) {
    state.token = null;
    save();
    stopTimers();
    closePreview();
    showLogin(msg || '');
  }

  /* ---------------- thư viện (đồng bộ từ desktop) ---------------- */
  var library = [];
  var libUpdatedAt = 0;
  function loadLibrary(quiet) {
    var id = state.cloudRoomId || state.roomCode;
    // Bài do thành viên TẠO TRÊN WEB được lưu vào danh sách chung ngay (chưa cần duyệt) để ai cũng thêm
    // được vào setlist; operator duyệt lúc NẠP setlist. Khi đã duyệt, bài nằm trong thư viện desktop (có
    // webId) -> khử trùng theo webId để không hiện 2 lần.
    var libP = fetch(API + '/library?roomId=' + encodeURIComponent(id)).then(function (r) { return r.json(); });
    var webP = callRoom('/songs/web').then(function (r) { return (r.ok && Array.isArray(r.body.songs)) ? r.body.songs : []; }).catch(function () { return []; });
    return Promise.all([libP, webP]).then(function (res) {
      var j = res[0], web = res[1];
      var base = Array.isArray(j.songs) ? j.songs : [];
      var have = {}; base.forEach(function (s) { if (s.webId) have[s.webId] = 1; });
      var webSongs = web.filter(function (w) { return !have[w.webId]; }).map(function (w) {
        return { id: 'web:' + w.webId, webId: w.webId, title: w.title, lyrics: w.lyrics, style: {}, bg: null, isWeb: true, by: w.by, mine: w.mine };
      });
      library = webSongs.concat(base);
      library.forEach(function (s) { s._n = S.searchNorm(s.title + ' ' + (s.lyrics || '')); });
      libUpdatedAt = Number(j.updatedAt) || (webSongs.length ? Date.now() : 0);
      renderLibInfo();
      renderResults();
      renderDraft();
      if (!quiet) toast('Đã tải ' + library.length + ' bài từ máy chiếu.');
    }).catch(function () {
      if (!quiet) toast('Không tải được thư viện. Kiểm tra mạng.', 'err');
    });
  }
  function renderLibInfo() {
    var nWeb = library.filter(function (s) { return s.isWeb; }).length;
    var t = !libUpdatedAt ? 'Máy chiếu chưa đồng bộ thư viện'
      : library.length + ' bài' + (nWeb ? ' (' + nWeb + ' mới chờ duyệt)' : '') + ' · cập nhật ' + new Date(libUpdatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    $('libInfo').textContent = t;
  }
  function findSong(id) {
    for (var i = 0; i < library.length; i++) if (String(library[i].id) === String(id)) return library[i];
    if (String(id).indexOf('web:') === 0) {
      var wid = String(id).slice(4);
      for (var k = 0; k < library.length; k++) if (library[k].webId === wid) return library[k];
    }
    return null;
  }

  /* ---------------- tab Soạn setlist ---------------- */
  function renderDraft() {
    var ol = $('slDraft');
    ol.textContent = '';
    state.slDraft.forEach(function (it, i) {
      var li = el('li');
      var inLib = findSong(it.id);
      var t = el('span', 't', it.title);
      if (it.webId && inLib && inLib.isWeb) { var np2 = el('span', 'pill pending', 'Mới · duyệt khi nạp'); np2.style.marginLeft = '6px'; t.appendChild(np2); }
      if (!inLib && library.length) { t.appendChild(el('span', 'sub', it.webId ? ' — bài mới đã bị từ chối hoặc không còn' : ' — không còn trong thư viện')); }
      li.appendChild(t);
      [['👁', 'Xem slide', function () { openSongPreview(it.id); }, !inLib],
       ['↑', 'Lên', function () { moveDraft(i, -1); }, i === 0],
       ['↓', 'Xuống', function () { moveDraft(i, 1); }, i === state.slDraft.length - 1],
       ['×', 'Bỏ', function () { state.slDraft.splice(i, 1); save(); renderDraft(); renderResults(); }, false]
      ].forEach(function (b) {
        var btn = el('button', 'btn small', b[0]); btn.type = 'button'; btn.title = b[1]; btn.disabled = !!b[3];
        btn.addEventListener('click', b[2]); li.appendChild(btn);
      });
      ol.appendChild(li);
    });
    $('slEmpty').classList.toggle('hidden', state.slDraft.length > 0);
    $('slCount').textContent = state.slDraft.length ? '(' + state.slDraft.length + ' bài)' : '';
  }
  function moveDraft(i, d) {
    var j = i + d; if (j < 0 || j >= state.slDraft.length) return;
    var t = state.slDraft[i]; state.slDraft[i] = state.slDraft[j]; state.slDraft[j] = t;
    save(); renderDraft();
  }
  function inDraft(id) { return state.slDraft.some(function (x) { return String(x.id) === String(id); }); }

  function renderResults() {
    var box = $('slResults');
    box.textContent = '';
    var q = S.searchNorm($('slSearch').value.trim());
    if (!library.length) { box.appendChild(el('div', 'muted', libUpdatedAt ? 'Thư viện đang trống.' : 'Chưa có thư viện — mở phần mềm trên máy chiếu và đăng nhập Kênh Band để đồng bộ.')); return; }
    var hits = (q ? library.filter(function (s) { return s._n.indexOf(q) !== -1; }) : library.slice(0, 40)).slice(0, 40);
    if (!hits.length) { box.appendChild(el('div', 'muted', 'Không tìm thấy bài nào.')); return; }
    hits.forEach(function (s) {
      var row = el('div', 'res');
      var t = el('div', 't');
      var bt = el('b', null, s.title);
      if (s.isWeb) { var np = el('span', 'pill pending', 'Mới · chờ duyệt'); np.style.marginLeft = '6px'; bt.appendChild(np); }
      t.appendChild(bt);
      var first = S.splitSlides(s.lyrics)[0];
      t.appendChild(el('span', null, first ? S.stripChords(first.content).replace(/\s*\n\s*/g, ' / ').slice(0, 80) : ''));
      row.appendChild(t);
      var v = el('button', 'btn small', '👁'); v.type = 'button'; v.title = 'Xem slide';
      v.addEventListener('click', function () { openSongPreview(s.id); });
      var added = inDraft(s.id);
      var a = el('button', 'btn small' + (added ? '' : ' ok'), added ? 'Bỏ' : 'Thêm'); a.type = 'button';
      a.addEventListener('click', function () {
        if (added) state.slDraft = state.slDraft.filter(function (x) { return String(x.id) !== String(s.id); });
        else state.slDraft.push(s.isWeb ? { id: String(s.id), title: s.title, webId: s.webId } : { id: String(s.id), title: s.title });
        save(); renderDraft(); renderResults();
      });
      row.appendChild(v); row.appendChild(a);
      box.appendChild(row);
    });
  }

  // Gửi 1 setlist: đường có token của relay trước (máy chiếu mở thì nạp ngay; relay cũng lưu vào
  // lịch sử "Đã gửi"), không tới được máy chiếu -> hộp thư cloud. resendOf = id lịch sử của setlist
  // được gửi lại (id gửi đi luôn MỚI vì desktop khử trùng theo id).
  function deliverSetlist(sl, resendOf) {
    var body = { id: sl.id, name: sl.name, items: sl.items };
    if (resendOf) body.resendOf = resendOf;
    return callRoom('/setlist', { method: 'POST', body: body }).then(function (r) {
      if (r.ok && r.body && r.body.delivered) return { mode: 'live' };
      if (!r.ok && r.body && r.body.error && r.status < 500 && r.status !== 429) throw new Error(r.body.error);
      // Máy chiếu tắt / relay lỗi -> hộp thư cloud (tự nạp khi máy chiếu mở lại).
      return fetch(API + '/setlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: state.cloudRoomId || state.roomCode, setlist: { id: sl.id, name: sl.name, from: { name: state.name }, ts: Date.now(), items: sl.items } })
      }).then(function (r2) { return r2.ok ? { mode: 'mailbox' } : r2.json().then(function (j) { throw new Error(j.error || ('HTTP ' + r2.status)); }); });
    });
  }
  function newSetlistId() { return 'sl-' + Date.now().toString(16) + randHex(3); }
  function cleanItems(items) {
    return items.map(function (it) { return it.webId ? { type: 'song', id: String(it.id), title: it.title, webId: it.webId } : { type: 'song', id: String(it.id), title: it.title }; });
  }

  var sending = false;
  function sendSetlist() {
    if (sending) return;
    if (!state.slDraft.length) { setStatus('slStatus', 'Setlist đang trống.', 'err'); return; }
    sending = true; $('slSend').disabled = true;
    setStatus('slStatus', 'Đang gửi…', 'info');
    var sl = { id: newSetlistId(), name: $('slName').value.trim() || 'Setlist', items: cleanItems(state.slDraft) };
    deliverSetlist(sl, null).then(function (res) {
      state.slDraft = []; $('slName').value = ''; save(); renderDraft(); renderResults();
      setStatus('slStatus', (res.mode === 'live' ? 'Đã gửi — máy chiếu đang mở, setlist hiện ngay để người vận hành nạp.' : 'Đã gửi vào hộp thư — sẽ hiện khi máy chiếu mở Kênh Band.') + ' Xem lại ở tab “Đã gửi”.', 'ok');
      refreshSent(true);
    }).catch(function (e) {
      setStatus('slStatus', 'Gửi không thành công: ' + ((e && e.message) || 'lỗi mạng') + '. Setlist vẫn được giữ, thử lại nhé.', 'err');
    }).then(function () { sending = false; $('slSend').disabled = false; });
  }

  /* ---------------- tab Đã gửi (lịch sử setlist của phòng) ---------------- */
  var sentLists = [];
  var resending = {};
  function fmtTime(ts) { return new Date(ts).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function refreshSent(quiet) {
    return callRoom('/setlists/history').then(function (r) {
      if (!r.ok) { if (!quiet) setStatus('sentStatus', (r.body && r.body.error) || 'Không tải được danh sách đã gửi.', 'err'); return; }
      sentLists = Array.isArray(r.body.setlists) ? r.body.setlists : [];
      if (!quiet) setStatus('sentStatus', '');
      renderSent();
    }).catch(function () { if (!quiet) setStatus('sentStatus', 'Không kết nối được máy chủ.', 'err'); });
  }
  function renderSent() {
    var ul = $('sentList'); ul.textContent = '';
    sentLists.forEach(function (sl) {
      var li = el('li', 'sent-item');
      var head = el('div', 'sent-head');
      head.appendChild(el('b', null, sl.name));
      head.appendChild(el('span', 'muted small', sl.items.length + ' bài'));
      li.appendChild(head);
      var meta = 'Gửi bởi ' + (sl.by || '?') + ' · ' + fmtTime(sl.ts);
      if (sl.sendCount > 1) meta += ' · đã gửi ' + sl.sendCount + ' lần, gần nhất ' + fmtTime(sl.lastSentAt) + (sl.lastBy && sl.lastBy !== sl.by ? ' (' + sl.lastBy + ')' : '');
      li.appendChild(el('div', 'sent-meta', meta));
      var ol = el('ol', 'sent-songs');
      sl.items.forEach(function (it) {
        var li2 = el('li', null, it.title);
        if (library.length && !findSong(it.id)) { li2.className = 'gone'; li2.textContent = it.title + ' — không còn trong thư viện'; }
        ol.appendChild(li2);
      });
      li.appendChild(ol);
      var acts = el('div', 'sent-actions');
      var rs = el('button', 'btn small primary', resending[sl.id] ? 'Đang gửi…' : 'Gửi lại'); rs.type = 'button'; rs.disabled = !!resending[sl.id];
      rs.addEventListener('click', function () { resendSetlist(sl); });
      var ed = el('button', 'btn small', 'Mở để sửa'); ed.type = 'button';
      ed.addEventListener('click', function () { loadSentIntoDraft(sl); });
      acts.appendChild(rs); acts.appendChild(ed);
      if (sl.mine) {
        var del = el('button', 'btn small', 'Xoá'); del.type = 'button';
        del.addEventListener('click', function () { deleteSent(sl); });
        acts.appendChild(del);
      }
      li.appendChild(acts);
      ul.appendChild(li);
    });
    $('sentEmpty').classList.toggle('hidden', sentLists.length > 0);
    var b = $('sentBadge'); b.textContent = String(sentLists.length); b.classList.toggle('hidden', sentLists.length === 0);
  }
  function resendSetlist(sl) {
    if (resending[sl.id]) return;
    if (!window.confirm('Gửi lại setlist “' + sl.name + '” (' + sl.items.length + ' bài) cho người vận hành?')) return;
    resending[sl.id] = true; renderSent();
    setStatus('sentStatus', 'Đang gửi lại…', 'info');
    deliverSetlist({ id: newSetlistId(), name: sl.name, items: cleanItems(sl.items) }, sl.id).then(function (res) {
      setStatus('sentStatus', 'Đã gửi lại “' + sl.name + '” — ' + (res.mode === 'live' ? 'máy chiếu đang mở, setlist hiện ngay để người vận hành nạp.' : 'đã vào hộp thư, sẽ hiện khi máy chiếu mở Kênh Band.'), 'ok');
      return refreshSent(true);
    }).catch(function (e) {
      setStatus('sentStatus', 'Gửi lại không thành công: ' + ((e && e.message) || 'lỗi mạng') + '.', 'err');
    }).then(function () { delete resending[sl.id]; renderSent(); });
  }
  function loadSentIntoDraft(sl) {
    if (state.slDraft.length && !window.confirm('Thay danh sách đang soạn bằng setlist “' + sl.name + '”?')) return;
    state.slDraft = sl.items.map(function (it) { return it.webId ? { id: String(it.id), title: it.title, webId: it.webId } : { id: String(it.id), title: it.title }; });
    $('slName').value = sl.name;
    save(); renderDraft(); renderResults(); switchTab('setlist');
    setStatus('slStatus', 'Đã mở “' + sl.name + '” để sửa — chỉnh xong bấm “Gửi setlist”.', 'info');
  }
  function deleteSent(sl) {
    if (!window.confirm('Xoá “' + sl.name + '” khỏi danh sách đã gửi của phòng? (Không ảnh hưởng setlist đã nạp ở máy chiếu.)')) return;
    callRoom('/setlists/history/delete', { method: 'POST', body: { id: sl.id } }).then(function (r) {
      if (!r.ok && r.status !== 404) { setStatus('sentStatus', (r.body && r.body.error) || 'Không xoá được.', 'err'); return; }
      setStatus('sentStatus', 'Đã xoá.', 'ok');
      return refreshSent(true);
    }).catch(function () { setStatus('sentStatus', 'Lỗi mạng, chưa xoá được.', 'err'); });
  }

  /* ---------------- tab Bài mới ---------------- */
  var nsTimer = null;
  function renderNewSongSlides() {
    var norm = S.normalizeLyrics($('nsLyrics').value);
    var slides = S.splitSlides(norm);
    var strip = $('nsSlides');
    strip.textContent = '';
    if (!slides.length) strip.appendChild(el('div', 'slide-card empty', 'Các slide sẽ hiện ở đây khi bạn gõ lời.'));
    slides.forEach(function (sl, i) {
      var c = el('div', 'slide-card');
      c.appendChild(el('span', 'n', String(i + 1) + '.'));
      if (sl.label) c.appendChild(el('span', 'lb', sl.label));
      c.appendChild(document.createTextNode((sl.label ? '\n' : '') + (sl.content || '(slide trống)')));
      strip.appendChild(c);
    });
    var len = norm.length;
    $('nsCount').textContent = len + ' / ' + S.LYRICS_MAX + ' ký tự';
    $('nsCount').style.color = len > S.LYRICS_MAX ? '#c0392f' : '';
    $('nsSlideCount').textContent = slides.length + ' slide';
    state.nsTitle = $('nsTitle').value; state.nsLyrics = $('nsLyrics').value; save();
  }
  function onNewSongInput() { clearTimeout(nsTimer); nsTimer = setTimeout(renderNewSongSlides, 150); }

  var creating = false;
  function createSong() {
    if (creating) return;
    var title = S.normalizeTitle($('nsTitle').value);
    var lyrics = S.normalizeLyrics($('nsLyrics').value);
    if (!title) { setStatus('nsStatus', 'Vui lòng nhập tên bài hát.', 'err'); $('nsTitle').focus(); return; }
    if (!lyrics) { setStatus('nsStatus', 'Vui lòng nhập lời bài hát.', 'err'); $('nsLyrics').focus(); return; }
    if (lyrics.length > S.LYRICS_MAX) { setStatus('nsStatus', 'Lời quá dài (tối đa ' + S.LYRICS_MAX + ' ký tự, hiện ' + lyrics.length + ').', 'err'); return; }
    // webId giữ nguyên khi gửi lại CÙNG nội dung (mạng chập chờn -> relay chống trùng);
    // đổi nội dung thì phải là bài mới -> webId mới.
    var hash = title + '\u0001' + lyrics;
    if (!state.nsWebId || state.nsHash !== hash) { state.nsWebId = S.newWebId(); state.nsHash = hash; save(); }
    creating = true; $('nsCreate').disabled = true;
    setStatus('nsStatus', 'Đang gửi…', 'info');
    callRoom('/song-submit', { method: 'POST', body: { webId: state.nsWebId, title: title, lyrics: lyrics } }).then(function (r) {
      if (!r.ok) { setStatus('nsStatus', (r.body && r.body.error) || ('Không gửi được (HTTP ' + r.status + ')'), 'err'); return; }
      state.nsWebId = null; state.nsHash = null; state.nsTitle = ''; state.nsLyrics = '';
      $('nsTitle').value = ''; $('nsLyrics').value = ''; save(); renderNewSongSlides();
      setStatus('nsStatus', r.body.duplicate ? 'Bài này đã được lưu trước đó.' : 'Đã lưu vào danh sách! Hãy thêm bài vào setlist — người vận hành sẽ duyệt khi nạp setlist.', 'ok');
      refreshMySongs();
      loadLibrary(true);
    }).catch(function () {
      setStatus('nsStatus', 'Lỗi mạng — bài vẫn còn trong ô nhập, bấm gửi lại được (không bị trùng).', 'err');
    }).then(function () { creating = false; $('nsCreate').disabled = false; });
  }

  /* ---------------- Bài của tôi ---------------- */
  var mySongs = [];
  var knownStatus = {};
  var myTimer = null;
  var STATUS_TXT = { pending: 'Chưa duyệt (duyệt khi nạp setlist)', approved: 'Đã vào thư viện máy chiếu', rejected: 'Bị từ chối' };
  function refreshMySongs() {
    return callRoom('/songs/mine').then(function (r) {
      if (!r.ok) return;
      mySongs = (r.body.songs || []).slice().sort(function (a, b) { return b.ts - a.ts; });
      var libDirty = false;
      mySongs.forEach(function (s) {
        var prev = knownStatus[s.webId];
        if (prev && prev !== s.status) {
          if (s.status === 'approved') { toast('Bài “' + s.title + '” đã được người vận hành duyệt và vào thư viện máy chiếu.'); libDirty = true; }
          if (s.status === 'rejected') toast('Bài “' + s.title + '” bị từ chối' + (s.reason ? ': ' + s.reason : '.'), 'err');
        }
        knownStatus[s.webId] = s.status;
      });
      renderMySongs();
      if (libDirty) setTimeout(function () { loadLibrary(true); }, 4000); // chờ desktop đẩy thư viện lên cloud (debounce ~3s)
      schedulePoll();
    }).catch(function () {});
  }
  function renderMySongs() {
    var ul = $('mySongs'); ul.textContent = '';
    var pending = mySongs.filter(function (s) { return s.status === 'pending'; }).length;
    mySongs.forEach(function (s) {
      var li = el('li');
      var t = el('div', 't');
      t.appendChild(el('b', null, s.title));
      t.appendChild(el('div', 'sub', s.slides + ' slide' + (s.status === 'rejected' && s.reason ? ' · Lý do: ' + s.reason : '')));
      li.appendChild(t);
      li.appendChild(el('span', 'pill ' + s.status, STATUS_TXT[s.status] || s.status));
      if (s.status !== 'rejected') {
        var inSl = state.slDraft.some(function (x) { return x.webId === s.webId; });
        var add = el('button', 'btn small', inSl ? 'Đã trong setlist' : '+ Thêm vào setlist'); add.type = 'button'; add.disabled = inSl;
        add.addEventListener('click', function () {
          state.slDraft.push({ id: 'web:' + s.webId, title: s.title, webId: s.webId });
          save(); renderDraft(); renderResults(); renderMySongs(); switchTab('setlist');
          toast('Đã thêm “' + s.title + '” vào setlist.');
        });
        li.appendChild(add);
      }
      ul.appendChild(li);
    });
    $('mySongsEmpty').classList.toggle('hidden', mySongs.length > 0);
    var b = $('pendingBadge'); b.textContent = String(pending); b.classList.toggle('hidden', pending === 0);
  }
  function schedulePoll() {
    clearTimeout(myTimer);
    var hasPending = mySongs.some(function (s) { return s.status === 'pending'; });
    if (!hasPending || !state.token) return;
    myTimer = setTimeout(function () { if (!document.hidden) refreshMySongs(); else schedulePoll(); }, 8000);
  }

  /* ---------------- xem trước slide ---------------- */
  var pv = { slides: [], idx: 0, style: S.resolveStyle(null), title: '', bgId: null };
  var backgrounds = [];   // [{id,name}]

  function safeFamily(f) { return /^[\w \-.À-ɏ]{1,60}$/.test(f) ? f : 'CMG Sans'; }

  function fitText() {
    var box = $('pvBox'), text = $('pvText'), st = pv.style;
    var base = st.fontSize, size = base, min = Math.max(8, Math.min(base, 10));
    var fam = safeFamily(st.fontFamily);
    text.style.fontFamily = '"' + fam + '", "CMG Sans", sans-serif';
    text.style.color = st.color;
    text.style.textAlign = st.textAlign;
    text.style.webkitTextStroke = st.textStrokeWidth + 'px ' + st.textStrokeColor;
    box.style.top = ''; box.style.bottom = ''; box.style.transform = '';
    if (st.verticalAlign === 'top') box.style.top = '43px';
    else if (st.verticalAlign === 'bottom') box.style.bottom = '43px';
    else { box.style.top = '50%'; box.style.transform = 'translateY(-50%)'; }
    // Vòng giảm cỡ chữ y hệt live.html: giảm 1px tới khi vừa khung 864x454 (stroke co theo).
    for (;;) {
      text.style.fontSize = size + 'px';
      text.style.webkitTextStroke = Math.round(st.textStrokeWidth * size / base) + 'px ' + st.textStrokeColor;
      if (box.scrollHeight <= 454 || size <= min) break;
      size -= 1;
    }
  }
  function scaleStage() {
    var stage = $('pvStage');
    var s = stage.clientWidth / 960;
    $('pvCanvas').style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  function renderSlide() {
    var n = pv.slides.length;
    if (!n) { $('pvText').textContent = ''; $('pvLabel').textContent = 'Chưa có slide'; $('pvPrev').disabled = $('pvNext').disabled = true; return; }
    pv.idx = Math.max(0, Math.min(pv.idx, n - 1));
    var sl = pv.slides[pv.idx];
    $('pvText').textContent = S.stripChords(sl.content);
    $('pvLabel').textContent = (sl.label ? sl.label + ' · ' : '') + (pv.idx + 1) + ' / ' + n;
    $('pvPrev').disabled = pv.idx === 0; $('pvNext').disabled = pv.idx === n - 1;
    scaleStage(); fitText();
  }
  function setBackground(id) {
    pv.bgId = id || null;
    state.bgId = pv.bgId; save();
    var img = $('pvBg');
    if (!pv.bgId) { img.classList.add('hidden'); img.removeAttribute('src'); }
    else {
      img.onerror = function () { img.classList.add('hidden'); toast('Không tải được ảnh nền này.', 'err'); };
      img.onload = function () { img.classList.remove('hidden'); };
      img.src = API + '/backgrounds/image/' + encodeURIComponent(state.roomCode) + '/' + encodeURIComponent(pv.bgId);
    }
    Array.prototype.forEach.call($('bgGrid').children, function (b) { b.classList.toggle('sel', (b.dataset.id || '') === (pv.bgId || '')); });
  }
  function renderBgGrid() {
    var sec = $('bgSection'), grid = $('bgGrid');
    grid.textContent = '';
    if (!backgrounds.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    $('bgCount').textContent = backgrounds.length + ' ảnh từ máy chiếu';
    var none = el('button', 'bg-item', null); none.type = 'button'; none.dataset.id = '';
    none.appendChild(el('span', null, 'Nền đen')); none.addEventListener('click', function () { setBackground(null); });
    grid.appendChild(none);
    backgrounds.forEach(function (b) {
      var btn = el('button', 'bg-item'); btn.type = 'button'; btn.dataset.id = b.id; btn.title = b.name;
      var im = el('img'); im.loading = 'lazy'; im.alt = b.name;
      im.src = API + '/backgrounds/image/' + encodeURIComponent(state.roomCode) + '/' + encodeURIComponent(b.id);
      btn.appendChild(im); btn.appendChild(el('span', null, b.name));
      btn.addEventListener('click', function () { setBackground(b.id); });
      grid.appendChild(btn);
    });
  }
  function loadBackgrounds() {
    return callRoom('/backgrounds').then(function (r) {
      backgrounds = (r.ok && Array.isArray(r.body.items)) ? r.body.items : [];
      renderBgGrid();
    }).catch(function () {});
  }

  function openPreview(title, lyrics, style, preferredBgName) {
    pv.title = title; pv.slides = S.splitSlides(lyrics); pv.idx = 0; pv.style = S.resolveStyle(style);
    $('pvTitle').textContent = 'Xem trước: ' + (title || 'Bài mới');
    var fam = pv.style.fontFamily;
    $('pvNote').textContent = (fam && fam !== 'CMG Sans' ? 'Phông “' + fam + '” có thể hiển thị khác trên máy chiếu thật. ' : '') + 'Chỉ để ước lượng bố cục; màn chiếu thật có thể khác đôi chút.';
    $('pv').classList.remove('hidden');
    // Nền: ưu tiên nền mà bài này đang dùng ở máy chiếu, rồi tới nền người dùng chọn lần trước.
    var pick = null;
    if (preferredBgName) { var m = backgrounds.filter(function (b) { return b.name === preferredBgName; })[0]; if (m) pick = m.id; }
    if (!pick && state.bgId && backgrounds.some(function (b) { return b.id === state.bgId; })) pick = state.bgId;
    setBackground(pick);
    renderBgGrid();
    setBackground(pick);
    renderSlide();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('bold 80px "CMG Sans"').then(function () { if (!$('pv').classList.contains('hidden')) renderSlide(); }).catch(function () {});
    }
  }
  function openSongPreview(id) {
    var s = findSong(id);
    if (!s) { toast('Bài này không còn trong thư viện.', 'err'); return; }
    openPreview(s.title, s.lyrics || '', s.style, s.bg);
  }
  function closePreview() { $('pv').classList.add('hidden'); }

  /* ---------------- khởi động / giao diện ---------------- */
  var libTimer = null;
  function stopTimers() { clearInterval(libTimer); clearTimeout(myTimer); libTimer = null; }
  function enterApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('roomName').textContent = state.roomName || 'Kênh Band';
    $('whoami').textContent = state.name ? '· ' + state.name : '';
    $('nsTitle').value = state.nsTitle || '';
    $('nsLyrics').value = state.nsLyrics || '';
    renderNewSongSlides();
    renderDraft();
    renderResults();
    loadLibrary(true);
    loadBackgrounds();
    refreshMySongs();
    refreshSent(true);
    // Thư viện tự làm mới: bài vừa tạo/sửa ở máy tính hiện lên đây không cần F5.
    clearInterval(libTimer);
    libTimer = setInterval(function () { if (!document.hidden && state.token) loadLibrary(true); }, 60000);
  }

  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    $('tab-setlist').classList.toggle('hidden', name !== 'setlist');
    $('tab-sent').classList.toggle('hidden', name !== 'sent');
    $('tab-newsong').classList.toggle('hidden', name !== 'newsong');
    if (name === 'newsong') refreshMySongs();
    if (name === 'sent') refreshSent(false);
  }

  $('loginBtn').addEventListener('click', doLogin);
  ['roomCode', 'roomPassword', 'yourName'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); }); });
  $('logoutBtn').addEventListener('click', function () { logout(''); });
  $('sentRefresh').addEventListener('click', function () { refreshSent(false); });
  $('libRefresh').addEventListener('click', function () { loadLibrary(false); loadBackgrounds(); });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.addEventListener('click', function () { switchTab(t.dataset.tab); }); });
  $('slSearch').addEventListener('input', renderResults);
  $('slSend').addEventListener('click', sendSetlist);
  $('nsTitle').addEventListener('input', onNewSongInput);
  $('nsLyrics').addEventListener('input', onNewSongInput);
  $('nsCreate').addEventListener('click', createSong);
  $('nsPreview').addEventListener('click', function () {
    var lyrics = S.normalizeLyrics($('nsLyrics').value);
    if (!lyrics) { setStatus('nsStatus', 'Hãy nhập lời trước khi xem trước.', 'err'); return; }
    openPreview($('nsTitle').value.trim(), lyrics, null, null);
  });
  $('pvClose').addEventListener('click', closePreview);
  $('pv').addEventListener('click', function (e) { if (e.target === $('pv')) closePreview(); });
  $('pvPrev').addEventListener('click', function () { pv.idx--; renderSlide(); });
  $('pvNext').addEventListener('click', function () { pv.idx++; renderSlide(); });
  document.addEventListener('keydown', function (e) {
    if ($('pv').classList.contains('hidden')) return;
    if (e.key === 'Escape') closePreview();
    else if (e.key === 'ArrowLeft') { pv.idx--; renderSlide(); }
    else if (e.key === 'ArrowRight') { pv.idx++; renderSlide(); }
  });
  window.addEventListener('resize', function () { if (!$('pv').classList.contains('hidden')) { scaleStage(); fitText(); } });

  // Mở bằng link có ?room= -> LUÔN bắt nhập mật khẩu (giống phone: ID phòng nằm trong
  // link/QR nên không đủ làm bằng chứng đã được vào phòng).
  // Đi từ nút "📋 Setlist" của trang /m/ (không có ?room=): dùng lại phiên đã đăng nhập ở
  // đó (cùng origin) để không bắt nhập mật khẩu lần nữa. Token vẫn được relay kiểm tra
  // (/whoami) — hết hạn/bị thu hồi thì về màn đăng nhập.
  function adoptPhoneSession() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PHONE_LS_KEY) || 'null'); } catch (e) { p = null; }
    if (!p || !p.token || !p.roomCode) return false;
    state.roomCode = String(p.roomCode).toUpperCase();
    state.token = p.token;
    state.name = p.name || state.name;
    state.roomName = p.roomName || 'Kênh Band';
    state.cloudRoomId = p.cloudRoomId || state.roomCode;
    if (p.profileId) state.profileId = p.profileId;
    save();
    return true;
  }
  function resume(allowAdopt) {
    if (!(state.token && state.roomCode)) {
      if (allowAdopt && adoptPhoneSession()) return resume(false);
      return showLogin('');
    }
    callRoom('/whoami').then(function (r) {
      if (r.ok) return enterApp();
      state.token = null; save();
      if (allowAdopt && adoptPhoneSession()) return resume(false);
      showLogin('');
    }).catch(function () { showLogin('Không kết nối được máy chủ.'); });
  }
  if (urlRoom) { state.token = null; save(); showLogin(''); }
  else resume(true);
})();
