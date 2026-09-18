// Band Comm — phiên đăng nhập CỦA OPERATOR (người vận hành laptop), tách hẳn
// khỏi accounts.js (đó là tài khoản operator CẤP cho band member đăng nhập
// trên điện thoại). Đây là gate cho chính máy chiếu: bản cài MỚI (xem
// store.js's `requireOperatorLogin`) phải đăng nhập bằng tài khoản Cognito
// trung tâm (cloud/identity/) trước khi Kênh Band được phép khởi động.
//
// Chỉ lưu token trên đĩa — không có mật khẩu nào đi qua đây. Refresh token
// Cognito mặc định sống ~30 ngày, nên operator không phải đăng nhập lại mỗi
// lần mở app trong khoảng đó.

const fs = require('fs');
const path = require('path');

function createOperatorAuthStore(userDataPath, safeWriteSync) {
  const filePath = path.join(userDataPath, 'band-comm-operator.json');
  let cache = null;

  function load() {
    if (cache) return cache;
    let raw = null;
    try {
      if (fs.existsSync(filePath)) raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('[BandComm] Failed to read band-comm-operator.json:', e);
    }
    cache = (raw && typeof raw === 'object') ? raw : {};
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
    safeWriteSync(filePath, cache);
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
