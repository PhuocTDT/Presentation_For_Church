// Band Comm — cloud relay (Cloudflare Worker + KV).
//
// Hộp thư setlist cho lúc laptop operator TẮT HẲN (SPEC 3b trong
// band-comm-plan.md). Điện thoại gửi thẳng lên đây bất cứ lúc nào có mạng;
// laptop kéo về khi band-comm start. Không giữ realtime chat — cái đó vẫn đi
// qua server local + Cloudflare Tunnel khi laptop bật.
//
// roomId là UUID sinh 1 lần trên laptop (band-comm.json -> cloudRoomId),
// đóng vai trò khoá namespace — nhiều "phòng" (nhiều nhà thờ) dùng chung 1
// Worker mà không đụng dữ liệu nhau. Không phải bí mật mạnh, nhưng đủ khó
// đoán cho quy mô LAN nội bộ; PIN thật vẫn nằm ở tầng server local.
//
// KV keys:
//   sl:<roomId>:<id>   setlist JSON, TTL 7 ngày
//   ack:<roomId>:<id>  "1" khi laptop đã nhận + operator thấy, TTL 7 ngày
//
// R2 (bucket GALLERY) — ảnh hợp âm, mirror từ server local sang để điện
// thoại XEM được ổn định (không phụ thuộc Cloudflare Tunnel còn sống hay
// không lúc đang xem). Danh sách ảnh nào tồn tại vẫn do server local quyết
// định (WS 'gallery' broadcast + /api/join như cũ, không đổi) — Worker ở đây
// CHỈ lưu/phục vụ bytes, không phải nguồn sự thật cho "ảnh nào đang có". PIN
// "người phụ trách" vẫn xác thực hoàn toàn ở local, Worker không biết gì về
// nó — server local đã xác thực xong mới gọi mirror sang đây.
// Object key: <roomId>/<id> (không có phần mở rộng — content-type lưu trong
// httpMetadata lúc put). Tự xoá sau 4 ngày qua lifecycle rule "expire-4d" đặt
// trên bucket (đủ trải từ tối thứ 6 tập tới Chủ nhật diễn, xem wrangler.toml).

export { RoomRelay } from './room-relay.js';

// GĐ2 — relay realtime (thay LAN server, xem room-relay.js) sống trong
// Durable Object riêng theo `room.code` (ID phòng 6 ký tự — KHÁC `roomId`
// UUID dùng cho setlist/library/gallery bên dưới, xem giải thích trong
// room-relay.js's comment đầu file), route qua `/api/room/<code>/…`.
// Phần dưới đây (setlist cloud queue, library sync, gallery mirror, trang
// composer) giữ NGUYÊN không đổi — vẫn dùng chung KV/R2 theo `roomId` UUID cũ.
function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4,10}$/.test(code);
}
function roomRelayFetch(env, roomCode, request, subPath) {
  const id = env.ROOMS.idFromName(roomCode);
  const stub = env.ROOMS.get(id);
  const inner = new URL(request.url);
  inner.pathname = subPath || '/';
  inner.searchParams.set('roomCode', roomCode);
  const forwarded = new Request(inner.toString(), request);
  return stub.fetch(forwarded);
}

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 ngày
// Thư viện bài hát đồng bộ lên đây để trang soạn setlist tĩnh (GET /composer)
// tra cứu được ngay cả khi laptop operator tắt hẳn — không có server local nào
// phục vụ /api/library lúc đó. TTL dài hơn nhiều so với setlist (30 ngày,
// không phải dữ liệu "dùng 1 lần rồi bỏ" như setlist) — nếu operator không mở
// app một thời gian, band vẫn tra cứu được bản gần nhất thay vì mất trắng.
const LIBRARY_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_LIBRARY_SONGS = 3000;
const MAX_LYRICS_CHARS = 6000; // đủ cho bài dài nhất thực tế, chặn payload rác phình to
const MAX_ITEMS = 60;
// Worker này dùng CHUNG cho mọi bản cài app (roomId hardcode làm namespace,
// không auth thật) — cap cứng số setlist tồn tại/phòng để 1 roomId bị
// spam/đoán trúng không thể ghi vô hạn vào KV chung. Cũ nhất bị dọn trước.
const MAX_SETLISTS_PER_ROOM = 40;
// Giới hạn tần suất ghi theo roomId — không có auth thật (chỉ roomId làm
// namespace) nên không có gì chặn 1 roomId gọi POST liên tục ngoài cap tổng ở
// trên (mà cap đó chỉ chặn LƯU TRỮ phình to, không chặn SỐ REQUEST/giây đốt
// hết quota Worker request + KV read/write dùng chung cho mọi nhà thờ khác).
// Đếm bằng KV (get rồi put, không atomic — chấp nhận sai số nhỏ do
// eventually-consistent, cùng kiểu đánh đổi như MAX_SETLISTS_PER_ROOM ở trên,
// đủ để chặn lạm dụng thay vì không có gì).
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 phút
const RATE_LIMIT_MAX = 30; // tối đa 30 lượt ghi / roomId / cửa sổ 5 phút
async function checkRateLimit(env, roomId) {
  const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const key = `rl:${roomId}:${bucket}`;
  const raw = await env.SETLISTS.get(key);
  const count = raw ? (parseInt(raw, 10) || 0) : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  await env.SETLISTS.put(key, String(count + 1), { expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 60 });
  return true;
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

function isValidRoomId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(id);
}

