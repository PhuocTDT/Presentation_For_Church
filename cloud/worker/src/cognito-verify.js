// Band Comm — verify Cognito ID token TRÊN relay (Cloudflare Workers), đối
// chiếu src/band-comm/cognito-jwks.js (Node, dùng ở LAN server cũ). Node bản
// gốc verify OFFLINE + cache JWKS ra đĩa vì máy operator có thể mất mạng
// ngoài LAN lúc đang họp — quan tâm đó KHÔNG áp dụng ở đây: relay chạy trên
// Cloudflare, LUÔN có mạng, nên chỉ cần cache JWKS trong RAM (per-DO-instance)
// với TTL, refetch khi hết hạn/thiếu `kid`. Không dùng thư viện `jose` (giữ 0
// dependency mới, đúng tinh thần accounts.js/cognito-jwks.js gốc) — tự verify
// RS256 bằng Web Crypto (`crypto.subtle`).

const REGION = 'ap-southeast-2';
const USER_POOL_ID = 'ap-southeast-2_OH1kbdXdE';
const CLIENT_ID = '7revs0o9tj9eqhpqrd03i3daof';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

export function createCognitoVerifier() {
  let jwks = null; // { keys, fetchedAt }
  const importedKeys = new Map(); // kid -> CryptoKey

  async function fetchJwks() {
    const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('Không tải được JWKS Cognito (HTTP ' + res.status + ')');
    const data = await res.json();
    if (!data || !Array.isArray(data.keys) || !data.keys.length) throw new Error('JWKS Cognito rỗng');
    jwks = { keys: data.keys, fetchedAt: Date.now() };
    importedKeys.clear();
    return jwks;
  }

  async function ensureJwks() {
    if (jwks && Date.now() - jwks.fetchedAt < JWKS_TTL_MS) return jwks;
    try {
      return await fetchJwks();
    } catch (e) {
      if (jwks) return jwks; // fetch mới lỗi nhưng đã có cache cũ -> dùng tạm, còn hơn chặn đăng nhập
      throw e;
    }
  }

  async function importKeyForKid(kid) {
    if (importedKeys.has(kid)) return importedKeys.get(kid);
    let current = await ensureJwks();
    let jwk = current.keys.find((k) => k.kid === kid);
    if (!jwk) {
      // Key mới xoay vòng (AWS đổi định kỳ), cache hiện tại chưa kịp có ->
      // force refetch đúng 1 lần trước khi kết luận thật sự không tồn tại.
      current = await fetchJwks();
      jwk = current.keys.find((k) => k.kid === kid);
      if (!jwk) throw new Error('Không tìm thấy khoá ký (kid) phù hợp');
    }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    importedKeys.set(kid, key);
    return key;
  }

  // Trả payload (claims) nếu hợp lệ, ném Error nếu không — caller (room-relay.js)
  // bắt lỗi và trả 401 chung chung, không phân biệt lý do (giống server.js cũ).
  async function verifyIdToken(token) {
    if (typeof token !== 'string' || !token) throw new Error('Thiếu token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Token không đúng định dạng');
    const [headerB64, payloadB64, sigB64] = parts;
    const header = b64urlToJson(headerB64);
    if (header.alg !== 'RS256') throw new Error('Thuật toán ký không được hỗ trợ');
    const payload = b64urlToJson(payloadB64);

    if (payload.iss !== ISSUER) throw new Error('iss không khớp');
    if (payload.token_use !== 'id') throw new Error('Không phải ID token');
    if (payload.aud !== CLIENT_ID) throw new Error('aud không khớp');
    if (!payload.exp || Date.now() >= payload.exp * 1000) throw new Error('Token đã hết hạn');

    const key = await importKeyForKid(header.kid);
    const signature = b64urlToBytes(sigB64);
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
    if (!ok) throw new Error('Chữ ký không hợp lệ');
    return payload;
  }

  return { verifyIdToken, verify: verifyIdToken };
}
