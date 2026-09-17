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

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 ngày
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
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

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
        from: { name: String((sl.from && sl.from.name) || '').slice(0, 40), role: (sl.from && sl.from.role) || 'band' },
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

    if (p === '/' || p === '/health') return json({ ok: true, service: 'band-comm-relay' });

    return json({ error: 'not found' }, 404);
  }
};
