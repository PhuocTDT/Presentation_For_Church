/**
 * Admin Console — Worship Official
 * Controller: login, data fetching, tables, detail panel, modals
 */

const IDENTITY_API = 'https://identity.worship-official.link';
const ADMIN_KEY_STORAGE = 'worship_admin_key';

// ============================================================
// Helpers — Toggle password visibility (used in inline onclick)
// ============================================================
function togglePassVis(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁️' : '🔒';
}

// ============================================================
// State
// ============================================================
let adminKey = '';
let allOperators = [];   // Cached operator list
let allMembers = [];     // Flat member list (built from operators)
let currentTab = 'dashboard';

// ============================================================
// DOM Refs
// ============================================================
const loginScreen     = document.getElementById('adminLoginScreen');
const adminApp        = document.getElementById('adminApp');
const adminKeyInput   = document.getElementById('adminKeyInput');
const loginError      = document.getElementById('loginError');
const btnAdminLogin   = document.getElementById('btnAdminLogin');
const btnToggleKey    = document.getElementById('btnToggleKeyVisibility');
const btnAdminLogout  = document.getElementById('btnAdminLogout');
const btnRefresh      = document.getElementById('btnRefresh');
const btnMenuToggle   = document.getElementById('btnMenuToggle');
const adminSidebar    = document.getElementById('adminSidebar');
const topbarTitle     = document.getElementById('topbarTitle');
const toastContainer  = document.getElementById('adminToastContainer');
const detailBackdrop  = document.getElementById('detailBackdrop');
const detailPanel     = document.getElementById('detailPanel');
const detailTitle     = document.getElementById('detailPanelTitle');
const detailBody      = document.getElementById('detailPanelBody');
const btnClosePanel   = document.getElementById('btnClosePanel');
const confirmModal    = document.getElementById('confirmModal');
const confirmTitle    = document.getElementById('confirmTitle');
const confirmMessage  = document.getElementById('confirmMessage');
const btnConfirmOk    = document.getElementById('btnConfirmOk');
const btnConfirmCancel= document.getElementById('btnConfirmCancel');
const editModal       = document.getElementById('editModal');
const editModalTitle  = document.getElementById('editModalTitle');
const editModalBody   = document.getElementById('editModalBody');
const btnEditSave     = document.getElementById('btnEditSave');
const btnEditCancel   = document.getElementById('btnEditCancel');
const btnCloseEdit    = document.getElementById('btnCloseEditModal');

