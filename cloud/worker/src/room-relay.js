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
const MSG_TYPES = ['alert', 'text', 'ack', 'resolve', 'presence', 'gallery', 'room', 'system', 'setlist'];
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
  try { return atob(s); } catch (e) { return ''; }
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
    });
    // Chống brute-force /join, /login — y hệt curve joinAttempts ở LAN
    // server.js cũ, CHỈ khác chỗ lưu (RAM của instance DO, không phải
    // ctx.storage): reset khi DO bị evict là đánh đổi CHẤP NHẬN ĐƯỢC, giống
    // LAN server cũ cũng reset khi restart — không phải state cần sống sót
    // qua evict, và ghi storage mỗi lần thử sẽ tốn 1 lượt storage write/
    // request không cần thiết.
    this.joinAttempts = new Map(); // key -> { fails, blockUntil, lastAt }
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
    return { clientId, name: b64urlDecodeToStr(nameB64), profileId: b64urlDecodeToStr(profileB64) || null };
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

    if (!this.adminSecret) {
      // Bootstrap lần đầu — client (main.js) tự sinh adminSecret, gửi lên
      // đây để DO ghim lại; từ lần sau bắt buộc khớp mới sửa được.
      if (!headerSecret || headerSecret.length < 16) return json({ error: 'Thiếu X-Admin-Secret hợp lệ lúc khởi tạo' }, 400);
      this.adminSecret = headerSecret;
      await this.ctx.storage.put('adminSecret', this.adminSecret);
    } else if (headerSecret !== this.adminSecret) {
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
      passwordSetAt: passwordChanged ? Date.now() : ((this.config && this.config.passwordSetAt) || Date.now()),
      accountsEnabled: body.accountsEnabled === true,
      passwordRequiredWithAccounts: body.passwordRequiredWithAccounts === true,
      authMode: body.authMode === 'cognito' ? 'cognito' : 'local'
    };
    await this.ctx.storage.put('config', this.config);
    if (passwordChanged) await this.rotateSecret();
    return json({ ok: true, config: this.config });
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
            passwordSetAt: r.createdAt || Date.now(),
            accountsEnabled: true,
            passwordRequiredWithAccounts: false,
            authMode: 'local'
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
    return !!this.adminSecret && headerSecret === this.adminSecret;
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
    if (action === 'reorder') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const map = new Map(this.gallery.images.map((x) => [x.id, x]));
      const next = ids.map((id) => map.get(id)).filter(Boolean);
      this.gallery.images.forEach((x) => { if (next.indexOf(x) < 0) next.push(x); });
      this.gallery.images = next;
      this.gallery.updatedAt = Date.now();
      await this.ctx.storage.put('gallery', this.gallery);
      await this.announceGallery();
      return json(await this.galleryManifest());
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
      gallery: await this.galleryManifest(),
      setlistEnabled: true
    };
  }

  async afterIdentityVerified(account) {
    if (!this.config.passwordRequiredWithAccounts) return json(await this.finishLogin(account));
    const tempToken = randomHex(16);
    this.pendingLogins.set(tempToken, {
      accountId: account.id, name: account.name, mustChangePassword: !!account.mustChangePassword,
      expiresAt: Date.now() + PENDING_LOGIN_MAX_AGE_MS
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
    const profileId = (typeof body.profileId === 'string' && body.profileId) ? body.profileId : ident.profileId;
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
  async galleryManifest() {
    return { images: this.gallery.images.map((x) => ({ id: x.id, name: x.name, ownerId: x.ownerId || null })), updatedAt: this.gallery.updatedAt || 0 };
  }

  async announceGallery() {
    const env = makeEnvelope({ type: 'gallery', from: { clientId: 'server', name: 'Kênh Band' }, meta: await this.galleryManifest() });
    this.broadcast(env);
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
    return { manifest: await this.galleryManifest() };
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
    return { manifest: await this.galleryManifest() };
  }

  async handleGalleryAdd(request, url) {
    const ident = await this.verifyToken(url.searchParams.get('token') || '');
    if (!ident) return json({ error: 'unauthorized' }, 401);
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
      .map((it) => ({ type: 'song', id: it.id, title: String(it.title || '').replace(/[<>]/g, '').slice(0, 200) }));
    if (!items.length) return json({ error: 'Setlist rỗng' }, 400);
    const sl = {
      id: String(body.id || newId('sl')),
      name: String(body.name || '').trim().slice(0, 80) || 'Setlist',
      from: { name: ident.name }, ts: Date.now(), items
    };
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

  presenceList() {
    return this.ctx.getWebSockets().map((ws) => {
      const a = ws.deserializeAttachment() || {};
      return { clientId: a.clientId, name: a.name };
    });
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
    const clientId = newId('c');
    const token = await this.makeToken(clientId, name, profileId);
    const restored = (profileId && this.profiles[profileId]) || this.findProfileByName(name);
    return json({
      token, clientId,
      room: { name: this.config.name },
      since: this.ring.length ? this.ring[this.ring.length - 1].id : null,
      profile: restored ? { profileId: profileId, ...restored } : null,
      gallery: await this.galleryManifest(),
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
      const replay = idx >= 0 ? this.ring.slice(idx + 1) : this.ring;
      for (const envelope of replay) {
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
      const envelope = makeEnvelope({ type: 'text', from: { clientId: a.clientId, name: a.name }, to: body.to || 'all', text });
      await this.pushRing(envelope);
      this.broadcast(envelope);
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
        this.broadcast(envelope);
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
    if (p.indexOf('/admin/accounts/') === 0) {
      return this.handleAdminAccounts(request, p.slice('/admin/accounts/'.length));
    }
    if (p.indexOf('/admin/gallery/') === 0) {
      return this.handleAdminGallery(request, p.slice('/admin/gallery/'.length));
    }
    if (request.method === 'GET' && p === '/mode') {
      if (!this.config) return json({ configured: false });
      return json({
        configured: true, roomName: this.config.name,
        accountsEnabled: !!this.config.accountsEnabled,
        passwordRequiredWithAccounts: !!this.config.passwordRequiredWithAccounts,
        authMode: this.config.authMode || 'local'
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
    if (request.method === 'GET' && p === '/gallery') return json(await this.galleryManifest());
    if (request.method === 'POST' && p === '/gallery/add') return this.handleGalleryAdd(request, url);
    if (request.method === 'POST' && p === '/gallery/remove') return this.handleGalleryRemove(request, url);
    if (request.method === 'POST' && p === '/setlist') return this.handleSetlistSubmit(request, url);

    return json({ error: 'not found' }, 404);
  }
}
