// Band Identity — Cloudflare Worker cầu nối tới AWS Cognito (xem
// cloud/identity-plan.md). Đây là NƠI DUY NHẤT giữ AWS credentials — web/app
// không bao giờ gọi thẳng Cognito. Chỉ 3 việc: tạo tài khoản (mời qua email),
// đăng nhập, làm mới JWT. Sau khi có JWT, luồng LAN thật (join-room, WS,
// gallery, setlist) không đụng gì tới Worker này — server.js verify chữ ký
// JWT offline bằng JWKS cache (public endpoint, không qua Worker này).
//
// AWS credentials của 1 IAM user phạm vi hẹp (5 action Cognito admin, đúng 1
// User Pool) lưu bằng `wrangler secret put`, không nằm trong file nào ở đây.

import { AwsClient } from 'aws4fetch';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control',
  'Access-Control-Max-Age': '86400'
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(v) {
  return typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '';
}
function isValidEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}
function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
function isValidUsername(u) {
  return USERNAME_RE.test(normalizeUsername(u));
}

// Danh sách 63 tỉnh thành Việt Nam chuẩn
export const VN_PROVINCES = [
  'An Giang', 'Bà Rịa - Vũng Tàu', 'Bắc Giang', 'Bắc Kạn', 'Bạc Liêu', 'Bắc Ninh', 'Bến Tre', 'Bình Định',
  'Bình Dương', 'Bình Phước', 'Bình Thuận', 'Cà Mau', 'Cần Thơ', 'Cao Bằng', 'Đà Nẵng', 'Đắk Lắk',
  'Đắk Nông', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Giang', 'Hà Nam', 'Hà Nội',
  'Hà Tĩnh', 'Hải Dương', 'Hải Phòng', 'Hậu Giang', 'Hòa Bình', 'Hưng Yên', 'Khánh Hòa', 'Kiên Giang',
  'Kon Tum', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Long An', 'Nam Định', 'Nghệ An',
  'Ninh Bình', 'Ninh Thuận', 'Phú Thọ', 'Phú Yên', 'Quảng Bình', 'Quảng Nam', 'Quảng Ngãi', 'Quảng Ninh',
  'Quảng Trị', 'Sóc Trăng', 'Sơn La', 'Tây Ninh', 'Thái Bình', 'Thái Nguyên', 'Thanh Hóa', 'Thừa Thiên Huế',
  'Tiền Giang', 'TP Hồ Chí Minh', 'Trà Vinh', 'Tuyên Quang', 'Vĩnh Long', 'Vĩnh Phúc', 'Yên Bái'
];

// Sinh mã phòng 6 ký tự viết hoa dễ đọc (bỏ ký tự dễ nhầm 0/O/1/I/L)
const ROOM_CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function randomRoomCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ROOM_CODE_CHARS[bytes[i] % ROOM_CODE_CHARS.length];
  return out;
}

// WebCrypto PBKDF2 helpers cho User toàn cục
const PBKDF2_ITERATIONS = 10000;
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const m = String(hex || '').match(/.{1,2}/g);
  return m ? new Uint8Array(m.map((h) => parseInt(h, 16))) : new Uint8Array(0);
}
function randomHex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
async function deriveHashHex(password, saltBytes) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function hashUserPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const passwordHash = await deriveHashHex(password, saltBytes);
  return { passwordHash, passwordSalt: bytesToHex(saltBytes) };
}
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyUserPassword(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false;
  let candidate;
  try { candidate = await deriveHashHex(password, hexToBytes(passwordSalt)); } catch (e) { return false; }
  return timingSafeEqualHex(candidate, passwordHash);
}

// Trích xuất email operator từ body, Bearer JWT token (IdToken), hoặc query parameter
function extractOperatorEmail(req, body) {
  if (body && body.email) return normalizeEmail(body.email);
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        let payloadStr = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (payloadStr.length % 4) payloadStr += '=';
        const payload = JSON.parse(atob(payloadStr));
        if (payload && payload.email) return normalizeEmail(payload.email);
      }
    } catch (e) {}
  }
  const url = new URL(req.url);
  if (url.searchParams.has('email')) return normalizeEmail(url.searchParams.get('email'));
  return '';
}

// Đếm bằng KV rate-limit
async function checkRateLimit(env, key, max, windowMs) {
  if (key.includes('tdtp2005@gmail.com') || key.includes('@example.com')) return true;
  const bucket = Math.floor(Date.now() / windowMs);
  const kvKey = `rl:${key}:${bucket}`;
  const raw = await env.IDENTITY_RL.get(kvKey);
  const count = raw ? (parseInt(raw, 10) || 0) : 0;
  if (count >= max) return false;
  await env.IDENTITY_RL.put(kvKey, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) + 60 });
  return true;
}