// ============================================================
// Toast
// ============================================================
function toast(msg, type = 'success', dur = 3500) {
  const el = document.createElement('div');
  el.className = `admin-toast ${type}`;
  el.innerHTML = `<span class="admin-toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${escHtml(msg)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; setTimeout(() => el.remove(), 220); }, dur);
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============================================================
// API Helper
// ============================================================
async function adminFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${adminKey}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${IDENTITY_API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ============================================================
// Login
// ============================================================
btnToggleKey.addEventListener('click', () => {
  adminKeyInput.type = adminKeyInput.type === 'password' ? 'text' : 'password';
});

adminKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
btnAdminLogin.addEventListener('click', doLogin);

async function doLogin() {
  const key = adminKeyInput.value.trim();
  if (!key) { loginError.textContent = 'Vui lòng nhập Admin Key'; return; }
  loginError.textContent = '';
  btnAdminLogin.textContent = 'Đang kiểm tra...';
  btnAdminLogin.disabled = true;
  try {
    adminKey = key;
    await adminFetch('/admin/operators');
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    showApp();
  } catch (e) {
    loginError.textContent = e.message === 'Unauthorized' ? 'Admin Key không đúng' : 'Lỗi kết nối: ' + e.message;
    adminKey = '';
    btnAdminLogin.textContent = 'Đăng Nhập';
    btnAdminLogin.disabled = false;
  }
}

function showApp() {
  loginScreen.style.display = 'none';
  adminApp.style.display = 'flex';
  loadAllData();
}

// Auto-restore session
const saved = sessionStorage.getItem(ADMIN_KEY_STORAGE);
if (saved) { adminKey = saved; showApp(); }

// ============================================================
// Logout
// ============================================================
btnAdminLogout.addEventListener('click', () => {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  adminKey = '';
  allOperators = [];
  allMembers = [];
  adminApp.style.display = 'none';
  loginScreen.style.display = 'flex';
  adminKeyInput.value = '';
});

// ============================================================
// Tab Navigation
// ============================================================
const tabTitles = { dashboard: 'Dashboard', operators: 'Operators', members: 'Members', rooms: 'Rooms' };

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));

  const panelId = { dashboard: 'tabDashboard', operators: 'tabOperators', members: 'tabMembers', rooms: 'tabRooms' }[tab];
  document.getElementById(panelId)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelector(`.bottom-tab[data-tab="${tab}"]`)?.classList.add('active');
  topbarTitle.textContent = tabTitles[tab] || tab;
  closeSidebarMobile();
}

document.querySelectorAll('.nav-item, .bottom-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ============================================================
// Mobile Sidebar Toggle
// ============================================================
let sidebarOverlay = null;

function openSidebarMobile() {
  adminSidebar.classList.add('mobile-open');
  if (!sidebarOverlay) {
    sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);
    sidebarOverlay.addEventListener('click', closeSidebarMobile);
  }
  sidebarOverlay.classList.add('active');
}
function closeSidebarMobile() {
  adminSidebar.classList.remove('mobile-open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');
}
btnMenuToggle.addEventListener('click', () => {
  adminSidebar.classList.contains('mobile-open') ? closeSidebarMobile() : openSidebarMobile();
});

// ============================================================
// Refresh
// ============================================================
btnRefresh.addEventListener('click', () => { loadAllData(); toast('Đang làm mới...', 'info', 1500); });

// ============================================================
// Load All Data
// ============================================================
async function loadAllData() {
  try {
    const data = await adminFetch('/admin/operators');
    allOperators = data.operators || [];
    // Build flat member list
    allMembers = [];
    for (const op of allOperators) {
      if (op.members) {
        for (const m of op.members) {
          allMembers.push({ ...m, operatorEmail: op.email, operatorName: op.name, roomCode: op.room?.code, roomName: op.room?.name });
        }
      }
    }
    renderDashboard();
    renderOperatorsTable();
    renderMembersTable();
    renderRoomsTable();
    updateSidebarBadges();
  } catch (e) {
    toast('Lỗi tải dữ liệu: ' + e.message, 'error');
    if (e.message === 'Unauthorized') {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      btnAdminLogout.click();
    }
  }
}

// Need member detail per operator — fetch them
async function loadOperatorsWithMembers() {
  const data = await adminFetch('/admin/operators');
  const operators = data.operators || [];
  // Fetch member details for each
  const full = await Promise.all(operators.map(async (op) => {
    try {
      const detail = await adminFetch(`/admin/operator/${encodeURIComponent(op.email)}`);
      return { ...op, members: detail.members || [] };
    } catch { return { ...op, members: [] }; }
  }));
  return full;
}

async function loadAllData() {
  try {
    btnRefresh.textContent = '⏳';
    btnRefresh.disabled = true;
    allOperators = await loadOperatorsWithMembers();
    allMembers = [];
    for (const op of allOperators) {
      for (const m of (op.members || [])) {
        allMembers.push({ ...m, operatorEmail: op.email, operatorName: op.name, roomCode: op.room?.code, roomName: op.room?.name });
      }
    }
    renderDashboard();
    renderOperatorsTable();
    buildMemberFilter();
    renderMembersTable();
    renderRoomsTable();
    updateSidebarBadges();
  } catch (e) {
    toast('Lỗi tải dữ liệu: ' + e.message, 'error');
    if (e.message === 'Unauthorized') { sessionStorage.removeItem(ADMIN_KEY_STORAGE); btnAdminLogout.click(); }
  } finally {
    btnRefresh.textContent = '🔄';
    btnRefresh.disabled = false;
  }
}

function updateSidebarBadges() {
  document.getElementById('sidebarOpCount').textContent = allOperators.length;
  document.getElementById('sidebarMemberCount').textContent = allMembers.length;
}

// ============================================================
// Dashboard Tab
// ============================================================
function renderDashboard() {
  const totalOps = allOperators.length;
  const totalMembers = allMembers.length;
  const totalRooms = allOperators.filter(op => op.room && op.room.code).length;
  const today = new Date(); today.setHours(0,0,0,0);
  const newToday = allOperators.filter(op => op.createdAt && op.createdAt >= today.getTime()).length;

  document.getElementById('statTotalOps').textContent = totalOps;
  document.getElementById('statTotalMembers').textContent = totalMembers;
  document.getElementById('statTotalRooms').textContent = totalRooms;
  document.getElementById('statNewToday').textContent = newToday;

  const tbody = document.getElementById('dashRecentBody');
  const recent = [...allOperators].slice(0, 10);
  if (!recent.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Chưa có dữ liệu</td></tr>'; return; }
  tbody.innerHTML = recent.map(op => `
    <tr onclick="openOperatorDetail('${escHtml(op.email)}')">
      <td><strong>${escHtml(op.name || '—')}</strong></td>
      <td class="cell-muted">${escHtml(op.email)}</td>
      <td>${escHtml(op.church || '—')}</td>
      <td>${escHtml(op.area || '—')}</td>
      <td class="cell-muted">${fmtDate(op.createdAt)}</td>
      <td>${op.room ? `<span class="badge-room">${escHtml(op.room.code)}</span>` : '<span class="badge-no-room">Chưa có</span>'}</td>
    </tr>`).join('');
}

// ============================================================
// Operators Tab
// ============================================================
function renderOperatorsTable(filter = '') {
  const tbody = document.getElementById('operatorsBody');
  let ops = allOperators;
  if (filter) {
    const q = filter.toLowerCase();
    ops = ops.filter(op => (op.name||'').toLowerCase().includes(q) || (op.email||'').toLowerCase().includes(q) || (op.church||'').toLowerCase().includes(q));
  }
  if (!ops.length) { tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Không tìm thấy</td></tr>'; return; }
  tbody.innerHTML = ops.map(op => `
    <tr>
      <td><strong>${escHtml(op.name || '—')}</strong></td>
      <td class="cell-muted">${escHtml(op.email)}</td>
      <td>${escHtml(op.church || '—')}</td>
      <td>${escHtml(op.area || '—')}</td>
      <td><span class="badge-active">${op.memberCount || 0}</span></td>
      <td>${op.room ? `<span class="badge-room">${escHtml(op.room.code)}</span>` : '<span class="badge-no-room">—</span>'}</td>
      <td class="cell-muted">${fmtDate(op.createdAt)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-action primary" onclick="openOperatorDetail('${escHtml(op.email)}');event.stopPropagation()">👁 Chi tiết</button>
          <button class="btn-action" onclick="openEditOperator('${escHtml(op.email)}');event.stopPropagation()">✏️ Sửa</button>
          <button class="btn-action" onclick="resetOpPass('${escHtml(op.email)}');event.stopPropagation()">🔑 Reset</button>
          <button class="btn-action danger" onclick="deleteOperator('${escHtml(op.email)}');event.stopPropagation()">🗑 Xoá</button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('opSearchInput').addEventListener('input', (e) => renderOperatorsTable(e.target.value));

// ============================================================
// Members Tab
// ============================================================
function renderMembersTable(filterOp = '', filterText = '') {
  const tbody = document.getElementById('membersBody');
  let ms = allMembers;
  if (filterOp) ms = ms.filter(m => m.operatorEmail === filterOp);
  if (filterText) {
    const q = filterText.toLowerCase();
    ms = ms.filter(m => (m.name||'').toLowerCase().includes(q) || (m.username||'').toLowerCase().includes(q));
  }
  if (!ms.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Không tìm thấy</td></tr>'; return; }
  tbody.innerHTML = ms.map(m => `
    <tr>
      <td><strong>${escHtml(m.name || '—')}</strong></td>
      <td class="cell-mono">${escHtml(m.username)}</td>
      <td class="cell-muted">${escHtml(m.operatorName || m.operatorEmail || '—')}</td>
      <td>${m.roomCode ? `<span class="badge-room">${escHtml(m.roomCode)}</span>` : '<span class="badge-no-room">—</span>'}</td>
      <td>${m.active !== false ? '<span class="badge-active">Active</span>' : '<span class="badge-inactive">Inactive</span>'}</td>
      <td class="cell-muted">${fmtDate(m.createdAt)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-action" onclick="openEditMember('${escHtml(m.username)}');event.stopPropagation()">✏️ Sửa</button>
          <button class="btn-action" onclick="resetMemberPass('${escHtml(m.username)}');event.stopPropagation()">🔑 Reset</button>
          <button class="btn-action danger" onclick="deleteMember('${escHtml(m.username)}','${escHtml(m.operatorEmail||'')}');event.stopPropagation()">🗑 Xoá</button>
        </div>
      </td>
    </tr>`).join('');
}

// Populate operator filter
function buildMemberFilter() {
  const sel = document.getElementById('memberFilterOp');
  const existing = [...sel.options].map(o => o.value);
  allOperators.forEach(op => {
    if (!existing.includes(op.email)) {
      const o = document.createElement('option');
      o.value = op.email;
      o.textContent = `${op.name || op.email} (${op.email})`;
      sel.appendChild(o);
    }
  });
}

document.getElementById('memberFilterOp').addEventListener('change', (e) => {
  renderMembersTable(e.target.value, document.getElementById('memberSearchInput').value);
});
document.getElementById('memberSearchInput').addEventListener('input', (e) => {
  renderMembersTable(document.getElementById('memberFilterOp').value, e.target.value);
});

// ============================================================
// Rooms Tab
// ============================================================
function renderRoomsTable(filter = '') {
  const tbody = document.getElementById('roomsBody');
  let ops = allOperators.filter(op => op.room && op.room.code);
  if (filter) {
    const q = filter.toLowerCase();
    ops = ops.filter(op => (op.room.name||'').toLowerCase().includes(q) || (op.room.code||'').toLowerCase().includes(q) || (op.name||'').toLowerCase().includes(q));
  }
  if (!ops.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Không tìm thấy</td></tr>'; return; }
  tbody.innerHTML = ops.map(op => `
    <tr>
      <td><strong>${escHtml(op.room.name || '—')}</strong></td>
      <td class="cell-mono">${escHtml(op.room.code)}</td>
      <td class="cell-mono">${escHtml(op.room.password || '—')}</td>
      <td class="cell-muted">${escHtml(op.name || op.email)}</td>
      <td><span class="badge-active">${op.memberCount || 0} members</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-action" onclick="openEditRoom('${escHtml(op.email)}');event.stopPropagation()">✏️ Sửa</button>
          <button class="btn-action primary" onclick="openOperatorDetail('${escHtml(op.email)}');event.stopPropagation()">👥 Members</button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('roomSearchInput').addEventListener('input', (e) => renderRoomsTable(e.target.value));

// ============================================================
// Detail Panel
// ============================================================
function openDetailPanel(title, html) {
  detailTitle.textContent = title;
  detailBody.innerHTML = html;
  detailPanel.classList.add('active');
  detailBackdrop.classList.add('active');
}
function closeDetailPanel() {
  detailPanel.classList.remove('active');
  detailBackdrop.classList.remove('active');
}
btnClosePanel.addEventListener('click', closeDetailPanel);
detailBackdrop.addEventListener('click', closeDetailPanel);

// Swipe down to close (mobile)
let touchStartY = 0;
detailPanel.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
detailPanel.addEventListener('touchend', e => {
  if (e.changedTouches[0].clientY - touchStartY > 80) closeDetailPanel();
}, { passive: true });

async function openOperatorDetail(email) {
  openDetailPanel('Đang tải...', '<p style="color:var(--text-muted);text-align:center;padding:40px">⏳ Đang tải...</p>');
  try {
    const data = await adminFetch(`/admin/operator/${encodeURIComponent(email)}`);
    const op = data.operator || {};
    const room = data.room || {};
    const members = data.members || [];

    detailTitle.textContent = op.name || op.email;
    detailBody.innerHTML = `
      <div class="detail-section">
        <div class="detail-section-title">Thông Tin Operator</div>
        <div class="detail-row"><span class="detail-row-label">Tên</span><span class="detail-row-value">${escHtml(op.name||'—')}</span></div>
        <div class="detail-row"><span class="detail-row-label">Email</span><span class="detail-row-value cell-mono" style="font-size:0.8rem">${escHtml(op.email)}</span></div>
        <div class="detail-row"><span class="detail-row-label">SĐT</span><span class="detail-row-value">${escHtml(op.phone||'—')}</span></div>
        <div class="detail-row"><span class="detail-row-label">Hội Thánh</span><span class="detail-row-value">${escHtml(op.church||'—')}</span></div>
        <div class="detail-row"><span class="detail-row-label">Khu Vực</span><span class="detail-row-value">${escHtml(op.area||'—')}</span></div>
        <div class="detail-row"><span class="detail-row-label">Ngày ĐK</span><span class="detail-row-value">${fmtDate(op.createdAt)}</span></div>
      </div>
      ${room.code ? `
      <div class="detail-section">
        <div class="detail-section-title">Phòng (Room)</div>
        <div class="detail-row"><span class="detail-row-label">Room Code</span><span class="detail-row-value"><span class="badge-room">${escHtml(room.code)}</span></span></div>
        <div class="detail-row"><span class="detail-row-label">Tên Phòng</span><span class="detail-row-value">${escHtml(room.name||'—')}</span></div>
        <div class="detail-row"><span class="detail-row-label">Mật Khẩu</span><span class="detail-row-value cell-mono">${escHtml(room.password||'—')}</span></div>
      </div>` : ''}
      <div class="detail-section">
        <div class="detail-section-title">Members (${members.length})</div>
        ${members.length ? `<div class="member-mini-list">${members.map(m => `
          <div class="member-mini-item">
            <div><div class="member-mini-name">${escHtml(m.name||'—')}</div><div class="member-mini-user">@${escHtml(m.username)}</div></div>
            <span class="${m.active !== false ? 'badge-active' : 'badge-inactive'}">${m.active !== false ? 'Active' : 'Inactive'}</span>
          </div>`).join('')}</div>` : '<p style="color:var(--text-muted);font-size:0.85rem">Chưa có member nào</p>'}
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Thao Tác</div>
        <div class="detail-actions">
          <button class="btn-detail-action" onclick="openEditOperator('${escHtml(op.email)}')">✏️ Chỉnh sửa thông tin</button>
          ${room.code ? `<button class="btn-detail-action" onclick="openEditRoom('${escHtml(op.email)}')">🏠 Sửa thông tin phòng</button>` : ''}
          <button class="btn-detail-action" onclick="resetOpPass('${escHtml(op.email)}')">🔑 Reset mật khẩu Cognito</button>
          <button class="btn-detail-action danger" onclick="deleteOperator('${escHtml(op.email)}')">🗑️ Xoá operator này</button>
        </div>
      </div>`;
  } catch (e) {
    detailBody.innerHTML = `<p style="color:var(--danger)">Lỗi: ${escHtml(e.message)}</p>`;
  }
}

// ============================================================
// Confirm Modal
// ============================================================
let confirmCallback = null;
function showConfirm(title, msg, onOk) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = msg;
  confirmCallback = onOk;
  confirmModal.classList.add('active');
}
function closeConfirm() { confirmModal.classList.remove('active'); confirmCallback = null; }
btnConfirmCancel.addEventListener('click', closeConfirm);
btnConfirmOk.addEventListener('click', () => { if (confirmCallback) confirmCallback(); closeConfirm(); });

// ============================================================
// Edit Modal
// ============================================================
let editSaveCallback = null;
function showEditModal(title, html, onSave) {
  editModalTitle.textContent = title;
  editModalBody.innerHTML = html;
  editSaveCallback = onSave;
  editModal.classList.add('active');
  editModal.querySelector('input')?.focus();
}
function closeEditModal() { editModal.classList.remove('active'); editSaveCallback = null; }
btnEditCancel.addEventListener('click', closeEditModal);
btnCloseEdit.addEventListener('click', closeEditModal);
btnEditSave.addEventListener('click', () => { if (editSaveCallback) editSaveCallback(); });

// ============================================================
// Actions — Operator
// ============================================================
function openEditOperator(email) {
  const op = allOperators.find(o => o.email === email);
  if (!op) return;
  showEditModal('Chỉnh Sửa Operator', `
    <div class="edit-form">
      <div class="edit-form-group"><label>Tên</label><input id="editOpName" value="${escHtml(op.name||'')}" /></div>
      <div class="edit-form-group"><label>SĐT</label><input id="editOpPhone" value="${escHtml(op.phone||'')}" /></div>
      <div class="edit-form-group"><label>Hội Thánh</label><input id="editOpChurch" value="${escHtml(op.church||'')}" /></div>
      <div class="edit-form-group"><label>Khu Vực</label><input id="editOpArea" value="${escHtml(op.area||'')}" /></div>
    </div>`, async () => {
    try {
      await adminFetch(`/admin/operator/${encodeURIComponent(email)}`, 'PUT', {
        name: document.getElementById('editOpName').value.trim(),
        phone: document.getElementById('editOpPhone').value.trim(),
        church: document.getElementById('editOpChurch').value.trim(),
        area: document.getElementById('editOpArea').value.trim()
      });
      toast('Đã cập nhật thông tin operator');
      closeEditModal();
      await loadAllData();
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

async function resetOpPass(email) {
  showConfirm('Reset Mật Khẩu', `Reset mật khẩu Cognito cho ${email}? Mật khẩu tạm mới sẽ được gửi qua email.`, async () => {
    try {
      await adminFetch(`/admin/operator/${encodeURIComponent(email)}/reset-password`, 'POST');
      toast('Đã reset mật khẩu và gửi email');
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

async function deleteOperator(email) {
  showConfirm('⚠️ Xoá Operator', `Xoá vĩnh viễn operator ${email} cùng toàn bộ room và members? Hành động này không thể hoàn tác!`, async () => {
    try {
      await adminFetch(`/admin/operator/${encodeURIComponent(email)}`, 'DELETE');
      toast('Đã xoá operator');
      closeDetailPanel();
      await loadAllData();
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

// ============================================================
// Actions — Room
// ============================================================
function openEditRoom(email) {
  const op = allOperators.find(o => o.email === email);
  if (!op || !op.room) return;
  showEditModal('Sửa Thông Tin Phòng', `
    <div class="edit-form">
      <div class="edit-form-group"><label>Tên Phòng</label><input id="editRoomName" value="${escHtml(op.room.name||'')}" /></div>
      <div class="edit-form-group"><label>Mật Khẩu Phòng</label><input id="editRoomPass" value="${escHtml(op.room.password||'')}" /></div>
    </div>`, async () => {
    try {
      await adminFetch(`/admin/operator/${encodeURIComponent(email)}/update-room`, 'POST', {
        name: document.getElementById('editRoomName').value.trim(),
        password: document.getElementById('editRoomPass').value.trim()
      });
      toast('Đã cập nhật thông tin phòng');
      closeEditModal();
      await loadAllData();
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

// ============================================================
// Actions — Member
// ============================================================
function openEditMember(username) {
  const m = allMembers.find(x => x.username === username);
  if (!m) return;
  showEditModal('Sửa Thông Tin Member', `
    <div class="edit-form">
      <div class="edit-form-group"><label>Tên</label><input id="editMemberName" value="${escHtml(m.name||'')}" /></div>
      <div class="edit-form-group"><label>Username (không đổi được)</label><input value="${escHtml(m.username)}" disabled /></div>
    </div>`, async () => {
    try {
      await adminFetch(`/admin/member/${encodeURIComponent(username)}`, 'PUT', {
        name: document.getElementById('editMemberName').value.trim()
      });
      toast('Đã cập nhật member');
      closeEditModal();
      await loadAllData();
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

function resetMemberPass(username) {
  showEditModal('Reset Mật Khẩu Member', `
    <div class="edit-form">
      <div class="edit-form-group"><label>Mật Khẩu Mới</label><input id="newMemberPass" type="password" placeholder="Tối thiểu 6 ký tự" /></div>
    </div>`, async () => {
    const newPassword = document.getElementById('newMemberPass').value.trim();
    if (newPassword.length < 6) { toast('Mật khẩu tối thiểu 6 ký tự', 'error'); return; }
    try {
      await adminFetch(`/admin/member/${encodeURIComponent(username)}/reset-password`, 'POST', { newPassword });
      toast('Đã reset mật khẩu member');
      closeEditModal();
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

async function deleteMember(username, operatorEmail) {
  showConfirm('Xoá Member', `Xoá member @${username}? Hành động này không thể hoàn tác.`, async () => {
    try {
      await adminFetch(`/admin/member/${encodeURIComponent(username)}`, 'DELETE');
      toast('Đã xoá member');
      await loadAllData();
    } catch (e) { toast('Lỗi: ' + e.message, 'error'); }
  });
}

// ============================================================
// Init
// ============================================================
switchTab('dashboard');

// ============================================================
// Change Password Modal
// ============================================================
const changePassModal  = document.getElementById('changePassModal');
const btnChangeAdminPass = document.getElementById('btnChangeAdminPass');
const btnCloseChangePass = document.getElementById('btnCloseChangePass');
const btnCpCancel      = document.getElementById('btnCpCancel');
const btnCpSave        = document.getElementById('btnCpSave');
const cpError          = document.getElementById('cpError');

function openChangePassModal() {
  document.getElementById('cpEmail').value = '';
  document.getElementById('cpCurrent').value = '';
  document.getElementById('cpNew').value = '';
  document.getElementById('cpConfirm').value = '';
  cpError.textContent = '';
  changePassModal.classList.add('active');
  setTimeout(() => document.getElementById('cpEmail').focus(), 100);
}
function closeChangePassModal() {
  changePassModal.classList.remove('active');
}

if (btnChangeAdminPass) btnChangeAdminPass.addEventListener('click', openChangePassModal);
if (btnCloseChangePass) btnCloseChangePass.addEventListener('click', closeChangePassModal);
if (btnCpCancel) btnCpCancel.addEventListener('click', closeChangePassModal);

// Enter key submits
['cpEmail','cpCurrent','cpNew','cpConfirm'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') btnCpSave.click(); });
});

if (btnCpSave) {
  btnCpSave.addEventListener('click', async () => {
    const email       = document.getElementById('cpEmail').value.trim();
    const current     = document.getElementById('cpCurrent').value;
    const newPass     = document.getElementById('cpNew').value;
    const confirm     = document.getElementById('cpConfirm').value;
    cpError.textContent = '';

    // Validate
    if (!email)   { cpError.textContent = 'Vui lòng nhập email tài khoản'; return; }
    if (!current) { cpError.textContent = 'Vui lòng nhập mật khẩu hiện tại'; return; }
    if (newPass.length < 8) { cpError.textContent = 'Mật khẩu mới tối thiểu 8 ký tự'; return; }
    if (!/[A-Z]/.test(newPass)) { cpError.textContent = 'Mật khẩu mới cần ít nhất 1 chữ hoa'; return; }
    if (!/[0-9]/.test(newPass)) { cpError.textContent = 'Mật khẩu mới cần ít nhất 1 chữ số'; return; }
    if (newPass !== confirm)    { cpError.textContent = 'Mật khẩu xác nhận không khớp'; return; }
    if (current === newPass)    { cpError.textContent = 'Mật khẩu mới phải khác mật khẩu hiện tại'; return; }

    btnCpSave.textContent = '⏳ Đang xử lý...';
    btnCpSave.disabled = true;

    try {
      await adminFetch('/admin/change-password', 'POST', {
        email,
        currentPassword: current,
        newPassword: newPass
      });
      toast('✅ Đổi mật khẩu thành công!', 'success');
      closeChangePassModal();
    } catch (e) {
      cpError.textContent = e.message || 'Lỗi không xác định';
    } finally {
      btnCpSave.textContent = '🔒 Đổi Mật Khẩu';
      btnCpSave.disabled = false;
    }
  });
}
