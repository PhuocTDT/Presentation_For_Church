// Band Comm — đăng nhập theo tài khoản (band-comm-plan.md §11).
//
// Tách riêng khỏi band-comm.json/store.js theo đúng lý do đã áp dụng cho
// gallery: dữ liệu có vòng đời/độ nhạy cảm khác (password hash) nên để 1 file
// riêng, giảm khả năng đụng độ khi 2 nơi cùng sửa band-comm.json.
//
// Mô hình: operator (laptop) là nơi DUY NHẤT tạo/đổi mật khẩu tài khoản —
// không có tự đăng ký, không có "quên mật khẩu tự đổi" phía band member (đã
// chốt D12). Password hash bằng crypto.scryptSync (built-in Node, 0
// dependency) — CHỈ chống lộ file trần, KHÔNG chống brute-force offline nếu
// file lộ và password ngắn/yếu; lớp phòng thủ thật là rate-limit theo
// accountId ở /api/login (xem server.js). Xem docs/data-contracts.md.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newId } = require('./protocol');

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const MIN_PASSWORD_LEN = 6;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { passwordHash: hash, passwordSalt: salt };
}

function verifyPassword(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false;
  let candidate;
  try {
    candidate = crypto.scryptSync(String(password || ''), passwordSalt, 64);
  } catch (e) { return false; }
  let stored;
  try {
    stored = Buffer.from(passwordHash, 'hex');
  } catch (e) { return false; }
  if (stored.length !== candidate.length) return false;
  return crypto.timingSafeEqual(stored, candidate);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function isValidUsername(username) {
  return USERNAME_RE.test(normalizeUsername(username));
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LEN && password.length <= 200;
}

// Public shape for the operator UI / roster checks — never includes the hash.
function publicAccount(a) {
  return {
    id: a.id, username: a.username, name: a.name, active: a.active !== false,
    createdAt: a.createdAt || 0, lastLoginAt: a.lastLoginAt || 0,
    mustChangePassword: !!a.mustChangePassword
  };
}

/**
 * @param {string} userDataPath
 * @param {(filePath:string, data:any)=>boolean} safeWriteSync  reused from main.js
 */
function createAccountsStore(userDataPath, safeWriteSync) {
  const filePath = path.join(userDataPath, 'band-comm-accounts.json');
  let cache = null;

  function load() {
    if (cache) return cache;
    let raw = null;
    try {
      if (fs.existsSync(filePath)) raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('[BandComm] Failed to read band-comm-accounts.json, using empty list:', e);
    }
    cache = { accounts: (raw && Array.isArray(raw.accounts)) ? raw.accounts : [] };
    return cache;
  }

  function persist() {
    safeWriteSync(filePath, cache);
  }

  function list() {
    return load().accounts.map(publicAccount);
  }

  function findById(id) {
    if (typeof id !== 'string' || !id || UNSAFE_KEYS.has(id)) return null;
    return load().accounts.find(a => a.id === id) || null;
  }

  function findByUsername(username) {
    const want = normalizeUsername(username);
    if (!want) return null;
    return load().accounts.find(a => a.username === want) || null;
  }

  // ids sinh bởi newId('acc') — dùng làm profileId khi đăng nhập qua tài
  // khoản (server.js). Vì profileId cũng nhận chuỗi client tự khai ở luồng
  // PIN phòng cũ, isAccountId() cho server.js chặn 1 client tự xưng đúng id
  // của tài khoản thật (band-comm-plan.md §11, điểm 10/D17).
  function isAccountId(id) {
    return typeof id === 'string' && load().accounts.some(a => a.id === id);
  }

  function create({ username, name, password, mustChangePassword }) {
    const cur = load();
    const uname = normalizeUsername(username);
    if (!isValidUsername(uname)) return { error: 'Tên đăng nhập không hợp lệ (2-32 ký tự, chữ thường/số/._-, bắt đầu bằng chữ hoặc số).' };
    if (findByUsername(uname)) return { error: 'Tên đăng nhập đã tồn tại.' };
    if (!isValidPassword(password)) return { error: `Mật khẩu phải từ ${MIN_PASSWORD_LEN} ký tự.` };
    const displayName = String(name || '').trim().slice(0, 40) || uname;
    const { passwordHash, passwordSalt } = hashPassword(password);
    const account = {
      id: newId('acc'),
      username: uname,
      name: displayName,
      passwordHash, passwordSalt,
      active: true,
      createdAt: Date.now(),
      lastLoginAt: 0,
      mustChangePassword: !!mustChangePassword
    };
    cur.accounts.push(account);
    persist();
    return { account: publicAccount(account) };
  }

  // `mustChangePassword` mặc định true khi operator TỰ tay đặt lại mật khẩu
  // (giống reset mật khẩu bình thường — nên bắt đổi lại) — truyền false rõ
  // ràng cho luồng band member tự đổi mật khẩu của chính mình (xem
  // changeOwnPassword), nơi không cần bắt đổi thêm lần nữa ngay sau đó.
  function updatePassword(id, password, { mustChangePassword = true } = {}) {
    if (!isValidPassword(password)) return { error: `Mật khẩu phải từ ${MIN_PASSWORD_LEN} ký tự.` };
    const account = findById(id);
    if (!account) return { error: 'Không tìm thấy tài khoản.' };
    Object.assign(account, hashPassword(password));
    account.mustChangePassword = !!mustChangePassword;
    persist();
    return { account: publicAccount(account) };
  }

  // Band member tự đổi mật khẩu của chính mình (bắt buộc sau khi
  // mustChangePassword=true, hoặc tự nguyện đổi bất cứ lúc nào) — khác
  // updatePassword() (operator reset hộ): cần đúng mật khẩu CŨ, và luôn xoá
  // cờ mustChangePassword sau khi đổi thành công.
  function changeOwnPassword(id, currentPassword, newPassword) {
    const account = findById(id);
    if (!account) return { error: 'Không tìm thấy tài khoản.' };
    if (!verifyPassword(currentPassword, account.passwordHash, account.passwordSalt)) {
      return { error: 'Mật khẩu hiện tại không đúng.' };
    }
    if (!isValidPassword(newPassword)) return { error: `Mật khẩu phải từ ${MIN_PASSWORD_LEN} ký tự.` };
    Object.assign(account, hashPassword(newPassword));
    account.mustChangePassword = false;
    persist();
    return { account: publicAccount(account) };
  }

  function update(id, { name } = {}) {
    const account = findById(id);
    if (!account) return { error: 'Không tìm thấy tài khoản.' };
    if (typeof name === 'string' && name.trim()) account.name = name.trim().slice(0, 40);
    persist();
    return { account: publicAccount(account) };
  }

  function setActive(id, active) {
    const account = findById(id);
    if (!account) return { error: 'Không tìm thấy tài khoản.' };
    account.active = !!active;
    persist();
    return { account: publicAccount(account) };
  }

  function remove(id) {
    const cur = load();
    const before = cur.accounts.length;
    cur.accounts = cur.accounts.filter(a => a.id !== id);
    if (cur.accounts.length === before) return { error: 'Không tìm thấy tài khoản.' };
    persist();
    return { ok: true };
  }

  // Xác thực đăng nhập — trả account đầy đủ (không lộ hash) hoặc null. Không
  // phân biệt "sai username" và "sai password" trong thông báo lỗi phía gọi
  // (server.js) để không lộ username nào tồn tại.
  function verify(username, password) {
    const account = findByUsername(username);
    if (!account || account.active === false) return null;
    if (!verifyPassword(password, account.passwordHash, account.passwordSalt)) return null;
    account.lastLoginAt = Date.now();
    persist();
    return publicAccount(account);
  }

  return { filePath, load, list, findById, findByUsername, isAccountId, create, update, updatePassword, changeOwnPassword, setActive, remove, verify };
}

module.exports = { createAccountsStore, isValidUsername, isValidPassword, MIN_PASSWORD_LEN };
