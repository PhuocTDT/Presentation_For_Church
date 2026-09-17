// Band Comm — verify Cognito ID token OFFLINE (cloud/identity-plan.md §4).
//
// Danh tính trung tâm (Cloudflare Worker "band-identity" gọi AWS Cognito) là
// tuỳ chọn nâng cao song song với accounts.js cục bộ (§5 của plan) — LAN-first
// vẫn là nguyên tắc gốc: verify chữ ký JWT lúc phone gửi lên KHÔNG được phát
// sinh request mạng nào (đang họp có thể mất mạng ngoài LAN). Cách làm: cache
// JWKS (bộ khoá công khai của Cognito) ra userData, tự refresh khi có mạng
// (lúc server start + định kỳ), dùng lại cache cũ khi offline. Endpoint JWKS
// là public — không cần AWS credentials để đọc.

const fs = require('fs');
const path = require('path');
const { jwtVerify, importJWK, decodeProtectedHeader } = require('jose');

// Cố định cho toàn bộ app — 1 User Pool dùng chung mọi bản cài/nhà thờ (đúng
// mục đích: 1 danh tính, nhiều phòng). Không phải bí mật (poolId/clientId
// không nhạy cảm, khác AWS access key chỉ nằm ở Worker secret).
const REGION = 'ap-southeast-2';
const USER_POOL_ID = 'ap-southeast-2_OH1kbdXdE';
const CLIENT_ID = '7revs0o9tj9eqhpqrd03i3daof';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h, best-effort khi có mạng
const FETCH_TIMEOUT_MS = 5000; // không được treo /api/login lâu nếu mạng chập chờn

function createJwksCache(userDataPath, safeWriteSync) {
  const filePath = path.join(userDataPath, 'cognito-jwks.json');
  let cache = null;       // { keys: [...], fetchedAt }
  let refreshTimer = null;
  const importedKeys = new Map(); // kid -> imported KeyLike (tránh import lại mỗi lần verify)

  function loadFromDisk() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw && Array.isArray(raw.keys)) cache = raw;
    } catch (e) { /* chưa từng fetch được lần nào — cache vẫn null, verify sẽ báo lỗi rõ ràng */ }
  }

  async function refresh() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(JWKS_URL, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !Array.isArray(data.keys) || !data.keys.length) return false;
      cache = { keys: data.keys, fetchedAt: Date.now() };
      importedKeys.clear();
      safeWriteSync(filePath, cache);
      return true;
    } catch (e) { return false; }
  }

  async function init() {
    if (!cache) loadFromDisk();
    await refresh(); // best effort — offline lúc start thì giữ cache cũ (hoặc null nếu máy mới)
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
    if (refreshTimer.unref) refreshTimer.unref();
  }

  function stop() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  async function getKey(kid) {
    if (importedKeys.has(kid)) return importedKeys.get(kid);
    if (!cache) loadFromDisk();
    let jwk = cache && cache.keys.find((k) => k.kid === kid);
    if (!jwk) {
      // Cognito xoay key theo chu kỳ dài — key lạ có thể do rotate, thử refresh
      // 1 lần nếu đang có mạng rồi tìm lại; offline thì thôi, báo lỗi.
      if (await refresh()) jwk = cache.keys.find((k) => k.kid === kid);
    }
    if (!jwk) return null;
    const key = await importJWK(jwk, jwk.alg || 'RS256');
    importedKeys.set(kid, key);
    return key;
  }

  // Trả về payload đã verify (chứa `sub` dùng làm profileId) hoặc throw.
  // KHÔNG phát sinh request mạng nếu key cần dùng đã có sẵn trong cache.
  async function verifyIdToken(idToken) {
    let header;
    try { header = decodeProtectedHeader(String(idToken || '')); } catch (e) { throw new Error('Token không hợp lệ'); }
    if (!header || !header.kid) throw new Error('Token không hợp lệ');
    const key = await getKey(header.kid);
    if (!key) throw new Error('Không xác định được khoá ký (JWKS chưa có/không tải được lúc offline)');
    const { payload } = await jwtVerify(idToken, key, { issuer: ISSUER, audience: CLIENT_ID });
    if (payload.token_use !== 'id') throw new Error('Không phải id token');
    return payload;
  }

  return { init, stop, verifyIdToken, filePath };
}

module.exports = { createJwksCache, REGION, USER_POOL_ID, CLIENT_ID };