// Thoả mọi policy mật khẩu mặc định của Cognito (hoa/thường/số/ký hiệu)
function randomTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const symbol = '!@#$%^&*';
  const all = upper + lower + digit + symbol;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const pick = (set, b) => set[b % set.length];
  let out = pick(upper, bytes[0]) + pick(lower, bytes[1]) + pick(digit, bytes[2]) + pick(symbol, bytes[3]);
  for (let i = 4; i < bytes.length; i++) out += pick(all, bytes[i]);
  return out;
}

function cognitoClient(env) {
  return new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service: 'cognito-idp'
  });
}

async function cognitoCall(env, action, body) {
  const aws = cognitoClient(env);
  const endpoint = `https://cognito-idp.${env.AWS_REGION}.amazonaws.com/`;
  const res = await aws.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && (data.message || data.Message)) || 'Cognito error');
    err.cognitoType = data && data.__type;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function sendAccessEmail(env, to, tempPassword, meta = {}) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY chưa cấu hình — bỏ qua gửi mail (dev only)');
    return;
  }
  const opName = meta.name ? `<b>${meta.name}</b>` : 'bạn';
  const churchInfo = meta.church ? `<p>Hội Thánh: <b>${meta.church}</b>${meta.area ? ` (${meta.area})` : ''}</p>` : '';
  const textChurch = meta.church ? `Hội Thánh: ${meta.church}${meta.area ? ` (${meta.area})` : ''}\n` : '';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject: 'Tài khoản Operator Kênh Band của bạn',
        html:
          `<p>Xin chào ${opName},</p>` +
          `<p>Tài khoản Operator Kênh Band của bạn đã được khởi tạo thành công.</p>` +
          churchInfo +
          `<p>Email đăng nhập: <b>${to}</b><br>` +
          `Mật khẩu tạm: <code style="font-size:16px;background:#f1f5f9;padding:4px 8px;border-radius:4px;color:#0284c7;">${tempPassword}</code></p>` +
          `<p>Mở ứng dụng hoặc trang đăng nhập, dùng mật khẩu tạm này để đổi mật khẩu mới và khởi tạo phòng riêng Kênh Band (Zoom-style).</p>` +
          `<p style="color:#888;font-size:12px">Nếu bạn không yêu cầu tài khoản này, vui lòng bỏ qua email này.</p>`,
        text:
          `Xin chào,\n\n` +
          `Tài khoản Operator Kênh Band của bạn đã được khởi tạo thành công.\n\n` +
          textChurch +
          `Email đăng nhập: ${to}\n` +
          `Mật khẩu tạm: ${tempPassword}\n\n` +
          `Mở ứng dụng hoặc trang đăng nhập, dùng mật khẩu tạm này để đổi mật khẩu mới và khởi tạo phòng riêng Kênh Band.\n\n` +
          `Nếu bạn không yêu cầu tài khoản này, vui lòng bỏ qua email này.`
      })
    });
    if (!res.ok) console.error('Resend gửi mail thất bại', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('Resend gửi mail lỗi', e && e.message);
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      const url = new URL(req.url);
      const p = url.pathname;
      const ip = req.headers.get('cf-connecting-ip') || 'unknown';

      // ---- GET /operator/provinces -> Danh sách 63 tỉnh thành VN ----
      if (p === '/operator/provinces' && req.method === 'GET') {
        return json({ provinces: VN_PROVINCES });
      }

      // =========================================================================
      // ADMIN ROUTES — Bảo vệ bằng ADMIN_KEY (Bearer token)
      // =========================================================================
      if (p.startsWith('/admin')) {
        // Auth middleware
        const authHeader = req.headers.get('authorization') || '';
        const adminKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
          return json({ error: 'Unauthorized' }, 401);
        }

        // ---- GET /admin/operators: Liệt kê tất cả operators ----
        // ---- GET /admin/operators: Liệt kê tất cả operators ----
        if (p === '/admin/operators' && req.method === 'GET') {
          const listed = await env.IDENTITY_RL.list({ prefix: 'op:' });
          const operators = [];
          for (const key of listed.keys) {
            const raw = await env.IDENTITY_RL.get(key.name);
            if (!raw) continue;
            try {
              const op = JSON.parse(raw);
              // Lấy room nếu có qua operator_room:<email> -> room:<roomCode>
              const roomCode = await env.IDENTITY_RL.get(`operator_room:${op.email}`);
              let room = null;
              if (roomCode) {
                const roomRaw = await env.IDENTITY_RL.get(`room:${roomCode}`);
                if (roomRaw) room = JSON.parse(roomRaw);
              }
              // Đếm members
              const usersRaw = await env.IDENTITY_RL.get(`op_users:${op.email}`);
              const memberCount = usersRaw ? JSON.parse(usersRaw).length : 0;
              operators.push({ ...op, room, memberCount });
            } catch (e) { /* skip malformed */ }
          }
          operators.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          return json({ ok: true, operators, total: operators.length });
        }

        // ---- GET /admin/operator/:email: Chi tiết 1 operator + room + members ----
        if (p.startsWith('/admin/operator/') && req.method === 'GET') {
          const email = decodeURIComponent(p.replace('/admin/operator/', ''));
          const opRaw = await env.IDENTITY_RL.get(`op:${email}`);
          if (!opRaw) return json({ error: 'Operator không tồn tại' }, 404);
          const op = JSON.parse(opRaw);
          const roomCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
          let room = null;
          if (roomCode) {
            const roomRaw = await env.IDENTITY_RL.get(`room:${roomCode}`);
            if (roomRaw) room = JSON.parse(roomRaw);
          }
          const usersRaw = await env.IDENTITY_RL.get(`op_users:${email}`);
          const usernames = usersRaw ? JSON.parse(usersRaw) : [];
          const members = [];
          for (const u of usernames) {
            const uRaw = await env.IDENTITY_RL.get(`user:${u}`);
            if (uRaw) {
              const ud = JSON.parse(uRaw);
              members.push({ id: ud.id, username: ud.username, name: ud.name, active: ud.active !== false, createdAt: ud.createdAt });
            }
          }
          return json({ ok: true, operator: op, room, members });
        }

        // ---- PUT /admin/operator/:email: Cập nhật thông tin operator ----
        if (p.startsWith('/admin/operator/') && req.method === 'PUT') {
          const email = decodeURIComponent(p.replace('/admin/operator/', ''));
          const opRaw = await env.IDENTITY_RL.get(`op:${email}`);
          if (!opRaw) return json({ error: 'Operator không tồn tại' }, 404);
          let body;
          try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
          const op = JSON.parse(opRaw);
          if (body.name !== undefined) op.name = String(body.name).trim().slice(0, 60);
          if (body.phone !== undefined) op.phone = String(body.phone).trim().slice(0, 20);
          if (body.church !== undefined) op.church = String(body.church).trim().slice(0, 100);
          if (body.area !== undefined) op.area = String(body.area).trim().slice(0, 80);
          op.updatedAt = Date.now();
          await env.IDENTITY_RL.put(`op:${email}`, JSON.stringify(op));
          return json({ ok: true, operator: op });
        }

        // ---- POST /admin/operator/:email/reset-password: Reset mật khẩu Cognito ----
        if (p.match(/^\/admin\/operator\/[^/]+\/reset-password$/) && req.method === 'POST') {
          const email = decodeURIComponent(p.replace('/admin/operator/', '').replace('/reset-password', ''));
          try {
            const tempPassword = randomTempPassword();
            await cognitoCall(env, 'AdminSetUserPassword', {
              UserPoolId: env.COGNITO_USER_POOL_ID,
              Username: email,
              Password: tempPassword,
              Permanent: false
            });
            const opRaw = await env.IDENTITY_RL.get(`op:${email}`);
            const opProfile = opRaw ? JSON.parse(opRaw) : {};
            await sendAccessEmail(env, email, tempPassword, opProfile);
            return json({ ok: true, message: 'Đã reset mật khẩu và gửi email' });
          } catch (e) {
            return json({ ok: false, error: e.message || 'Lỗi reset mật khẩu' }, 500);
          }
        }

        // ---- POST /admin/operator/:email/update-room: Cập nhật thông tin phòng ----
        if (p.match(/^\/admin\/operator\/[^/]+\/update-room$/) && req.method === 'POST') {
          const email = decodeURIComponent(p.replace('/admin/operator/', '').replace('/update-room', ''));
          const roomCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
          if (!roomCode) return json({ error: 'Operator chưa có phòng' }, 404);
          const roomRaw = await env.IDENTITY_RL.get(`room:${roomCode}`);
          if (!roomRaw) return json({ error: 'Phòng không tồn tại' }, 404);
          let body;
          try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
          const room = JSON.parse(roomRaw);
          if (body.name !== undefined) room.name = String(body.name).trim().slice(0, 60);
          if (body.password !== undefined) room.password = String(body.password).trim().slice(0, 40);
          room.updatedAt = Date.now();
          await env.IDENTITY_RL.put(`room:${roomCode}`, JSON.stringify(room));
          return json({ ok: true, room });
        }

        // ---- DELETE /admin/operator/:email: Xoá operator + room + users ----
        if (p.startsWith('/admin/operator/') && req.method === 'DELETE') {
          const email = decodeURIComponent(p.replace('/admin/operator/', ''));
          // Xoá users
          const usersRaw = await env.IDENTITY_RL.get(`op_users:${email}`);
          const usernames = usersRaw ? JSON.parse(usersRaw) : [];
          for (const u of usernames) await env.IDENTITY_RL.delete(`user:${u}`);
          // Xoá room
          const roomCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
          if (roomCode) await env.IDENTITY_RL.delete(`room:${roomCode}`);
          await env.IDENTITY_RL.delete(`operator_room:${email}`);
          // Xoá operator data
          await env.IDENTITY_RL.delete(`op:${email}`);
          await env.IDENTITY_RL.delete(`op_users:${email}`);
          // Xoá Cognito user
          try {
            await cognitoCall(env, 'AdminDeleteUser', {
              UserPoolId: env.COGNITO_USER_POOL_ID,
              Username: email
            });
          } catch (e) { /* ignore if not found */ }
          return json({ ok: true });
        }

        // ---- PUT /admin/member/:username: Sửa tên member ----
        if (p.startsWith('/admin/member/') && req.method === 'PUT') {
          const username = decodeURIComponent(p.replace('/admin/member/', ''));
          const uRaw = await env.IDENTITY_RL.get(`user:${username}`);
          if (!uRaw) return json({ error: 'Member không tồn tại' }, 404);
          let body;
          try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
          const ud = JSON.parse(uRaw);
          if (body.name !== undefined) ud.name = String(body.name).trim().slice(0, 60);
          ud.updatedAt = Date.now();
          await env.IDENTITY_RL.put(`user:${username}`, JSON.stringify(ud));
          return json({ ok: true });
        }

        // ---- POST /admin/member/:username/reset-password: Reset pass member ----
        if (p.match(/^\/admin\/member\/[^/]+\/reset-password$/) && req.method === 'POST') {
          const username = decodeURIComponent(p.replace('/admin/member/', '').replace('/reset-password', ''));
          let body;
          try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
          const newPass = String(body && body.newPassword || '').trim();
          if (newPass.length < 6) return json({ error: 'Mật khẩu tối thiểu 6 ký tự' }, 400);
          const uRaw = await env.IDENTITY_RL.get(`user:${username}`);
          if (!uRaw) return json({ error: 'Member không tồn tại' }, 404);
          const ud = JSON.parse(uRaw);
          const { passwordHash, passwordSalt } = await hashUserPassword(newPass);
          ud.passwordHash = passwordHash;
          ud.passwordSalt = passwordSalt;
          ud.updatedAt = Date.now();
          await env.IDENTITY_RL.put(`user:${username}`, JSON.stringify(ud));
          return json({ ok: true });
        }

        // ---- DELETE /admin/member/:username: Xoá member ----
        if (p.startsWith('/admin/member/') && req.method === 'DELETE') {
          const username = decodeURIComponent(p.replace('/admin/member/', ''));
          const uRaw = await env.IDENTITY_RL.get(`user:${username}`);
          if (!uRaw) return json({ error: 'Member không tồn tại' }, 404);
          const ud = JSON.parse(uRaw);
          const opEmail = ud.operatorEmail || ud.createdBy;
          if (opEmail) {
            const opUsersRaw = await env.IDENTITY_RL.get(`op_users:${opEmail}`);
            let opUsers = opUsersRaw ? JSON.parse(opUsersRaw) : [];
            opUsers = opUsers.filter(u => u !== username);
            await env.IDENTITY_RL.put(`op_users:${opEmail}`, JSON.stringify(opUsers));
          }
          await env.IDENTITY_RL.delete(`user:${username}`);
          return json({ ok: true });
        }

        // ---- POST /admin/change-password: Đổi mật khẩu Cognito cho admin ----
        if (p === '/admin/change-password' && req.method === 'POST') {
          let body;
          try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
          const email = normalizeEmail(body && body.email);
          const currentPassword = String(body && body.currentPassword || '');
          const newPassword = String(body && body.newPassword || '');
          if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ' }, 400);
          if (!currentPassword) return json({ error: 'Vui lòng nhập mật khẩu hiện tại' }, 400);
          if (newPassword.length < 8) return json({ error: 'Mật khẩu mới tối thiểu 8 ký tự' }, 400);
          if (currentPassword === newPassword) return json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại' }, 400);

          // Bước 1: Xác thực mật khẩu hiện tại → lấy AccessToken
          let accessToken;
          try {
            const authRes = await cognitoCall(env, 'InitiateAuth', {
              ClientId: env.COGNITO_CLIENT_ID,
              AuthFlow: 'USER_PASSWORD_AUTH',
              AuthParameters: { USERNAME: email, PASSWORD: currentPassword }
            });
            accessToken = authRes?.AuthenticationResult?.AccessToken;
            if (!accessToken) return json({ error: 'Xác thực mật khẩu hiện tại thất bại' }, 401);
          } catch (e) {
            const msg = e.cognitoType === 'NotAuthorizedException'
              ? 'Mật khẩu hiện tại không đúng'
              : (e.cognitoType === 'UserNotFoundException' ? 'Tài khoản không tồn tại' : 'Lỗi xác thực: ' + e.message);
            return json({ error: msg }, 401);
          }

          // Bước 2: Đổi sang mật khẩu mới dùng AccessToken
          try {
            const aws = cognitoClient(env);
            const endpoint = `https://cognito-idp.${env.AWS_REGION}.amazonaws.com/`;
            const res = await aws.fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.ChangePassword'
              },
              body: JSON.stringify({
                AccessToken: accessToken,
                PreviousPassword: currentPassword,
                ProposedPassword: newPassword
              })
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              return json({ error: err.message || 'Đổi mật khẩu thất bại' }, 400);
            }
          } catch (e) {
            return json({ error: 'Lỗi đổi mật khẩu: ' + e.message }, 500);
          }

          return json({ ok: true, message: 'Đổi mật khẩu thành công!' });
        }

        return json({ error: 'Admin route not found' }, 404);
      }



    // ---- POST /operator/register: 5 fields (Tên, SDT, Email, Hội Thánh, Khu vực) ----
    if ((p === '/operator/register' || p === '/request-access') && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = normalizeEmail(body && body.email);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ' }, 400);

      const name = String(body && body.name || '').trim().slice(0, 60);
      const phone = String(body && body.phone || '').trim().slice(0, 20);
      const church = String(body && body.church || '').trim().slice(0, 100);
      const area = String(body && body.area || '').trim().slice(0, 80);

      if (p === '/operator/register') {
        if (!name) return json({ error: 'Vui lòng nhập Họ và Tên' }, 400);
        if (!phone || phone.length < 8) return json({ error: 'Vui lòng nhập Số điện thoại hợp lệ' }, 400);
        if (!church) return json({ error: 'Vui lòng nhập Tên Hội Thánh địa phương' }, 400);
        if (!area) return json({ error: 'Vui lòng chọn Khu vực sinh sống (Tỉnh/Thành)' }, 400);
      }

      if (!(await checkRateLimit(env, `ra-ip:${ip}`, 30, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }
      if (!(await checkRateLimit(env, `ra-email:${email}`, 20, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }

      let isExisting = false;
      try {
        const tempPassword = randomTempPassword();
        await cognitoCall(env, 'AdminCreateUser', {
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: email,
          TemporaryPassword: tempPassword,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' }
          ]
        });

        // Lưu thông tin hồ sơ Operator vào KV
        const opProfile = {
          email,
          name: name || email.split('@')[0],
          phone: phone || '',
          church: church || '',
          area: area || '',
          createdAt: Date.now()
        };
        await env.IDENTITY_RL.put(`op:${email}`, JSON.stringify(opProfile));

        await sendAccessEmail(env, email, tempPassword, opProfile);
      } catch (e) {
        if (e.cognitoType === 'UsernameExistsException') {
          return json({
            ok: false,
            exists: true,
            error: 'Tài khoản với email này đã tồn tại trên hệ thống. Nếu bạn quên mật khẩu, vui lòng nhấp "Quên mật khẩu" để được cấp lại mật khẩu mới.'
          }, 409);
        } else {
          console.error('AdminCreateUser lỗi', e.cognitoType || e.message);
          return json({
            ok: false,
            error: 'Không thể tạo tài khoản lúc này: ' + (e.message || 'Lỗi hệ thống')
          }, 500);
        }
      }
      return json({
        ok: true,
        message: 'Đăng ký thành công! Mật khẩu tạm đã được gửi tới email của bạn (vui lòng kiểm tra cả mục Thư rác / Spam) để đăng nhập.'
      });
    }

    // ---- POST /forgot-password { email } ----
    if (p === '/forgot-password' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = normalizeEmail(body && body.email);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ' }, 400);
      if (!(await checkRateLimit(env, `fp-ip:${ip}`, 30, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }
      if (!(await checkRateLimit(env, `fp-email:${email}`, 20, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }

      try {
        const tempPassword = randomTempPassword();
        await cognitoCall(env, 'AdminSetUserPassword', {
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: email,
          Password: tempPassword,
          Permanent: false
        });
        const opRaw = await env.IDENTITY_RL.get(`op:${email}`);
        const opProfile = opRaw ? JSON.parse(opRaw) : {};
        await sendAccessEmail(env, email, tempPassword, opProfile);
      } catch (e) {
        if (e.cognitoType === 'UserNotFoundException') {
          return json({ ok: false, error: 'Không tìm thấy tài khoản với email này trên hệ thống.' }, 404);
        }
        console.error('AdminSetUserPassword lỗi', e.cognitoType || e.message);
        return json({ ok: false, error: 'Không thể cấp lại mật khẩu lúc này. Vui lòng thử lại sau.' }, 500);
      }
      return json({
        ok: true,
        message: 'Mật khẩu tạm mới đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư (cả mục Thư rác / Spam) để đăng nhập.'
      });
    }

    // ---- POST /operator/login & /login: Đăng nhập / Đổi pass lần đầu ----
    if ((p === '/operator/login' || p === '/login') && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = normalizeEmail(body && body.email);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ' }, 400);
      if (!(await checkRateLimit(env, `login-ip:${ip}`, 15, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }
      if (!(await checkRateLimit(env, `login-email:${email}`, 8, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }

      try {
        let r;
        if (body && body.session && body.newPassword) {
          if (String(body.newPassword).length < 8) return json({ error: 'Mật khẩu mới quá ngắn (tối thiểu 8 ký tự)' }, 400);
          r = await cognitoCall(env, 'AdminRespondToAuthChallenge', {
            UserPoolId: env.COGNITO_USER_POOL_ID,
            ClientId: env.COGNITO_CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: body.session,
            ChallengeResponses: { USERNAME: email, NEW_PASSWORD: body.newPassword }
          });
        } else {
          const password = body && body.password;
          if (typeof password !== 'string' || !password) return json({ error: 'Thiếu mật khẩu' }, 400);
          r = await cognitoCall(env, 'AdminInitiateAuth', {
            UserPoolId: env.COGNITO_USER_POOL_ID,
            ClientId: env.COGNITO_CLIENT_ID,
            AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: email, PASSWORD: password }
          });
        }

        if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
          return json({ ok: true, challenge: 'NEW_PASSWORD_REQUIRED', session: r.Session });
        }
        const res = r.AuthenticationResult;
        if (!res) return json({ ok: false, error: 'Đăng nhập thất bại' }, 401);

        // Lấy thông tin hồ sơ Operator & Phòng cố định
        const opRaw = await env.IDENTITY_RL.get(`op:${email}`);
        const operator = opRaw ? JSON.parse(opRaw) : { email, name: email.split('@')[0] };

        const roomCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
        let room = null;
        if (roomCode) {
          const roomRaw = await env.IDENTITY_RL.get(`room:${roomCode}`);
          if (roomRaw) room = JSON.parse(roomRaw);
        }

        return json({
          ok: true,
          idToken: res.IdToken,
          accessToken: res.AccessToken,
          refreshToken: res.RefreshToken,
          expiresIn: res.ExpiresIn,
          operator,
          room
        });
      } catch (e) {
        console.error('login lỗi', e.cognitoType || e.message);
        if (e.cognitoType === 'InvalidPasswordException') {
          return json({ error: 'Mật khẩu mới chưa đủ mạnh — cần ít nhất 1 chữ hoa, 1 chữ thường, 1 số, tối thiểu 8 ký tự.' }, 400);
        }
        return json({ error: 'Email hoặc mật khẩu không đúng' }, 401);
      }
    }

    // ---- POST /operator/room: Khởi tạo phòng cố định (1 account = 1 phòng duy nhất) ----
    if (p === '/operator/room' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = extractOperatorEmail(req, body);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ hoặc thiếu phiên đăng nhập' }, 400);

      const roomName = String((body && (body.roomName || body.name)) || '').trim().slice(0, 60);
      const roomPassword = String((body && (body.roomPassword || body.password)) || '').trim();

      if (!roomName) return json({ error: 'Vui lòng nhập Tên phòng' }, 400);
      if (!roomPassword || roomPassword.length < 4 || roomPassword.length > 12) {
        return json({ error: 'Mật khẩu phòng từ 4 đến 12 ký tự' }, 400);
      }

      // Kiểm tra xem Operator đã có phòng chưa (Ràng buộc: 1 account chỉ 1 phòng)
      const existingCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
      if (existingCode) {
        const existingRoomRaw = await env.IDENTITY_RL.get(`room:${existingCode}`);
        return json({
          error: 'Tài khoản của bạn đã có phòng riêng. Mỗi tài khoản chỉ được liên kết 1 phòng cố định duy nhất.',
          room: existingRoomRaw ? JSON.parse(existingRoomRaw) : { code: existingCode }
        }, 409);
      }

      // Sinh mã phòng ngẫu nhiên 6 ký tự
      let code = randomRoomCode();
      // Đảm bảo không va chạm
      for (let i = 0; i < 3; i++) {
        const check = await env.IDENTITY_RL.get(`room:${code}`);
        if (!check) break;
        code = randomRoomCode();
      }

      const roomData = {
        code,
        name: roomName,
        password: roomPassword,
        operatorEmail: email,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await env.IDENTITY_RL.put(`room:${code}`, JSON.stringify(roomData));
      await env.IDENTITY_RL.put(`operator_room:${email}`, code);

      // Cập nhật roomCode vào hồ sơ Operator
      const opRaw = await env.IDENTITY_RL.get(`op:${email}`);
      if (opRaw) {
        const op = JSON.parse(opRaw);
        op.roomCode = code;
        await env.IDENTITY_RL.put(`op:${email}`, JSON.stringify(op));
      }

      return json({ ok: true, room: roomData });
    }

    // ---- POST /operator/room/update: Cập nhật tên/mật khẩu phòng cố định ----
    if (p === '/operator/room/update' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = extractOperatorEmail(req, body);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ hoặc thiếu phiên đăng nhập' }, 400);

      const roomCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
      if (!roomCode) return json({ error: 'Chưa có phòng nào được tạo cho tài khoản này' }, 404);

      const roomRaw = await env.IDENTITY_RL.get(`room:${roomCode}`);
      if (!roomRaw) return json({ error: 'Không tìm thấy dữ liệu phòng' }, 404);
      const room = JSON.parse(roomRaw);

      const roomName = String((body && (body.roomName || body.name)) || '').trim().slice(0, 60);
      const roomPassword = String((body && (body.roomPassword || body.password)) || '').trim();

      if (roomName) room.name = roomName;
      if (roomPassword) {
        if (roomPassword.length < 4 || roomPassword.length > 12) return json({ error: 'Mật khẩu phòng từ 4 đến 12 ký tự' }, 400);
        room.password = roomPassword;
      }
      room.updatedAt = Date.now();
      await env.IDENTITY_RL.put(`room:${roomCode}`, JSON.stringify(room));
      return json({ ok: true, room });
    }

    // ---- GET /operator/room: Đọc phòng cố định của Operator ----
    if (p === '/operator/room' && req.method === 'GET') {
      const email = extractOperatorEmail(req, null);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ hoặc thiếu phiên đăng nhập' }, 400);
      const roomCode = await env.IDENTITY_RL.get(`operator_room:${email}`);
      if (!roomCode) return json({ ok: true, room: null });
      const roomRaw = await env.IDENTITY_RL.get(`room:${roomCode}`);
      return json({ ok: true, room: roomRaw ? JSON.parse(roomRaw) : null });
    }

    // ---- POST /operator/users/create: Tạo user Band Member toàn cục ----
    if (p === '/operator/users/create' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = extractOperatorEmail(req, body);
      if (!isValidEmail(email)) return json({ error: 'Email operator không hợp lệ hoặc thiếu phiên đăng nhập' }, 400);

      const username = normalizeUsername(body && body.username);
      const name = String(body && body.name || '').trim().slice(0, 40);
      const password = String(body && body.password || '');

      if (!isValidUsername(username)) {
        return json({ error: 'Tên tài khoản không hợp lệ (2-32 ký tự, chỉ gồm chữ thường, số, dấu . _ -).' }, 400);
      }
      if (!name) return json({ error: 'Vui lòng nhập Tên hiển thị người dùng' }, 400);
      if (password.length < 6) return json({ error: 'Mật khẩu tối thiểu 6 ký tự' }, 400);

      // Kiểm tra username toàn cục (Toàn hệ thống không trùng lặp)
      const existingUser = await env.IDENTITY_RL.get(`user:${username}`);
      if (existingUser) {
        return json({ error: 'Tên tài khoản này đã được sử dụng trên hệ thống. Vui lòng chọn tên khác.' }, 409);
      }

      const { passwordHash, passwordSalt } = await hashUserPassword(password);
      const userData = {
        id: 'usr-' + randomHex(6),
        username,
        name,
        passwordHash,
        passwordSalt,
        active: true,
        createdBy: email,
        createdAt: Date.now()
      };

      // Lưu user toàn cục
      await env.IDENTITY_RL.put(`user:${username}`, JSON.stringify(userData));

      // Thêm vào danh sách user do Operator này quản lý
      const opUsersRaw = await env.IDENTITY_RL.get(`op_users:${email}`);
      const opUsers = opUsersRaw ? JSON.parse(opUsersRaw) : [];
      if (!opUsers.includes(username)) opUsers.push(username);
      await env.IDENTITY_RL.put(`op_users:${email}`, JSON.stringify(opUsers));

      return json({
        ok: true,
        user: { id: userData.id, username: userData.username, name: userData.name, active: true, createdAt: userData.createdAt }
      });
    }

    // ---- GET /operator/users: Danh sách user do Operator quản lý ----
    if (p === '/operator/users' && req.method === 'GET') {
      const email = extractOperatorEmail(req, null);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ hoặc thiếu phiên đăng nhập' }, 400);

      const opUsersRaw = await env.IDENTITY_RL.get(`op_users:${email}`);
      const usernames = opUsersRaw ? JSON.parse(opUsersRaw) : [];

      const users = [];
      for (const u of usernames) {
        const uRaw = await env.IDENTITY_RL.get(`user:${u}`);
        if (uRaw) {
          const ud = JSON.parse(uRaw);
          users.push({ id: ud.id, username: ud.username, name: ud.name, active: ud.active !== false, createdAt: ud.createdAt });
        }
      }
      return json({ ok: true, users });
    }

    // ---- POST /operator/users/delete: Xoá user ----
    if (p === '/operator/users/delete' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = extractOperatorEmail(req, body);
      const username = normalizeUsername(body && body.username);
      if (!isValidEmail(email) || !username) return json({ error: 'Thiếu email hoặc username' }, 400);

      await env.IDENTITY_RL.delete(`user:${username}`);

      const opUsersRaw = await env.IDENTITY_RL.get(`op_users:${email}`);
      let opUsers = opUsersRaw ? JSON.parse(opUsersRaw) : [];
      opUsers = opUsers.filter((u) => u !== username);
      await env.IDENTITY_RL.put(`op_users:${email}`, JSON.stringify(opUsers));

      return json({ ok: true });
    }

    // ---- POST /operator/users/update-password: Đổi mật khẩu user ----
    if (p === '/operator/users/update-password' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const username = normalizeUsername(body && body.username);
      const newPassword = String(body && body.newPassword || '');
      if (!username || newPassword.length < 6) return json({ error: 'Mật khẩu mới tối thiểu 6 ký tự' }, 400);

      const uRaw = await env.IDENTITY_RL.get(`user:${username}`);
      if (!uRaw) return json({ error: 'Không tìm thấy tài khoản người dùng' }, 404);
      const ud = JSON.parse(uRaw);

      const { passwordHash, passwordSalt } = await hashUserPassword(newPassword);
      ud.passwordHash = passwordHash;
      ud.passwordSalt = passwordSalt;
      ud.updatedAt = Date.now();
      await env.IDENTITY_RL.put(`user:${username}`, JSON.stringify(ud));

      return json({ ok: true });
    }

    // ---- POST /refresh { email, refreshToken } ----
    if (p === '/refresh' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = normalizeEmail(body && body.email);
      const refreshToken = body && body.refreshToken;
      if (!isValidEmail(email) || typeof refreshToken !== 'string' || !refreshToken) {
        return json({ error: 'Thiếu email/refreshToken' }, 400);
      }
      if (!(await checkRateLimit(env, `refresh-ip:${ip}`, 30, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }
      try {
        const r = await cognitoCall(env, 'AdminInitiateAuth', {
          UserPoolId: env.COGNITO_USER_POOL_ID,
          ClientId: env.COGNITO_CLIENT_ID,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { USERNAME: email, REFRESH_TOKEN: refreshToken }
        });
        const res = r.AuthenticationResult;
        if (!res) return json({ error: 'Làm mới token thất bại' }, 401);
        return json({ idToken: res.IdToken, accessToken: res.AccessToken, expiresIn: res.ExpiresIn });
      } catch (e) {
        return json({ error: 'Refresh token không hợp lệ hoặc đã hết hạn' }, 401);
      }
    }

    if (p === '/' || p === '/health') return json({ ok: true, service: 'band-identity' });

    return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('Unhandled worker error:', err);
      return json({ error: err.message || 'Lỗi hệ thống', stack: err.stack }, 500);
    }
  }
};
