// Band Comm — Durable Object relay (GĐ2, thay LAN HTTP+WS server trong
// src/band-comm/server.js). Mỗi phòng (1 nhà thờ) = 1 instance DO riêng,
// định danh bằng CHÍNH `room.code` (ID phòng 6 ký tự, KHÔNG phải
// `cloudRoomId` UUID) — code là thứ điện thoại BIẾT SẴN trước khi join
// (gõ tay hoặc `?room=` trong link/QR), còn cloudRoomId chỉ lộ ra SAU khi
// join thành công nên không dùng làm khoá định tuyến được. `cloudRoomId`
// vẫn giữ nguyên vai trò namespace cho gallery/setlist/library-sync (KV/R2
// trên chính Worker này, không đổi) — DO chỉ LƯU LẠI giá trị đó (operator
// gửi kèm lúc `/admin/config`) để trả lại cho client dùng đúng chỗ cũ, không
// dùng nó để định tuyến. Va chạm code giữa 2 phòng khác nhau về lý thuyết có
// thể xảy ra (32^6 ≈ 1 tỷ khả năng) nhưng ở quy mô thực tế (nhà thờ) coi như
// không đáng kể — nếu cần chống tuyệt đối sau này, thêm KV `code->cloudRoomId`
// là đủ, chưa cần ngay.
//
// Cả operator (laptop) LẪN band member (điện thoại) đều là
// WebSocket CLIENT nối ra ngoài tới đây — không còn ai "host server" nữa,
// nên không cần LAN discovery (mDNS), không cần Cloudflare Tunnel, không có
// cổng nào mở ra Internet từ máy operator. Xem band-comm-plan.md §14.
//
// Dùng WebSocket Hibernation API (`ctx.acceptWebSocket`) — Cloudflare được
// phép evict DO khỏi memory giữa các message (rẻ hơn nhiều so với giữ 1
// instance sống 24/7 cho mỗi phòng), nhưng kết nối WS vẫn sống; state cần
// nhớ giữa các lần evict PHẢI nằm trong `ws.serializeAttachment()` (tối đa
// ~2KB, sống lại được sau hibernate) hoặc `ctx.storage` (durable, ghi disk).
// KHÔNG dùng biến JS thường (Map ở module scope) để nhớ session — mất ngay
// khi DO bị evict.
//
// Đối chiếu 1-1 với protocol.js (Node, dùng ở LAN server cũ) — cố tình giữ
// CÙNG envelope shape để phía client (comm/mobile/app.js, index.html) đổi
// tối thiểu khi rewire từ LAN sang relay này.

import {
  isValidUsername, isValidPassword, publicAccount,
  createAccount, updateAccountPassword, updateAccount, setAccountActive, removeAccount,
  verifyAccount, changeOwnPassword, verifyPasswordHash
} from './accounts-webcrypto.js';
import { createCognitoVerifier } from './cognito-verify.js';

const RING_MAX = 120;               // số envelope replay được khi phone reconnect
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000; // giống TOKEN_MAX_AGE_MS ở server.js cũ
const DUP_WINDOW_MS = 5000;
const BLOCK_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // Chặn (operator) tự hết hạn sau 3 ngày
const MSG_TYPES = ['alert', 'text', 'ack', 'resolve', 'presence', 'gallery', 'room', 'system', 'setlist', 'songnew'];

// Hộp thư "bài hát mới từ web" (trang /setlist/) — operator duyệt rồi mới nạp
// vào thư viện desktop. Giới hạn khớp worker.js's /library-sync để bài đã
// duyệt không bị cắt khi đồng bộ ngược lại lên web.
const SONG_TITLE_MAX = 200;
const SONG_LYRICS_MAX = 6000;
const SONG_INBOX_MAX_PENDING = 50;          // tối đa bài đang chờ duyệt / phòng
const SONG_SUBMIT_PER_HOUR = 10;            // tối đa bài / thành viên / giờ
const SONG_RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // giữ bản đã duyệt/từ chối để web hiện trạng thái
const SONG_WEBID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// Nền ĐÍNH KÈM setlist (tuỳ chọn) = TÊN file ảnh trong thư viện media của máy chiếu. Chỉ là chuỗi để khớp tên,
// không phải đường dẫn: bỏ ký tự điều khiển và < > / \\ : * ? " | để không thành path/HTML. Rỗng = không có nền.
function cleanBgName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>\/\\:*?"|]/g, '').trim().slice(0, 200);
}
const SONG_PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // bài web chưa ai đưa vào setlist: giữ 30 ngày

// Lịch sử setlist đã gửi của phòng (tab "Đã gửi" ở trang /setlist/): lưu để xem lại + gửi lại.
const SL_HISTORY_MAX = 50;                                // tối đa setlist lưu / phòng (cũ nhất bị dọn)
const SL_HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000;       // quá 90 ngày kể từ lần gửi cuối thì dọn

// Ảnh nền thư viện (desktop đẩy bản thu nhỏ ~960px JPEG) để trang /setlist/ xem trước
// slide. Bucket R2 RIÊNG (binding BGS) — KHÔNG dùng bucket gallery vì bucket đó
// tự xoá sau 4 ngày (lifecycle expire-4d), còn nền phải sống lâu.
const BG_MAX_BYTES = 400 * 1024;
const BG_MAX_PER_ROOM = 200;

// Chuẩn hoá lời bài hát ĐÚNG như trang web (comm/setlist/slides.js) và desktop
// (index.html getLyricsFromEditor): CRLF -> LF, cắt khoảng trắng cuối dòng,
// một hoặc nhiều dòng trống = 1 ngắt slide (\n\n), bỏ khối rỗng.
function normalizeSongLyrics(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return text.split(/\n\s*\n/)
    .map((blk) => blk.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
}
function normalizeSongTitle(raw) {
  return String(raw || '').replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SONG_TITLE_MAX);
}
const PENDING_LOGIN_MAX_AGE_MS = 5 * 60 * 1000; // y hệt server.js cũ

// ---- Web Crypto helpers (Workers runtime không có Node's `crypto` module —
// chỉ có `crypto.subtle`/`crypto.getRandomValues`, cả 2 đều async-first) ----
function randomHex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function newId(prefix) {
  return `${prefix}-${randomHex(6)}`;
}
function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlEncodeStr(str) {
  return b64urlEncode(new TextEncoder().encode(str));
}
function b64urlDecodeToStr(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    // atob() trả chuỗi Latin-1 bytes — phải decode lại qua TextDecoder để
    // khôi phục đúng UTF-8 (ký tự tiếng Việt dấu multi-byte). Dùng cách
    // compatible nhất: chuyển binary string sang Uint8Array rồi decode.
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) { return ''; }
}
async function importHmacKey(secretHex) {
  const bytes = new Uint8Array(secretHex.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmacSign(key, data) {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

// Strip Vietnamese diacritics + punctuation, lowercase, collapse spaces —
// y hệt protocol.js's normalizeDedupKey (Node), port sang runtime này.
function normalizeDedupKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeEnvelope({ type, from, to, text, buttonId, refId, meta }) {
  const safeType = MSG_TYPES.includes(type) ? type : 'system';
  const body = String(text || '');
  return {
    id: newId('m'),
    ts: Date.now(),
    type: safeType,
    from: from || { clientId: 'server', name: 'Kênh Band' },
    to: to || 'all',
    refId: refId || null,
    buttonId: buttonId || null,
    dedupKey: safeType === 'alert' ? normalizeDedupKey(body) : null,
    text: body,
    meta: meta || {}
  };
}

function json(obj, status = 200, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...(extraHeaders || {}) }
  });
}

function sanitizeName(v) {
  return String(v || '').trim().slice(0, 40) || 'Ẩn danh';
}