// Trang soạn setlist tĩnh, phục vụ NGAY từ Worker này (cùng origin với API,
// không cần domain/deploy riêng) — chỗ duy nhất band vào được để soạn+gửi
// setlist khi laptop operator tắt hẳn (band-comm-plan.md, xem thảo luận về
// "setlist cloud queue vô nghĩa nếu không ai vào được trang lúc app tắt").
// Vanilla JS, không backtick/template literal bên trong (đang nằm trong 1
// template literal ở worker.js — tránh xung đột dấu `).
const COMPOSER_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<meta name="theme-color" content="#ffffff">
<title>Soạn Setlist — Kênh Band</title>
<style>
  :root {
    --bg:#ffffff; --panel:#f4f5f7; --panel-2:#eceef1; --line:#dfe2e7;
    --ink:#1e2430; --ink-soft:#5b6472; --ink-faint:#8a93a3;
    --op:#2563a8; --op-bg:#e8f1fb; --ok:#2f8a55; --danger:#c0392f;
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; min-height:100%; }
  body {
    background:var(--bg); color:var(--ink);
    font:15px/1.45 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif;
  }
  button { font:inherit; color:inherit; cursor:pointer; }
  input { font:inherit; }
  .hidden { display:none !important; }
  .wrap { max-width:480px; margin:0 auto; padding:18px 16px 40px; }
  h1 { font-size:1.2rem; margin:0 0 4px; }
  .sub { color:var(--ink-soft); font-size:.85rem; margin:0 0 4px; }
  .offline-note { background:var(--op-bg); color:var(--op); border-radius:10px; padding:9px 12px; font-size:.8rem; margin:12px 0 18px; }
  .field { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
  .field label { font-size:.72rem; letter-spacing:.04em; text-transform:uppercase; color:var(--ink-faint); }
  .field input {
    background:#fff; border:1px solid var(--line); border-radius:10px;
    padding:11px 13px; color:var(--ink); outline:none;
  }
  .field input:focus { border-color:var(--op); }
  .sl-draft { display:flex; flex-direction:column; gap:4px; margin-bottom:14px; }
  .sl-draft .row { display:flex; align-items:center; gap:6px; background:#fff; border:1px solid var(--line); border-radius:9px; padding:7px 9px; font-size:.86rem; }
  .sl-draft .row .n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sl-draft .row button { border:none; background:var(--panel-2); border-radius:7px; padding:4px 9px; font-size:.9rem; color:var(--ink-soft); }
  .sl-draft .row button.x { color:var(--danger); }
  .sl-draft .empty { color:var(--ink-faint); font-size:.82rem; padding:6px 2px; }
  #slResults { max-height:44vh; overflow-y:auto; border:1px solid var(--line); border-radius:10px; margin-top:6px; background:#fff; }
  #slResults .r { padding:10px 13px; border-bottom:1px solid var(--line); font-size:.86rem; }
  #slResults .r:last-child { border-bottom:none; }
  #slResults .r .ly { display:block; font-size:.74rem; color:var(--ink-faint); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #slResults .r.added { background:var(--op-bg); }
  .send-row { display:flex; justify-content:flex-end; margin-top:16px; }
  .send-row button {
    background:var(--op); border:none; border-radius:10px; padding:12px 22px;
    font-weight:700; color:#fff; font-size:.95rem;
  }
  .send-row button:disabled { opacity:.5; }
  .status { font-size:.85rem; margin-top:10px; min-height:1.2em; text-align:center; }
  .status.ok { color:var(--ok); }
  .status.err { color:var(--danger); }
  .err-screen { text-align:center; padding:60px 20px; color:var(--ink-soft); }
</style>
</head>
<body>
<div class="wrap" id="app">
  <h1>Soạn Setlist</h1>
  <p class="sub">Kênh Band</p>
  <div class="offline-note">Gửi được ngay cả khi máy trình chiếu đang tắt — danh sách sẽ tự nạp vào lịch trình khi máy mở lại.</div>

  <div class="field">
    <label for="yourName">Tên của bạn</label>
    <input id="yourName" placeholder="VD: Minh" maxlength="40">
  </div>
  <div class="field">
    <label for="slName">Tên setlist</label>
    <input id="slName" placeholder="VD: CN sáng 09/09" maxlength="80">
  </div>

  <div class="sl-draft" id="slDraft"></div>

  <div class="field">
    <label for="slSearch">Tìm bài hát</label>
    <input id="slSearch" placeholder="Gõ tên / số bài để thêm…" autocomplete="off">
  </div>
  <div id="slResults" class="hidden"></div>

  <div class="send-row"><button type="button" id="slSend">Gửi Setlist</button></div>
  <div class="status" id="slStatus"></div>
</div>
<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var roomId = params.get('room') || '';

  if (!roomId) {
    document.getElementById('app').innerHTML = '<div class="err-screen">Thiếu link phòng.<br>Xin lấy lại link từ người trình chiếu (mục "Kênh Band" trong app).</div>';
    return;
  }

  var LS_KEY = 'bandcomposer.v1.' + roomId;
  var state = {};
  try { state = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { state = {}; }
  if (!Array.isArray(state.draft)) state.draft = [];
  function saveState() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  if (state.name) $('yourName').value = state.name;
  $('yourName').addEventListener('change', function () { state.name = this.value.trim().slice(0, 40); saveState(); });

  var songs = [];
  var libLoaded = false;

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  }

  function fetchLibrary() {
    fetch('/library?roomId=' + encodeURIComponent(roomId))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        songs = (j && Array.isArray(j.songs)) ? j.songs : [];
        libLoaded = true;
        renderResults($('slSearch').value);
      })
      .catch(function () { libLoaded = true; renderResults($('slSearch').value); });
  }
  fetchLibrary();

  function renderDraft() {
    var box = $('slDraft'); box.textContent = '';
    var d = state.draft;
    if (!d.length) {
      var e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'Chưa có bài. Gõ tìm bên dưới rồi chạm để thêm.';
      box.appendChild(e); return;
    }
    d.forEach(function (it, i) {
      var row = document.createElement('div'); row.className = 'row';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1) + '. ' + it.title;
      row.appendChild(n);
      [['↑', -1], ['↓', 1], ['×', 0]].forEach(function (pair) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = pair[0];
        if (pair[1] === 0) b.className = 'x';
        b.addEventListener('click', function () {
          if (pair[1] === 0) { state.draft.splice(i, 1); }
          else { var j = i + pair[1]; if (j < 0 || j >= state.draft.length) return; var t = state.draft[i]; state.draft[i] = state.draft[j]; state.draft[j] = t; }
          saveState(); renderDraft(); renderResults($('slSearch').value);
        });
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  function renderResults(query) {
    var wrap = $('slResults');
    var q = norm(query).trim();
    if (!q) { wrap.classList.add('hidden'); wrap.textContent = ''; return; }
    var inDraft = {};
    state.draft.forEach(function (x) { inDraft[String(x.id)] = 1; });
    var hits = songs.filter(function (s) {
      return norm(s.title).indexOf(q) >= 0 || norm(s.lyrics).indexOf(q) >= 0;
    }).slice(0, 40);
    wrap.textContent = '';
    if (!hits.length) {
      wrap.classList.remove('hidden');
      var e = document.createElement('div'); e.className = 'r';
      e.textContent = libLoaded ? 'Không thấy bài nào.' : 'Đang tải thư viện…';
      wrap.appendChild(e); return;
    }
    hits.forEach(function (s) {
      var r = document.createElement('div'); r.className = 'r' + (inDraft[String(s.id)] ? ' added' : '');
      var title = document.createElement('span');
      title.textContent = (inDraft[String(s.id)] ? '✓ ' : '') + s.title;
      r.appendChild(title);
      if (s.lyrics) {
        var ly = document.createElement('span'); ly.className = 'ly';
        ly.textContent = String(s.lyrics).replace(/\\n+/g, ' · ').slice(0, 90);
        r.appendChild(ly);
      }
      r.addEventListener('click', function () {
        var k = String(s.id);
        if (inDraft[k]) { state.draft = state.draft.filter(function (x) { return String(x.id) !== k; }); }
        else { state.draft.push({ id: s.id, title: s.title }); }
        saveState(); renderDraft(); renderResults(query);
      });
      wrap.appendChild(r);
    });
    wrap.classList.remove('hidden');
  }

  $('slSearch').addEventListener('input', function () { renderResults(this.value); });

  function setStatus(text, kind) {
    var el = $('slStatus');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  $('slSend').addEventListener('click', function () {
    if (!state.draft.length) { setStatus('Setlist đang trống.', 'err'); return; }
    var name = $('slName').value.trim() || 'Setlist';
    var yourName = $('yourName').value.trim();
    var payload = {
      roomId: roomId,
      setlist: {
        id: 'sl-' + Date.now().toString(16) + Math.random().toString(16).slice(2, 8),
        name: name,
        from: { name: yourName },
        items: state.draft.map(function (x) { return { type: 'song', id: x.id, title: x.title }; })
      }
    };
    var btn = $('slSend');
    btn.disabled = true;
    setStatus('Đang gửi…');
    fetch('/setlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.j || !res.j.ok) {
          setStatus((res.j && res.j.error) || 'Không gửi được, thử lại sau.', 'err');
          return;
        }
        state.draft = []; saveState();
        $('slName').value = '';
        renderDraft(); renderResults('');
        setStatus('Đã gửi — sẽ tự nạp vào lịch trình khi máy trình chiếu mở lại.', 'ok');
      })
      .catch(function () {
        btn.disabled = false;
        setStatus('Không có mạng — thử lại khi có kết nối.', 'err');
      });
  });

  renderDraft();
})();
</script>
</body>
</html>
`;

// id sinh sẵn ở server local (newId('img') trong src/band-comm/protocol.js,
// dạng "img-<hex>") — Worker chỉ chấp nhận lại đúng khuôn đó, không tự sinh,
// để 1 ảnh có CHUNG id giữa file local và object R2 (galleryRemove(id) ở
// local mirror sang đây xoá đúng object).
function isValidImageId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // khớp cap ở src/band-comm/server.js's galleryAdd()

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const p = url.pathname;

    // ---- /api/room/<roomId>/<...> -> forward tới Durable Object của phòng đó
    // (GĐ2 relay realtime, xem room-relay.js). `roomId` = cloudRoomId. ----
    if (p.indexOf('/api/room/') === 0) {
      const rest = p.slice('/api/room/'.length);
      const slash = rest.indexOf('/');
      const roomCode = (slash >= 0 ? rest.slice(0, slash) : rest).toUpperCase();
      const subPath = slash >= 0 ? rest.slice(slash) : '/';
      if (!isValidRoomCode(roomCode)) return json({ error: 'ID phòng không hợp lệ' }, 400);
      return roomRelayFetch(env, roomCode, req, subPath);
    }

    // ---- POST /setlist { roomId, setlist:{id,name,from,ts,items} } ----
    if (p === '/setlist' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const roomId = body && body.roomId;
      const sl = body && body.setlist;
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      if (!(await checkRateLimit(env, roomId))) return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      if (!sl || typeof sl.id !== 'string' || !sl.id) return json({ error: 'thiếu setlist.id' }, 400);
      // Chặn sớm mảng khổng lồ trước khi .filter() phải duyệt hết — tránh tốn
      // CPU time (giới hạn theo request) cho payload rác.
      if (Array.isArray(sl.items) && sl.items.length > 500) return json({ error: 'Setlist quá lớn' }, 400);
      const items = (Array.isArray(sl.items) ? sl.items : [])
        .filter((it) => it && it.type === 'song' && it.id != null)
        .slice(0, MAX_ITEMS)
        .map((it) => ({ type: 'song', id: String(it.id).slice(0, 100), title: String(it.title || '').slice(0, 200) }));
      if (!items.length) return json({ error: 'Setlist rỗng' }, 400);
      const clean = {
        id: String(sl.id).slice(0, 80),
        name: String(sl.name || 'Setlist').trim().slice(0, 80) || 'Setlist',
        from: { name: String((sl.from && sl.from.name) || '').slice(0, 40) },
        ts: Date.now(),
        items
      };

      // Cap cứng/phòng: dọn bớt key cũ nhất nếu đã đầy trước khi ghi thêm.
      // Tên key mang id dạng "sl-<hex timestamp>..." (sinh ở app.js) nên sort
      // theo tên xấp xỉ đúng thứ tự thời gian — đủ tốt cho dọn dẹp, không cần
      // đọc lại từng giá trị để lấy `ts` thật (tốn thêm N lượt đọc KV).
      const existing = await env.SETLISTS.list({ prefix: `sl:${roomId}:`, limit: 1000 });
      if (existing.keys.length >= MAX_SETLISTS_PER_ROOM) {
        const sorted = existing.keys.map((k) => k.name).sort();
        const toDelete = sorted.slice(0, sorted.length - MAX_SETLISTS_PER_ROOM + 1);
        await Promise.all(toDelete.map((k) => env.SETLISTS.delete(k)));
      }

      await env.SETLISTS.put(`sl:${roomId}:${clean.id}`, JSON.stringify(clean), { expirationTtl: TTL_SECONDS });
      return json({ ok: true, id: clean.id });
    }

    // ---- GET /setlist?roomId= -> mọi setlist còn hạn cho phòng đó ----
    if (p === '/setlist' && req.method === 'GET') {
      const roomId = url.searchParams.get('roomId');
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      const list = await env.SETLISTS.list({ prefix: `sl:${roomId}:`, limit: 100 });
      const out = [];
      for (const k of list.keys) {
        const v = await env.SETLISTS.get(k.name);
        if (v) { try { out.push(JSON.parse(v)); } catch (e) {} }
      }
      out.sort((a, b) => a.ts - b.ts);
      return json({ setlists: out });
    }

    // ---- POST /setlist/ack { roomId, id } -> laptop báo đã nhận ----
    if (p === '/setlist/ack' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const roomId = body && body.roomId;
      const id = body && String(body.id || '').slice(0, 80);
      if (!isValidRoomId(roomId) || !id) return json({ error: 'thiếu roomId/id' }, 400);
      if (!(await checkRateLimit(env, roomId))) return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      await env.SETLISTS.put(`ack:${roomId}:${id}`, '1', { expirationTtl: TTL_SECONDS });
      return json({ ok: true });
    }

    // ---- GET /setlist/ack?roomId=&ids=a,b,c -> điện thoại poll xem cái nào xong ----
    if (p === '/setlist/ack' && req.method === 'GET') {
      const roomId = url.searchParams.get('roomId');
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const acked = [];
      for (const id of ids) {
        const v = await env.SETLISTS.get(`ack:${roomId}:${id}`);
        if (v) acked.push(id);
      }
      return json({ acked });
    }

    // ---- POST /library-sync { roomId, songs:[{id,title,lyrics}] } -> ghi đè
    // toàn bộ chỉ mục thư viện cho phòng đó. Gọi từ server.js mỗi lần band-comm
    // start + mỗi lần thư viện bài hát đổi (save/delete/import) — xem
    // syncLibraryToCloud() trong src/band-comm/server.js. ----
    if (p === '/library-sync' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const roomId = body && body.roomId;
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      if (!(await checkRateLimit(env, roomId))) return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      const songs = (Array.isArray(body.songs) ? body.songs : [])
        .filter((s) => s && s.id != null && s.title)
        .slice(0, MAX_LIBRARY_SONGS)
        .map((s) => ({
          id: String(s.id).slice(0, 100),
          title: String(s.title).slice(0, 200),
          lyrics: String(s.lyrics || '').slice(0, MAX_LYRICS_CHARS)
        }));
      await env.SETLISTS.put(`lib:${roomId}`, JSON.stringify({ songs, updatedAt: Date.now() }), { expirationTtl: LIBRARY_TTL_SECONDS });
      return json({ ok: true, count: songs.length });
    }

    // ---- GET /library?roomId= -> chỉ mục thư viện đã đồng bộ gần nhất, cho
    // trang soạn setlist tĩnh (/composer) tra cứu khi laptop tắt hẳn ----
    if (p === '/library' && req.method === 'GET') {
      const roomId = url.searchParams.get('roomId');
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      const raw = await env.SETLISTS.get(`lib:${roomId}`);
      if (!raw) return json({ songs: [], updatedAt: 0 });
      try { return json(JSON.parse(raw)); } catch (e) { return json({ songs: [], updatedAt: 0 }); }
    }

    // ---- POST /gallery { roomId, id, name, ext, dataB64 } -> mirror 1 ảnh
    // đã upload/xác thực xong ở server local sang R2 để xem ổn định ----
    if (p === '/gallery' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const roomId = body && body.roomId;
      const id = body && body.id;
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      if (!isValidImageId(id)) return json({ error: 'id không hợp lệ' }, 400);
      if (!(await checkRateLimit(env, roomId))) return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      const ext = /^\.(jpe?g|png|webp)$/i.test(String(body.ext || '')) ? String(body.ext).toLowerCase() : '.jpg';
      const contentType = IMAGE_MIME[ext] || 'image/jpeg';
      const b64 = String(body.dataB64 || '').replace(/^data:[^,]*,/, '');
      if (!b64) return json({ error: 'thiếu dataB64' }, 400);
      let buf;
      try { buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch (e) { return json({ error: 'dataB64 không hợp lệ' }, 400); }
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) return json({ error: 'Ảnh quá lớn' }, 400);
      await env.GALLERY.put(`${roomId}/${id}`, buf, {
        httpMetadata: { contentType },
        customMetadata: { name: String(body.name || 'Hợp âm').slice(0, 80) }
      });
      return json({ ok: true, id });
    }

    // ---- GET /gallery/image/<roomId>/<id> -> bytes ảnh, phục vụ trực tiếp
    // từ R2 (điện thoại gọi thẳng, không qua server local) ----
    if (p.indexOf('/gallery/image/') === 0 && req.method === 'GET') {
      const rest = p.slice('/gallery/image/'.length).split('/');
      const roomId = rest[0], id = rest[1];
      if (!isValidRoomId(roomId) || !isValidImageId(id)) return json({ error: 'không hợp lệ' }, 400);
      const obj = await env.GALLERY.get(`${roomId}/${id}`);
      if (!obj) return json({ error: 'not found' }, 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          ...CORS
        }
      });
    }

    // ---- POST /gallery/remove { roomId, id } -> mirror xoá (operator xoá ở
    // local, hoặc dọn tay trước khi tới hạn 4 ngày) ----
    if (p === '/gallery/remove' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const roomId = body && body.roomId;
      const id = body && body.id;
      if (!isValidRoomId(roomId) || !isValidImageId(id)) return json({ error: 'không hợp lệ' }, 400);
      await env.GALLERY.delete(`${roomId}/${id}`);
      return json({ ok: true });
    }

    // ---- GET /composer -> trang soạn setlist tĩnh, không cần laptop operator
    // đang chạy (?room=<cloudRoomId>, xem COMPOSER_HTML ở trên) ----
    if (p === '/composer' && req.method === 'GET') {
      return new Response(COMPOSER_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } });
    }

    // ---- GET /m, /m/, /m/app.js -> trang join Kênh Band (comm/mobile/),
    // mount qua binding MOBILE_ASSETS (xem wrangler.toml) — URL CỐ ĐỊNH, không
    // đổi theo máy operator/tunnel như LAN cũ (?room=<code> giữ nguyên như
    // /composer). GĐ2, band-comm-plan.md §14.
    // `/m` (không có dấu / cuối) PHẢI redirect sang `/m/` trước — index.html
    // dùng <script src="app.js"> TƯƠNG ĐỐI (y hệt bản LAN gốc phục vụ ở
    // path gốc "/"), trình duyệt resolve tương đối theo URL trang đang mở:
    // mở đúng "/m/" thì ra "/m/app.js" (đúng); mở "/m" (thiếu /) thì ra
    // "/app.js" (sai, 404) — đã tái hiện thật qua curl trước khi thêm redirect. ----
    // ---- GET / hoặc /m -> tự động redirect sang /m/ (kèm query string ?room=<code>)
    // Giúp người dùng khi truy cập trực tiếp channel.worship-official.link hoặc
    // channel.worship-official.link/?room=... đều vào thẳng trang Kênh Band mà không bị crash/JSON thô ----
    if (req.method === 'GET' && (p === '/' || p === '/m')) {
      return Response.redirect(url.origin + '/m/' + url.search, 302);
    }
    if (req.method === 'GET' && (p === '/m/' || p.indexOf('/m/') === 0)) {
      const assetUrl = new URL(req.url);
      assetUrl.pathname = p === '/m/' ? '/index.html' : p.slice('/m'.length);
      const assetRes = await env.MOBILE_ASSETS.fetch(new Request(assetUrl, req));
      // Assets binding trả response gốc (không có CORS header của worker.js
      // này) — không sao vì trang tự tải (same-origin request từ chính nó,
      // browser không cần CORS cho navigation/script-src gốc), chỉ cần khi
      // JS bên trong gọi fetch() sang origin khác (đã có CORS ở các route đó).
      return assetRes;
    }

    if (p === '/health') return json({ ok: true, service: 'band-comm-relay' });

    return json({ error: 'not found' }, 404);
  }
};
