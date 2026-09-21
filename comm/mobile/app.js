/* Kênh Band — mobile client. Vanilla JS, no build, no CDN.
   GĐ2 (band-comm-plan.md §14): phục vụ từ cloud (Cloudflare Worker
   MOBILE_ASSETS, path /m/) thay vì LAN server trên máy operator. Downstream:
   WebSocket thẳng tới Durable Object relay tại
   CLOUD_API_BASE + '/api/room/<ROOM_CODE>/ws'. Upstream: fetch POST /
   WS message tới CÙNG base — không còn khái niệm "server LAN" hay path
   tương đối nữa, ROOM_CODE (ID phòng, gõ/quét lúc join) xác định đúng phòng
   thay vì domain/IP như LAN cũ.
   No severity anywhere — every incoming message is handled the same way;
   only DIRECTION (band vs operator) changes the colour. */

(function () {
  'use strict';

  var LS_KEY = 'bandcomm.v1';
  // Cùng 1 Worker phục vụ CẢ trang này (mount /m/) LẪN toàn bộ API/relay —
  // xem cloud/worker/src/worker.js + room-relay.js.
  var CLOUD_API_BASE = 'https://channel.worship-official.link';

  var state = loadState();
  var ws = null;
  var lastId = state.lastId || null;  // persist qua reload — tránh replay ring buffer khi mố lại trang
  var reconnTimer = null;
  var reconnDelay = 1000;
  var pingTimer = null;
  var toastQueue = [];
  var toastShowing = false;
  var editingId = null;
  var saveLastIdTimer = null;  // debounce ghi localStorage


  var $ = function (id) { return document.getElementById(id); };

  function loadState() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { s = {}; }
    if (!s.profileId) {
      var _buf = new Uint8Array(8);
      crypto.getRandomValues(_buf);
      s.profileId = 'p-' + Array.prototype.map.call(_buf, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    if (!Array.isArray(s.buttons)) s.buttons = [];
    if (typeof s.sound !== 'boolean') s.sound = true;
    if (typeof s.vibrate !== 'boolean') s.vibrate = true;
    if (!Array.isArray(s.slDraft)) s.slDraft = [];
    return s;
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ID phòng — biết TRƯỚC khi join (gõ tay hoặc ?room= trong link/QR), khác
  // hẳn state.cloudRoomId (chỉ biết SAU khi join, dùng cho gallery/setlist
  // cloud-queue cũ, không đổi). roomUrl()/roomWsBase() dùng CHUNG cho mọi
  // request/WS sau khi đã xác định đúng phòng.
  function currentRoomCode() {
    return (state.roomCode || '').trim().toUpperCase();
  }
  function roomUrl(path) {
    return CLOUD_API_BASE + '/api/room/' + encodeURIComponent(currentRoomCode()) + path;
  }
  function roomWsUrl(path) {
    return CLOUD_API_BASE.replace(/^http/, 'ws') + '/api/room/' + encodeURIComponent(currentRoomCode()) + path;
  }

  /* ---------------- join ---------------- */
  var urlParams = new URLSearchParams(location.search);
  var urlRoomCode = (urlParams.get('room') || urlParams.get('r') || '').trim().toUpperCase();
  var forceLogin = urlParams.has('login') || urlParams.has('logout');

  // Quy tắc bảo mật: Mọi trường hợp truy cập qua link hoặc quét mã QR (có ?room=... hoặc ?r=...)
  // đều BẮT BUỘC phải nhập mật khẩu phòng, không tự động vượt qua mật khẩu.
  if (urlRoomCode) {
    state.token = null;
    state.clientId = null;
    state.roomCode = urlRoomCode;
    saveState();
  } else if (forceLogin) {
    state.token = null;
    state.clientId = null;
    saveState();
  }

  // Điền sẵn ID phòng và Tên nếu có
  if ($('name') && state.name) $('name').value = state.name;
  if ($('roomCode')) {
    var initialCode = urlRoomCode || currentRoomCode();
    if (initialCode) $('roomCode').value = initialCode;
  }
  if ($('roomPassword')) $('roomPassword').value = '';

  if ($('joinBtn')) $('joinBtn').addEventListener('click', doJoin);
  ['roomCode', 'roomPassword', 'name'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  });

  // Nút "mắt" hiện/ẩn mật khẩu
  Array.prototype.forEach.call(document.querySelectorAll('.pwd-toggle'), function (btn) {
    btn.addEventListener('click', function () {
      var input = $(btn.getAttribute('data-target'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    });
  });

  function doJoin() {
    var name = ($('name') ? $('name').value : '').trim();
    var code = ($('roomCode') ? $('roomCode').value : '').trim().toUpperCase();
    var password = ($('roomPassword') ? $('roomPassword').value : '').trim();
    $('joinErr').textContent = '';
    if (!name) {
      $('joinErr').textContent = 'Vui lòng nhập tên của bạn.';
      if ($('name')) $('name').focus();
      return;
    }
    if (!code || !/^[A-Z0-9]{4,10}$/.test(code)) {
      $('joinErr').textContent = 'ID phòng gồm 4–10 ký tự chữ/số.';
      if ($('roomCode')) $('roomCode').focus();
      return;
    }
    if (!password || !/^[a-zA-Z0-9]{4,12}$/.test(password)) {
      $('joinErr').textContent = 'Vui lòng nhập mật khẩu phòng (4–12 ký tự).';
      if ($('roomPassword')) $('roomPassword').focus();
      return;
    }
    $('joinBtn').disabled = true;
    state.roomCode = code;

    fetch(roomUrl('/join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, code: code, password: password, profileId: state.profileId })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) {
        $('joinErr').textContent = res.j && res.j.error ? res.j.error : 'Không vào được phòng. Vui lòng kiểm tra ID và Mật khẩu.';
        return;
      }
      finalizeJoin(res.j, name);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy chủ phòng. Kiểm tra kết nối mạng (Wi-Fi/4G).';
    });
  }

  function finalizeJoin(j, fallbackName) {
    state.token = j.token;
    state.clientId = j.clientId;
    state.name = j.name || fallbackName;
    state.roomName = (j.room && j.room.name) || 'Kênh Band';
    state.operatorReplies = j.operatorReplies || [];
    state.cloudRoomId = j.cloudRoomId || '';
    $('slToggleBtn').hidden = !j.setlistEnabled;
    if ((!state.buttons || !state.buttons.length) && j.profile && j.profile.buttons && j.profile.buttons.length) {
      state.buttons = j.profile.buttons;
    }
    saveState();
    try { window.history.replaceState({}, document.title, location.pathname); } catch (e) {}
    enterMain();
    if (j.gallery) renderChords(j.gallery);
  }

  /* ---------------- main ---------------- */

  function leaveRoom() {
    if (ws) {
      try { ws.onclose = null; ws.close(); } catch (e) {}
      ws = null;
    }
    if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    state.token = null;
    state.clientId = null;
    saveState();
    setDot('');
    $('main').classList.add('hidden');
    $('join').classList.remove('hidden');
    $('joinErr').textContent = '';
    $('joinInfo').textContent = '';
    if ($('roomPassword')) $('roomPassword').value = '';
    var code = currentRoomCode() || urlRoomCode;
    if (code && $('roomCode')) $('roomCode').value = code;
  }

  function enterMain() {
    $('join').classList.add('hidden');
    $('main').classList.remove('hidden');
    $('roomName').textContent = state.roomName || 'Kênh Band';
    renderButtons();
    connect();
    startPing();
    // Phiên resume qua token đã lưu (bỏ qua finalizeJoin() nên bỏ luôn phần
    // renderChords(j.gallery) chỉ nằm ở đó) — tự fetch lại gallery ở đây để
    // nút "🎼 Hợp âm" không bị kẹt ở trạng thái hidden mặc định trong HTML.
    fetch(roomUrl('/gallery?token=' + encodeURIComponent(state.token || '')))
      .then(function (r) { return r.json(); })
      .then(function (manifest) { renderChords(manifest); })
      .catch(function () {});
  }

  function connect() {
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; }
    setDot('');
    var url = roomWsUrl('/ws?token=' + encodeURIComponent(state.token) +
              (lastId ? '&since=' + encodeURIComponent(lastId) : ''));
    try { ws = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () { setDot('on'); reconnDelay = 1000; };
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg) return;
      if (msg.kind === 'pong') return;
      if (msg.kind !== 'envelope' || !msg.envelope) return;
      var env = msg.envelope;
      if (env.id && env.type !== 'presence') {
        lastId = env.id;
        state.lastId = lastId;   // persist: có hiệu lực qua reload/reconnect
        // Debounce ghi localStorage — nhiều messages đến liên tục chỉ ghi 1 lần
        clearTimeout(saveLastIdTimer);
        saveLastIdTimer = setTimeout(saveState, 500);
      }
      handleEnvelope(env);
    };
    ws.onerror = function () { /* onclose fires right after */ };
    ws.onclose = function () {
      setDot('off');
      ws = null;
      scheduleReconnect();
    };
  }

  // WebSocket has no auto-retry. Back off, and re-check the token each attempt
  // (a dead token -> bounce to the join screen; still offline -> keep backing off).
  function scheduleReconnect() {
    if (reconnTimer) return;
    reconnTimer = setTimeout(function () {
      reconnTimer = null;
      reconnDelay = Math.min(reconnDelay * 2, 10000);
      fetch(roomUrl('/whoami?token=' + encodeURIComponent(state.token || '')))
        .then(function (r) {
          if (r.status === 401) { state.token = null; saveState(); location.reload(); return; }
          connect();
        })
        .catch(function () { scheduleReconnect(); });
    }, reconnDelay);
  }

  // Giữ kết nối WS sống qua NAT/carrier hay ngắt idle — gửi ping NGAY TRÊN
  // WEBSOCKET đang mở (không phải HTTP POST riêng như LAN cũ), khớp
  // kind:'ping' -> kind:'pong' phía room-relay.js.
  function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ kind: 'ping' })); } catch (e) {} }
    }, 10000);
  }

  function setDot(cls) {
    $('dot').className = 'dot' + (cls ? ' ' + cls : '');
  }

  function handleEnvelope(env) {
    if (!env || !env.type) return;
    if (env.type === 'presence') {
      var list = (env.meta && env.meta.clients) || [];
      $('count').textContent = list.length + ' người';
      return;
    }
    if (env.type === 'system') { return; }
    if (env.type === 'gallery') { renderChords(env.meta || {}); return; }
    if (env.type === 'room') {
      // Dự phòng — room-relay.js hiện chưa phát loại envelope này (setlistEnabled
      // luôn true, không còn phụ thuộc Named Tunnel như LAN cũ nên không cần
      // báo đổi giữa chừng nữa), giữ lại nhánh xử lý phòng khi cần dùng lại sau.
      if (env.meta && typeof env.meta.setlistEnabled === 'boolean') {
        $('slToggleBtn').hidden = !env.meta.setlistEnabled;
      }
      return;
    }

    var mine = env.from && env.from.clientId === state.clientId;
    var label = env.meta && env.meta.label ? env.meta.label : '';
    if (env.type === 'alert') {
      if (mine) { markSent(env.buttonId, env.text); return; }
      // another member's alert — the whole text IS a button label -> bold it
      toast('band', env.from.name, '', env.text);
    } else if (env.type === 'ack') {
      // "Người vận hành đã tiếp nhận <label>" with the label in bold
      if (label) toast('op', 'Người chiếu máy', 'Người vận hành đã tiếp nhận ', label);
      else toast('op', 'Người chiếu máy', env.text);
    } else if (env.type === 'text') {
      toast('op', 'Người chiếu máy', env.text);
    }
  }

  /* ---------------- toast (2s, no persistent feed) ---------------- */

  // toast(kind, who, text, bold?) — `bold` is appended inside <strong>.
  // operator messages stay up longer (3s) and use a bolder colour.
  function toast(kind, who, text, bold) {
    toastQueue.push({ kind: kind, who: who, text: text || '', bold: bold || '', dur: kind === 'op' ? 3000 : 2000 });
    if (state.vibrate && navigator.vibrate) { try { navigator.vibrate(kind === 'op' ? [30, 40, 30] : 30); } catch (e) {} }
    if (state.sound) beep();
    pumpToast();
  }
  function pumpToast() {
    if (toastShowing || !toastQueue.length) return;
    toastShowing = true;
    var t = toastQueue.shift();
    var el = document.createElement('div');
    el.className = 'toast ' + t.kind;
    var w = document.createElement('div'); w.className = 'who'; w.textContent = t.who || '';
    var b = document.createElement('div'); b.className = 'body';
    if (t.text) b.appendChild(document.createTextNode(t.text));
    if (t.bold) { var s = document.createElement('strong'); s.textContent = t.bold; b.appendChild(s); }
    if (t.who) el.appendChild(w);
    el.appendChild(b);
    $('toasts').appendChild(el);
    var kill = function () {
      if (!el.parentNode) return;
      el.parentNode.removeChild(el);
      toastShowing = false;
      setTimeout(pumpToast, 120);
    };
    el.addEventListener('click', kill);
    setTimeout(kill, t.dur || 2000);
  }

  var audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.frequency.value = 660;
      g.gain.value = 0.04;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.12);
    } catch (e) {}
  }

  /* ---------------- personal buttons ---------------- */

  var editMode = false;
  $('editModeBtn').addEventListener('click', function () {
    editMode = !editMode;
    $('editModeBtn').textContent = editMode ? 'Xong' : 'Sửa';
    renderButtons();
  });

  function renderButtons() {
    var wrap = $('buttons');
    wrap.textContent = '';

    // "Tạo nút" first, at the top of the list.
    var addGrid = document.createElement('div');
    addGrid.className = 'grid';
    var add = document.createElement('button');
    add.className = 'qbtn add';
    add.textContent = 'Tạo nút';
    add.addEventListener('click', function () { openEditor(null); });
    addGrid.appendChild(add);
    wrap.appendChild(addGrid);

    var groups = {};
    var order = [];
    state.buttons.forEach(function (b) {
      var g = b.group || '';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(b);
    });
    order.forEach(function (g) {
      if (g) {
        var gl = document.createElement('div');
        gl.className = 'group-label';
        gl.textContent = g;
        wrap.appendChild(gl);
      }
      var grid = document.createElement('div');
      grid.className = 'grid';
      grid.style.marginTop = '8px';
      groups[g].forEach(function (b) { grid.appendChild(buttonTile(b)); });
      wrap.appendChild(grid);
    });
  }

  function buttonTile(b) {
    var el = document.createElement('button');
    el.className = 'qbtn';
    el.dataset.id = b.id;
    el.textContent = b.label;
    el.addEventListener('click', function () {
      if (editMode) { openEditor(b); return; }
      sendButton(b, el);
    });
    return el;
  }

  // Gửi qua CHÍNH WebSocket đang mở (không còn HTTP POST /api/message riêng —
  // room-relay.js nhận alert trực tiếp qua kind:'message' trên WS) — 'sent'
  // là optimistic (đã đưa được vào socket), phần xác nhận thật đến từ chính
  // echo envelope quay lại (xem handleEnvelope's markSent()).
  function sendButton(b, el) {
    el.classList.remove('failed');
    if (!ws || ws.readyState !== WebSocket.OPEN) { flash(el, 'failed'); return; }
    try {
      ws.send(JSON.stringify({ kind: 'message', buttonId: b.id, text: b.label }));
      flash(el, 'sent');
    } catch (e) {
      flash(el, 'failed');
    }
  }

  function markSent(buttonId, text) {
    var el = buttonId && document.querySelector('.qbtn[data-id="' + cssEsc(buttonId) + '"]');
    if (el) flash(el, 'sent');
  }

  function flash(el, cls) {
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, cls === 'failed' ? 2500 : 1200);
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* ---------------- editor sheet ---------------- */

  function openEditor(b) {
    editingId = b ? b.id : null;
    $('editorTitle').textContent = b ? 'Sửa nút' : 'Tạo nút';
    $('edLabel').value = b ? b.label : '';
    $('edGroup').value = b ? (b.group || '') : '';
    $('edDelete').classList.toggle('hidden', !b);
    $('editor').classList.remove('hidden');
    $('edLabel').focus();
  }
  function closeEditor() { $('editor').classList.add('hidden'); editingId = null; }

  $('edCancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('click', function (e) { if (e.target === $('editor')) closeEditor(); });
  $('edDelete').addEventListener('click', function () {
    state.buttons = state.buttons.filter(function (x) { return x.id !== editingId; });
    persistButtons();
    closeEditor();
  });
  $('edSave').addEventListener('click', function () {
    var label = $('edLabel').value.trim();
    if (!label) { $('edLabel').focus(); return; }
    var group = $('edGroup').value.trim();
    if (editingId) {
      state.buttons = state.buttons.map(function (x) {
        return x.id === editingId ? { id: x.id, label: label, group: group } : x;
      });
    } else {
      state.buttons.push({ id: 'b-' + Math.random().toString(16).slice(2, 10), label: label, group: group });
    }
    persistButtons();
    closeEditor();
  });

  function persistButtons() {
    saveState();
    renderButtons();
    fetch(roomUrl('/profile?token=' + encodeURIComponent(state.token || '')), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: state.profileId, buttons: state.buttons })
    }).catch(function () {});
  }

  /* ---------------- chord-sheet gallery ---------------- */

  var chIds = [];
  var chImgs = [];
  var chUpdatedAt = 0;
  var chOpen = false;           // người xem đã bấm "Xem hợp âm" chưa

  function renderChords(manifest) {
    var imgs = (manifest && manifest.images) || [];
    var ids = imgs.map(function (x) { return x.id; });
    var force = ids.join(',') !== chIds.join(',');
    chIds = ids;
    chImgs = imgs;
    chUpdatedAt = (manifest && manifest.updatedAt) || chUpdatedAt;
    updateChToggle();
    var sec = $('chords'), track = $('chTrack') || $('chView'), dots = $('chDots');
    // Ảnh KHÔNG tự hiện: người xem phải bấm "🎼 Hợp âm" để mở section ra —
    // luôn cho mở kể cả thư viện trống, vì ai cũng thêm ảnh được nên cần
    // thấy nút "+ Thêm ảnh" để bắt đầu, không còn khái niệm "chưa bật".
    if (!chOpen) { sec.classList.add('hidden'); if (force) { track.textContent = ''; dots.textContent = ''; } return; }
    sec.classList.remove('hidden');
    if (!force) return;
    track.textContent = ''; dots.textContent = '';
    imgs.forEach(function (item, i) {
      var id = item.id;
      var wrap = document.createElement('div');
      wrap.className = 'ch-slide';
      var im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = 'Hợp âm ' + (i + 1);
      // Ảnh lưu thẳng lên R2 lúc thêm (xem room-relay.js's handleGalleryAdd) —
      // không còn "server local" nào để rớt về nữa, chỉ 1 nguồn duy nhất.
      im.src = CLOUD_API_BASE + '/gallery/image/' + encodeURIComponent(state.cloudRoomId) + '/' + encodeURIComponent(id);
      wrap.appendChild(im);
      // Chỉ chủ ảnh (ownerId === profileId của chính điện thoại này, ổn định
      // qua các lần join lại) mới thấy nút Xoá — ai cũng thêm được nhưng chỉ
      // tự xoá ảnh mình đăng, tránh 1 người xoá nhầm/cố ý ảnh người khác.
      if (item.ownerId && item.ownerId === state.profileId) {
        var rm = document.createElement('button');
        rm.type = 'button'; rm.textContent = 'Xoá';
        rm.style.cssText = 'position:absolute;top:6px;right:6px;background:#c0392f;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-weight:700;z-index:2;';
        rm.addEventListener('click', function (e) { e.stopPropagation(); removeChord(id); });
        wrap.appendChild(rm);
      }
      track.appendChild(wrap);
      var d = document.createElement('button');
      d.type = 'button';
      d.addEventListener('click', function () { goChord(i); });
      dots.appendChild(d);
    });
    currentChordIdx = 0;
    updateTrackPosition(false);
    setActiveDot(0);
  }

  function updateChToggle() {
    var b = $('chToggleBtn'), nb = $('chNew');
    if (!b) return;
    // Luôn hiện: ai cũng thêm ảnh được nên không còn điều kiện "đã có ảnh
    // hoặc đã bật quyền phụ trách" trước khi cho bấm vào.
    b.hidden = false;
    b.classList.toggle('active', chOpen);
    if (nb) nb.hidden = !(chIds.length && chUpdatedAt > (state.chSeenAt || 0) && !chOpen);
  }

  $('chToggleBtn') && $('chToggleBtn').addEventListener('click', function () {
    chOpen = !chOpen;
    if (chOpen) { state.chSeenAt = chUpdatedAt || Date.now(); saveState(); }
    var cur = chImgs; chIds = [];          // ép render lại
    renderChords({ images: cur, updatedAt: chUpdatedAt });
    if (chOpen) { var s = $('chords'); if (s && s.scrollIntoView) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  function removeChord(id) {
    fetch(roomUrl('/gallery/remove?token=' + encodeURIComponent(state.token || '')), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id })
    })
      .then(function (r) { return r.json(); })
      .then(function (m) { renderChords(m); })
      .catch(function () { toast('band', '', 'Xoá không được.'); });
  }

  function downscaleChordImg(file, cb) {
    var img = new Image();
    img.onload = function () {
      var max = 1400, w = img.naturalWidth, h = img.naturalHeight;
      if (w > max || h > max) { var s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { cb(c.toDataURL('image/jpeg', 0.82)); } catch (e) {}
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function () { URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  }

  document.getElementById('chAddInput') && $('chAddInput').addEventListener('change', function (ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = '';
    files.forEach(function (f) {
      downscaleChordImg(f, function (dataUrl) {
        fetch(roomUrl('/gallery/add?token=' + encodeURIComponent(state.token || '')), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, ext: '.jpg', dataB64: dataUrl })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            // fetch() không coi status lỗi (403/413/500...) là promise reject —
            // trước đây gọi thẳng renderChords() với body lỗi {error:...}, bị
            // hiểu nhầm thành gallery rỗng, KHÔNG báo gì cho người dùng biết là
            // đã thất bại (vd hết quyền phụ trách ảnh giữa chừng).
            if (res.ok) { renderChords(res.j); }
            else { toast('band', '', (res.j && res.j.error) || 'Tải ảnh lên không được.'); }
          })
          .catch(function () { toast('band', '', 'Tải ảnh lên không được.'); });
      });
    });
  });

  var currentChordIdx = 0;

  function updateTrackPosition(animate) {
    var track = $('chTrack') || $('chView');
    if (!track) return;
    track.style.transition = animate ? 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
    track.style.transform = 'translate3d(-' + (currentChordIdx * 100) + '%, 0, 0)';
  }

  function goChord(i) {
    var track = $('chTrack') || $('chView');
    var total = track ? track.children.length : 0;
    if (total <= 0) return;
    currentChordIdx = Math.max(0, Math.min(i, total - 1));
    updateTrackPosition(true);
    setActiveDot(currentChordIdx);
  }

  function setActiveDot(i) {
    var ds = $('chDots').children;
    for (var k = 0; k < ds.length; k++) ds[k].classList.toggle('on', k === i);
  }

  var chTouchStartX = 0;
  var chTouchStartY = 0;
  var chIsHorizontal = null;
  var chIsDragging = false;

  var chViewEl = $('chView');
  chViewEl.addEventListener('touchstart', function (e) {
    if (!e.touches || e.touches.length !== 1) return;
    var track = $('chTrack') || $('chView');
    if (!track || track.children.length <= 1) return;
    chTouchStartX = e.touches[0].clientX;
    chTouchStartY = e.touches[0].clientY;
    chIsHorizontal = null;
    chIsDragging = true;
    track.style.transition = 'none';
  }, { passive: true });

  chViewEl.addEventListener('touchmove', function (e) {
    if (!chIsDragging || !e.touches || !e.touches.length) return;
    var dx = e.touches[0].clientX - chTouchStartX;
    var dy = e.touches[0].clientY - chTouchStartY;

    if (chIsHorizontal === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        chIsHorizontal = Math.abs(dx) >= Math.abs(dy);
        if (!chIsHorizontal) {
          chIsDragging = false;
          return;
        }
      } else {
        return;
      }
    }

    if (!chIsHorizontal) return;
    if (e.cancelable) e.preventDefault();

    var track = $('chTrack') || $('chView');
    var w = chViewEl.clientWidth || 1;
    var total = track.children.length;
    var baseOffset = -currentChordIdx * w;

    // Resistance at edges
    if ((currentChordIdx === 0 && dx > 0) || (currentChordIdx === total - 1 && dx < 0)) {
      dx = dx * 0.3;
    }
    track.style.transform = 'translate3d(' + (baseOffset + dx) + 'px, 0, 0)';
  }, { passive: false });

  chViewEl.addEventListener('touchend', function (e) {
    if (!chIsDragging) return;
    chIsDragging = false;
    if (!chIsHorizontal) return;
    var dx = (e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : 0) - chTouchStartX;
    var w = chViewEl.clientWidth || 1;
    var threshold = Math.min(w * 0.15, 45);
    var track = $('chTrack') || $('chView');
    var total = track ? track.children.length : 0;

    if (dx < -threshold && currentChordIdx < total - 1) {
      currentChordIdx++;
    } else if (dx > threshold && currentChordIdx > 0) {
      currentChordIdx--;
    }
    updateTrackPosition(true);
    setActiveDot(currentChordIdx);
  }, { passive: true });

  chViewEl.addEventListener('touchcancel', function () {
    if (!chIsDragging) return;
    chIsDragging = false;
    updateTrackPosition(true);
  }, { passive: true });

  window.addEventListener('resize', function () {
    updateTrackPosition(false);
  });

  /* ---------------- setlist (soạn danh sách bài gửi máy chiếu) ---------------- */

  var slSongs = [];
  var slLibLoaded = false;

  function fetchLibrary() {
    // fallback từ cache trước cho nhanh / lúc mạng chờn (chỉ dùng nếu cache khớp đúng room)
    if (!slSongs.length && state.slLibCache && state.slLibCache.roomId === state.cloudRoomId && Array.isArray(state.slLibCache.songs)) {
      slSongs = state.slLibCache.songs;
    }
    // /library (Worker-level, không qua DO) — cùng endpoint /composer đã
    // dùng, KV theo cloudRoomId, độc lập LAN từ trước tới giờ.
    fetch(CLOUD_API_BASE + '/library?roomId=' + encodeURIComponent(state.cloudRoomId || ''))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && Array.isArray(j.songs)) {
          slSongs = j.songs;
          slLibLoaded = true;
          state.slLibCache = { roomId: state.cloudRoomId, songs: j.songs, ts: Date.now() };
          saveState();
          renderSlResults($('slSearch').value);
        }
      }).catch(function () {});
  }

  function renderSlDraft() {
    var box = $('slDraft'); box.textContent = '';
    var d = state.slDraft || [];
    if (!d.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Chưa có bài. Gõ tìm bên dưới rồi chạm để thêm.'; box.appendChild(e); return; }
    d.forEach(function (it, i) {
      var row = document.createElement('div'); row.className = 'row';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1) + '. ' + it.title;
      row.appendChild(n);
      [['↑', -1], ['↓', 1], ['×', 0]].forEach(function (pair) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = pair[0];
        if (pair[1] === 0) b.className = 'x';
        b.addEventListener('click', function () {
          if (pair[1] === 0) { state.slDraft.splice(i, 1); }
          else { var j = i + pair[1]; if (j < 0 || j >= state.slDraft.length) return; var t = state.slDraft[i]; state.slDraft[i] = state.slDraft[j]; state.slDraft[j] = t; }
          saveState(); renderSlDraft(); renderSlResults($('slSearch').value);
        });
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  }
  function renderSlResults(query) {
    var wrap = $('slResults');
    var q = norm(query).trim();
    if (!q) { wrap.classList.add('hidden'); wrap.textContent = ''; return; }
    var inDraft = {}; (state.slDraft || []).forEach(function (x) { inDraft[String(x.id)] = 1; });
    var hits = slSongs.filter(function (s) { return norm(s.title).indexOf(q) >= 0 || norm(s.lyrics).indexOf(q) >= 0; }).slice(0, 40);
    wrap.textContent = '';
    if (!hits.length) { wrap.classList.remove('hidden'); var e = document.createElement('div'); e.className = 'r'; e.textContent = slLibLoaded ? 'Không thấy bài nào.' : 'Đang tải thư viện…'; wrap.appendChild(e); return; }
    hits.forEach(function (s) {
      var r = document.createElement('div'); r.className = 'r' + (inDraft[String(s.id)] ? ' added' : '');
      var title = document.createElement('span'); title.textContent = (inDraft[String(s.id)] ? '✓ ' : '') + s.title;
      r.appendChild(title);
      if (s.lyrics) { var ly = document.createElement('span'); ly.className = 'ly'; ly.textContent = s.lyrics.replace(/\n+/g, ' · ').slice(0, 90); r.appendChild(ly); }
      r.addEventListener('click', function () {
        var k = String(s.id);
        if (inDraft[k]) { state.slDraft = state.slDraft.filter(function (x) { return String(x.id) !== k; }); }
        else { state.slDraft.push({ id: s.id, title: s.title }); }
        saveState(); renderSlDraft(); renderSlResults(query);
      });
      wrap.appendChild(r);
    });
    wrap.classList.remove('hidden');
  }

  function sendSetlist() {
    var d = state.slDraft || [];
    if (!d.length) { toast('band', '', 'Setlist đang trống.'); return; }
    var name = $('slName').value.trim() || 'Setlist';
    var payload = {
      id: 'sl-' + Date.now().toString(16) + Math.random().toString(16).slice(2, 8),
      name: name,
      items: d.map(function (x) { return { type: 'song', id: x.id, title: x.title }; })
    };
    $('slSend').disabled = true;
    fetch(roomUrl('/setlist?token=' + encodeURIComponent(state.token || '')), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        $('slSend').disabled = false;
        if (!res.ok || !res.j || !res.j.ok) { toast('band', '', (res.j && res.j.error) || 'Máy chiếu chưa nhận được.'); return; }
        // relay luôn trả lời được dù operator đang offline (khác LAN cũ,
        // network error mới báo "tắt") — res.j.delivered mới là tín hiệu
        // thật "operator có đang mở app không", quyết định có cần gửi thêm
        // qua hộp thư cloud hay không.
        if (res.j.delivered) { finishSetlistSent(false); }
        else { sendSetlistToCloud(payload); }
      })
      .catch(function () { sendSetlistToCloud(payload); });
  }

  function finishSetlistSent(viaCloud) {
    state.slDraft = []; saveState();
    $('slName').value = ''; $('slSearch').value = '';
    renderSlDraft(); renderSlResults('');
    toast('op', '', viaCloud ? 'Máy chiếu đang tắt — đã gửi qua hộp thư, sẽ tới khi máy chiếu mở lại.' : 'Đã gửi setlist cho máy chiếu.');
    $('setlistBlock').classList.add('hidden');
  }

  function sendSetlistToCloud(payload) {
    if (!state.cloudRoomId) {
      $('slSend').disabled = false;
      toast('band', '', 'Chưa gửi được — máy chiếu chưa online. Danh sách vẫn được giữ.');
      return;
    }
    fetch(CLOUD_API_BASE + '/setlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: state.cloudRoomId,
        setlist: { id: payload.id, name: payload.name, from: { name: state.name }, items: payload.items }
      })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        $('slSend').disabled = false;
        if (res.ok && res.j && res.j.ok) finishSetlistSent(true);
        else toast('band', '', 'Chưa gửi được — thử lại sau.');
      })
      .catch(function () {
        $('slSend').disabled = false;
        toast('band', '', 'Không có mạng — thử lại khi có kết nối.');
      });
  }

  $('slToggleBtn') && $('slToggleBtn').addEventListener('click', function () {
    var sec = $('setlistBlock');
    var show = sec.classList.contains('hidden');
    sec.classList.toggle('hidden', !show);
    $('slToggleBtn').classList.toggle('active', show);
    if (show) {
      renderSlDraft();
      if (!slLibLoaded) fetchLibrary();
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  $('slSearch') && $('slSearch').addEventListener('input', function () { renderSlResults(this.value); });
  $('slSend') && $('slSend').addEventListener('click', sendSetlist);

  /* ---------------- composer + settings ---------------- */

  $('composeSend').addEventListener('click', sendCompose);
  $('composeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendCompose(); });
  function sendCompose() {
    var v = $('composeInput').value.trim();
    if (!v) return;
    $('composeInput').value = '';
    if (!ws || ws.readyState !== WebSocket.OPEN) { toast('band', '', 'Chưa gửi được — mất kết nối.'); return; }
    toast('band', '', 'Đã gửi');
    try { ws.send(JSON.stringify({ kind: 'message', text: v })); } catch (e) { toast('band', '', 'Chưa gửi được — thử lại.'); }
  }

  // NOTE: no leave-on-pagehide — phones background constantly and that would log
  // them out. Truly-gone clients fall out of the presence list after ~25s; the
  // token still rehydrates them if they come back.

  /* ---------------- boot ---------------- */
  $('leaveBtn') && $('leaveBtn').addEventListener('click', function () {
    if (confirm('Bạn muốn rời khỏi phòng hiện tại để quay lại màn hình đăng nhập?')) {
      leaveRoom();
    }
  });

  // Khởi động:
  // 1. Nếu có ?room= hoặc ?r= trong URL (quét QR / bấm link): state.token đã được reset ở trên,
  //    luôn mở màn hình Đăng nhập (Join Gate) và bắt buộc người dùng nhập mật khẩu phòng.
  // 2. Nếu không có ?room= trong URL (người dùng reload trang trong phiên làm việc):
  //    kiểm tra token đã lưu với server (/whoami) để khôi phục phiên nếu hợp lệ.
  if (!urlRoomCode && state.token && state.clientId && currentRoomCode()) {
    fetch(roomUrl('/whoami?token=' + encodeURIComponent(state.token || '')))
      .then(function (r) {
        if (r.ok) {
          enterMain();
        } else {
          state.token = null;
          state.clientId = null;
          saveState();
          $('join').classList.remove('hidden');
          $('main').classList.add('hidden');
          $('joinErr').textContent = 'Phiên đăng nhập đã hết hạn hoặc mật khẩu đã đổi. Vui lòng đăng nhập lại.';
        }
      })
      .catch(function () {
        // Mất mạng tạm thời lúc khởi động -> vẫn cố vào để WebSocket tự retry
        enterMain();
      });
  } else {
    // Mặc định luôn hiện màn hình Đăng nhập (Join Gate)
    $('join').classList.remove('hidden');
    $('main').classList.add('hidden');
    // Tự động focus vào ô Tên (field đầu tiên) nếu chưa có tên
    // hoặc vào ô Mật khẩu nếu đã có cả Tên và ID phòng
    setTimeout(function () {
      if ($('name') && !$('name').value) {
        $('name').focus();
      } else if ($('roomCode') && !$('roomCode').value) {
        $('roomCode').focus();
      } else if ($('roomPassword') && !$('roomPassword').value) {
        $('roomPassword').focus();
      }
    }, 200);
  }
})();
