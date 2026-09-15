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

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 ngày
const MAX_ITEMS = 60;
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
      if (!sl || typeof sl.id !== 'string' || !sl.id) return json({ error: 'thiếu setlist.id' }, 400);
      const items = (Array.isArray(sl.items) ? sl.items : [])
        .filter((it) => it && it.type === 'song' && it.id != null)
        .slice(0, MAX_ITEMS)
        .map((it) => ({ type: 'song', id: it.id, title: String(it.title || '').slice(0, 200) }));
      if (!items.length) return json({ error: 'Setlist rỗng' }, 400);
      const clean = {
        id: String(sl.id).slice(0, 80),
        name: String(sl.name || 'Setlist').trim().slice(0, 80) || 'Setlist',
        from: { name: String((sl.from && sl.from.name) || '').slice(0, 40), role: (sl.from && sl.from.role) || 'band' },
        ts: Date.now(),
        items
      };
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

    if (p === '/' || p === '/health') return json({ ok: true, service: 'band-comm-relay' });

    return json({ error: 'not found' }, 404);
  }
};
