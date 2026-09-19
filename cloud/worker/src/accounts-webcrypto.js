// Band Comm — tài khoản local (band-comm-plan.md §11), port sang Durable
// Object relay (GĐ2, §14). Đối chiếu 1-1 với src/band-comm/accounts.js
// (Node) — CHỈ khác thuật toán hash: Cloudflare Workers runtime không có
// Node's `crypto.scryptSync`, chỉ có Web Crypto (`crypto.subtle`) — dùng
// PBKDF2-HMAC-SHA256 thay thế (OWASP 2023 khuyến nghị ≥600.000 vòng lặp cho
// PBKDF2-SHA256 khi KHÔNG có "peer" nào khác canh — nhưng account ở đây bị
// gate sau `/join` (đã cần đúng mật khẩu phòng) NÊN rủi ro brute-force offline
// thấp hơn 1 form đăng nhập public trần; chọn 210.000 vòng — mức sàn OWASP
// cũ, đủ chậm để chống brute-force mà vẫn nằm trong CPU time cho phép của 1
// request Worker). Không lưu trạng thái — caller (room-relay.js) đọc/ghi
// mảng accounts vào `ctx.storage`, các hàm ở đây chỉ thao tác THUẦN trên
// mảng được truyền vào.

const PBKDF2_ITERATIONS = 10000;
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
export const MIN_PASSWORD_LEN = 6;

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

async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const passwordHash = await deriveHashHex(password, saltBytes);
  return { passwordHash, passwordSalt: bytesToHex(saltBytes) };
}

// So sánh hex bằng thời gian không đổi (không "early-exit" ngay ký tự sai
// đầu tiên) — tránh timing side-channel dò từng byte hash, tương đương
// crypto.timingSafeEqual() phía Node bản gốc.
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPasswordHash(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false;
  let candidate;
  try { candidate = await deriveHashHex(password, hexToBytes(passwordSalt)); } catch (e) { return false; }
  return timingSafeEqualHex(candidate, passwordHash);
}

function normalizeUsername(u) { return String(u || '').trim().toLowerCase(); }
export function isValidUsername(u) { return USERNAME_RE.test(normalizeUsername(u)); }
export function isValidPassword(p) { return typeof p === 'string' && p.length >= MIN_PASSWORD_LEN && p.length <= 200; }

export function publicAccount(a) {
  return {
    id: a.id, username: a.username, name: a.name, active: a.active !== false,
    createdAt: a.createdAt || 0, lastLoginAt: a.lastLoginAt || 0,
    mustChangePassword: !!a.mustChangePassword
  };
}

export function findAccountByUsername(accounts, username) {
  const want = normalizeUsername(username);
  if (!want) return null;
  return accounts.find((a) => a.username === want) || null;
}

export function findAccountById(accounts, id) {
  if (typeof id !== 'string' || !id) return null;
  return accounts.find((a) => a.id === id) || null;
}

// Trả { error } hoặc { account } (dạng public). Mutate `accounts` tại chỗ —
// caller chịu trách nhiệm `ctx.storage.put('accounts', accounts)` sau đó.
export async function createAccount(accounts, { username, name, password, mustChangePassword }) {
  const uname = normalizeUsername(username);
  if (!isValidUsername(uname)) return { error: 'Tên đăng nhập không hợp lệ (2-32 ký tự, chữ thường/số/._-, bắt đầu bằng chữ hoặc số).' };
  if (findAccountByUsername(accounts, uname)) return { error: 'Tên đăng nhập đã tồn tại.' };
  if (!isValidPassword(password)) return { error: `Mật khẩu phải từ ${MIN_PASSWORD_LEN} ký tự.` };
  const displayName = String(name || '').trim().slice(0, 40) || uname;
  const { passwordHash, passwordSalt } = await hashPassword(password);
  const account = {
    id: 'acc-' + randomHex(6),
    username: uname, name: displayName,
    passwordHash, passwordSalt,
    active: true, createdAt: Date.now(), lastLoginAt: 0,
    mustChangePassword: !!mustChangePassword
  };
  accounts.push(account);
  return { account: publicAccount(account) };
}

export async function updateAccountPassword(accounts, id, password, { mustChangePassword = true } = {}) {
  if (!isValidPassword(password)) return { error: `Mật khẩu phải từ ${MIN_PASSWORD_LEN} ký tự.` };
  const account = findAccountById(accounts, id);
  if (!account) return { error: 'Không tìm thấy tài khoản.' };
  Object.assign(account, await hashPassword(password));
  account.mustChangePassword = !!mustChangePassword;
  return { account: publicAccount(account) };
}

export function updateAccount(accounts, id, { name } = {}) {
  const account = findAccountById(accounts, id);
  if (!account) return { error: 'Không tìm thấy tài khoản.' };
  if (typeof name === 'string' && name.trim()) account.name = name.trim().slice(0, 40);
  return { account: publicAccount(account) };
}

export function setAccountActive(accounts, id, active) {
  const account = findAccountById(accounts, id);
  if (!account) return { error: 'Không tìm thấy tài khoản.' };
  account.active = !!active;
  return { account: publicAccount(account) };
}

export function removeAccount(accounts, id) {
  const before = accounts.length;
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx < 0) return { error: 'Không tìm thấy tài khoản.' };
  accounts.splice(idx, 1);
  return { ok: true, removed: before !== accounts.length };
}

// Không phân biệt "sai username" và "sai password" trong lỗi trả về (caller
// tự quyết định thông báo) — tránh lộ username nào tồn tại.
export async function verifyAccount(accounts, username, password) {
  const account = findAccountByUsername(accounts, username);
  if (!account || account.active === false) return null;
  if (!(await verifyPasswordHash(password, account.passwordHash, account.passwordSalt))) return null;
  account.lastLoginAt = Date.now();
  return publicAccount(account);
}

export async function changeOwnPassword(accounts, id, currentPassword, newPassword) {
  const account = findAccountById(accounts, id);
  if (!account) return { error: 'Không tìm thấy tài khoản.' };
  if (!(await verifyPasswordHash(currentPassword, account.passwordHash, account.passwordSalt))) {
    return { error: 'Mật khẩu hiện tại không đúng.' };
  }
  if (!isValidPassword(newPassword)) return { error: `Mật khẩu phải từ ${MIN_PASSWORD_LEN} ký tự.` };
  Object.assign(account, await hashPassword(newPassword));
  account.mustChangePassword = false;
  return { account: publicAccount(account) };
}
