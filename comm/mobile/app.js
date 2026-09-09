/* Kênh Band — mobile client. Vanilla JS, no build, no CDN.
   Downstream: WebSocket (/api/ws). Upstream: fetch POST.
   WebSocket (not SSE) because Cloudflare Tunnel buffers streaming HTTP and
   operator→phone messages would never arrive.
   No severity anywhere — every incoming message is handled the same way;
   only DIRECTION (band vs operator) changes the colour. */

(function () {
  'use strict';

  var LS_KEY = 'bandcomm.v1';

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
      hasUploaderPin = !!res.j.hasUploaderPin;
      if ((!state.buttons || !state.buttons.length) && res.j.profile && res.j.profile.buttons && res.j.profile.buttons.length) {
        state.buttons = res.j.profile.buttons;
      }
      saveState();
      enterMain();
      if (res.j.gallery) renderChords(res.j.gallery);
      reclaimUploader();
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
  var chUpdatedAt = 0;
  var chOpen = false;           // người xem đã bấm "Xem hợp âm" chưa
  var hasUploaderPin = false;   // máy chiếu có bật cho điện thoại upload không
  var isUploader = false;       // client này đã giành quyền phụ trách ảnh

  function renderChords(manifest) {
    var imgs = (manifest && manifest.images) || [];
    var ids = imgs.map(function (x) { return x.id; });
    var force = ids.join(',') !== chIds.join(',');
    chIds = ids;
    chUpdatedAt = (manifest && manifest.updatedAt) || chUpdatedAt;
    updateChToggle();
    var sec = $('chords'), track = $('chView'), dots = $('chDots');
    // Ảnh KHÔNG tự hiện: người xem phải bấm "🎼 Hợp âm". Uploader luôn thấy để quản lý.
    var show = isUploader || (chOpen && ids.length);
    if (!show) { sec.classList.add('hidden'); if (force) { track.textContent = ''; dots.textContent = ''; } return; }
    sec.classList.remove('hidden');
    updateUploaderUI();
    if (!force) return;
    track.textContent = ''; dots.textContent = '';
    ids.forEach(function (id, i) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'flex:0 0 100%;position:relative;scroll-snap-align:center;';
      var im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = 'Hợp âm ' + (i + 1);
      im.src = 'api/gallery/image/' + encodeURIComponent(id) + '?token=' + encodeURIComponent(state.token || '');
      im.style.cssText = 'width:100%;height:auto;max-height:64vh;object-fit:contain;background:#fff;display:block;';
      wrap.appendChild(im);
      if (isUploader) {
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

  function updateUploaderUI() {
    var mb = $('chManageBtn'), al = $('chAddLabel');
    if (mb) { mb.hidden = !hasUploaderPin; mb.textContent = isUploader ? 'Đang phụ trách ✓' : 'Phụ trách ảnh'; }
    if (al) al.hidden = !isUploader;
  }

  function updateChToggle() {
    var b = $('chToggleBtn'), nb = $('chNew');
    if (!b) return;
    b.hidden = !(chIds.length || isUploader);
    b.classList.toggle('active', chOpen || isUploader);
    if (nb) nb.hidden = !(chIds.length && chUpdatedAt > (state.chSeenAt || 0) && !chOpen);
  }

  $('chToggleBtn') && $('chToggleBtn').addEventListener('click', function () {
    chOpen = !chOpen;
    if (chOpen) { state.chSeenAt = chUpdatedAt || Date.now(); saveState(); }
    var cur = chIds.slice(); chIds = [];          // ép render lại
    renderChords({ images: cur.map(function (id) { return { id: id }; }), updatedAt: chUpdatedAt });
    if (chOpen) { var s = $('chords'); if (s && s.scrollIntoView) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  function reclaimUploader() {
    if (state.uploaderPin) claimUploader(state.uploaderPin, true);
    else updateUploaderUI();
  }

  function claimUploader(pin, silent) {
    fetch('api/gallery/claim', { method: 'POST', headers: authHeader(), body: JSON.stringify({ pin: pin }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.uploader) {
          isUploader = true; state.uploaderPin = pin; saveState();
          var cur = chIds.slice(); chIds = [];   // ép render lại kèm nút Xoá
          updateUploaderUI(); renderChords({ images: cur.map(function (id) { return { id: id }; }) });
          if (!silent) toast('op', '', 'Bạn là người phụ trách ảnh hợp âm.');
        } else {
          isUploader = false;
          if (!silent) toast('band', '', (res.j && res.j.error) || 'Không nhận được quyền.');
          if (res.j && (res.j.error || '').indexOf('Sai') === 0) { state.uploaderPin = null; saveState(); }
          updateUploaderUI();
        }
      }).catch(function () { if (!silent) toast('band', '', 'Không kết nối được máy chiếu.'); });
  }

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

  document.getElementById('chManageBtn') && $('chManageBtn').addEventListener('click', function () {
    if (isUploader) { toast('op', '', 'Bạn đang phụ trách ảnh.'); return; }
    var pin = prompt('Nhập mã phụ trách ảnh (máy chiếu cấp):');
    if (pin) claimUploader(pin.replace(/\D/g, ''), false);
  });
  document.getElementById('chAddInput') && $('chAddInput').addEventListener('change', function (ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = '';
    files.forEach(function (f) {
      downscaleChordImg(f, function (dataUrl) {
        fetch('api/gallery/add', { method: 'POST', headers: authHeader(), body: JSON.stringify({ name: f.name, ext: '.jpg', dataB64: dataUrl }) })
          .then(function (r) { return r.json(); })
          .then(function (m) { renderChords(m); })
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
        $('slSend').disabled = false;
        if (res.ok && res.j && res.j.ok) {
          state.slDraft = []; saveState();
          $('slName').value = ''; $('slSearch').value = '';
          renderSlDraft(); renderSlResults('');
          toast('op', '', 'Đã gửi setlist cho máy chiếu.');
          $('setlistBlock').classList.add('hidden');
        } else {
          toast('band', '', (res.j && res.j.error) || 'Máy chiếu chưa nhận được.');
        }
      })
      .catch(function () { $('slSend').disabled = false; toast('band', '', 'Chưa gửi được — máy chiếu chưa online. Danh sách vẫn được giữ.'); });
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
