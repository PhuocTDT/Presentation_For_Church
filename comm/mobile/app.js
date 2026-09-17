/* Kênh Band — mobile client. Vanilla JS, no build, no CDN.
   Downstream: WebSocket (/api/ws). Upstream: fetch POST.
   WebSocket (not SSE) because Cloudflare Tunnel buffers streaming HTTP and
   operator→phone messages would never arrive.
   No severity anywhere — every incoming message is handled the same way;
   only DIRECTION (band vs operator) changes the colour. */

(function () {
  'use strict';

  var LS_KEY = 'bandcomm.v1';
  // Hộp thư setlist trên Cloudflare khi máy chiếu tắt hẳn — chỉ dùng khi gửi
  // LAN thất bại (network error), xem cloud/worker/src/worker.js.
  var CLOUD_API_BASE = 'https://api.worship-official.link';
  // Đăng nhập tài khoản trung tâm (authMode='cognito', cloud/identity-plan.md)
  // — Worker "band-identity" là NƠI DUY NHẤT phone nói chuyện để lấy JWT; sau
  // đó JWT gửi thẳng cho server LAN (server local verify offline, không đi
  // qua Worker này nữa). Bước này BẮT BUỘC cần mạng (4G/wifi khác venue).
  var IDENTITY_API_BASE = 'https://identity.worship-official.link';

  var state = loadState();
  var ws = null;
  var lastId = null;          // last envelope id seen -> replay cursor on reconnect
  var reconnTimer = null;
  var reconnDelay = 1000;
  var pingTimer = null;
  var toastQueue = [];
  var toastShowing = false;
  var editingId = null;

  var $ = function (id) { return document.getElementById(id); };

  function loadState() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { s = {}; }
    if (!s.profileId) s.profileId = 'p-' + Math.random().toString(16).slice(2, 10);
    if (!Array.isArray(s.buttons)) s.buttons = [];
    if (typeof s.sound !== 'boolean') s.sound = true;
    if (typeof s.vibrate !== 'boolean') s.vibrate = true;
    if (!Array.isArray(s.slDraft)) s.slDraft = [];
    return s;
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- join ---------------- */
  // 2 chế độ (band-comm-plan.md §11), chọn qua GET api/mode lúc trang tải:
  //  - mặc định (accountsEnabled=false): tên tự gõ + mật khẩu phòng (như trước).
  //  - tài khoản (accountsEnabled=true): đăng nhập username+password do
  //    người trình chiếu cấp sẵn (không tự đăng ký được) -> nếu operator có
  //    bật thêm "mật khẩu phòng sau đăng nhập" thì có thêm bước 2.

  var accountsEnabled = false;
  var authMode = 'local';
  var pendingTempToken = null; // set khi đang ở bước 2 (chờ nhập mật khẩu phòng)
  // authMode='cognito' — session/email chờ đổi mật khẩu lần đầu (Cognito
  // NEW_PASSWORD_REQUIRED) + name đã khai ở bước 1, giữ lại vì field gốc bị
  // ẩn đi ở bước đổi mật khẩu.
  var pendingCognito = null; // { session, email, name }

  fetch('api/mode').then(function (r) { return r.json(); }).then(function (m) {
    accountsEnabled = !!(m && m.accountsEnabled);
    authMode = (m && m.authMode === 'cognito') ? 'cognito' : 'local';
    if (accountsEnabled && authMode === 'cognito') {
      $('joinLegacyFields').classList.add('hidden');
      $('joinCognitoFields').classList.remove('hidden');
      $('joinSub').textContent = 'Đăng nhập bằng tài khoản email dùng chung nhiều nhà thờ.';
    } else if (accountsEnabled) {
      $('joinLegacyFields').classList.add('hidden');
      $('joinAccountFields').classList.remove('hidden');
      $('joinSub').textContent = 'Đăng nhập bằng tài khoản người trình chiếu đã cấp cho bạn.';
    }
  }).catch(function () { /* mất mạng lúc tải trang — cứ để mặc định (mô hình mật khẩu phòng) */ });

  $('joinBtn').addEventListener('click', doJoin);
  $('roomPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('roomPassword2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciNewPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciRequestAccessBtn').addEventListener('click', doRequestAccess);

  function doJoin() {
    if (pendingTempToken) return doJoinRoom();
    if (pendingCognito) return doCognitoNewPassword();
    if (accountsEnabled && authMode === 'cognito') return doCognitoLogin();
    if (accountsEnabled) return doLogin();
    return doLegacyJoin();
  }

  // Điền state chung + vào màn chính — dùng chung cho cả 3 đường vào kênh
  // (mật khẩu phòng cũ, đăng nhập tài khoản 1 bước, đăng nhập tài khoản 2 bước).
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
    enterMain();
    if (j.gallery) renderChords(j.gallery);
  }

  function doLegacyJoin() {
    var name = $('name').value.trim();
    var password = $('roomPassword').value.trim();
    $('joinErr').textContent = '';
    if (!name) { $('joinErr').textContent = 'Nhập tên đã.'; return; }
    if (!/^[a-zA-Z0-9]{4,12}$/.test(password)) { $('joinErr').textContent = 'Mật khẩu phòng gồm 4–12 ký tự chữ/số.'; return; }
    $('joinBtn').disabled = true;

    fetch('api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, password: password, profileId: state.profileId })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = res.j && res.j.error ? res.j.error : 'Không vào được kênh.'; return; }
      finalizeJoin(res.j, name);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy trình chiếu. Cùng Wi-Fi chưa?';
    });
  }

  function doLogin() {
    var username = $('username').value.trim();
    var password = $('password').value;
    $('joinErr').textContent = '';
    if (!username || !password) { $('joinErr').textContent = 'Nhập tên đăng nhập và mật khẩu.'; return; }
    $('joinBtn').disabled = true;

    fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = res.j && res.j.error ? res.j.error : 'Không đăng nhập được.'; return; }
      if (res.j.needsRoomPassword) {
        pendingTempToken = res.j.tempToken;
        $('joinAccountFields').classList.add('hidden');
        $('joinRoomPasswordFields').classList.remove('hidden');
        $('joinSub').textContent = 'Nhập thêm mật khẩu phòng người trình chiếu đọc cho bạn.';
        $('roomPassword2').focus();
        return;
      }
      finalizeJoin(res.j);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy trình chiếu. Cùng Wi-Fi chưa?';
    });
  }

  function doJoinRoom() {
    var password = $('roomPassword2').value.trim();
    $('joinErr').textContent = '';
    if (!/^[a-zA-Z0-9]{4,12}$/.test(password)) { $('joinErr').textContent = 'Mật khẩu phòng gồm 4–12 ký tự chữ/số.'; return; }
    $('joinBtn').disabled = true;

    fetch('api/join-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: pendingTempToken, password: password })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) {
        $('joinErr').textContent = res.j && res.j.error ? res.j.error : 'Không vào được kênh.';
        // Phiên đăng nhập (bước 1) đã hết hạn — không còn tempToken nào để
        // thử tiếp, bung lại về bước 1 thay vì để người dùng bấm mãi vào 1
        // mật khẩu không còn ý nghĩa.
        if (res.j && res.j.error && res.j.error.indexOf('hết hạn') >= 0) {
          pendingTempToken = null;
          $('joinRoomPasswordFields').classList.add('hidden');
          $('joinAccountFields').classList.remove('hidden');
          $('joinSub').textContent = 'Đăng nhập bằng tài khoản người trình chiếu đã cấp cho bạn.';
        }
        return;
      }
      pendingTempToken = null;
      finalizeJoin(res.j);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy trình chiếu. Cùng Wi-Fi chưa?';
    });
  }

  // authMode='cognito' bước 1: xin JWT từ Worker "band-identity" bằng
  // email+mật khẩu (KHÔNG gọi server LAN ở bước này — Worker giữ AWS
  // credentials, server LAN chỉ verify chữ ký JWT offline sau đó).
  function doCognitoLogin() {
    var name = $('ciName').value.trim();
    var email = $('ciEmail').value.trim();
    var password = $('ciPassword').value;
    $('joinErr').textContent = ''; $('joinInfo').textContent = '';
    if (!name) { $('joinErr').textContent = 'Nhập tên đã.'; return; }
    if (!email || !password) { $('joinErr').textContent = 'Nhập email và mật khẩu.'; return; }
    $('joinBtn').disabled = true;

    fetch(IDENTITY_API_BASE + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = (res.j && res.j.error) || 'Không đăng nhập được.'; return; }
      if (res.j.challenge === 'NEW_PASSWORD_REQUIRED') {
        pendingCognito = { session: res.j.session, email: email, name: name };
        $('joinCognitoFields').classList.add('hidden');
        $('joinCognitoNewPasswordFields').classList.remove('hidden');
        $('joinSub').textContent = 'Mật khẩu tạm chỉ dùng 1 lần — đặt mật khẩu mới.';
        $('ciNewPassword').focus();
        return;
      }
      doCognitoFinish(res.j.idToken, name);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy chủ đăng nhập. Cần có mạng (4G/Wi-Fi khác) để đăng nhập lần đầu.';
    });
  }

  // Cognito bắt buộc đổi mật khẩu tạm ngay lần đăng nhập đầu.
  function doCognitoNewPassword() {
    var newPassword = $('ciNewPassword').value;
    $('joinErr').textContent = ''; $('joinInfo').textContent = '';
    if (!newPassword || newPassword.length < 8) { $('joinErr').textContent = 'Mật khẩu mới tối thiểu 8 ký tự.'; return; }
    $('joinBtn').disabled = true;
    var pending = pendingCognito;

    fetch(IDENTITY_API_BASE + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pending.email, session: pending.session, newPassword: newPassword })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok || !res.j.idToken) {
        $('joinErr').textContent = (res.j && res.j.error) || 'Không đổi được mật khẩu, vui lòng đăng nhập lại.';
        pendingCognito = null;
        $('joinCognitoNewPasswordFields').classList.add('hidden');
        $('joinCognitoFields').classList.remove('hidden');
        $('joinSub').textContent = 'Đăng nhập bằng tài khoản email dùng chung nhiều nhà thờ.';
        return;
      }
      pendingCognito = null;
      doCognitoFinish(res.j.idToken, pending.name);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy chủ đăng nhập. Cần có mạng (4G/Wi-Fi khác) để đăng nhập lần đầu.';
    });
  }

  // Bước 2: đưa idToken đã có chữ ký Cognito cho server LAN verify offline —
  // giống hệt luồng needsRoomPassword/finalizeJoin của đăng nhập tài khoản cục bộ.
  function doCognitoFinish(idToken, name) {
    $('joinBtn').disabled = true;
    fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: idToken, name: name })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) {
        $('joinErr').textContent = (res.j && res.j.error) || 'Không vào được kênh.';
        $('joinCognitoNewPasswordFields').classList.add('hidden');
        $('joinCognitoFields').classList.remove('hidden');
        return;
      }
      if (res.j.needsRoomPassword) {
        pendingTempToken = res.j.tempToken;
        $('joinCognitoFields').classList.add('hidden');
        $('joinCognitoNewPasswordFields').classList.add('hidden');
        $('joinRoomPasswordFields').classList.remove('hidden');
        $('joinSub').textContent = 'Nhập thêm mật khẩu phòng người trình chiếu đọc cho bạn.';
        $('roomPassword2').focus();
        return;
      }
      finalizeJoin(res.j, name);
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy trình chiếu. Cùng Wi-Fi chưa?';
    });
  }

  // "Chưa có tài khoản?" — Worker tự sinh mật khẩu tạm + gửi qua email (không
  // tự đăng ký công khai kiểu ai cũng thấy được ai đã có tài khoản: response
  // luôn {ok:true} dù email đã tồn tại hay chưa, xem cloud/identity/src/worker.js).
  function doRequestAccess() {
    var email = $('ciEmail').value.trim();
    $('joinErr').textContent = ''; $('joinInfo').textContent = '';
    if (!email) { $('joinErr').textContent = 'Nhập email trước đã.'; return; }
    $('ciRequestAccessBtn').disabled = true;

    fetch(IDENTITY_API_BASE + '/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('ciRequestAccessBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = (res.j && res.j.error) || 'Không gửi được yêu cầu.'; return; }
      $('joinInfo').textContent = 'Nếu email hợp lệ, mật khẩu tạm đã được gửi tới hộp thư (kiểm tra cả mục Spam).';
    }).catch(function () {
      $('ciRequestAccessBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy chủ. Cần có mạng để yêu cầu tài khoản.';
    });
  }

  /* ---------------- main ---------------- */

  function enterMain() {
    $('join').classList.add('hidden');
    $('main').classList.remove('hidden');
    $('roomName').textContent = state.roomName || 'Kênh Band';
    renderButtons();
    connect();
    startPing();
  }

  function connect() {
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; }
    setDot('');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/api/ws?token=' + encodeURIComponent(state.token) +
              (lastId ? '&since=' + encodeURIComponent(lastId) : '');
    try { ws = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () { setDot('on'); reconnDelay = 1000; };
    ws.onmessage = function (e) {
      var env;
      try { env = JSON.parse(e.data); } catch (err) { return; }
      if (env && env.id && env.type !== 'presence') lastId = env.id;
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
      fetch('api/ping', { method: 'POST', headers: authHeader(), body: '{}' })
        .then(function (r) {
          if (r.status === 401) { state.token = null; saveState(); location.reload(); return; }
          connect();
        })
        .catch(function () { scheduleReconnect(); });
    }, reconnDelay);
  }

  function authHeader() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (state.token || '') };
  }

  function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(function () {
      fetch('api/ping', { method: 'POST', headers: authHeader(), body: '{}' }).catch(function () {});
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
      // Operator changed tunnelName (drives setlistEnabled) AFTER this phone
      // already joined — setlistEnabled only ever came from /api/join's
      // response, and reconnect (POST /api/ping) doesn't re-fetch it, so
      // without this the setlist UI could stay hidden for the rest of a
      // long-lived session even after the operator turns it on.
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

  function sendButton(b, el) {
    el.classList.remove('failed');
    fetch('api/message', {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ buttonId: b.id, label: b.label })
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      flash(el, 'sent');
    }).catch(function () {
      flash(el, 'failed');
    });
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
    fetch('api/profile', {
      method: 'POST', headers: authHeader(),
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
    var sec = $('chords'), track = $('chView'), dots = $('chDots');
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
      wrap.style.cssText = 'flex:0 0 100%;position:relative;scroll-snap-align:center;';
      var im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = 'Hợp âm ' + (i + 1);
      // Ưu tiên xem qua Cloudflare (ổn định, không phụ thuộc tunnel còn sống
      // lúc đang xem) — server local mirror ảnh lên đó ngay lúc upload. Nếu
      // cloud lỗi (chưa kịp mirror, mất mạng ngoài…) tự rớt về local qua LAN.
      var localSrc = 'api/gallery/image/' + encodeURIComponent(id) + '?token=' + encodeURIComponent(state.token || '');
      if (state.cloudRoomId) {
        im.src = CLOUD_API_BASE + '/gallery/image/' + encodeURIComponent(state.cloudRoomId) + '/' + encodeURIComponent(id);
        im.addEventListener('error', function onCloudErr() {
          im.removeEventListener('error', onCloudErr);
          im.src = localSrc;
        }, { once: true });
      } else {
        im.src = localSrc;
      }
      im.style.cssText = 'width:100%;height:auto;max-height:64vh;object-fit:contain;background:#fff;display:block;';
      wrap.appendChild(im);
      // Chỉ chủ ảnh (ownerId === profileId của chính điện thoại này, ổn định
      // qua các lần join lại) mới thấy nút Xoá — ai cũng thêm được nhưng chỉ
      // tự xoá ảnh mình đăng, tránh 1 người xoá nhầm/cố ý ảnh người khác.
      if (item.ownerId && item.ownerId === state.profileId) {
        var rm = document.createElement('button');
        rm.type = 'button'; rm.textContent = 'Xoá';
        rm.style.cssText = 'position:absolute;top:6px;right:6px;background:#c0392f;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-weight:700;';
        rm.addEventListener('click', function (e) { e.stopPropagation(); removeChord(id); });
        wrap.appendChild(rm);
      }
      track.appendChild(wrap);
      var d = document.createElement('button');
      d.type = 'button';
      d.addEventListener('click', function () { goChord(i); });
      dots.appendChild(d);
    });
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
    fetch('api/gallery/remove', { method: 'POST', headers: authHeader(), body: JSON.stringify({ id: id }) })
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
        fetch('api/gallery/add', { method: 'POST', headers: authHeader(), body: JSON.stringify({ name: f.name, ext: '.jpg', dataB64: dataUrl }) })
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

  function goChord(i) {
    var img = $('chView').children[i];
    if (img && img.scrollIntoView) {
      img.scrollIntoView({ block: 'nearest', inline: 'center' });   // instant + snap-aware
    } else {
      var v = $('chView');
      v.scrollLeft = i * (v.clientWidth || v.offsetWidth || 1);
    }
    setActiveDot(i);
  }
  function setActiveDot(i) {
    var ds = $('chDots').children;
    for (var k = 0; k < ds.length; k++) ds[k].classList.toggle('on', k === i);
  }
  var chScrollTimer = null;
  $('chView').addEventListener('scroll', function () {
    clearTimeout(chScrollTimer);
    chScrollTimer = setTimeout(function () {
      var v = $('chView');
      setActiveDot(v.clientWidth ? Math.round(v.scrollLeft / v.clientWidth) : 0);
    }, 60);
  });

  /* ---------------- setlist (soạn danh sách bài gửi máy chiếu) ---------------- */

  var slSongs = [];
  var slLibLoaded = false;

  function fetchLibrary() {
    // fallback từ cache trước cho nhanh / lúc mạng chờn
    if (!slSongs.length && state.slLibCache && Array.isArray(state.slLibCache.songs)) slSongs = state.slLibCache.songs;
    fetch('api/library', { headers: authHeader() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && Array.isArray(j.songs)) {
          slSongs = j.songs;
          slLibLoaded = true;
          state.slLibCache = { songs: j.songs, ts: Date.now() };
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
    fetch('api/setlist', { method: 'POST', headers: authHeader(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) { $('slSend').disabled = false; finishSetlistSent(false); }
        else { $('slSend').disabled = false; toast('band', '', (res.j && res.j.error) || 'Máy chiếu chưa nhận được.'); }
      })
      // Lỗi mạng (không phải lỗi validate) -> máy chiếu có thể đang tắt hẳn ->
      // thử gửi qua hộp thư cloud để nó lấy về khi mở lại.
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
    toast('band', '', 'Đã gửi');
    fetch('api/message', { method: 'POST', headers: authHeader(), body: JSON.stringify({ text: v }) })
      .catch(function () { toast('band', '', 'Chưa gửi được — thử lại.'); });
  }

  // NOTE: no leave-on-pagehide — phones background constantly and that would log
  // them out. Truly-gone clients fall out of the presence list after ~25s; the
  // token still rehydrates them if they come back.

  /* ---------------- boot ---------------- */
  if (state.token && state.clientId) {
    enterMain();
  }
})();
