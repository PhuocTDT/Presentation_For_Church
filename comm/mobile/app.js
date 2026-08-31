/* Kênh Band — mobile client. Vanilla JS, no build, no CDN.
   Downstream: EventSource (/api/stream). Upstream: fetch POST.
   No severity anywhere — every incoming message is handled the same way;
   only DIRECTION (band vs operator) changes the colour. */

(function () {
  'use strict';

  var LS_KEY = 'bandcomm.v1';

  var state = loadState();
  var es = null;
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
    return s;
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- join ---------------- */

  var role = 'band';
  Array.prototype.forEach.call(document.querySelectorAll('.roles button'), function (b) {
    b.addEventListener('click', function () {
      role = b.getAttribute('data-role');
      document.querySelectorAll('.roles button').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
    });
  });

  $('joinBtn').addEventListener('click', doJoin);
  $('pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });

  function doJoin() {
    var name = $('name').value.trim();
    var pin = $('pin').value.trim();
    $('joinErr').textContent = '';
    if (!name) { $('joinErr').textContent = 'Nhập tên đã.'; return; }
    if (!/^\d{4,8}$/.test(pin)) { $('joinErr').textContent = 'Mã PIN gồm 4–8 chữ số.'; return; }
    $('joinBtn').disabled = true;

    fetch('api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, role: role, pin: pin, profileId: state.profileId })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      $('joinBtn').disabled = false;
      if (!res.ok) { $('joinErr').textContent = res.j && res.j.error ? res.j.error : 'Không vào được kênh.'; return; }
      state.token = res.j.token;
      state.clientId = res.j.clientId;
      state.name = name;
      state.role = role;
      state.roomName = res.j.room && res.j.room.name || 'Kênh Band';
      state.operatorReplies = res.j.operatorReplies || [];
      if ((!state.buttons || !state.buttons.length) && res.j.profile && res.j.profile.buttons && res.j.profile.buttons.length) {
        state.buttons = res.j.profile.buttons;
      }
      saveState();
      enterMain();
    }).catch(function () {
      $('joinBtn').disabled = false;
      $('joinErr').textContent = 'Không kết nối được máy trình chiếu. Cùng Wi-Fi chưa?';
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
    if (es) { es.close(); es = null; }
    setDot('');
    es = new EventSource('api/stream?token=' + encodeURIComponent(state.token));
    es.onopen = function () { setDot('on'); };
    es.onerror = function () {
      setDot('off');
      // EventSource retries on its own (server sends `retry:`). If the token
      // is dead the stream keeps 401-ing — bounce to join after a while.
      if (es && es.readyState === 2) { setTimeout(maybeReauth, 4000); }
    };
    es.onmessage = function (e) {
      var env;
      try { env = JSON.parse(e.data); } catch (err) { return; }
      handleEnvelope(env);
    };
  }

  function maybeReauth() {
    fetch('api/ping', { method: 'POST', headers: authHeader() }).then(function (r) {
      if (r.status === 401) { state.token = null; saveState(); location.reload(); }
    }).catch(function () {});
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
  function toast(kind, who, text, bold) {
    toastQueue.push({ kind: kind, who: who, text: text || '', bold: bold || '' });
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
    setTimeout(kill, 2000);   // 2s — không che màn hình lâu
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

  $('gearBtn').addEventListener('click', function () {
    var on = !state.sound;
    // simple cycle: sound+vibrate / silent
    state.sound = on; state.vibrate = on;
    saveState();
    toast('op', '', on ? 'Âm & rung: bật' : 'Âm & rung: tắt');
  });

  // NOTE: no leave-on-pagehide — phones background constantly and that would log
  // them out. Truly-gone clients fall out of the presence list after ~25s; the
  // token still rehydrates them if they come back.

  /* ---------------- boot ---------------- */
  if (state.token && state.clientId) {
    role = state.role || 'band';
    enterMain();
  }
})();
