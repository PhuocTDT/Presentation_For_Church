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
  // Đăng nhập tài khoản trung tâm (authMode='cognito', cloud/identity-plan.md)
  // — Worker "band-identity" là NƠI DUY NHẤT phone nói chuyện để lấy JWT;
  // JWT sau đó gửi cho relay (verify chữ ký, không gọi lại Worker này).
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
  // 2 chế độ (band-comm-plan.md §11), chọn qua GET /mode CHO ĐÚNG PHÒNG —
  // khác hẳn LAN cũ (1 domain = 1 phòng, /mode không cần tham số gì): giờ
  // nhiều nhà thờ dùng CHUNG 1 domain, phải biết ROOM CODE trước mới hỏi
  // được /mode của phòng nào. Link/QR operator chia sẻ có sẵn ?room=<code>
  // (điền sẵn, tự dò mode ngay) — gõ tay ID phòng (không có ?room=) vẫn luôn
  // hoạt động qua form mặc định (mật khẩu phòng), TỰ chuyển form đúng ngay
  // khi rời khỏi ô ID phòng (blur) nếu phòng đó thật ra dùng tài khoản.
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
  // Tài khoản local bị operator bắt đổi mật khẩu ngay lần đăng nhập đầu
  // (ô tick lúc tạo/reset tài khoản) — j giữ token đã cấp (đăng nhập coi
  // như đã xong), currentPassword là mật khẩu vừa gõ ở bước đăng nhập
  // (đổi mật khẩu cần đúng mật khẩu cũ, xem accounts.js's changeOwnPassword).
  var pendingMustChange = null; // { j, fallbackName, currentPassword }
  var pendingAccountPassword = null;

  var ROOM_CODE_RE = /^[A-Z0-9]{4,10}$/;
  var currentAuthTab = 'account';

  function setAuthTab(tab) {
    currentAuthTab = tab;
    $('joinErr').textContent = '';
    if (tab === 'account') {
      if ($('tabAccount')) $('tabAccount').classList.add('active');
      if ($('tabLegacy')) $('tabLegacy').classList.remove('active');
      $('joinAccountFields').classList.remove('hidden');
      $('joinLegacyFields').classList.add('hidden');
      $('joinCognitoFields').classList.add('hidden');
      $('joinSub').textContent = 'Đăng nhập bằng tài khoản thành viên ban nhạc + ID phòng.';
      $('joinBtn').textContent = 'Đăng nhập vào kênh';
    } else {
      if ($('tabAccount')) $('tabAccount').classList.remove('active');
      if ($('tabLegacy')) $('tabLegacy').classList.add('active');
      $('joinAccountFields').classList.add('hidden');
      $('joinLegacyFields').classList.remove('hidden');
      $('joinCognitoFields').classList.add('hidden');
      $('joinSub').textContent = 'Nhập tên của bạn, ID phòng và mật khẩu phòng người trình chiếu đọc cho bạn.';
      $('joinBtn').textContent = 'Vào kênh';
    }
  }

  if ($('tabAccount')) $('tabAccount').addEventListener('click', function () { setAuthTab('account'); });
  if ($('tabLegacy')) $('tabLegacy').addEventListener('click', function () { setAuthTab('legacy'); });

  function syncRoomCodeFields(code) {
    ['roomCode', 'roomCode2', 'roomCode3'].forEach(function (id) {
      if ($(id) && document.activeElement !== $(id)) $(id).value = code;
    });
  }
  function applyMode(m) {
    accountsEnabled = !!(m && m.accountsEnabled);
    authMode = (m && m.authMode === 'cognito') ? 'cognito' : 'local';
    if (accountsEnabled && authMode === 'cognito') {
      $('joinLegacyFields').classList.add('hidden');
      $('joinAccountFields').classList.add('hidden');
      $('joinCognitoFields').classList.remove('hidden');
      if ($('authTabs')) $('authTabs').classList.add('hidden');
      $('joinSub').textContent = 'Đăng nhập bằng tài khoản email dùng chung nhiều nhà thờ + ID phòng.';
      $('joinBtn').textContent = 'Đăng nhập vào kênh';
    } else if (accountsEnabled) {
      if ($('authTabs')) $('authTabs').classList.remove('hidden');
      setAuthTab('account');
    }
  }
  function lookupMode(code) {
    if (!ROOM_CODE_RE.test(code)) return;
    fetch(CLOUD_API_BASE + '/api/room/' + encodeURIComponent(code) + '/mode')
      .then(function (r) { return r.json(); })
      .then(function (m) {
        if (!m || !m.configured) { return; }
        $('joinErr').textContent = '';
        applyMode(m);
      })
      .catch(function () { /* mất mạng lúc dò */ });
  }

  var urlParams = new URLSearchParams(location.search);
  var urlRoomCode = (urlParams.get('room') || '').trim().toUpperCase();
  var forceLogin = urlParams.has('login') || urlParams.has('logout');

  if (forceLogin) {
    state.token = null;
    state.clientId = null;
    saveState();
  } else if (urlRoomCode && state.roomCode && urlRoomCode !== currentRoomCode()) {
    state.token = null;
    state.clientId = null;
    state.roomCode = urlRoomCode;
    saveState();
  }

  var activeCode = urlRoomCode || currentRoomCode();
  if (activeCode) {
    syncRoomCodeFields(activeCode);
    lookupMode(activeCode);
  }

  ['roomCode', 'roomCode2', 'roomCode3'].forEach(function (id) {
    $(id) && $(id).addEventListener('input', function () {
      var code = this.value.trim().toUpperCase();
      ['roomCode', 'roomCode2', 'roomCode3'].forEach(function (otherId) {
        if (otherId !== id && $(otherId)) $(otherId).value = code;
      });
    });
    $(id) && $(id).addEventListener('blur', function () {
      var code = this.value.trim().toUpperCase();
      if (code) { syncRoomCodeFields(code); lookupMode(code); }
    });
  });

  $('joinBtn').addEventListener('click', doJoin);
  $('roomPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('roomPassword2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciNewPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciNewPasswordConfirm').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('mcNewPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('mcNewPasswordConfirm').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  $('ciRequestAccessBtn').addEventListener('click', doRequestAccess);
  $('ciForgotPasswordBtn').addEventListener('click', doForgotPassword);

  // Nút "mắt" hiện/ẩn mật khẩu — người dùng gõ sai (đặc biệt lúc đặt mật khẩu
  // mới, ô mật khẩu che kín nên không tự phát hiện gõ nhầm/thiếu ký tự) không
  // có cách nào tự kiểm tra lại trước khi bấm gửi.
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
    if (pendingMustChange) return doMustChangePassword();
    if (pendingTempToken) return doJoinRoom();
    if (pendingCognito) return doCognitoNewPassword();
    if (accountsEnabled && authMode === 'cognito') return doCognitoLogin();
    if (currentAuthTab === 'account') return doLogin();
    return doLegacyJoin();
  }

  // Điền state chung + vào màn chính — dùng chung cho cả 3 đường vào kênh
  // (mật khẩu phòng cũ, đăng nhập tài khoản 1 bước, đăng nhập tài khoản 2 bước).
  function finalizeJoin(j, fallbackName) {
    if (j.mustChangePassword) return showMustChangePassword(j, fallbackName);
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
    var code = $('roomCode').value.trim().toUpperCase();
    var password = $('roomPassword').value.trim();
    $('joinErr').textContent = '';
    if (!name) { $('joinErr').textContent = 'Nhập tên đã.'; return; }
    if (!/^[A-Z0-9]{4,10}$/.test(code)) { $('joinErr').textContent = 'ID phòng gồm 4–10 ký tự chữ/số.'; return; }
    if (!/^[a-zA-Z0-9]{4,12}$/.test(password)) { $('joinErr').textContent = 'Mật khẩu phòng gồm 4–12 ký tự chữ/số.'; return; }
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
    var code = $('roomCode2').value.trim().toUpperCase();
    $('joinErr').textContent = '';
    if (!username || !password) { $('joinErr').textContent = 'Nhập tên đăng nhập và mật khẩu.'; return; }
    if (!/^[A-Z0-9]{4,10}$/.test(code)) { $('joinErr').textContent = 'ID phòng gồm 4–10 ký tự chữ/số.'; return; }
    $('joinBtn').disabled = true;
    pendingAccountPassword = password;
    state.roomCode = code;

    fetch(roomUrl('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password, code: code })
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

    fetch(roomUrl('/join-room'), {
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

  // Chuyển sang màn "bắt đổi mật khẩu" — token đăng nhập j.token đã hợp lệ
  // (dùng luôn để gọi /api/change-password, không cần đăng nhập lại).
  function showMustChangePassword(j, fallbackName) {
    pendingMustChange = { j: j, fallbackName: fallbackName, currentPassword: pendingAccountPassword };
    pendingAccountPassword = null;
    $('joinLegacyFields').classList.add('hidden');
    $('joinAccountFields').classList.add('hidden');
    $('joinRoomPasswordFields').classList.add('hidden');
    $('joinCognitoFields').classList.add('hidden');
    $('joinCognitoNewPasswordFields').classList.add('hidden');
    $('joinMustChangeFields').classList.remove('hidden');
    $('joinErr').textContent = '';
    $('joinSub').textContent = 'Đổi mật khẩu trước khi dùng tiếp.';
    $('mcNewPassword').focus();
  }

  function doMustChangePassword() {
    var newPassword = $('mcNewPassword').value;
    var confirmPassword = $('mcNewPasswordConfirm').value;
    $('joinErr').textContent = '';
    if (!newPassword || newPassword.length < 6) { $('joinErr').textContent = 'Mật khẩu mới tối thiểu 6 ký tự.'; return; }
    if (newPassword !== confirmPassword) { $('joinErr').textContent = 'Mật khẩu nhập lại không khớp.'; return; }
    $('joinBtn').disabled = true;
    var pending = pendingMustChange;

    fetch(roomUrl('/change-password?token=' + encodeURIComponent(pending.j.token)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: pending.currentPassword, newPassword: newPassword })
    }).then(function (r) {
      return r.json().then(function (jr) { return { ok: r.ok, j: jr }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = (res.j && res.j.error) || 'Không đổi được mật khẩu.'; return; }
      pendingMustChange = null;
      $('joinMustChangeFields').classList.add('hidden');
      pending.j.mustChangePassword = false;
      finalizeJoin(pending.j, pending.fallbackName);
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
    var code = $('roomCode3').value.trim().toUpperCase();
    $('joinErr').textContent = ''; $('joinInfo').textContent = '';
    if (!name) { $('joinErr').textContent = 'Nhập tên đã.'; return; }
    if (!email || !password) { $('joinErr').textContent = 'Nhập email và mật khẩu.'; return; }
    if (!/^[A-Z0-9]{4,10}$/.test(code)) { $('joinErr').textContent = 'ID phòng gồm 4–10 ký tự chữ/số.'; return; }
    $('joinBtn').disabled = true;
    state.roomCode = code;

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
    var confirmPassword = $('ciNewPasswordConfirm').value;
    $('joinErr').textContent = ''; $('joinInfo').textContent = '';
    if (!newPassword || newPassword.length < 8) { $('joinErr').textContent = 'Mật khẩu mới tối thiểu 8 ký tự.'; return; }
    if (newPassword !== confirmPassword) { $('joinErr').textContent = 'Mật khẩu nhập lại không khớp.'; return; }
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

  // Bước 2: đưa idToken đã có chữ ký Cognito cho relay verify (chữ ký RS256,
  // không xác thực lại mật khẩu) — giống hệt luồng needsRoomPassword/
  // finalizeJoin của đăng nhập tài khoản cục bộ.
  function doCognitoFinish(idToken, name) {
    $('joinBtn').disabled = true;
    var code = $('roomCode3').value.trim().toUpperCase();
    state.roomCode = code;
    fetch(roomUrl('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: idToken, name: name, code: code })
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

  // "Quên mật khẩu?" — cùng nguyên tắc không lộ email tồn tại hay không như
  // doRequestAccess() ở trên (xem cloud/identity/src/worker.js's /forgot-password).
  function doForgotPassword() {
    var email = $('ciEmail').value.trim();
    $('joinErr').textContent = ''; $('joinInfo').textContent = '';
    if (!email) { $('joinErr').textContent = 'Nhập email trước đã.'; return; }
    $('ciForgotPasswordBtn').disabled = true;

    fetch(IDENTITY_API_BASE + '/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('ciForgotPasswordBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = (res.j && res.j.error) || 'Không gửi được yêu cầu.'; return; }
      $('joinInfo').textContent = 'Nếu email có tài khoản, mật khẩu tạm mới đã được gửi tới hộp thư (kiểm tra cả mục Spam).';
    }).catch(function () {
      $('ciForgotPasswordBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy chủ. Cần có mạng để đặt lại mật khẩu.';
    });
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
    var code = currentRoomCode() || urlRoomCode;
    if (code) {
      syncRoomCodeFields(code);
      lookupMode(code);
    }
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
      if (env.id && env.type !== 'presence') lastId = env.id;
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

  // Cơ chế bảo mật & kiểm tra URL:
  // 1. Chỉ tự động kết nối vào phòng khi URL CÓ CHỈ ĐỊNH rõ ràng ID phòng (?room=<code>) VÀ khớp với token đã lưu.
  // 2. Truy cập trực tiếp link gốc (không có ?room=) LUÔN mở màn hình Đăng nhập (Join Gate) để người dùng chủ động chọn phòng/nhập thông tin.
  // 3. Trước khi mở màn hình chính, luôn xác thực token với server (/whoami) để chặn token hết hạn hoặc phòng đã đổi mật khẩu.
  if (urlRoomCode && state.token && state.clientId && !forceLogin && urlRoomCode === currentRoomCode()) {
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
    // Mặc định luôn hiện màn hình Đăng nhập
    $('join').classList.remove('hidden');
    $('main').classList.add('hidden');
  }
})();
