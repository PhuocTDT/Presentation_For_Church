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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
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

// Đếm bằng KV (get rồi put, không atomic) — cùng đánh đổi eventually-consistent
// như cloud/worker/src/worker.js's checkRateLimit, đủ chặn lạm dụng cho quy mô
// dùng thật (vài chục người dùng chung 1 danh mục), không phải ranh giới cứng.
async function checkRateLimit(env, key, max, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  const kvKey = `rl:${key}:${bucket}`;
  const raw = await env.IDENTITY_RL.get(kvKey);
  const count = raw ? (parseInt(raw, 10) || 0) : 0;
  if (count >= max) return false;
  await env.IDENTITY_RL.put(kvKey, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) + 60 });
  return true;
}

// Thoả mọi policy mật khẩu mặc định của Cognito (hoa/thường/số/ký hiệu) —
// chỉ dùng làm mật khẩu TẠM, người dùng bị bắt đổi ngay lần đăng nhập đầu
// (NEW_PASSWORD_REQUIRED, xử lý ở /login bên dưới).
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

async function sendAccessEmail(env, to, tempPassword) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY chưa cấu hình — bỏ qua gửi mail (dev only)');
    return;
  }
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
        subject: 'Tài khoản Kênh Band của bạn',
        html:
          `<p>Xin chào,</p>` +
          `<p>Tài khoản Kênh Band của bạn đã sẵn sàng.</p>` +
          `<p>Email đăng nhập: <b>${to}</b><br>` +
          `Mật khẩu tạm: <code style="font-size:16px">${tempPassword}</code></p>` +
          `<p>Mở ứng dụng/trang đăng nhập, dùng mật khẩu tạm này rồi đặt mật khẩu mới ngay lần đầu.</p>` +
          `<p style="color:#888;font-size:12px">Nếu bạn không yêu cầu tài khoản này, có thể bỏ qua email này.</p>`
      })
    });
    if (!res.ok) console.error('Resend gửi mail thất bại', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('Resend gửi mail lỗi', e && e.message);
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const p = url.pathname;
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';

    // ---- POST /request-access { email } -> tạo tài khoản Cognito, gửi mật
    // khẩu tạm qua Resend. Operator laptop KHÔNG tham gia bước này — bất kỳ
    // ai biết email đều "yêu cầu" được, nhưng chỉ nhận được gì qua chính hộp
    // mail của họ; không rò rỉ email đã tồn tại hay chưa qua response. ----
    if (p === '/request-access' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const email = normalizeEmail(body && body.email);
      if (!isValidEmail(email)) return json({ error: 'Email không hợp lệ' }, 400);
      if (!(await checkRateLimit(env, `ra-ip:${ip}`, 8, 10 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }
      if (!(await checkRateLimit(env, `ra-email:${email}`, 3, 60 * 60 * 1000))) {
        return json({ error: 'Quá nhiều yêu cầu, thử lại sau ít phút' }, 429);
      }

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
        await sendAccessEmail(env, email, tempPassword);
      } catch (e) {
        if (e.cognitoType !== 'UsernameExistsException') {
          console.error('AdminCreateUser lỗi', e.cognitoType || e.message);
        }
        // Không leak email đã tồn tại hay lỗi khác qua response — luôn trả ok.
      }
      return json({ ok: true });
    }

    // ---- POST /login — 2 dạng body:
    //   { email, password }                     -> lần đăng nhập đầu/thường
    //   { email, session, newPassword }          -> trả lời challenge
    //     NEW_PASSWORD_REQUIRED (mật khẩu tạm bắt buộc đổi)
    // Trả { challenge:'NEW_PASSWORD_REQUIRED', session } nếu còn cần đổi mật
    // khẩu, hoặc { idToken, accessToken, refreshToken, expiresIn } khi xong. ----
    if (p === '/login' && req.method === 'POST') {
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
          return json({ challenge: 'NEW_PASSWORD_REQUIRED', session: r.Session });
        }
        const res = r.AuthenticationResult;
        if (!res) return json({ error: 'Đăng nhập thất bại' }, 401);
        return json({
          idToken: res.IdToken,
          accessToken: res.AccessToken,
          refreshToken: res.RefreshToken,
          expiresIn: res.ExpiresIn
        });
      } catch (e) {
        // Gộp mọi lỗi xác thực (sai email/mật khẩu/không tồn tại) thành 1
        // thông báo chung — tránh lộ email nào đã có tài khoản.
        return json({ error: 'Email hoặc mật khẩu không đúng' }, 401);
      }
    }

    // ---- POST /refresh { email, refreshToken } -> JWT mới khi cái cũ gần
    // hết hạn (id token Cognito mặc định ~1h), không cần nhập lại mật khẩu ----
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
  }
};
