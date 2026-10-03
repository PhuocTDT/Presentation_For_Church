// Band Comm — phiên đăng nhập CỦA OPERATOR (người vận hành laptop), tách hẳn
// khỏi accounts.js (đó là tài khoản operator CẤP cho band member đăng nhập
// trên điện thoại). Đây là gate cho chính máy chiếu: bắt buộc MỌI bản cài
// phải đăng nhập bằng tài khoản Cognito trung tâm (cloud/identity/) trước
// khi Kênh Band được phép khởi động.
//
// Chỉ lưu token trên đĩa — không có mật khẩu nào đi qua đây. Refresh token
// Cognito mặc định sống ~30 ngày, nên operator không phải đăng nhập lại mỗi
// lần mở app trong khoảng đó.
//
// Token được mã hóa at-rest qua `secretBox` (main.js truyền vào Electron
// safeStorage = DPAPI trên Windows, gắn với tài khoản Windows đang đăng nhập)
// — file band-comm-operator.json bị copy sang máy/tài khoản khác thì vô dụng.
// Module này vẫn không phụ thuộc Electron: secretBox là tham số tùy chọn
// { available(): bool, encrypt(str): base64, decrypt(base64): str }. Không có
// secretBox (hoặc OS không hỗ trợ) thì lưu rõ như trước. File cũ (token rõ)
// được tự mã hóa lại ở lần đọc đầu tiên.

const fs = require('fs');
const path = require('path');

const TOKEN_FIELDS = ['idToken', 'accessToken', 'refreshToken'];

function createOperatorAuthStore(userDataPath, safeWriteSync, secretBox) {
  const filePath = path.join(userDataPath, 'band-comm-operator.json');
  let cache = null;

  function canEncrypt() {
    try { return !!(secretBox && secretBox.available()); } catch (e) { return false; }
  }

  // Ghi xuống đĩa: token nằm trong `enc` (mã hóa) thay vì field rõ.
  function persist(session) {
    if (!canEncrypt()) { safeWriteSync(filePath, session); return; }
    const tokens = {};
    TOKEN_FIELDS.forEach(k => { tokens[k] = session[k] || ''; });
    const onDisk = {
      v: 2,
      email: session.email || '',
      expiresAt: session.expiresAt || 0,
      loggedInAt: session.loggedInAt || 0,
      enc: secretBox.encrypt(JSON.stringify(tokens))
    };
    safeWriteSync(filePath, onDisk);
  }

  function load() {
    if (cache) return cache;
    let raw = null;
    try {
      if (fs.existsSync(filePath)) raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('[BandComm] Failed to read band-comm-operator.json:', e);
    }
    raw = (raw && typeof raw === 'object') ? raw : {};
    if (typeof raw.enc === 'string') {
      // Định dạng mới: giải mã. Giải mã lỗi (đổi tài khoản Windows, file hỏng)
      // = coi như chưa đăng nhập — buộc đăng nhập lại, không đoán/khôi phục.
      let tokens = null;
      try { if (canEncrypt()) tokens = JSON.parse(secretBox.decrypt(raw.enc)); } catch (e) { tokens = null; }
      if (tokens && typeof tokens === 'object') {
        cache = { email: raw.email || '', expiresAt: raw.expiresAt || 0, loggedInAt: raw.loggedInAt || 0 };
        TOKEN_FIELDS.forEach(k => { cache[k] = String(tokens[k] || ''); });
      } else {
        console.warn('[BandComm] Không giải mã được token đã lưu — yêu cầu đăng nhập lại.');
        cache = {};
      }
      return cache;
    }
    cache = raw;
    // File cũ (token rõ): mã hóa lại ngay nếu OS cho phép, rồi ghi đè bản rõ.
    if (cache.refreshToken && canEncrypt()) {
      try { persist(cache); console.log('[BandComm] Đã mã hóa token operator đang lưu dạng rõ.'); } catch (e) { console.error('[BandComm] Mã hóa lại token lỗi:', e); }
    }
    return cache;
  }

  // { email, idToken, accessToken, refreshToken, expiresAt (ms), loggedInAt }
  function save(session) {
    cache = {
      email: String((session && session.email) || ''),
      idToken: String((session && session.idToken) || ''),
      accessToken: String((session && session.accessToken) || ''),
      refreshToken: String((session && session.refreshToken) || ''),
      expiresAt: Number((session && session.expiresAt) || 0),
      loggedInAt: Date.now()
    };
    persist(cache);
    return cache;
  }

  function clear() {
    cache = {};
    safeWriteSync(filePath, cache);
  }

  // Có refresh token đã lưu = coi như "đã đăng nhập" cho mục đích gate mở
  // Kênh Band — idToken hết hạn (~1h) không sao, server.js's cognito-jwks
  // verify riêng lúc phone thật sự join; ở đây chỉ cần biết operator ĐÃ
  // đăng nhập ít nhất 1 lần và phiên chưa bị đăng xuất tay.
  function isLoggedIn() {
    const s = load();
    return !!(s && s.refreshToken);
  }

  return { filePath, load, save, clear, isLoggedIn };
}

module.exports = { createOperatorAuthStore };
