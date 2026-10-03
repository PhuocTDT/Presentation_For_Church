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
  // Bộ nút mặc định — trước đây (khi còn hệ thống tài khoản đăng nhập) mỗi
  // người có 1 hồ sơ cố định nên tự tạo nút 1 lần là đủ. Từ lúc chuyển hẳn
  // sang chỉ-join-bằng-mật-khẩu-phòng, hồ sơ (profileId) gắn với TRÌNH
  // DUYỆT/THIẾT BỊ cụ thể (localStorage) chứ không phải người dùng — máy
  // mới/xoá cache/đổi trình duyệt là mất bộ nút cũ, phải tự tạo lại từ đầu.
  // Seed sẵn bộ nút này cho THIẾT BỊ MỚI (state.buttons rỗng VÀ không khôi
  // phục được hồ sơ cũ từ server — xem finalizeJoin) để có sẵn điểm khởi đầu
  // thay vì màn hình trắng; band member vẫn sửa/xoá/thêm tự do sau đó.
  var DEFAULT_BUTTONS = [
    { id: 'b-def-piano-up', label: 'Tăng piano', group: 'Âm lượng' },
    { id: 'b-def-piano-down', label: 'Giảm piano', group: 'Âm lượng' },
    { id: 'b-def-guitar-up', label: 'Tăng guitar', group: 'Âm lượng' },
    { id: 'b-def-guitar-down', label: 'Giảm guitar', group: 'Âm lượng' },
    { id: 'b-def-mic-up', label: 'Tăng mic hướng dẫn', group: 'Âm lượng' },
    { id: 'b-def-mic-down', label: 'Giảm mic hướng dẫn', group: 'Âm lượng' },
    { id: 'b-def-guitar-mute', label: 'Guitar mất tiếng', group: 'Sự cố' },
    { id: 'b-def-piano-mute', label: 'Piano mất tiếng', group: 'Sự cố' },
    { id: 'b-def-sub-issue', label: 'Loa sub có vấn đề', group: 'Sự cố' },
    { id: 'b-def-intro', label: 'Dạo', group: 'Nhạc' },
    { id: 'b-def-repeat-chorus', label: 'Quay lại điệp khúc', group: 'Nhạc' },
    { id: 'b-def-next-song', label: 'Chuyển bài', group: 'Nhạc' },
    { id: 'b-def-ok', label: 'Ok', group: '' }
  ];
  // Nút mặc định chỉ được nạp cho THIẾT BỊ HOÀN TOÀN MỚI (xem finalizeJoin) nên điện
  // thoại đã có nút tự tạo (hoặc khôi phục từ hồ sơ cũ trên server) không bao giờ có
  // chúng, trong khi laptop/trình duyệt mới thì có — đó là lý do 2 nơi khác nhau.
  // Hàm dưới thêm bộ mặc định vào máy ĐÃ có nút mà KHÔNG xoá/sửa nút người dùng:
  //  - bỏ qua nút mặc định đã có (cùng id) hoặc trùng nhãn với nút tự tạo (tránh nhân đôi);
  //  - `ignoreDeleted=false` (tự động, 1 lần/thiết bị) tôn trọng nút mặc định người dùng đã xoá;
  //  - `ignoreDeleted=true` (bấm "Nút mặc định") thêm lại tất cả.
  function missingDefaults(ignoreDeleted) {
    var haveId = {}, haveLabel = {};
    (state.buttons || []).forEach(function (b) { haveId[b.id] = 1; haveLabel[String(b.label || '').trim().toLowerCase()] = 1; });
    var gone = ignoreDeleted ? [] : (state.deletedDefaults || []);
    return DEFAULT_BUTTONS.filter(function (d) {
      return !haveId[d.id] && !haveLabel[d.label.toLowerCase()] && gone.indexOf(d.id) === -1;
    });
  }
  function addDefaultButtons(ignoreDeleted) {
    var add = missingDefaults(ignoreDeleted);
    if (ignoreDeleted) state.deletedDefaults = [];
    add.forEach(function (d) { state.buttons.push({ id: d.id, label: d.label, group: d.group }); });
    return add.length;
  }
  // Cùng 1 Worker phục vụ CẢ trang này (mount /m/) LẪN toàn bộ API/relay —
  // xem cloud/worker/src/worker.js + room-relay.js.
  // Trang này LUÔN do chính Worker phục vụ nên gọi API cùng origin: production vẫn là
  // channel.worship-official.link, còn chạy local (wrangler dev) thì trỏ vào relay local thay vì
  // lén gọi nhầm production.
  var CLOUD_API_BASE = /^https?:$/.test(location.protocol) ? location.origin : 'https://channel.worship-official.link';

  var state = loadState();
  var ws = null;
  var lastTs = state.lastTs || 0;     // kèm `sinceTs` để server bù đúng tin mới nếu lastId không còn trong ring
  var lastId = state.lastId || null;  // persist qua reload — tránh replay ring buffer khi mố lại trang
  var reconnTimer = null;
  var reconnDelay = 1000;
  var pingTimer = null;
  var toastQueue = [];
  var toastShowing = false;
  var editingId = null;
  var saveLastIdTimer = null;  // debounce ghi localStorage
  // Chặn hiện trùng 1 envelope 2 lần (vd. `lastId` lưu debounce 500ms chưa
  // kịp ghi lúc app bị đóng/crash đúng lúc đó, reconnect sau replay lại vài
  // tin cuối đã thấy rồi) — bounded, tự dọn khi quá 200 id.
  var seenEnvIds = [];
  function isDupEnvelope(id) {
    if (!id) return false;
    if (seenEnvIds.indexOf(id) !== -1) return true;
    seenEnvIds.push(id);
    if (seenEnvIds.length > 200) seenEnvIds.splice(0, seenEnvIds.length - 200);
    return false;
  }


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
    if (!state.buttons || !state.buttons.length) {
      if (j.profile && j.profile.buttons && j.profile.buttons.length) {
        // Máy này chưa có nút, nhưng server nhận ra hồ sơ cũ (profileId khớp,
        // hoặc trùng tên hiển thị) — khôi phục đúng bộ nút người này đã tạo.
        state.buttons = j.profile.buttons;
      } else {
        // Thiết bị/hồ sơ hoàn toàn mới, không có gì để khôi phục — seed bộ
        // nút mặc định thay vì để trống.
        state.buttons = DEFAULT_BUTTONS.map(function (b) { return { id: b.id, label: b.label, group: b.group }; });
      }
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
    // 1 lần / thiết bị: bổ sung bộ nút mặc định cho máy đã có nút tự tạo (xem missingDefaults).
    if (!state.defaultsMergedV1) {
      state.defaultsMergedV1 = true;
      if (addDefaultButtons(false)) persistButtons(); else saveState();
    }
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
              (lastId ? '&since=' + encodeURIComponent(lastId) + '&sinceTs=' + lastTs : ''));
    try { ws = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () { setDot('on'); reconnDelay = 1000; };
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg) return;
      if (msg.kind === 'pong') return;
      if (msg.kind !== 'envelope' || !msg.envelope) return;
      var env = msg.envelope;
      // CHỈ cập nhật cursor `since` bằng id của loại envelope THẬT SỰ nằm
      // trong ring (alert/text/ack/resolve — xem room-relay.js's pushRing()
      // call sites). `gallery`/`presence`/`setlist` không được pushRing(),
      // nên dùng id của chúng làm `since` lúc reconnect khiến server không
      // tìm thấy trong ring và replay lại TOÀN BỘ ring — các alert/tin nhắn
      // đã hiện rồi (toast) bị hiện lại thành trùng lặp.
      if (env.id && (env.type === 'alert' || env.type === 'text' || env.type === 'ack' || env.type === 'resolve')) {
        lastId = env.id;
        lastTs = Number(env.ts) || lastTs;
        state.lastId = lastId;
        state.lastTs = lastTs;   // persist: có hiệu lực qua reload/reconnect
        // Debounce ghi localStorage — nhiều messages đến liên tục chỉ ghi 1 lần
        clearTimeout(saveLastIdTimer);
        saveLastIdTimer = setTimeout(saveState, 500);
      }
      handleEnvelope(env);
    };
    ws.onerror = function () { /* onclose fires right after */ };
    ws.onclose = function (e) {
      setDot('off');
      ws = null;
      // 4001 = operator bấm "Kick" (xem room-relay.js's kickWebSocketsByClientId) —
      // KHÔNG tự reconnect lại (token vẫn còn hạn, tự nối lại ngay sẽ vô
      // hiệu hoá hẳn nút Kick). Reload thẳng trang (giống hệt luồng token hết
      // hạn/401 ở dưới) thay vì chỉ chuyển màn hình bằng leaveRoom() — đảm
      // bảo mọi state/timer JS được dọn sạch hoàn toàn, không chỉ ẩn UI.
      if (e && e.code === 4001) {
        state.token = null;
        state.clientId = null;
        saveState();
        try { sessionStorage.setItem('bandcomm_kicked', '1'); } catch (err) {}
        location.reload();
        return;
      }
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
    // Envelope nhắm riêng 1 clientId (vd. ack cá nhân) -> bỏ qua nếu không
    // phải của mình, phòng khi relay lỡ gửi rộng hơn phạm vi (defense in depth).
    if (env.to && env.to !== 'all' && env.to !== state.clientId) return;
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

    // alert/ack/text là one-shot (toast/đánh dấu đã gửi) — hiện lại 2 lần vì
    // replay overlap là 1 bug thấy được (toast/rung lặp lại), khác gallery/
    // presence ở trên vốn idempotent (ghi đè state, không tích luỹ).
    if (isDupEnvelope(env.id)) return;
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

  // Màu ổn định theo tên nhóm (hash đơn giản, giống cách operator tô màu tên
  // người gửi) — chỉ để PHÂN BIỆT trực quan giữa các nhóm nút, KHÔNG mang
  // nghĩa mức độ khẩn cấp (đúng chủ đích "No severity" của cả hệ thống: mọi
  // tin xử lý như nhau). Nhóm rỗng (không đặt tên) giữ nguyên màu viền mặc
  // định, không tô.
  function groupHsl(group) {
    var k = String(group || ''), h = 0;
    for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 55%, 48%)';
  }

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
    // Chỉ hiện khi còn nút mặc định chưa có (kể cả đã xoá) — thêm lại không đụng nút tự tạo.
    if (missingDefaults(true).length) {
      var defBtn = document.createElement('button');
      defBtn.className = 'qbtn add';
      defBtn.textContent = 'Nút mặc định';
      defBtn.title = 'Thêm các nút mặc định còn thiếu (Âm lượng, Sự cố, Nhạc…)';
      defBtn.addEventListener('click', function () {
        var n = addDefaultButtons(true);
        persistButtons();
        toast('band', '', n ? ('Đã thêm ' + n + ' nút mặc định.') : 'Đã có đủ nút mặc định.');
      });
      addGrid.appendChild(defBtn);
    }
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
        gl.style.setProperty('--group-color', groupHsl(g));
        var dot = document.createElement('span');
        dot.className = 'dot';
        gl.appendChild(dot);
        gl.appendChild(document.createTextNode(g));
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
    if (b.group) {
      el.style.setProperty('--group-color', groupHsl(b.group));
      el.style.setProperty('--group-text', '#fff');
    }
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
    // Nhớ nút MẶC ĐỊNH đã xoá để lần nạp tự động sau không thêm lại ngược ý người dùng.
    if (editingId && String(editingId).indexOf('b-def-') === 0) {
      state.deletedDefaults = (state.deletedDefaults || []).filter(function (x) { return x !== editingId; }).concat([editingId]);
    }
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
    if ($('chOrderBtn')) $('chOrderBtn').hidden = imgs.length < 2;
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
      // Chạm vào ảnh -> mở xem phóng to (lightbox), lướt qua lại không cần
      // thoát. Nút Xoá bên trong tự stopPropagation() nên không kích hoạt
      // luôn lightbox khi bấm Xoá.
      wrap.addEventListener('click', function () { openLightbox(i); });
      // Chỉ chủ ảnh mới thấy nút Xoá — ai cũng thêm được nhưng chỉ tự xoá ảnh
      // mình đăng. Server tính sẵn `mine` (không trả ownerId thật của ai cả
      // nữa, tránh lộ profileId — bearer secret — cho người khác trong phòng).
      if (item.mine) {
        var rm = document.createElement('button');
        rm.type = 'button'; rm.textContent = 'Xoá';
        rm.style.cssText = 'position:absolute;top:6px;right:6px;background:#c0392f;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-weight:700;z-index:2;';
        rm.addEventListener('click', function (e) { e.stopPropagation(); removeChord(id); });
        wrap.appendChild(rm);
      }
      track.appendChild(wrap);
      var d = document.createElement('button');
      d.type = 'button';
      d.addEventListener('click', function () { chCarousel.goTo(i); });
      dots.appendChild(d);
    });
    chCarousel.goTo(0, false);
  }

  // ---- Sắp xếp thứ tự ảnh hợp âm (thứ tự dùng chung cả phòng) ----
  // Làm việc trên BẢN SAO cục bộ, bấm "Lưu thứ tự" mới gửi 1 lần (không bắn 1 request
  // mỗi lần bấm ▲▼ — relay có giới hạn tần suất và mỗi lần đổi đều phát cho cả phòng).
  var chOrderIds = [];
  function renderChOrder() {
    var list = $('chOrderList'); list.textContent = '';
    var byId = {}; chImgs.forEach(function (x) { byId[x.id] = x; });
    chOrderIds.forEach(function (id, i) {
      var it = byId[id] || { id: id };
      var row = document.createElement('div'); row.className = 'o';
      var idx = document.createElement('span'); idx.className = 'i'; idx.textContent = (i + 1) + '.';
      var im = document.createElement('img'); im.alt = '';
      im.src = CLOUD_API_BASE + '/gallery/image/' + encodeURIComponent(state.cloudRoomId) + '/' + encodeURIComponent(id);
      var nm = document.createElement('span'); nm.className = 'n'; nm.textContent = it.name || ('Ảnh ' + (i + 1));
      var up = document.createElement('button'); up.type = 'button'; up.textContent = '▲'; up.disabled = i === 0; up.setAttribute('aria-label', 'Lên');
      var dn = document.createElement('button'); dn.type = 'button'; dn.textContent = '▼'; dn.disabled = i === chOrderIds.length - 1; dn.setAttribute('aria-label', 'Xuống');
      up.addEventListener('click', function () { moveChOrder(i, -1); });
      dn.addEventListener('click', function () { moveChOrder(i, 1); });
      row.appendChild(idx); row.appendChild(im); row.appendChild(nm); row.appendChild(up); row.appendChild(dn);
      list.appendChild(row);
    });
  }
  function moveChOrder(i, d) {
    var j = i + d; if (j < 0 || j >= chOrderIds.length) return;
    var t = chOrderIds[i]; chOrderIds[i] = chOrderIds[j]; chOrderIds[j] = t;
    renderChOrder();
  }
  function closeChOrder() { $('chOrder').classList.add('hidden'); }
  $('chOrderBtn') && $('chOrderBtn').addEventListener('click', function () {
    if (chImgs.length < 2) { toast('band', '', 'Cần ít nhất 2 ảnh để sắp xếp.'); return; }
    chOrderIds = chImgs.map(function (x) { return x.id; });
    renderChOrder();
    $('chOrder').classList.remove('hidden');
  });
  $('chOrderCancel') && $('chOrderCancel').addEventListener('click', closeChOrder);
  $('chOrder') && $('chOrder').addEventListener('click', function (e) { if (e.target === $('chOrder')) closeChOrder(); });
  $('chOrderSave') && $('chOrderSave').addEventListener('click', function () {
    var btn = $('chOrderSave'); btn.disabled = true;
    fetch(roomUrl('/gallery/reorder?token=' + encodeURIComponent(state.token || '')), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: chOrderIds })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (res.ok) { closeChOrder(); renderChords(res.j); toast('band', '', 'Đã lưu thứ tự ảnh hợp âm.'); }
        else { toast('band', '', (res.j && res.j.error) || 'Lưu thứ tự không được.'); }
      })
      .catch(function () { btn.disabled = false; toast('band', '', 'Lưu thứ tự không được (mất kết nối?).'); });
  });

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
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        // Cùng lỗi đã fix ở luồng thêm ảnh phía trên: fetch() không coi status
        // lỗi (403/404...) là promise reject, gọi thẳng renderChords() với body
        // lỗi {error:...} sẽ bị hiểu nhầm thành gallery rỗng.
        if (res.ok) { renderChords(res.j); }
        else { toast('band', '', (res.j && res.j.error) || 'Xoá không được.'); }
      })
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

  // Carousel vuốt ngang dùng chung cho CẢ khung inline (#chView) LẪN lightbox
  // phóng to (#chLightboxView) — 2 nơi cần y hệt 1 kiểu cơ chế (drag + snap +
  // dot pager), tách ra đây để không lặp code, mỗi instance tự giữ state
  // riêng (idx/dragging/...) qua closure, không đụng nhau.
  function makeSwipeCarousel(viewEl, getTrackEl, dotsEl) {
    var idx = 0, startX = 0, startY = 0, isHorizontal = null, dragging = false;

    function position(animate) {
      var track = getTrackEl();
      if (!track) return;
      track.style.transition = animate ? 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
      track.style.transform = 'translate3d(-' + (idx * 100) + '%, 0, 0)';
    }
    function setActiveDot() {
      if (!dotsEl) return;
      var ds = dotsEl.children;
      for (var k = 0; k < ds.length; k++) ds[k].classList.toggle('on', k === idx);
    }
    function goTo(i, animate) {
      var track = getTrackEl();
      var total = track ? track.children.length : 0;
      if (total <= 0) return;
      idx = Math.max(0, Math.min(i, total - 1));
      position(animate !== false);
      setActiveDot();
    }

    viewEl.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      var track = getTrackEl();
      if (!track || track.children.length <= 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isHorizontal = null;
      dragging = true;
      track.style.transition = 'none';
    }, { passive: true });

    viewEl.addEventListener('touchmove', function (e) {
      if (!dragging || !e.touches || !e.touches.length) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      if (isHorizontal === null) {
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          isHorizontal = Math.abs(dx) >= Math.abs(dy);
          if (!isHorizontal) { dragging = false; return; }
        } else {
          return;
        }
      }

      if (!isHorizontal) return;
      if (e.cancelable) e.preventDefault();

      var track = getTrackEl();
      var w = viewEl.clientWidth || 1;
      var total = track.children.length;
      var baseOffset = -idx * w;

      // Resistance at edges
      if ((idx === 0 && dx > 0) || (idx === total - 1 && dx < 0)) {
        dx = dx * 0.3;
      }
      track.style.transform = 'translate3d(' + (baseOffset + dx) + 'px, 0, 0)';
    }, { passive: false });

    viewEl.addEventListener('touchend', function (e) {
      if (!dragging) return;
      dragging = false;
      if (!isHorizontal) return;
      var dx = (e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : 0) - startX;
      var w = viewEl.clientWidth || 1;
      var threshold = Math.min(w * 0.15, 45);
      var track = getTrackEl();
      var total = track ? track.children.length : 0;
      var next = idx;
      if (dx < -threshold && idx < total - 1) next = idx + 1;
      else if (dx > threshold && idx > 0) next = idx - 1;
      goTo(next, true);
    }, { passive: true });

    viewEl.addEventListener('touchcancel', function () {
      if (!dragging) return;
      dragging = false;
      position(true);
    }, { passive: true });

    window.addEventListener('resize', function () { position(false); });

    return { goTo: goTo };
  }

  var chCarousel = makeSwipeCarousel($('chView'), function () { return $('chTrack'); }, $('chDots'));
  var chLightboxCarousel = makeSwipeCarousel($('chLightboxView'), function () { return $('chLightboxTrack'); }, $('chLightboxDots'));

  // Phóng to xem chi tiết + lướt qua lại không thoát — mở đúng ảnh vừa chạm
  // trong khung inline, dựng lại track riêng cho lightbox từ chIMgs hiện tại.
  // z-index lightbox (40) THẤP HƠN #toasts (50) nên cảnh báo/tin nhắn mới vẫn
  // đè lên trên được, không bị che mất khi đang xem ảnh phóng to.
  function openLightbox(startIndex) {
    if (!chImgs.length) return;
    var track = $('chLightboxTrack');
    track.textContent = '';
    chImgs.forEach(function (item, i) {
      var wrap = document.createElement('div');
      wrap.className = 'ch-lightbox-slide';
      var im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = 'Hợp âm ' + (i + 1);
      im.src = CLOUD_API_BASE + '/gallery/image/' + encodeURIComponent(state.cloudRoomId) + '/' + encodeURIComponent(item.id);
      wrap.appendChild(im);
      track.appendChild(wrap);
    });
    var dotsEl = $('chLightboxDots');
    dotsEl.textContent = '';
    chImgs.forEach(function (_, i) {
      var d = document.createElement('button');
      d.type = 'button';
      d.addEventListener('click', function () { chLightboxCarousel.goTo(i); });
      dotsEl.appendChild(d);
    });
    $('chLightbox').classList.remove('hidden');
    chLightboxCarousel.goTo(startIndex, false);
  }
  function closeLightbox() {
    $('chLightbox').classList.add('hidden');
  }
  $('chLightboxClose') && $('chLightboxClose').addEventListener('click', closeLightbox);

  /* ---------------- setlist: đã tách thành trang riêng /setlist/ ---------------- */
  // Trước đây soạn setlist nằm ngay trong trang này. Giờ mở trang riêng (comm/setlist/,
  // có tạo bài mới + xem trước slide). KHÔNG kèm ?room= : trang đó tự nhận lại phiên
  // đăng nhập của trang này (cùng origin) nên không bắt nhập mật khẩu lần nữa.
  $('slToggleBtn') && $('slToggleBtn').addEventListener('click', function () { location.href = '/setlist/'; });

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
    // Vừa bị operator kick (xem 'onclose' ở trên) -> báo lý do sau khi
    // location.reload() đã xoá sạch mọi state JS trong bộ nhớ.
    try {
      if (sessionStorage.getItem('bandcomm_kicked')) {
        sessionStorage.removeItem('bandcomm_kicked');
        $('joinErr').textContent = 'Bạn đã bị ngắt kết nối khỏi phòng bởi người vận hành.';
      }
    } catch (e) {}
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