export class RoomRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Đọc 1 lần lúc DO thức dậy (constructor chạy lại mỗi lần evict/re-hydrate) —
    // `blockConcurrencyWhile` đảm bảo không request nào chạy trước khi state
    // load xong từ storage (tránh race lúc DO vừa dậy).
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.config = (await ctx.storage.get('config')) || null;
      this.secretHex = (await ctx.storage.get('secretHex')) || null;
      this.adminSecret = (await ctx.storage.get('adminSecret')) || null;
      this.ring = (await ctx.storage.get('ring')) || [];
      this.accounts = (await ctx.storage.get('accounts')) || [];
      this.profiles = (await ctx.storage.get('profiles')) || {}; // profileId -> {name, updatedAt, buttons}
      this.gallery = (await ctx.storage.get('gallery')) || { images: [], updatedAt: 0 }; // {images:[{id,name,ownerId}], updatedAt}
      this.blocked = (await ctx.storage.get('blocked')) || {}; // profileId -> {name, blockedAt}
      this.songInbox = (await ctx.storage.get('songInbox')) || []; // bài mới từ web chờ operator duyệt
      this.bgManifest = (await ctx.storage.get('bgManifest')) || { items: [], updatedAt: 0 }; // ảnh nền: [{id,name,key,size}]
      this.slHistory = (await ctx.storage.get('slHistory')) || []; // setlist đã gửi: [{id,name,items,by,submitter,ts,lastSentAt,sendCount}]
    });
    // Chống brute-force /join, /login — y hệt curve joinAttempts ở LAN
    // server.js cũ, CHỈ khác chỗ lưu (RAM của instance DO, không phải
    // ctx.storage): reset khi DO bị evict là đánh đổi CHẤP NHẬN ĐƯỢC, giống
    // LAN server cũ cũng reset khi restart — không phải state cần sống sót
    // qua evict, và ghi storage mỗi lần thử sẽ tốn 1 lượt storage write/
    // request không cần thiết.
    this.joinAttempts = new Map(); // key -> { fails, blockUntil, lastAt }
    // Chống spam /gallery/add — không có gì chặn trước đây (khác hẳn worker.js's
    // /gallery vốn có checkRateLimit), 1 client hợp lệ (biết mật khẩu phòng)
    // có thể gọi liên tục ảnh ~8MB, tốn R2 storage/request cost, và cuối cùng
    // làm mảng metadata ctx.storage.put('gallery', …) vượt giới hạn 1 key
    // (~128KiB) khiến upload hỏng cho CẢ phòng. Cùng kiểu lưu RAM-only như
    // joinAttempts — reset khi DO evict là chấp nhận được.
    this.galleryAddAttempts = new Map(); // key -> number[] (timestamps trong cửa sổ)
    // accountId/name đã xác thực xong bước 1 (/login), chờ mật khẩu phòng
    // bước 2 (/join-room) nếu config.passwordRequiredWithAccounts bật — y hệt
    // pendingLogins ở server.js cũ. KHÔNG cần sống sót qua evict (TTL 5 phút,
    // dùng 1 lần) nên RAM là đủ, không cần ctx.storage.
    this.pendingLogins = new Map(); // tempToken -> { accountId, name, mustChangePassword, expiresAt }
    // Lazy — chỉ phòng có authMode='cognito' mới cần, tránh phí 1 verifier
    // (+ JWKS cache riêng) cho mọi phòng khác chỉ dùng tài khoản cục bộ.
    this.cognitoVerifier = null;
  }

  async persistAccounts() {
    await this.ctx.storage.put('accounts', this.accounts);
  }

  passwordBackoffMs(fails) {
    if (fails < 5) return 0;
    if (fails < 10) return 30 * 1000;
    if (fails < 20) return 5 * 60 * 1000;
    return 30 * 60 * 1000;
  }
  checkJoinBlocked(key) {
    const att = this.joinAttempts.get(key);
    const now = Date.now();
    return (att && att.blockUntil > now) ? Math.ceil((att.blockUntil - now) / 1000) : 0;
  }
  recordJoinFailure(key) {
    const now = Date.now();
    const next = this.joinAttempts.get(key) || { fails: 0, blockUntil: 0, lastAt: now };
    next.fails += 1;
    next.lastAt = now;
    next.blockUntil = now + this.passwordBackoffMs(next.fails);
    this.joinAttempts.set(key, next);
    // Dọn entry cũ >1h luôn tiện lúc này — tần suất gọi (mỗi lần có ai gõ sai)
    // đủ thấp để không cần timer riêng như HEARTBEAT_MS ở LAN server cũ.
    for (const [k, a] of this.joinAttempts) {
      if (now - a.lastAt > 60 * 60 * 1000) this.joinAttempts.delete(k);
    }
  }
  clearJoinAttempts(key) { this.joinAttempts.delete(key); }

  // Block tự hết hạn sau BLOCK_DURATION_MS (3 ngày) — không xoá storage
  // ngay ở đây (hot path, gọi mỗi lần verifyToken()/join), entry hết hạn chỉ
  // nằm im vô hại; dọn thật sự xảy ra lúc operator xem danh sách "Đã chặn"
  // (handleAdminPresence's action 'blocked').
  isProfileBlocked(profileId) {
    const b = this.blocked[profileId];
    return !!b && (Date.now() - b.blockedAt) < BLOCK_DURATION_MS;
  }

  // true nếu được phép thêm ảnh (chưa vượt `max` lần trong `windowMs` gần
  // nhất) — sliding window đơn giản bằng mảng timestamp, đủ dùng cho quy mô
  // 1 phòng/band nhỏ, không cần chính xác tuyệt đối như KV bucket-count.
  checkGalleryAddRateLimit(key, max = 20, windowMs = 5 * 60 * 1000) {
    const now = Date.now();
    const hits = (this.galleryAddAttempts.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) { this.galleryAddAttempts.set(key, hits); return false; }
    hits.push(now);
    this.galleryAddAttempts.set(key, hits);
    return true;
  }

  async ensureSecret() {
    if (this.secretHex) return this.secretHex;
    this.secretHex = randomHex(32);
    await this.ctx.storage.put('secretHex', this.secretHex);
    return this.secretHex;
  }

  async makeToken(clientId, name, profileId) {
    const secretHex = await this.ensureSecret();
    const key = await importHmacKey(secretHex);
    const issued = String(Date.now());
    const parts = [clientId, issued, b64urlEncodeStr(name), b64urlEncodeStr(profileId || '')];
    const sig = await hmacSign(key, parts.join('.'));
    return [...parts, sig].join('.');
  }

  async verifyToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 5) return null;
    const [clientId, issued, nameB64, profileB64, sig] = parts;
    const issuedNum = Number(issued);
    if (!clientId || !Number.isFinite(issuedNum)) return null;
    if (Date.now() - issuedNum > TOKEN_MAX_AGE_MS) return null;
    const secretHex = await this.ensureSecret();
    const key = await importHmacKey(secretHex);
    const expected = await hmacSign(key, parts.slice(0, 4).join('.'));
    if (expected !== sig) return null;
    const profileId = b64urlDecodeToStr(profileB64) || null;
    // Token cấp TRƯỚC lúc bị block vẫn còn hạn (tới 12h) — chặn NGAY Ở ĐÂY
    // (điểm xác thực token DUY NHẤT, mọi route /whoami, /gallery/*, /profile,
    // /setlist, WS upgrade... đều gọi verifyToken()) để 1 người bị block mất
    // quyền truy cập ngay lập tức, không chỉ riêng lúc /join lại từ đầu.
    if (profileId && this.isProfileBlocked(profileId)) return null;
    return { clientId, name: b64urlDecodeToStr(nameB64), profileId };
  }

  // Đổi secret -> mọi token đang tồn tại verify-fail ngay (y hệt
  // commServer.rotateSecret() ở LAN cũ) — dùng khi đổi mật khẩu phòng.
  async rotateSecret() {
    this.secretHex = randomHex(32);
    await this.ctx.storage.put('secretHex', this.secretHex);
  }

  // ---- Config phòng (name/code/password) — operator (main.js) gọi lúc
  // band-comm start, xác thực bằng adminSecret riêng (sinh 1 lần, lưu trong
  // band-comm.json phía laptop, KHÔNG phải cùng thứ với mật khẩu phòng band
  // member gõ). Lần gọi ĐẦU TIÊN (chưa có adminSecret nào) tự bootstrap. ----
  async handleAdminConfig(request) {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const headerSecret = request.headers.get('X-Admin-Secret') || '';
    const authHeader = request.headers.get('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    // Ai được (tái) đặt adminSecret của phòng? CHỈ:
    //   1) người đã giữ đúng adminSecret hiện tại, hoặc
    //   2) CHỦ PHÒNG — Cognito ID token hợp lệ có email == operatorEmail trong bản ghi
    //      phòng của identity (GLOBAL_USERS 'room:<code>'): bootstrap lần đầu, cài lại
    //      app, đổi máy.
    // Đã BỎ (B-19): "mật khẩu phòng khớp" và "DO chưa có config" — mật khẩu phòng mọi
    // thành viên ban hát đều biết nên bất kỳ ai cũng chiếm được quyền operator và khóa
    // operator thật ra ngoài; còn nhánh sau cho ai gửi trước thì giữ phòng.
    let isAuthorized = false;
    const newSecretValid = headerSecret.length >= 16 && headerSecret.length <= 256;

    if (this.adminSecret && this.checkAdminSecret(request)) {
      isAuthorized = true;
    } else if (newSecretValid && bearerToken) {
      const roomCodeForOwner = /^[A-Z0-9]{4,10}$/.test(String(body.code || '')) ? String(body.code) : ((this.config && this.config.code) || this.roomCode || '');
      if (await this.bearerIsRoomOwner(bearerToken, roomCodeForOwner)) {
        this.adminSecret = headerSecret;
        await this.ctx.storage.put('adminSecret', this.adminSecret);
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return json({ error: 'Sai admin secret' }, 403);
    }

    const name = String(body.name || 'Kênh Band').trim().slice(0, 60) || 'Kênh Band';
    const code = /^[A-Z0-9]{4,10}$/.test(String(body.code || '')) ? String(body.code) : (this.config && this.config.code) || '';
    const password = /^[a-zA-Z0-9]{4,12}$/.test(String(body.password || '')) ? String(body.password) : (this.config && this.config.password) || '';
    if (!code || !password) return json({ error: 'Thiếu code/password hợp lệ' }, 400);
    // cloudRoomId = UUID namespace CŨ (setlist/library/gallery, KV/R2 trên
    // chính Worker này) — DO không dùng để định tuyến (xem comment đầu file),
    // chỉ LƯU LẠI để trả cho client trong response /join, /login (finishLogin)
    // giữ nguyên hành vi gallery/setlist phía mobile không cần đổi gì.
    const cloudRoomId = /^[a-zA-Z0-9_-]{4,64}$/.test(String(body.cloudRoomId || '')) ? String(body.cloudRoomId) : ((this.config && this.config.cloudRoomId) || code);
    const passwordChanged = !this.config || this.config.password !== password;
    this.config = {
      name, code, password, cloudRoomId,
      passwordSetAt: passwordChanged ? Date.now() : ((this.config && this.config.passwordSetAt) || Date.now())
    };
    await this.ctx.storage.put('config', this.config);
    if (passwordChanged) await this.rotateSecret();
    return json({ ok: true, config: this.config });
  }

  // Cognito ID token hợp lệ VÀ email khớp chủ phòng đã đăng ký ở identity. Thiếu bản ghi
  // phòng / thiếu operatorEmail (phòng cũ) → từ chối (fail closed); operator vẫn dùng
  // được adminSecret đã ghim.
  async bearerIsRoomOwner(bearerToken, roomCode) {
    try {
      if (!roomCode || !this.env || !this.env.GLOBAL_USERS) return false;
      const raw = await this.env.GLOBAL_USERS.get(`room:${roomCode}`);
      if (!raw) return false;
      const owner = String((JSON.parse(raw) || {}).operatorEmail || '').trim().toLowerCase();
      if (!owner) return false;
      if (!this.cognitoVerifier) this.cognitoVerifier = createCognitoVerifier();
      const payload = await this.cognitoVerifier.verifyIdToken(bearerToken).catch(() => null);
      const email = String((payload && payload.email) || '').trim().toLowerCase();
      return !!email && email === owner;
    } catch (e) {
      console.error('bearerIsRoomOwner error:', e);
      return false;
    }
  }

  // ---- POST /admin/purge: XÓA TOÀN BỘ dữ liệu của phòng (quyền được xóa dữ liệu cá nhân, xem
  // chính sách riêng tư). Gồm: storage của Durable Object (cấu hình, tài khoản thành viên, hồ sơ nút
  // bấm, tin nhắn gần nhất, danh sách chặn, bài hát chờ duyệt, ảnh), ảnh hợp âm/ảnh nền trên R2,
  // và các khóa KV của phòng (hộp thư setlist, ack, thư viện đồng bộ). Ngắt mọi kết nối đang mở.
  // Ai được gọi: (a) đang giữ adminSecret của phòng, (b) chủ phòng bằng Cognito ID token, hoặc
  // (c) quản trị viên dịch vụ có env.ADMIN_PURGE_KEY (wrangler secret) qua header X-Purge-Key —
  // dùng khi chủ phòng gửi yêu cầu xóa mà không còn máy/khóa cũ. Chỉ xóa dữ liệu của phòng;
  // KHÔNG xóa tài khoản đăng nhập (việc đó do identity: DELETE /admin/operator/:email).
  async handlePurge(request) {
    const code = this.roomCode || (this.config && this.config.code) || '';
    if (!/^[A-Z0-9]{4,10}$/.test(code)) return json({ error: 'Mã phòng không hợp lệ' }, 400);

    let allowed = this.checkAdminSecret(request);
    if (!allowed && this.env && this.env.ADMIN_PURGE_KEY) {
      const given = request.headers.get('X-Purge-Key') || '';
      const want = String(this.env.ADMIN_PURGE_KEY);
      if (given.length === want.length && given.length >= 16) {
        let diff = 0;
        for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
        allowed = diff === 0;
      }
    }
    if (!allowed) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (bearer && await this.bearerIsRoomOwner(bearer, code)) allowed = true;
    }
    if (!allowed) return json({ error: 'unauthorized' }, 403);

    const deleted = { r2Gallery: 0, r2Backgrounds: 0, kvSetlists: 0, kvLibrary: 0 };
    const purgeR2 = async (bucket, prefix) => {
      let n = 0, cursor;
      do {
        const page = await bucket.list({ prefix, cursor, limit: 1000 });
        const keys = (page.objects || []).map((o) => o.key);
        if (keys.length) { await bucket.delete(keys); n += keys.length; }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return n;
    };
    const purgeKv = async (kv, prefix) => {
      let n = 0, cursor;
      do {
        const page = await kv.list({ prefix, cursor, limit: 1000 });
        for (const k of page.keys) { await kv.delete(k.name); n++; }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return n;
    };
    const env = this.env || {};
    if (env.GALLERY) deleted.r2Gallery = await purgeR2(env.GALLERY, code + '/');
    if (env.BGS) deleted.r2Backgrounds = await purgeR2(env.BGS, code + '/');
    if (env.SETLISTS) {
      deleted.kvSetlists = (await purgeKv(env.SETLISTS, 'sl:' + code + ':')) + (await purgeKv(env.SETLISTS, 'ack:' + code + ':'));
      if (await env.SETLISTS.get('lib:' + code)) { await env.SETLISTS.delete('lib:' + code); deleted.kvLibrary = 1; }
    }

    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'Phòng đã bị xóa'); } catch (e) { /* đã đóng */ } }
    await this.ctx.storage.deleteAll();
    // Đưa trạng thái trong RAM về rỗng (instance này có thể còn sống sau khi xóa storage)
    this.config = null; this.secretHex = null; this.adminSecret = null; this.ring = [];
    this.accounts = []; this.profiles = {}; this.gallery = { images: [], updatedAt: 0 }; this.blocked = {};
    this.songInbox = []; this.bgManifest = { items: [], updatedAt: 0 }; this.slHistory = [];
    this.joinAttempts = new Map(); this.galleryAddAttempts = new Map(); this.pendingLogins = new Map();
    return json({ ok: true, deleted });
  }

  async ensureConfig(code) {
    if (this.config) return this.config;
    const c = code || this.roomCode;
    if (c && this.env && this.env.GLOBAL_USERS) {
      try {
        const raw = await this.env.GLOBAL_USERS.get(`room:${c}`);
        if (raw) {
          const r = JSON.parse(raw);
          this.config = {
            name: r.name || 'Kênh Band',
            code: r.code || c,
            password: r.password || '',
            cloudRoomId: r.code || c,
            passwordSetAt: r.createdAt || Date.now()
          };
          await this.ctx.storage.put('config', this.config);
        }
      } catch (e) {
        console.error('ensureConfig error:', e);
      }
    }
    return this.config;
  }

  // ---- Quản lý tài khoản local (band-comm-plan.md §11) — operator (laptop)
  // là nơi DUY NHẤT tạo/sửa/xoá, xác thực bằng adminSecret giống /admin/config.
  // Đổi mật khẩu/khoá/xoá account -> rotateSecret() luôn (mọi token đang tồn
  // tại verify-fail ngay) — y hệt commServer.rotateSecret() cũ main.js gọi
  // sau các IPC band-accounts-*. ----
  checkAdminSecret(request) {
    const headerSecret = request.headers.get('X-Admin-Secret') || '';
    if (!this.adminSecret || !headerSecret || headerSecret.length !== this.adminSecret.length) return false;
    // So sánh hằng thời gian: không lộ độ dài tiền tố đúng qua thời gian phản hồi.
    let diff = 0;
    for (let i = 0; i < headerSecret.length; i++) diff |= headerSecret.charCodeAt(i) ^ this.adminSecret.charCodeAt(i);
    return diff === 0;
  }

  // ---- GET/POST /admin/verify: worker.js (KV endpoints dành riêng cho operator:
  // /library-sync, /setlist/ack, ...) hỏi DO của phòng xem X-Admin-Secret có phải
  // của operator thật không. Chỉ trả 200/401, không đổi trạng thái, KHÔNG bootstrap. ----
  handleAdminVerify(request) {
    return this.checkAdminSecret(request) ? json({ ok: true }) : json({ error: 'unauthorized' }, 401);
  }

  async handleAdminAccounts(request, action) {
    if (!this.checkAdminSecret(request)) return json({ error: 'Sai admin secret' }, 403);
    const body = await request.json().catch(() => ({}));

    if (action === 'list' && request.method === 'GET') {
      return json({ accounts: this.accounts.map(publicAccount) });
    }
    if (action === 'create') {
      const result = await createAccount(this.accounts, body);
      if (!result.error) await this.persistAccounts();
      return json(result, result.error ? 400 : 200);
    }
    if (action === 'update') {
      const result = updateAccount(this.accounts, body.id, { name: body.name });
      if (!result.error) await this.persistAccounts();
      return json(result, result.error ? 400 : 200);
    }
    if (action === 'update-password') {
      const result = await updateAccountPassword(this.accounts, body.id, body.password, { mustChangePassword: body.mustChangePassword });
      if (!result.error) { await this.persistAccounts(); await this.rotateSecret(); }
      return json(result, result.error ? 400 : 200);
    }
    if (action === 'set-active') {
      const result = setAccountActive(this.accounts, body.id, body.active);
      if (!result.error) { await this.persistAccounts(); await this.rotateSecret(); }
      return json(result, result.error ? 400 : 200);
    }
    if (action === 'remove') {
      const result = removeAccount(this.accounts, body.id);
      if (!result.error) { await this.persistAccounts(); await this.rotateSecret(); }
      return json(result, result.error ? 400 : 200);
    }
    return json({ error: 'not found' }, 404);
  }

  // Operator quản lý ẢNH BẤT KỲ (không riêng ảnh mình đăng) — y hệt IPC
  // band-comm-gallery-* cũ gọi thẳng commServer.galleryAdd/Remove/Reorder,
  // KHÔNG qua check ownerId (đó là luật riêng cho band member ở
  // handleGalleryAdd/Remove phía trên).
  async handleAdminGallery(request, action) {
    if (!this.checkAdminSecret(request)) return json({ error: 'Sai admin secret' }, 403);
    const body = await request.json().catch(() => ({}));
    if (action === 'add') {
      const result = await this.addImage({ name: body.name, ext: body.ext, dataB64: body.dataB64, ownerId: null });
      return json(result.error ? { error: result.error } : result.manifest, result.error ? 400 : 200);
    }
    if (action === 'remove') {
      const result = await this.removeImage(body.id, {});
      return json(result.error ? { error: result.error } : result.manifest, result.error ? 404 : 200);
    }
    if (action === 'remove-many') {
      const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
      const result = await this.removeImages(ids, {});
      return json(result.manifest || await this.galleryManifest());
    }
    if (action === 'clear') {
      const allIds = this.gallery.images.map((x) => x.id);
      const result = await this.removeImages(allIds, {});
      return json(result.manifest || await this.galleryManifest());
    }
    if (action === 'reorder') {
      await this.reorderGallery(Array.isArray(body.ids) ? body.ids : []);
      return json(await this.galleryManifest());
    }
    return json({ error: 'not found' }, 404);
  }

  // Đặt lại thứ tự ảnh hợp âm theo `ids`. id lạ/trùng bị bỏ qua; ảnh không có trong
  // `ids` (vd. vừa có người thêm trong lúc đang kéo) được GIỮ và xếp xuống cuối —
  // không bao giờ làm mất ảnh. Thứ tự dùng chung cả phòng: ai đổi thì mọi điện
  // thoại + máy chiếu thấy đổi theo (announceGallery).
  async reorderGallery(ids) {
    const map = new Map(this.gallery.images.map((x) => [x.id, x]));
    const seen = new Set();
    const next = [];
    for (const id of ids) {
      const it = map.get(String(id));
      if (it && !seen.has(it.id)) { seen.add(it.id); next.push(it); }
    }
    this.gallery.images.forEach((x) => { if (!seen.has(x.id)) next.push(x); });
    this.gallery.images = next;
    this.gallery.updatedAt = Date.now();
    await this.ctx.storage.put('gallery', this.gallery);
    await this.announceGallery();
  }

  // Thành viên (điện thoại) đổi thứ tự — chọn "operator + thành viên đều được". Chỉ ĐỔI
  // THỨ TỰ, không xoá được ảnh người khác (quyền xoá vẫn theo ownerId ở removeImage).
  async handleGalleryReorder(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.ids) || body.ids.length > 500) return json({ error: 'bad json' }, 400);
    if (!this.checkGalleryAddRateLimit('reorder:' + ident.clientId, 30)) {
      return json({ error: 'Đổi thứ tự quá nhanh, thử lại sau ít phút' }, 429);
    }
    await this.reorderGallery(body.ids.map((x) => String(x).slice(0, 64)));
    return json(await this.galleryManifest(ident.profileId));
  }

  // Đóng ngay 1 kết nối đang mở theo clientId — chỉ ngắt phiên hiện tại,
  // KHÔNG cấm quay lại (khác block bên dưới). Code 4001 tự đặt (không phải
  // mã chuẩn CloseEvent) để phân biệt "bị kick" với rớt mạng thường trên
  // client nếu sau này cần hiển thị khác đi.
  kickWebSocketsByClientId(clientId) {
    let found = false;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.clientId === clientId) {
        found = true;
        try { ws.close(4001, 'Kicked by operator'); } catch (e) {}
      }
    }
    return found;
  }

  // Operator xem ai đang online (kèm profileId để kick/block đúng người),
  // và quản lý danh sách chặn — TÁCH RIÊNG khỏi `presenceList()`/envelope
  // `presence` public (chỉ có clientId+name): profileId là bearer secret
  // của band member, không được lộ cho ai khác ngoài chính chủ và operator
  // (xem galleryManifest()'s comment cho lý do đầy đủ) — route này có
  // checkAdminSecret() nên an toàn để trả thêm profileId.
  async handleAdminPresence(request, action) {
    if (!this.checkAdminSecret(request)) return json({ error: 'Sai admin secret' }, 403);

    if (action === 'list' && request.method === 'GET') {
      const clients = this.ctx.getWebSockets().map((ws) => {
        const a = ws.deserializeAttachment() || {};
        return { clientId: a.clientId, name: a.name, profileId: a.profileId || null, isOperator: !!a.isOperator };
      }).filter((c) => !c.isOperator);
      return json({ clients });
    }

    if (action === 'blocked' && request.method === 'GET') {
      // Dọn thật sự (xoá khỏi storage) các entry đã quá BLOCK_DURATION_MS —
      // chỗ duy nhất persist việc dọn, vì đây là action operator chủ động
      // xem, tần suất thấp, không tốn write ở hot path như verifyToken().
      const now = Date.now();
      let changed = false;
      for (const profileId of Object.keys(this.blocked)) {
        if (now - this.blocked[profileId].blockedAt >= BLOCK_DURATION_MS) {
          delete this.blocked[profileId];
          changed = true;
        }
      }
      if (changed) await this.ctx.storage.put('blocked', this.blocked);
      const blocked = Object.keys(this.blocked).map((profileId) => ({
        profileId, ...this.blocked[profileId],
        expiresAt: this.blocked[profileId].blockedAt + BLOCK_DURATION_MS
      }));
      blocked.sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0));
      return json({ blocked });
    }

    const body = await request.json().catch(() => ({}));

    if (action === 'kick') {
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'Thiếu clientId' }, 400);
      const ok = this.kickWebSocketsByClientId(clientId);
      return json({ ok: ok });
    }

    if (action === 'block') {
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'Thiếu clientId' }, 400);
      const target = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() || {}).find((a) => a.clientId === clientId);
      if (!target || !target.profileId) return json({ error: 'Không tìm thấy người dùng này (đã rời phòng?)' }, 404);
      this.blocked[target.profileId] = { name: target.name || 'Ẩn danh', blockedAt: Date.now() };
      await this.ctx.storage.put('blocked', this.blocked);
      this.kickWebSocketsByClientId(clientId);
      return json({ ok: true, profileId: target.profileId, name: target.name });
    }

    if (action === 'unblock') {
      const profileId = String(body.profileId || '');
      if (!profileId) return json({ error: 'Thiếu profileId' }, 400);
      delete this.blocked[profileId];
      await this.ctx.storage.put('blocked', this.blocked);
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  }

  // Cấp token đầy đủ, cùng shape /join — dùng chung cho /login (không cần
  // thêm mật khẩu phòng) và /join-room (bước 2, sau khi đã qua mật khẩu
  // phòng). `account.mustChangePassword` chỉ có ý nghĩa cho tài khoản local
  // (Cognito dùng NEW_PASSWORD_REQUIRED riêng, không đi qua đây).
  async finishLogin(account) {
    const clientId = newId('c');
    const token = await this.makeToken(clientId, account.name, account.id);
    const restored = (this.profiles[account.id]) || this.findProfileByName(account.name);
    return {
      token, clientId,
      name: account.name,
      room: { name: this.config.name },
      since: this.ring.length ? this.ring[this.ring.length - 1].id : null,
      mustChangePassword: !!account.mustChangePassword,
      profile: restored ? { profileId: account.id, ...restored } : null,
      cloudRoomId: this.config.cloudRoomId || this.roomCode || '',
      gallery: await this.galleryManifest(account.id),
      setlistEnabled: true
    };
  }

  async afterIdentityVerified(account) {
    if (!this.config.passwordRequiredWithAccounts) return json(await this.finishLogin(account));
    const tempToken = randomHex(16);
    const now = Date.now();
    // Dọn entry hết hạn trước khi thêm mới — chống inflate RAM khi bị abuse
    for (const [k, v] of this.pendingLogins) {
      if (v.expiresAt < now) this.pendingLogins.delete(k);
    }
    this.pendingLogins.set(tempToken, {
      accountId: account.id, name: account.name, mustChangePassword: !!account.mustChangePassword,
      expiresAt: now + PENDING_LOGIN_MAX_AGE_MS
    });
    return json({ needsRoomPassword: true, tempToken });
  }

  async handleLogin(request) {
    if (!this.config) return json({ error: 'Phòng chưa được cấu hình' }, 404);
    if (!this.config.accountsEnabled) return json({ error: 'not found' }, 404);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    if (String(body.code || '').trim().toUpperCase() !== this.config.code) {
      return json({ error: 'Sai ID phòng' }, 403);
    }

    // authMode='cognito' (cloud/identity-plan.md §4): client đã lấy idToken
    // đã ký sẵn từ Cloudflare Worker "band-identity" (đăng nhập Cognito qua
    // mạng riêng, KHÔNG qua relay này) — ở đây chỉ verify chữ ký, không xác
    // thực mật khẩu. Khác Node cũ (verify OFFLINE bằng cache đĩa) — relay
    // LUÔN có mạng nên verify trực tiếp, xem cognito-verify.js.
    if (this.config.authMode === 'cognito') {
      const ipKey = 'login-ip:' + ip;
      const blockedSec = this.checkJoinBlocked(ipKey);
      if (blockedSec > 0) {
        return json({ error: 'Thử sai quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' }, 429, { 'Retry-After': String(blockedSec) });
      }
      if (!this.cognitoVerifier) this.cognitoVerifier = createCognitoVerifier();
      let payload;
      try {
        payload = await this.cognitoVerifier.verifyIdToken(body.idToken);
      } catch (e) {
        this.recordJoinFailure(ipKey);
        return json({ error: 'Đăng nhập không hợp lệ hoặc đã hết hạn, vui lòng đăng nhập lại' }, 401);
      }
      this.clearJoinAttempts(ipKey);
      // profileId = sub Cognito (id vĩnh viễn, không đổi dù đổi tên/mật khẩu)
      // — y hệt server.js cũ, tái dùng nguyên cơ chế profileId đã có.
      const account = { id: String(payload.sub), name: sanitizeName(body.name || payload.email), mustChangePassword: false };
      return this.afterIdentityVerified(account);
    }

    const username = String(body.username || '').trim().toLowerCase();
    const ipKey = 'login-ip:' + ip;
    const acctKey = 'login-acct:' + username;
    const blockedSec = Math.max(this.checkJoinBlocked(ipKey), username ? this.checkJoinBlocked(acctKey) : 0);
    if (blockedSec > 0) {
      return json({ error: 'Thử sai quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' }, 429, { 'Retry-After': String(blockedSec) });
    }
    let account = await verifyAccount(this.accounts, username, body.password);
    if (!account && this.env && this.env.GLOBAL_USERS) {
      try {
        const uRaw = await this.env.GLOBAL_USERS.get(`user:${username}`);
        if (uRaw) {
          const gu = JSON.parse(uRaw);
          if (gu && gu.active !== false) {
            const valid = await verifyPasswordHash(body.password, gu.passwordHash, gu.passwordSalt);
            if (valid) {
              account = { id: gu.id, username: gu.username, name: gu.name, active: true, mustChangePassword: false };
            }
          }
        }
      } catch (e) {
        console.error('Lỗi tra cứu global user:', e);
      }
    }
    if (!account) {
      this.recordJoinFailure(ipKey);
      if (username) this.recordJoinFailure(acctKey);
      return json({ error: 'Sai tên đăng nhập hoặc mật khẩu' }, 403);
    }
    if (this.accounts.some((a) => a.username === username)) {
      await this.persistAccounts(); // lastLoginAt vừa đổi (chỉ cho local account)
    }
    this.clearJoinAttempts(ipKey); this.clearJoinAttempts(acctKey);
    return this.afterIdentityVerified(account);
  }

  async handleJoinRoom(request) {
    if (!this.config) return json({ error: 'Phòng chưa được cấu hình' }, 404);
    if (!this.config.accountsEnabled || !this.config.passwordRequiredWithAccounts) return json({ error: 'not found' }, 404);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipKey = 'joinroom-ip:' + ip;
    const blockedSec = this.checkJoinBlocked(ipKey);
    if (blockedSec > 0) {
      return json({ error: 'Thử sai mật khẩu phòng quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' }, 429, { 'Retry-After': String(blockedSec) });
    }
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const tempToken = String(body.tempToken || '');
    const pending = this.pendingLogins.get(tempToken);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingLogins.delete(tempToken);
      return json({ error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' }, 401);
    }
    if (String(body.password || '') !== this.config.password) {
      this.recordJoinFailure(ipKey);
      return json({ error: 'Sai mật khẩu phòng' }, 403);
    }
    this.clearJoinAttempts(ipKey);
    this.pendingLogins.delete(tempToken);
    const acc = this.accounts.find((a) => a.id === pending.accountId) || {
      id: pending.accountId,
      name: pending.name,
      active: true,
      mustChangePassword: !!pending.mustChangePassword
    };
    if (acc.active === false) return json({ error: 'Tài khoản không còn hoạt động' }, 401);
    return json(await this.finishLogin(acc));
  }

  // Band member tự đổi mật khẩu (bắt buộc khi mustChangePassword=true, xem
  // finishLogin ở trên) — cần token hợp lệ + đúng mật khẩu CŨ. Y hệt
  // POST /api/change-password ở server.js cũ.
  async handleChangePassword(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const result = await changeOwnPassword(this.accounts, ident.profileId, body.currentPassword, body.newPassword);
    if (result.error) return json({ error: result.error }, 400);
    await this.persistAccounts();
    return json({ ok: true });
  }

  // ---- Bộ nút cảnh báo cá nhân — backup phía relay, bản chính nằm ở
  // localStorage điện thoại (xem app.js). Y hệt store.js's saveProfile()/
  // findProfileByName() cũ, chỉ đổi chỗ lưu (ctx.storage thay band-comm.json). ----
  findProfileByName(name) {
    const want = sanitizeName(name);
    for (const p of Object.values(this.profiles)) {
      if (p && p.name === want) return p;
    }
    return null;
  }

  async handleProfileGet(url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const p = ident.profileId && this.profiles[ident.profileId];
    return json({ profile: p ? { profileId: ident.profileId, ...p } : null });
  }

  async handleProfileSave(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    // LUÔN dùng profileId trong token đã verify (từ lúc /join) — trước đây
    // body.profileId có thể ghi đè, nghĩa là ai gọi request cũng tự chọn
    // được sẽ ghi đè hồ sơ nút của profileId nào (kể cả của người khác).
    const profileId = ident.profileId;
    if (!profileId) return json({ error: 'Thiếu profileId' }, 400);
    const buttons = Array.isArray(body.buttons) ? body.buttons.slice(0, 60).map((b) => ({
      id: String(b && b.id || '').slice(0, 40),
      label: String(b && b.label || '').slice(0, 60),
      group: String(b && b.group || '').slice(0, 40)
    })).filter((b) => b.id && b.label) : [];
    this.profiles[profileId] = { name: ident.name, updatedAt: Date.now(), buttons };
    await this.ctx.storage.put('profiles', this.profiles);
    return json({ ok: true });
  }

  // ---- Ảnh hợp âm — manifest (ai đã đăng ảnh nào) lưu trong ctx.storage,
  // bytes thật lưu R2 `env.GALLERY` (binding CHUNG với worker.js, DO trong
  // cùng Worker script tự động có quyền truy cập) dưới object key
  // `<cloudRoomId>/<id>` — Y HỆT quy ước cũ worker.js's POST /gallery đã dùng,
  // nên GET /gallery/image/<cloudRoomId>/<id> (route cũ, không đổi) vẫn phục
  // vụ đúng ảnh không cần sửa gì. Không còn khái niệm "1 người phụ trách" —
  // ai join hợp lệ cũng thêm được, chỉ tự xoá được ảnh mình đăng (y hệt LAN cũ). ----
  // `ownerId` (== profileId người đăng) KHÔNG được trả thẳng cho ai khác
  // ngoài chính chủ nữa — profileId là bearer secret client tự sinh (128-bit
  // random, comm/mobile/app.js) để "nhận lại" ảnh/hồ sơ của mình qua các lần
  // join lại, KHÔNG có xác thực nào khác ràng buộc nó. Trả thẳng ownerId cho
  // cả phòng (broadcast gallery envelope, và cả response /join) từng khiến
  // BẤT KỲ member nào đọc được profileId của người khác rồi tự xưng lại
  // đúng profileId đó ở /join để "trở thành" họ — xoá ảnh hoặc ghi đè hồ sơ
  // nút của người khác. Chỉ trả boolean `mine` (đúng bằng viewerProfileId
  // của NGƯỜI ĐANG HỎI) — không rò rỉ giá trị ownerId gốc ra ngoài nữa.
  async galleryManifest(viewerProfileId) {
    return {
      images: this.gallery.images.map((x) => ({ id: x.id, name: x.name, mine: !!(viewerProfileId && x.ownerId === viewerProfileId) })),
      updatedAt: this.gallery.updatedAt || 0
    };
  }

  // Broadcast KHÔNG dùng chung 1 payload nữa — "mine" phụ thuộc người nhận,
  // nên phải dựng manifest riêng cho từng socket đang mở (đọc profileId từ
  // chính attachment của socket đó, y hệt cách sendTo() định danh client).
  async announceGallery() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      const envelope = makeEnvelope({ type: 'gallery', from: { clientId: 'server', name: 'Kênh Band' }, meta: await this.galleryManifest(a.profileId) });
      try { ws.send(JSON.stringify({ kind: 'envelope', envelope })); } catch (e) {}
    }
  }

  // Lõi thêm/xoá dùng chung cho CẢ band member (token, chỉ tự xoá ảnh mình)
  // LẪN operator (adminSecret, xoá/sắp xếp bất kỳ ảnh nào — y hệt IPC
  // band-comm-gallery-* cũ gọi thẳng commServer.galleryAdd/Remove/Reorder
  // không qua check ownerId).
  async addImage({ name, ext, dataB64, ownerId }) {
    if (!this.config.cloudRoomId) return { error: 'Phòng chưa có cloudRoomId (cần restart app operator)' };
    const safeExt = /^\.(jpe?g|png|webp)$/i.test(String(ext || '')) ? String(ext).toLowerCase() : '.jpg';
    const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[safeExt] || 'image/jpeg';
    const b64 = String(dataB64 || '').replace(/^data:[^,]*,/, '');
    if (!b64) return { error: 'Thiếu dataB64' };
    let buf;
    try { buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch (e) { return { error: 'dataB64 không hợp lệ' }; }
    if (!buf.length || buf.length > 8 * 1024 * 1024) return { error: 'Ảnh quá lớn' };
    const id = newId('img');
    const cleanName = String(name || 'Hợp âm').slice(0, 80);
    await this.env.GALLERY.put(`${this.config.cloudRoomId}/${id}`, buf, {
      httpMetadata: { contentType }, customMetadata: { name: cleanName }
    });
    this.gallery.images.push({ id, name: cleanName, ownerId: ownerId || null });
    this.gallery.updatedAt = Date.now();
    await this.ctx.storage.put('gallery', this.gallery);
    await this.announceGallery();
    return { manifest: await this.galleryManifest(ownerId) };
  }

  // `enforceOwnership` là CỜ RIÊNG, tách khỏi `callerProfileId` — band member
  // gọi luôn truyền enforceOwnership:true dù `callerProfileId` CÓ THỂ null
  // (client tự khai profileId là tuỳ chọn ở /join). Gộp chung 2 việc vào 1
  // "if (callerProfileId && …)" là SAI (đã tái hiện thật qua test): profileId
  // null vẫn phải bị so sánh khác item.ownerId và bị từ chối, không phải
  // đương nhiên bỏ qua check vì giá trị falsy.
  async removeImage(id, { enforceOwnership, callerProfileId } = {}) {
    const item = this.gallery.images.find((x) => x.id === id);
    if (!item) return { error: 'Không tìm thấy ảnh' };
    if (enforceOwnership && (!item.ownerId || item.ownerId !== callerProfileId)) {
      return { error: 'Bạn chỉ xoá được ảnh mình đã đăng' };
    }
    this.gallery.images = this.gallery.images.filter((x) => x.id !== id);
    this.gallery.updatedAt = Date.now();
    await this.ctx.storage.put('gallery', this.gallery);
    if (this.config.cloudRoomId) await this.env.GALLERY.delete(`${this.config.cloudRoomId}/${id}`).catch(() => {});
    await this.announceGallery();
    return { manifest: await this.galleryManifest(callerProfileId) };
  }

  async removeImages(ids, { enforceOwnership, callerProfileId } = {}) {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (!list.length) return { manifest: await this.galleryManifest(callerProfileId) };
    const idSet = new Set(list);
    const toDeleteIds = [];
    this.gallery.images = this.gallery.images.filter((x) => {
      if (idSet.has(x.id)) {
        if (enforceOwnership && (!x.ownerId || x.ownerId !== callerProfileId)) {
          return true;
        }
        toDeleteIds.push(x.id);
        return false;
      }
      return true;
    });
    if (toDeleteIds.length > 0) {
      this.gallery.updatedAt = Date.now();
      await this.ctx.storage.put('gallery', this.gallery);
      if (this.config.cloudRoomId) {
        await Promise.all(toDeleteIds.map((id) => this.env.GALLERY.delete(`${this.config.cloudRoomId}/${id}`).catch(() => {})));
      }
      await this.announceGallery();
    }
    return { manifest: await this.galleryManifest(callerProfileId), deletedCount: toDeleteIds.length };
  }

  async handleGalleryAdd(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    if (!this.checkGalleryAddRateLimit(ident.clientId)) {
      return json({ error: 'Tải ảnh lên quá nhanh, vui lòng thử lại sau ít phút' }, 429);
    }
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const result = await this.addImage({ name: body.name, ext: body.ext, dataB64: body.dataB64, ownerId: ident.profileId });
    if (result.error) return json({ error: result.error }, 400);
    return json(result.manifest);
  }

  async handleGalleryRemove(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body || !body.id) return json({ error: 'bad json' }, 400);
    const result = await this.removeImage(body.id, { enforceOwnership: true, callerProfileId: ident.profileId });
    if (result.error) return json({ error: result.error }, result.error === 'Không tìm thấy ảnh' ? 404 : 403);
    return json(result.manifest);
  }

  // ---- Setlist gửi từ điện thoại — khác hẳn "hộp thư cloud khi laptop tắt
  // hẳn" (worker.js's /setlist, KV riêng, TTL 7 ngày, đã có sẵn) — đây là
  // đường THẬT-TIME khi operator đang mở app: phát 1 envelope type 'setlist'
  // qua WS, main.js's relay-client.js's onEvent bắt riêng loại này (KHÔNG
  // đẩy vào feed chat) để gọi callback onSetlist, y hệt hành vi
  // ingestSetlist() ở server.js cũ. ----
  async handleSetlistSubmit(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((it) => it && it.type === 'song' && it.id != null)
      .slice(0, 60)
      .map((it) => {
        const out = { type: 'song', id: it.id, title: String(it.title || '').replace(/[<>]/g, '').slice(0, 200) };
        // Bài tạo mới trên web: chỉ giữ webId (đã validate). Lời KHÔNG đi theo setlist — desktop
        // lấy từ /admin/songs/pending của relay lúc operator nạp, nên client không tiêm lời tuỳ ý.
        if (it.webId != null && SONG_WEBID_RE.test(String(it.webId))) out.webId = String(it.webId);
        const itemBg = cleanBgName(it.bg); // nền riêng của bài (tuỳ chọn)
        if (itemBg) out.bg = itemBg;
        return out;
      });
    if (!items.length) return json({ error: 'Setlist rỗng' }, 400);
    const sl = {
      id: String(body.id || newId('sl')),
      name: String(body.name || '').trim().slice(0, 80) || 'Setlist',
      from: { name: ident.name }, ts: Date.now(), items
    };
    const listBg = cleanBgName(body.bg); // nền chung cho cả list (tuỳ chọn)
    if (listBg) sl.bg = listBg;
    // Lưu vào lịch sử của phòng để tab "Đã gửi" xem lại/gửi lại. body.resendOf = id lịch sử của setlist
    // được gửi lại (id gửi đi vẫn MỚI vì desktop khử trùng theo id) -> cập nhật bản cũ thay vì thêm bản sao.
    await this.recordSetlistHistory(ident, sl, body.resendOf);
    const env = makeEnvelope({ type: 'setlist', from: { clientId: ident.clientId, name: ident.name }, meta: sl });
    this.broadcast(env); // KHÔNG pushRing — setlist không cần replay lúc reconnect (đã gửi 1 lần là đủ, operator xử lý ngay lúc online)
    // Operator (laptop) có đang online không lúc gửi — khác LAN cũ (network
    // error TỰ NHIÊN báo "laptop tắt"), relay LUÔN trả lời được dù operator
    // mất kết nối, nên phải tự kiểm tra rồi báo qua field riêng. app.js dùng
    // để quyết định có cần gửi thêm qua hộp thư cloud (SETLISTS KV, /setlist
    // ở worker.js) hay không — y hệt UX cũ.
    const delivered = this.ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() || {}).isOperator);
    return json({ ok: true, id: sl.id, delivered });
  }

  // ---- Lịch sử setlist đã gửi (chung cả phòng) ----
  async persistSlHistory() {
    const now = Date.now();
    this.slHistory = this.slHistory.filter((e) => now - e.lastSentAt < SL_HISTORY_TTL_MS);
    if (this.slHistory.length > SL_HISTORY_MAX) {
      this.slHistory.sort((a, b) => a.lastSentAt - b.lastSentAt);
      this.slHistory = this.slHistory.slice(this.slHistory.length - SL_HISTORY_MAX);
    }
    await this.ctx.storage.put('slHistory', this.slHistory);
  }

  async recordSetlistHistory(ident, sl, resendOf) {
    const who = this.songSubmitterKey(ident);
    const now = Date.now();
    const prev = typeof resendOf === 'string' && resendOf
      ? this.slHistory.find((e) => e.id === resendOf.slice(0, 80)) : null;
    if (prev) {
      prev.lastSentAt = now;
      prev.sendCount = (prev.sendCount || 1) + 1;
      prev.lastBy = ident.name;
    } else {
      this.slHistory.push({
        id: sl.id, name: sl.name, items: sl.items, bg: sl.bg || '', by: ident.name, submitter: who,
        ts: now, lastSentAt: now, sendCount: 1, lastBy: ident.name
      });
    }
    await this.persistSlHistory();
  }

  async handleSetlistHistory(url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const who = this.songSubmitterKey(ident);
    const setlists = this.slHistory.slice()
      .sort((a, b) => b.lastSentAt - a.lastSentAt)
      .map((e) => ({
        id: e.id, name: e.name, items: e.items, bg: e.bg || '', by: e.by, ts: e.ts, lastSentAt: e.lastSentAt,
        sendCount: e.sendCount || 1, lastBy: e.lastBy || e.by, mine: e.submitter === who
      }));
    return json({ setlists });
  }

  // Chỉ người đã gửi (cùng profileId/clientId) mới xoá được bản lưu của mình.
  async handleSetlistHistoryDelete(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const id = String(body.id || '').slice(0, 80);
    const entry = this.slHistory.find((e) => e.id === id);
    if (!entry) return json({ error: 'Không tìm thấy setlist' }, 404);
    if (entry.submitter !== this.songSubmitterKey(ident)) return json({ error: 'Chỉ người đã gửi mới xoá được' }, 403);
    this.slHistory = this.slHistory.filter((e) => e !== entry);
    await this.persistSlHistory();
    return json({ ok: true });
  }

  // ---- Ảnh nền thư viện cho preview slide ----
  // Operator (adminSecret) quản lý; thành viên (token) chỉ đọc manifest {id,name}.
  // Bytes ở R2 BGS key `<roomCode>/<id>`; id ngẫu nhiên (không đoán được) và đổi
  // mỗi lần ảnh thay đổi nên cache 1 ngày ở Worker không bao giờ phục vụ ảnh cũ.
  bgPrefix() { return String((this.config && this.config.code) || this.roomCode || ''); }

  async persistBgManifest() {
    this.bgManifest.updatedAt = Date.now();
    await this.ctx.storage.put('bgManifest', this.bgManifest);
  }

  async handleBackgroundsManifest(url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    return json({ items: this.bgManifest.items.map((b) => ({ id: b.id, name: b.name })), updatedAt: this.bgManifest.updatedAt });
  }

  async handleAdminBackgrounds(request, action) {
    if (!this.checkAdminSecret(request)) return json({ error: 'Sai admin secret' }, 403);
    if (!this.env.BGS) return json({ error: 'Chưa cấu hình bucket ảnh nền (BGS)' }, 503);
    if (action === 'list' && request.method === 'GET') {
      return json({ items: this.bgManifest.items, updatedAt: this.bgManifest.updatedAt });
    }
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);

    if (action === 'put' && request.method === 'POST') {
      const name = String(body.name || '').replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, 120);
      const key = String(body.key || '').slice(0, 64);
      if (!name || !key) return json({ error: 'Thiếu name/key' }, 400);
      const b64 = String(body.dataB64 || '').replace(/^data:[^,]*,/, '');
      if (!b64 || b64.length > Math.ceil(BG_MAX_BYTES * 4 / 3) + 8) return json({ error: 'Ảnh thiếu hoặc quá lớn (tối đa ' + (BG_MAX_BYTES / 1024) + 'KB)' }, 400);
      let buf;
      try { buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch (e) { return json({ error: 'dataB64 không hợp lệ' }, 400); }
      if (!buf.length || buf.length > BG_MAX_BYTES) return json({ error: 'Ảnh quá lớn' }, 400);
      if (!(buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)) return json({ error: 'Chỉ nhận ảnh JPEG' }, 400);
      const old = this.bgManifest.items.find((b) => b.name === name);
      if (!old && this.bgManifest.items.length >= BG_MAX_PER_ROOM) return json({ error: 'Đã đủ ' + BG_MAX_PER_ROOM + ' ảnh nền' }, 400);
      const id = newId('bg');
      await this.env.BGS.put(this.bgPrefix() + '/' + id, buf, { httpMetadata: { contentType: 'image/jpeg' } });
      if (old) {
        await this.env.BGS.delete(this.bgPrefix() + '/' + old.id).catch(() => {});
        this.bgManifest.items = this.bgManifest.items.filter((b) => b !== old);
      }
      this.bgManifest.items.push({ id, name, key, size: buf.length });
      await this.persistBgManifest();
      return json({ ok: true, id });
    }
    if (action === 'remove' && request.method === 'POST') {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
      const gone = this.bgManifest.items.filter((b) => ids.has(b.id));
      await Promise.all(gone.map((b) => this.env.BGS.delete(this.bgPrefix() + '/' + b.id).catch(() => {})));
      this.bgManifest.items = this.bgManifest.items.filter((b) => !ids.has(b.id));
      if (gone.length) await this.persistBgManifest();
      return json({ ok: true, removed: gone.length });
    }
    return json({ error: 'not found' }, 404);
  }

  // ---- Hộp thư bài hát mới từ web ----
  // Người gửi định danh bằng profileId (ổn định qua reconnect/đổi clientId) rồi
  // tới clientId. KHÔNG tin tên hiển thị để chống mạo danh.
  songSubmitterKey(ident) { return ident.profileId || ident.clientId; }

  async persistSongInbox() {
    const now = Date.now();
    this.songInbox = this.songInbox.filter((e) => e.status === 'pending'
      ? (now - e.ts) < SONG_PENDING_TTL_MS
      : (now - (e.resolvedAt || e.ts)) < SONG_RESOLVED_TTL_MS);
    await this.ctx.storage.put('songInbox', this.songInbox);
  }

  publicSongEntry(e) {
    return { webId: e.webId, title: e.title, slides: e.slides, status: e.status, reason: e.reason || '', songId: e.songId || null, ts: e.ts };
  }

  async handleSongSubmit(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    const webId = String(body.webId || '');
    if (!SONG_WEBID_RE.test(webId)) return json({ error: 'webId không hợp lệ' }, 400);
    const who = this.songSubmitterKey(ident);

    // Idempotent: web gửi lại cùng webId (mạng chập chờn, bấm 2 lần) → trả bản đã có, KHÔNG tạo thêm.
    const existing = this.songInbox.find((e) => e.webId === webId);
    if (existing) {
      if (existing.submitter !== who) return json({ error: 'webId đã được dùng' }, 409);
      return json({ ok: true, duplicate: true, song: this.publicSongEntry(existing) });
    }

    const title = normalizeSongTitle(body.title);
    const lyrics = normalizeSongLyrics(body.lyrics);
    if (!title) return json({ error: 'Thiếu tên bài hát' }, 400);
    if (!lyrics) return json({ error: 'Lời bài hát đang trống' }, 400);
    if (lyrics.length > SONG_LYRICS_MAX) return json({ error: 'Lời bài hát quá dài (tối đa ' + SONG_LYRICS_MAX + ' ký tự)' }, 400);

    const now = Date.now();
    const recent = this.songInbox.filter((e) => e.submitter === who && now - e.ts < 60 * 60 * 1000).length;
    if (recent >= SONG_SUBMIT_PER_HOUR) return json({ error: 'Bạn gửi quá nhiều bài, thử lại sau ít phút' }, 429, { 'Retry-After': '300' });
    if (this.songInbox.filter((e) => e.status === 'pending').length >= SONG_INBOX_MAX_PENDING) {
      return json({ error: 'Hộp chờ duyệt đang đầy, nhờ người vận hành duyệt bớt rồi gửi lại' }, 429);
    }

    const entry = {
      webId, title, lyrics, slides: lyrics.split('\n\n').length, ts: now, status: 'pending',
      submitter: who, from: { name: ident.name, clientId: ident.clientId }
    };
    this.songInbox.push(entry);
    await this.persistSongInbox();
    // Bài được LƯU NGAY vào danh sách chung của web (xem handleWebSongs). KHÔNG báo/duyệt riêng
    // lẻ: operator chỉ duyệt lúc NẠP setlist có chứa bài này (desktop kéo /admin/songs/pending).
    return json({ ok: true, duplicate: false, song: this.publicSongEntry(entry) });
  }

  // Danh sách bài do thành viên TẠO TRÊN WEB, hiển thị chung trong thư viện của trang /setlist/
  // để ai cũng thêm được vào setlist: bài chưa duyệt + bài vừa duyệt gần đây (cầu nối cho tới khi
  // desktop đồng bộ thư viện lên cloud; web khử trùng theo webId). Bài bị từ chối không hiện ở đây.
  async handleWebSongs(url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const who = this.songSubmitterKey(ident);
    const now = Date.now();
    const songs = this.songInbox
      .filter((e) => e.status === 'pending' || (e.status === 'approved' && now - (e.resolvedAt || e.ts) < 10 * 60 * 1000))
      .slice(-200)
      .map((e) => ({
        webId: e.webId, title: e.title, lyrics: e.lyrics, slides: e.slides, status: e.status,
        ts: e.ts, mine: e.submitter === who, by: (e.from && e.from.name) || ''
      }));
    return json({ songs });
  }

  async handleSongsMine(url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
    const who = this.songSubmitterKey(ident);
    return json({ songs: this.songInbox.filter((e) => e.submitter === who).map((e) => this.publicSongEntry(e)) });
  }

  // Operator (adminSecret): xem bài chờ duyệt (kèm lời đầy đủ) và chốt Duyệt/Từ chối.
  async handleAdminSongs(request, action) {
    if (!this.checkAdminSecret(request)) return json({ error: 'Sai admin secret' }, 403);
    if (action === 'pending' && request.method === 'GET') {
      return json({
        songs: this.songInbox.filter((e) => e.status === 'pending')
          .map((e) => ({ ...this.publicSongEntry(e), lyrics: e.lyrics, from: e.from }))
      });
    }
    if (action === 'resolve' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'bad json' }, 400);
      const entry = this.songInbox.find((e) => e.webId === String(body.webId || ''));
      if (!entry) return json({ error: 'Không tìm thấy bài' }, 404);
      if (body.action !== 'approve' && body.action !== 'reject') return json({ error: 'action không hợp lệ' }, 400);
      const status = body.action === 'approve' ? 'approved' : 'rejected';
      // Đã chốt rồi mà gọi lại cùng kết quả → coi như thành công (operator retry sau khi mất mạng); khác kết quả → 409.
      if (entry.status !== 'pending' && entry.status !== status) return json({ error: 'Bài đã được xử lý: ' + entry.status }, 409);
      entry.status = status;
      entry.resolvedAt = Date.now();
      entry.reason = String(body.reason || '').replace(/[<>]/g, '').slice(0, 200);
      entry.songId = body.songId != null ? String(body.songId).slice(0, 100) : null;
      await this.persistSongInbox();
      return json({ ok: true, song: this.publicSongEntry(entry) });
    }
    return json({ error: 'not found' }, 404);
  }

  // Không tính operator (laptop) vào — trước đây bao gồm cả kết nối của
  // chính operator, khiến "Đang kết nối" luôn thừa 1 so với số band member
  // thật sự (2 hiện, mở ra chỉ thấy 1 người) — public list này lẫn số đếm
  // ở sidebar phải khớp với danh sách chi tiết bên admin đã lọc đúng.
  presenceList() {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() || {})
      .filter((a) => !a.isOperator)
      .map((a) => ({ clientId: a.clientId, name: a.name }));
  }

  async pushRing(envelope) {
    this.ring.push(envelope);
    if (this.ring.length > RING_MAX) this.ring = this.ring.slice(-RING_MAX);
    await this.ctx.storage.put('ring', this.ring);
  }

  broadcast(envelope, { exceptClientId } = {}) {
    const payload = JSON.stringify({ kind: 'envelope', envelope });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (exceptClientId && a.clientId === exceptClientId) continue;
      try { ws.send(payload); } catch (e) { /* socket đã chết, dọn ở webSocketClose */ }
    }
  }

  // Gửi riêng cho đúng 1 clientId (vd. ack cá nhân) — KHÔNG spray cho cả
  // phòng như broadcast(). Không throw nếu client đó hiện không có socket
  // nào mở (đã pushRing() trước đó rồi nên khi reconnect vẫn replay được).
  sendTo(clientId, envelope) {
    const payload = JSON.stringify({ kind: 'envelope', envelope });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.clientId !== clientId) continue;
      try { ws.send(payload); } catch (e) { /* socket đã chết, dọn ở webSocketClose */ }
    }
  }

  async broadcastPresence() {
    const env = makeEnvelope({ type: 'presence', from: { clientId: 'server', name: 'Kênh Band' }, meta: { clients: this.presenceList() } });
    this.broadcast(env);
  }

  async handleJoin(request) {
    if (!this.config) return json({ error: 'Phòng chưa được cấu hình (operator chưa mở Kênh Band lần nào)' }, 404);
    // CF-Connecting-IP = IP thật của client (Cloudflare edge gắn header này,
    // sống sót qua lượt forward worker.js -> DO vì Request kế thừa header từ
    // request gốc). Không có nó (test local `wrangler dev`) -> gộp chung 1
    // khoá 'unknown', chấp nhận được (chỉ ảnh hưởng lúc dev).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const blockedSec = this.checkJoinBlocked(ip);
    if (blockedSec > 0) {
      return json({ error: 'Thử sai mật khẩu phòng quá nhiều lần, vui lòng đợi ' + blockedSec + 's rồi thử lại' }, 429, { 'Retry-After': String(blockedSec) });
    }
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad json' }, 400);
    if (String(body.code || '').trim().toUpperCase() !== this.config.code) {
      this.recordJoinFailure(ip);
      return json({ error: 'Sai ID phòng' }, 403);
    }
    if (String(body.password || '') !== this.config.password) {
      this.recordJoinFailure(ip);
      return json({ error: 'Sai mật khẩu phòng' }, 403);
    }
    this.clearJoinAttempts(ip);
    const name = sanitizeName(body.name);
    const profileId = (typeof body.profileId === 'string' && body.profileId && body.profileId.length <= 64) ? body.profileId : null;
    if (profileId && this.isProfileBlocked(profileId)) {
      return json({ error: 'Bạn đã bị chặn khỏi phòng này bởi người vận hành' }, 403);
    }
    const clientId = newId('c');
    const token = await this.makeToken(clientId, name, profileId);
    const restored = (profileId && this.profiles[profileId]) || this.findProfileByName(name);
    return json({
      token, clientId,
      room: { name: this.config.name },
      since: this.ring.length ? this.ring[this.ring.length - 1].id : null,
      profile: restored ? { profileId: profileId, ...restored } : null,
      gallery: await this.galleryManifest(profileId),
      cloudRoomId: this.config.cloudRoomId || this.roomCode || '',
      setlistEnabled: true
    });
  }

  // Operator (main.js) nối vào bằng adminSecret (cùng thứ dùng cho
  // /admin/config), KHÔNG qua /join — operator không cần "vào phòng" bằng
  // mật khẩu phòng của chính mình. Danh tính CỐ ĐỊNH `clientId:'operator'`,
  // y hệt hằng số `OPERATOR` ở server.js cũ (LAN) — giữ nguyên để phía
  // client (comm/mobile/app.js, main.js's onEvent taskbar-flash filter)
  // không phải đổi gì thêm khi rewire.
  async identifyConnection(url) {
    const adminSecret = url.searchParams.get('adminSecret');
    if (adminSecret) {
      if (!this.adminSecret || adminSecret !== this.adminSecret) return null;
      return { clientId: 'operator', name: 'Người chiếu máy', profileId: null, isOperator: true };
    }
    const token = url.searchParams.get('token') || '';
    const ident = await this.verifyToken(token);
    return ident ? { ...ident, isOperator: false } : null;
  }

  async handleWebSocketUpgrade(request, url) {
    const ident = await this.identifyConnection(url);
    if (!ident) return json({ error: 'unauthorized' }, 401);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [ident.clientId]);
    server.serializeAttachment({ clientId: ident.clientId, name: ident.name, profileId: ident.profileId, isOperator: !!ident.isOperator });

    // Replay từ `since` (id envelope cuối phone đã thấy) — reconnect không mất
    // tin nhắn gửi lúc mất mạng thoáng qua, y hệt hành vi LAN cũ.
    const since = url.searchParams.get('since');
    if (since) {
      const idx = this.ring.findIndex((e) => e.id === since);
      // `since` không còn trong ring (id không phải loại pushRing(), ring đã
      // xoay quá 120 tin, hoặc client phiên bản cũ gửi id presence/gallery) —
      // TUYỆT ĐỐI không replay cả ring: đó là nguồn lỗi "tin cũ đã xử lý đổ
      // về lại sau vài phút" (xem changelog). Chỉ bù các tin MỚI HƠN mốc
      // `sinceTs` client gửi kèm; không có sinceTs thì không replay gì.
      let replay;
      if (idx >= 0) {
        replay = this.ring.slice(idx + 1);
      } else {
        const sinceTs = Number(url.searchParams.get('sinceTs')) || 0;
        replay = sinceTs ? this.ring.filter((e) => e.ts > sinceTs) : [];
      }
      for (const envelope of replay) {
        if (envelope.to && envelope.to !== 'all' && envelope.to !== ident.clientId) continue;
        try { server.send(JSON.stringify({ kind: 'envelope', envelope })); } catch (e) {}
      }
    }
    await this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- WebSocket Hibernation API — Cloudflare gọi lại các hàm này mỗi khi
  // có message/close, kể cả sau khi DO đã bị evict khỏi memory và dậy lại.
  // KHÔNG được dùng biến ngoài `ws.deserializeAttachment()`/`ctx.storage` để
  // nhớ state giữa các lần gọi. ----
  async webSocketMessage(ws, message) {
    let body;
    try { body = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch (e) { return; }
    const a = ws.deserializeAttachment() || {};
    if (!a.clientId) return;

    if (body.kind === 'ping') { try { ws.send(JSON.stringify({ kind: 'pong' })); } catch (e) {} return; }

    // Band member gửi cảnh báo bằng nút cá nhân/chữ tự do -> type 'alert'.
    // (Không giới hạn isOperator — ai đã join hợp lệ cũng gửi được, y hệt
    // /api/message ở LAN server cũ.)
    if (body.kind === 'message') {
      const text = String(body.text || body.label || '').trim().slice(0, 500);
      if (!text) return;
      // Dedup double-tap (y hệt server.js cũ's client.dupMap) — bị rớt lúc
      // port sang relay: DUP_WINDOW_MS khai báo mà không dùng ở đâu, nút
      // chạm 2 lần liên tiếp (rất dễ xảy ra trên màn hình điện thoại) tạo ra
      // 2 alert/toast riêng biệt cho cùng 1 lần bấm. State dedup lưu ngay
      // trong attachment của socket (không dùng biến ngoài — Hibernation API).
      const dedupKey = String(body.buttonId || text).toLowerCase();
      const now = Date.now();
      if (a.lastMsgKey === dedupKey && now - (a.lastMsgAt || 0) < DUP_WINDOW_MS) return;
      ws.serializeAttachment(Object.assign({}, a, { lastMsgKey: dedupKey, lastMsgAt: now }));
      const envelope = makeEnvelope({
        type: 'alert', from: { clientId: a.clientId, name: a.name },
        to: 'all', buttonId: body.buttonId || null, text
      });
      await this.pushRing(envelope);
      this.broadcast(envelope);
      return;
    }

    // Còn lại (text/ack/resolve) chỉ operator gửi được — y hệt LAN cũ nơi
    // operatorSend/Ack/Resolve chỉ main.js gọi được qua IPC, band member
    // không có đường nào trong comm/mobile/app.js gọi tới.
    if (!a.isOperator) return;

    if (body.kind === 'text') {
      const text = String(body.text || '').trim().slice(0, 500);
      if (!text) return;
      const to = body.to || 'all';
      const envelope = makeEnvelope({ type: 'text', from: { clientId: a.clientId, name: a.name }, to, text });
      await this.pushRing(envelope);
      // Cùng lỗi đã fix ở 'ack': to !== 'all' nghĩa là tin nhắn riêng, phải
      // sendTo() unicast, không broadcast() cho cả phòng.
      if (to === 'all') this.broadcast(envelope);
      else this.sendTo(to, envelope);
      return;
    }

    if (body.kind === 'ack') {
      const targets = Array.isArray(body.clientIds) ? body.clientIds : (body.clientIds ? [body.clientIds] : []);
      const label = String(body.label || '').trim();
      for (const cid of targets) {
        const envelope = makeEnvelope({
          type: 'ack', from: { clientId: a.clientId, name: a.name }, to: cid,
          text: label ? `Người vận hành đã tiếp nhận ${label}` : 'Người vận hành đã tiếp nhận',
          meta: { label }
        });
        await this.pushRing(envelope);
        this.sendTo(cid, envelope);
      }
      return;
    }

    if (body.kind === 'resolve') {
      const label = String(body.label || '').trim();
      const envelope = makeEnvelope({
        type: 'resolve', from: { clientId: a.clientId, name: a.name }, to: 'all',
        text: label ? `Đã xử lý: ${label}` : 'Đã xử lý',
        meta: { dedupKey: body.dedupKey || null }
      });
      await this.pushRing(envelope);
      this.broadcast(envelope);
      return;
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch (e) {}
    await this.broadcastPresence();
  }

  async webSocketError(ws, error) {
    await this.broadcastPresence();
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);
      const p = url.pathname;
      const roomCodeParam = url.searchParams.get('roomCode');
      if (roomCodeParam) this.roomCode = roomCodeParam;
      await this.ensureConfig(roomCodeParam);

      if (request.method === 'GET' && p === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
        return this.handleWebSocketUpgrade(request, url);
      }
      if (request.method === 'POST' && p === '/admin/config') return this.handleAdminConfig(request);
      if (p === '/admin/verify') return this.handleAdminVerify(request);
      if (request.method === 'POST' && p === '/admin/purge') return this.handlePurge(request);
      if (p.indexOf('/admin/accounts/') === 0) {
        return this.handleAdminAccounts(request, p.slice('/admin/accounts/'.length));
      }
      if (p.indexOf('/admin/gallery/') === 0) {
        return this.handleAdminGallery(request, p.slice('/admin/gallery/'.length));
      }
      if (p.indexOf('/admin/backgrounds/') === 0) {
        return this.handleAdminBackgrounds(request, p.slice('/admin/backgrounds/'.length));
      }
      if (p.indexOf('/admin/songs/') === 0) {
        return this.handleAdminSongs(request, p.slice('/admin/songs/'.length));
      }
      if (p.indexOf('/admin/presence/') === 0) {
        return this.handleAdminPresence(request, p.slice('/admin/presence/'.length));
      }
      if (request.method === 'GET' && p === '/mode') {
        if (!this.config) return json({ configured: false });
        return json({
          configured: true,
          roomName: this.config.name || 'Kênh Band'
        });
      }
      if (request.method === 'POST' && p === '/join') return this.handleJoin(request);
      if (request.method === 'POST' && p === '/login') return this.handleLogin(request);
      if (request.method === 'POST' && p === '/join-room') return this.handleJoinRoom(request);
      if (request.method === 'POST' && p === '/change-password') return this.handleChangePassword(request, url);
      if (request.method === 'GET' && p === '/presence') return json({ clients: this.presenceList() });
      if (request.method === 'GET' && p === '/whoami') {
        const ident = await this.verifyToken(url.searchParams.get('token') || '');
        return ident ? json({ ok: true }) : json({ error: 'unauthorized' }, 401);
      }
      if (request.method === 'GET' && p === '/profile') return this.handleProfileGet(url);
      if (request.method === 'POST' && p === '/profile') return this.handleProfileSave(request, url);
      if (request.method === 'GET' && p === '/gallery') {
        const ident = await this.verifyToken(url.searchParams.get('token') || '');
        return json(await this.galleryManifest(ident ? ident.profileId : null));
      }
      if (request.method === 'POST' && p === '/gallery/add') return this.handleGalleryAdd(request, url);
      if (request.method === 'POST' && p === '/gallery/remove') return this.handleGalleryRemove(request, url);
      if (request.method === 'POST' && p === '/gallery/reorder') return this.handleGalleryReorder(request, url);
      if (request.method === 'POST' && p === '/setlist') return this.handleSetlistSubmit(request, url);
      if (request.method === 'GET' && p === '/setlists/history') return this.handleSetlistHistory(url);
      if (request.method === 'POST' && p === '/setlists/history/delete') return this.handleSetlistHistoryDelete(request, url);
      if (request.method === 'POST' && p === '/song-submit') return this.handleSongSubmit(request, url);
      if (request.method === 'GET' && p === '/songs/mine') return this.handleSongsMine(url);
      if (request.method === 'GET' && p === '/songs/web') return this.handleWebSongs(url);
      if (request.method === 'GET' && p === '/backgrounds') return this.handleBackgroundsManifest(url);

      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('[RoomRelay] Fetch error:', err);
      return json({ error: (err && err.message) || 'Lỗi xử lý yêu cầu relay' }, 500);
    }
  }
}
