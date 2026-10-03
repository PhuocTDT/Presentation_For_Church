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
// ── Xác thực OPERATOR cho các endpoint ghi dành riêng cho laptop (B-17) ──────────
// Trước đây các endpoint này chỉ kiểm tra roomId (= mã phòng 6 ký tự, mọi thành
// viên ban hát đều biết) → ai biết mã phòng cũng ghi đè được thư viện, ack/xoá
// setlist, ghi/xoá ảnh của phòng đó. Giờ operator phải gửi X-Admin-Secret
// (relayAdminSecret trong band-comm.json — cùng khóa đã dùng cho /admin/config và WS);
// Worker hỏi Durable Object của phòng (/admin/verify) xem có khớp không.
//
// env.OPERATOR_AUTH_MODE (wrangler.toml [vars]):
//   'enforce' (mặc định nếu thiếu) — thiếu hoặc sai secret → từ chối
//   'log'     — thiếu secret thì cho qua + ghi log (giai đoạn chuyển tiếp để các bản
//               app cũ chưa gửi header vẫn chạy). Secret SAI thì luôn bị từ chối.
//   'off'     — tắt kiểm tra (chỉ để debug)
// Chỉ request có header X-Admin-Secret mới chạm tới Durable Object (tránh spam tạo DO).
const AUTH_FAIL_WINDOW_MS = 5 * 60 * 1000;
const AUTH_FAIL_MAX = 20; // tối đa 20 lần sai secret / IP / 5 phút
async function authFailureBudget(env, ip) {
  const raw = await env.SETLISTS.get(`rlf:${ip}:${Math.floor(Date.now() / AUTH_FAIL_WINDOW_MS)}`);
  return (raw ? (parseInt(raw, 10) || 0) : 0) < AUTH_FAIL_MAX;
}
async function recordAuthFailure(env, ip) {
  const key = `rlf:${ip}:${Math.floor(Date.now() / AUTH_FAIL_WINDOW_MS)}`;
  const raw = await env.SETLISTS.get(key);
  await env.SETLISTS.put(key, String((raw ? (parseInt(raw, 10) || 0) : 0) + 1), { expirationTtl: Math.ceil(AUTH_FAIL_WINDOW_MS / 1000) + 60 });
}
async function verifyOperatorSecret(env, req, roomId) {
  if (!isValidRoomCode(roomId)) return false; // DO chỉ định danh theo mã phòng hợp lệ (A-Z0-9, 4-10)
  const secret = req.headers.get('X-Admin-Secret') || '';
  if (secret.length < 16 || secret.length > 256) return false;
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  const res = await stub.fetch(`https://relay.internal/admin/verify?roomCode=${encodeURIComponent(roomId)}`, {
    method: 'POST',
    headers: { 'X-Admin-Secret': secret }
  });
  return res.status === 200;
}
// Trả null nếu được phép; ngược lại trả Response lỗi để caller return ngay.
async function requireOperator(env, req, roomId, label) {
  const mode = String(env.OPERATOR_AUTH_MODE || 'enforce').toLowerCase();
  if (mode === 'off') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (req.headers.get('X-Admin-Secret')) {
    if (!(await authFailureBudget(env, ip))) return json({ error: 'Quá nhiều lần thử, thử lại sau ít phút' }, 429);
    if (await verifyOperatorSecret(env, req, roomId)) return null;
    await recordAuthFailure(env, ip);
    return json({ error: 'Không có quyền operator cho phòng này' }, 403);
  }
  if (mode === 'log') {
    console.warn(`[operator-auth] ${label}: thiếu X-Admin-Secret (room ${roomId}) — chế độ log, cho qua`);
    return null;
  }
  return json({ error: 'Thiếu X-Admin-Secret của operator' }, 401);
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

// Style rút gọn của bài hát (chỉ đủ để trang /setlist/ vẽ preview slide) —
// whitelist từng trường, KHÔNG nhận nguyên object do desktop gửi.
function sanitizeSongStyle(st) {
  const out = {};
  if (!st || typeof st !== 'object') return out;
  const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined; };
  const put = (k, v) => { if (v !== undefined) out[k] = v; };
  put('fontFamily', str(st.fontFamily, 60));
  put('fontSize', str(String(st.fontSize == null ? '' : st.fontSize), 12));
  put('color', str(st.color, 30));
  put('textStrokeColor', str(st.textStrokeColor, 30));
  put('textAlign', ['left', 'center', 'right', 'justify'].includes(st.textAlign) ? st.textAlign : undefined);
  put('verticalAlign', ['top', 'center', 'middle', 'bottom'].includes(st.verticalAlign) ? st.verticalAlign : undefined);
  put('textStrokeWidth', num(st.textStrokeWidth, 0, 30));
  return out;
}

// Trang soạn setlist đã tách thành trang riêng comm/setlist/ (phục vụ ở /setlist/
// qua binding MOBILE_ASSETS, xem route bên dưới). /composer cũ chỉ còn là redirect.

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
        .map((it) => {
          const out = { type: 'song', id: String(it.id).slice(0, 100), title: String(it.title || '').slice(0, 200) };
          // webId = bài tạo mới trên web; lời lấy từ relay lúc operator nạp (không đi theo setlist)
          if (it.webId != null && /^[A-Za-z0-9_-]{8,64}$/.test(String(it.webId))) out.webId = String(it.webId);
          return out;
        });
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
      // Người gõ tay /setlist (không có roomId) -> đưa tới trang; có roomId = API hộp thư của desktop.
      if (!url.searchParams.has('roomId')) return Response.redirect(url.origin + '/setlist/' + url.search, 302);
      const roomId = url.searchParams.get('roomId');
      if (!isValidRoomId(roomId)) return json({ error: 'roomId không hợp lệ' }, 400);
      const denied = await requireOperator(env, req, roomId, 'GET /setlist');
      if (denied) return denied;
      const list = await env.SETLISTS.list({ prefix: `sl:${roomId}:`, limit: 100 });
      const out = [];
      for (const k of list.keys) {
        const id = k.name.replace(`sl:${roomId}:`, '');
        if (id) {
          const isAcked = await env.SETLISTS.get(`ack:${roomId}:${id}`);
          if (isAcked) {
            await env.SETLISTS.delete(k.name).catch(() => {});
            continue;
          }
        }
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
      const denied = await requireOperator(env, req, roomId, 'POST /setlist/ack');
      if (denied) return denied;
      if (!(await checkRateLimit(env, roomId))) return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      await env.SETLISTS.put(`ack:${roomId}:${id}`, '1', { expirationTtl: TTL_SECONDS });
      await env.SETLISTS.delete(`sl:${roomId}:${id}`).catch(() => {});
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
      const denied = await requireOperator(env, req, roomId, 'POST /library-sync');
      if (denied) return denied;
      if (!(await checkRateLimit(env, roomId))) return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      const songs = (Array.isArray(body.songs) ? body.songs : [])
        .filter((s) => s && s.id != null && s.title)
        .slice(0, MAX_LIBRARY_SONGS)
        .map((s) => ({
          id: String(s.id).slice(0, 100),
          title: String(s.title).slice(0, 200),
          lyrics: String(s.lyrics || '').slice(0, MAX_LYRICS_CHARS),
          style: sanitizeSongStyle(s.style),
          bg: typeof s.bg === 'string' && s.bg ? s.bg.slice(0, 200) : null,
          // webId = bài này vốn do thành viên tạo trên web (đã được duyệt) -> web khử trùng với danh sách bài web
          webId: s.webId != null && /^[A-Za-z0-9_-]{8,64}$/.test(String(s.webId)) ? String(s.webId) : null
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
      const denied = await requireOperator(env, req, roomId, 'POST /gallery');
      if (denied) return denied;
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
      const denied = await requireOperator(env, req, roomId, 'POST /gallery/remove');
      if (denied) return denied;
      await env.GALLERY.delete(`${roomId}/${id}`);
      return json({ ok: true });
    }

    // ---- GET /backgrounds/image/<roomCode>/<id> -> ảnh nền (R2 BGS) cho preview ở /setlist/.
    // Giống /gallery/image: id ngẫu nhiên không đoán được là "khoá"; đổi ảnh = đổi id nên cache dài an toàn.
    if (p.indexOf('/backgrounds/image/') === 0 && req.method === 'GET') {
      const m = /^\/backgrounds\/image\/([A-Z0-9]{4,10})\/([A-Za-z0-9_-]{4,64})$/.exec(p);
      if (!m || !env.BGS) return json({ error: 'not found' }, 404);
      const obj = await env.BGS.get(m[1] + '/' + m[2]);
      if (!obj) return json({ error: 'not found' }, 404);
      return new Response(obj.body, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', ...CORS }
      });
    }

    // ---- GET /composer (link/QR cũ) -> /setlist/ giữ nguyên ?room=... ----
    if (p === '/composer' && req.method === 'GET') {
      return Response.redirect(url.origin + '/setlist/' + url.search, 302);
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
    // ---- GET /setlist/ và /setlist/<file> -> trang soạn setlist (comm/setlist/) ----
    // Cố ý chỉ khớp có dấu / cuối: GET /setlist?roomId= là API hộp thư (xem trên).
    if (req.method === 'GET' && p.indexOf('/setlist/') === 0) {
      const assetUrl = new URL(req.url);
      assetUrl.pathname = p === '/setlist/' ? '/setlist/index.html' : p;
      return env.MOBILE_ASSETS.fetch(new Request(assetUrl, req));
    }
    if (req.method === 'GET' && (p === '/m/' || p.indexOf('/m/') === 0)) {
      const assetUrl = new URL(req.url);
      assetUrl.pathname = p === '/m/' ? '/mobile/index.html' : '/mobile' + p.slice('/m'.length);
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
