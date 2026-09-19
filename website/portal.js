/**
 * Presentation For Church — Operator Portal & Band Management
 * Dedicated Modern Dashboard Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  const IDENTITY_API_BASE = 'https://identity.worship-official.link';
  const OP_SESSION_KEY = 'kenhband_operator_session';

  // 1. Session & Auth Guard
  function getSession() {
    try {
      const raw = localStorage.getItem(OP_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(sess) {
    try {
      localStorage.setItem(OP_SESSION_KEY, JSON.stringify(sess));
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(OP_SESSION_KEY);
    } catch (e) {}
  }

  let session = getSession();

  // Guard: If not logged in, redirect to login page
  if (!session || !session.idToken) {
    window.location.href = 'index.html#get-account';
    return;
  }

  // State
  let bandUsers = [];
  let isPasswordHidden = true;
  let currentRoom = session.room || {};
  let currentOperator = session.operator || { email: session.email, name: session.email.split('@')[0] };

  // DOM Elements
  const headerAvatar = document.getElementById('headerAvatar');
  const headerOpName = document.getElementById('headerOpName');
  const headerOpEmail = document.getElementById('headerOpEmail');
  const heroOpName = document.getElementById('heroOpName');
  const heroChurchBadge = document.getElementById('heroChurchBadge');
  const btnHeaderLogout = document.getElementById('btnHeaderLogout');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // Metrics Elements
  const metricRoomCode = document.getElementById('metricRoomCode');
  const metricRoomName = document.getElementById('metricRoomName');
  const metricRoomPass = document.getElementById('metricRoomPass');
  const btnToggleRoomPass = document.getElementById('btnToggleRoomPass');
  const btnCopyRoomCode = document.getElementById('btnCopyRoomCode');
  const btnEditRoomModalOpen = document.getElementById('btnEditRoomModalOpen');

  const metricBandLink = document.getElementById('metricBandLink');
  const btnCopyBandLink = document.getElementById('btnCopyBandLink');
  const btnOpenBandLink = document.getElementById('btnOpenBandLink');
  const btnShowQrModal = document.getElementById('btnShowQrModal');

  const metricComposerLink = document.getElementById('metricComposerLink');
  const btnCopyComposerLink = document.getElementById('btnCopyComposerLink');
  const btnOpenComposerLink = document.getElementById('btnOpenComposerLink');

  const metricUsersCount = document.getElementById('metricUsersCount');
  const tabUsersCount = document.getElementById('tabUsersCount');

  // Workspace Tabs
  const tabButtons = document.querySelectorAll('.workspace-tab-btn');
  const tabPanels = document.querySelectorAll('.workspace-tab-panel');

  // Members Management
  const membersSearchInput = document.getElementById('membersSearchInput');
  const btnOpenAddMemberModal = document.getElementById('btnOpenAddMemberModal');
  const membersTableBody = document.getElementById('membersTableBody');
  const membersEmptyState = document.getElementById('membersEmptyState');

  // Settings Tab Elements
  const settingRoomNameInput = document.getElementById('settingRoomNameInput');
  const settingRoomPassInput = document.getElementById('settingRoomPassInput');
  const btnSaveRoomSettings = document.getElementById('btnSaveRoomSettings');

  // QR Tab Elements
  const qrCanvasContainer = document.getElementById('qrCanvasContainer');
  const qrRoomTitle = document.getElementById('qrRoomTitle');
  const qrRoomCodeDisplay = document.getElementById('qrRoomCodeDisplay');
  const btnDownloadQr = document.getElementById('btnDownloadQr');
  const btnFullscreenQr = document.getElementById('btnFullscreenQr');

  // Modals
  const modalAddMember = document.getElementById('modalAddMember');
  const formAddMember = document.getElementById('formAddMember');
  const inputAddName = document.getElementById('inputAddName');
  const inputAddUsername = document.getElementById('inputAddUsername');
  const inputAddPass = document.getElementById('inputAddPass');
  const inputAddPassConfirm = document.getElementById('inputAddPassConfirm');
  const btnSubmitAddMember = document.getElementById('btnSubmitAddMember');

  const modalResetPass = document.getElementById('modalResetPass');
  const formResetPass = document.getElementById('formResetPass');
  const resetPassTargetUser = document.getElementById('resetPassTargetUser');
  const inputResetPassNew = document.getElementById('inputResetPassNew');
  const inputResetPassConfirm = document.getElementById('inputResetPassConfirm');
  const btnSubmitResetPass = document.getElementById('btnSubmitResetPass');

  const modalFullscreenQr = document.getElementById('modalFullscreenQr');
  const fsQrCanvasContainer = document.getElementById('fsQrCanvasContainer');
  const fsRoomCode = document.getElementById('fsRoomCode');
  const fsRoomPass = document.getElementById('fsRoomPass');
  const fsRoomName = document.getElementById('fsRoomName');

  // Toast Container
  const toastContainer = document.getElementById('portalToastContainer');

  // =========================================================================
  // Helper: Toast Notifications
  // =========================================================================
  function showToast(message, type = 'success', duration = 3500) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `portal-toast toast-${type}`;
    const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');
    toast.innerHTML = `
      <span class="portal-toast-icon">${icon}</span>
      <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(15px)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // =========================================================================
  // Theme Toggle (Sync with Landing Page)
  // =========================================================================
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function updateThemeIcon(theme) {
    if (!themeToggleBtn) return;
    themeToggleBtn.innerHTML = theme === 'light' ? '🌙' : '☀️';
    themeToggleBtn.setAttribute('title', theme === 'light' ? 'Chuyển sang Giao diện Tối' : 'Chuyển sang Giao diện Sáng');
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cur);
      localStorage.setItem('theme', cur);
      updateThemeIcon(cur);
    });
  }
  initTheme();

  // =========================================================================
  // Initialize UI with Session Data
  // =========================================================================
  function renderHeaderAndHero() {
    const op = currentOperator || {};
    const room = currentRoom || {};

    const name = op.name || op.email.split('@')[0];
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'OP';

    if (headerAvatar) headerAvatar.textContent = initials;
    if (headerOpName) headerOpName.textContent = name;
    if (headerOpEmail) headerOpEmail.textContent = op.email || session.email;
    if (heroOpName) heroOpName.textContent = name;

    const churchStr = op.church ? `${op.church}${op.area ? ' • ' + op.area : ''}` : '';
    if (heroChurchBadge) {
      if (churchStr) {
        heroChurchBadge.innerHTML = `📍 <span>${escapeHtml(churchStr)}</span>`;
        heroChurchBadge.style.visibility = 'visible';
      } else {
        heroChurchBadge.style.visibility = 'hidden';
      }
    }

    // Room Card
    const code = room.code || '------';
    const rName = room.name || 'Phòng Kênh Band';
    const rPass = room.password || '';

    if (metricRoomCode) metricRoomCode.textContent = code;
    if (metricRoomName) metricRoomName.textContent = rName;
    if (metricRoomPass) {
      metricRoomPass.textContent = isPasswordHidden ? '••••••' : rPass;
    }

    // Band URLs
    const bandUrl = `https://channel.worship-official.link/m/?room=${encodeURIComponent(code)}`;
    const compUrl = `https://channel.worship-official.link/composer?room=${encodeURIComponent(code)}`;

    if (metricBandLink) metricBandLink.textContent = bandUrl;
    if (btnOpenBandLink) btnOpenBandLink.href = bandUrl;

    if (metricComposerLink) metricComposerLink.textContent = compUrl;
    if (btnOpenComposerLink) btnOpenComposerLink.href = compUrl;

    // Settings inputs
    if (settingRoomNameInput) settingRoomNameInput.value = rName;
    if (settingRoomPassInput) settingRoomPassInput.value = rPass;

    // QR section texts
    if (qrRoomTitle) qrRoomTitle.textContent = rName;
    if (qrRoomCodeDisplay) qrRoomCodeDisplay.textContent = code;

    // Render QR codes
    renderQrCode(bandUrl, qrCanvasContainer, 220);
  }

  // =========================================================================
  // Room Password Reveal & Copy Actions
  // =========================================================================
  if (btnToggleRoomPass) {
    btnToggleRoomPass.addEventListener('click', () => {
      isPasswordHidden = !isPasswordHidden;
      if (metricRoomPass && currentRoom) {
        metricRoomPass.textContent = isPasswordHidden ? '••••••' : (currentRoom.password || '');
      }
      btnToggleRoomPass.textContent = isPasswordHidden ? '👁️ Hiện' : '🔒 Ẩn';
    });
  }

  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener('click', () => {
      if (!currentRoom.code) return;
      navigator.clipboard.writeText(currentRoom.code).then(() => {
        showToast(`Đã sao chép Mã Phòng: ${currentRoom.code}`);
      });
    });
  }

  if (btnCopyBandLink) {
    btnCopyBandLink.addEventListener('click', () => {
      const url = `https://channel.worship-official.link/m/?room=${currentRoom.code || ''}`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Đã sao chép đường dẫn Kênh Band cho điện thoại!');
      });
    });
  }

  if (btnCopyComposerLink) {
    btnCopyComposerLink.addEventListener('click', () => {
      const url = `https://channel.worship-official.link/composer?room=${currentRoom.code || ''}`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Đã sao chép đường dẫn Soạn Setlist Từ Xa!');
      });
    });
  }

  // =========================================================================
  // Tabs Switching
  // =========================================================================
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // =========================================================================
  // Band Members Management (CRUD)
  // =========================================================================
  async function loadBandUsers() {
    if (!session || !session.idToken) return;
    try {
      const emailParam = session.email ? `?email=${encodeURIComponent(session.email)}` : '';
      const res = await fetch(`${IDENTITY_API_BASE}/operator/users${emailParam}`, {
        headers: { 'Authorization': `Bearer ${session.idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        bandUsers = data.users || [];
        renderMembersList(bandUsers);
        updateUserCounters(bandUsers.length);
      }
    } catch (err) {
      console.error('Lỗi khi tải danh sách user:', err);
    }
  }

  function updateUserCounters(count) {
    if (metricUsersCount) metricUsersCount.textContent = `${count} thành viên`;
    if (tabUsersCount) tabUsersCount.textContent = `${count}`;
  }

  function renderMembersList(usersToRender) {
    if (!membersTableBody) return;
    membersTableBody.innerHTML = '';

    if (!usersToRender || usersToRender.length === 0) {
      if (membersEmptyState) membersEmptyState.style.display = 'block';
      return;
    }

    if (membersEmptyState) membersEmptyState.style.display = 'none';

    usersToRender.forEach(user => {
      const tr = document.createElement('tr');
      const initial = (user.name || user.username || 'U').charAt(0).toUpperCase();
      const dateStr = user.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN') : 'Mới tạo';

      tr.innerHTML = `
        <td>
          <div class="user-identity-cell">
            <div class="user-avatar-initial">${escapeHtml(initial)}</div>
            <div class="user-names-block">
              <span class="user-display-name">${escapeHtml(user.name || user.username)}</span>
              <span class="user-username">@${escapeHtml(user.username)}</span>
            </div>
          </div>
        </td>
        <td>
          <span class="user-status-pill">● Hoạt động</span>
        </td>
        <td style="color: var(--text-muted); font-size: 0.86rem;">
          ${escapeHtml(dateStr)}
        </td>
        <td>
          <div class="user-actions-cell">
            <button type="button" class="btn-table-action btn-change-pass" data-username="${escapeHtml(user.username)}">
              🔑 Đổi pass
            </button>
            <button type="button" class="btn-table-action danger btn-delete-user" data-username="${escapeHtml(user.username)}">
              🗑️ Xoá
            </button>
          </div>
        </td>
      `;

      // Event handlers for actions
      const btnPass = tr.querySelector('.btn-change-pass');
      if (btnPass) {
        btnPass.addEventListener('click', () => openResetPassModal(user.username));
      }

      const btnDel = tr.querySelector('.btn-delete-user');
      if (btnDel) {
        btnDel.addEventListener('click', () => confirmDeleteUser(user.username));
      }

      membersTableBody.appendChild(tr);
    });
  }

  // Live Search Filter
  if (membersSearchInput) {
    membersSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        renderMembersList(bandUsers);
        return;
      }
      const filtered = bandUsers.filter(u => 
        (u.name && u.name.toLowerCase().includes(q)) || 
        (u.username && u.username.toLowerCase().includes(q))
      );
      renderMembersList(filtered);
    });
  }

  // =========================================================================
  // Add Member Modal & Submission
  // =========================================================================
  function openModal(modal) {
    if (!modal) return;
    modal.classList.add('active');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
  }

  // Bind close buttons for all modals
  document.querySelectorAll('.modal-btn-close, .btn-modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.portal-modal-backdrop');
      closeModal(modal);
    });
  });

  if (btnOpenAddMemberModal) {
    btnOpenAddMemberModal.addEventListener('click', () => {
      if (formAddMember) formAddMember.reset();
      openModal(modalAddMember);
      if (inputAddName) inputAddName.focus();
    });
  }

  if (formAddMember) {
    formAddMember.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (inputAddName && inputAddName.value || '').trim();
      const username = (inputAddUsername && inputAddUsername.value || '').trim().toLowerCase();
      const password = (inputAddPass && inputAddPass.value || '');
      const confirmPass = (inputAddPassConfirm && inputAddPassConfirm.value || '');

      if (!name || !username || !password) {
        showToast('Vui lòng điền đầy đủ các mục.', 'error');
        return;
      }
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        showToast('Tên tài khoản 3-32 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới.', 'error');
        return;
      }
      if (password.length < 6) {
        showToast('Mật khẩu tối thiểu 6 ký tự.', 'error');
        return;
      }
      if (password !== confirmPass) {
        showToast('Xác nhận mật khẩu không khớp.', 'error');
        return;
      }

      btnSubmitAddMember.disabled = true;
      btnSubmitAddMember.textContent = 'Đang khởi tạo...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/users/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.idToken}`
          },
          body: JSON.stringify({ name, username, password, email: session.email })
        });
        const data = await res.json().catch(() => ({}));

        btnSubmitAddMember.disabled = false;
        btnSubmitAddMember.textContent = 'Tạo Tài Khoản';

        if (!res.ok || !data.ok) {
          showToast(data.error || 'Không thể tạo user.', 'error');
          return;
        }

        closeModal(modalAddMember);
        showToast(`✓ Đã tạo thành công thành viên @${username}!`);
        await loadBandUsers();
      } catch (err) {
        btnSubmitAddMember.disabled = false;
        btnSubmitAddMember.textContent = 'Tạo Tài Khoản';
        showToast('Lỗi kết nối máy chủ xác thực.', 'error');
      }
    });
  }

  // =========================================================================
  // Reset Password Modal & Submission
  // =========================================================================
  let targetResetUsername = '';

  function openResetPassModal(username) {
    targetResetUsername = username;
    if (resetPassTargetUser) resetPassTargetUser.textContent = `@${username}`;
    if (formResetPass) formResetPass.reset();
    openModal(modalResetPass);
    if (inputResetPassNew) inputResetPassNew.focus();
  }

  if (formResetPass) {
    formResetPass.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!targetResetUsername) return;

      const newPassword = (inputResetPassNew && inputResetPassNew.value || '');
      const confirmPassword = (inputResetPassConfirm && inputResetPassConfirm.value || '');

      if (newPassword.length < 6) {
        showToast('Mật khẩu mới tối thiểu 6 ký tự.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('Xác nhận mật khẩu mới không khớp.', 'error');
        return;
      }

      btnSubmitResetPass.disabled = true;
      btnSubmitResetPass.textContent = 'Đang lưu...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/users/update-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.idToken}`
          },
          body: JSON.stringify({
            username: targetResetUsername,
            newPassword,
            email: session.email
          })
        });
        const data = await res.json().catch(() => ({}));

        btnSubmitResetPass.disabled = false;
        btnSubmitResetPass.textContent = 'Lưu Mật Khẩu';

        if (!res.ok || !data.ok) {
          showToast(data.error || 'Không thể đổi mật khẩu.', 'error');
          return;
        }

        closeModal(modalResetPass);
        showToast(`✓ Đã đổi mật khẩu cho user @${targetResetUsername}!`);
      } catch (err) {
        btnSubmitResetPass.disabled = false;
        btnSubmitResetPass.textContent = 'Lưu Mật Khẩu';
        showToast('Lỗi kết nối máy chủ.', 'error');
      }
    });
  }

  // =========================================================================
  // Delete Member User
  // =========================================================================
  async function confirmDeleteUser(username) {
    if (!confirm(`Bạn có chắc chắn muốn xoá tài khoản @${username}? Thao tác này không thể hoàn tác.`)) {
      return;
    }

    try {
      const res = await fetch(`${IDENTITY_API_BASE}/operator/users/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.idToken}`
        },
        body: JSON.stringify({ username, email: session.email })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        showToast(data.error || 'Không thể xoá tài khoản.', 'error');
        return;
      }

      showToast(`✓ Đã xoá thành công tài khoản @${username}!`);
      await loadBandUsers();
    } catch (err) {
      showToast('Lỗi kết nối khi xoá tài khoản.', 'error');
    }
  }

  // =========================================================================
  // Room Settings (Update Room Name & Password)
  // =========================================================================
  if (btnSaveRoomSettings) {
    btnSaveRoomSettings.addEventListener('click', async () => {
      const roomName = (settingRoomNameInput && settingRoomNameInput.value || '').trim();
      const roomPassword = (settingRoomPassInput && settingRoomPassInput.value || '').trim();

      if (!roomName) {
        showToast('Vui lòng nhập tên phòng.', 'error');
        return;
      }
      if (roomPassword && (roomPassword.length < 4 || roomPassword.length > 12)) {
        showToast('Mật khẩu phòng từ 4 đến 12 ký tự.', 'error');
        return;
      }

      btnSaveRoomSettings.disabled = true;
      btnSaveRoomSettings.textContent = 'Đang lưu...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/room/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.idToken}`
          },
          body: JSON.stringify({
            name: roomName,
            password: roomPassword,
            email: session.email
          })
        });
        const data = await res.json().catch(() => ({}));

        btnSaveRoomSettings.disabled = false;
        btnSaveRoomSettings.textContent = 'Lưu Thay Đổi Phòng';

        if (!res.ok || !data.ok) {
          showToast(data.error || 'Không thể cập nhật phòng.', 'error');
          return;
        }

        currentRoom = data.room;
        session.room = data.room;
        setSession(session);
        renderHeaderAndHero();
        showToast('✓ Cập nhật thông tin phòng thành công!');
      } catch (err) {
        btnSaveRoomSettings.disabled = false;
        btnSaveRoomSettings.textContent = 'Lưu Thay Đổi Phòng';
        showToast('Lỗi kết nối máy chủ.', 'error');
      }
    });
  }

  // =========================================================================
  // QR Code Generation Engine (Lightweight, Zero-Dependency Canvas Renderer)
  // =========================================================================
  function renderQrCode(url, container, size = 220) {
    if (!container) return;
    container.innerHTML = '';

    // Create an image using Google Chart QR or quick SVG fallback
    const qrImg = document.createElement('img');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&margin=10`;
    qrImg.alt = 'QR Code Kênh Band';
    qrImg.width = size;
    qrImg.height = size;
    qrImg.style.borderRadius = '8px';
    qrImg.style.display = 'block';

    qrImg.onerror = () => {
      // Fallback text if offline
      container.innerHTML = `<div style="padding: 20px; font-size: 0.85rem; color: #666;">Quét link: <br><strong>${url}</strong></div>`;
    };

    container.appendChild(qrImg);
  }

  // Fullscreen Stage View Modal
  if (btnFullscreenQr || btnShowQrModal) {
    const triggerBtn = btnFullscreenQr || btnShowQrModal;
    const handler = () => {
      const bandUrl = `https://channel.worship-official.link/m/?room=${currentRoom.code || ''}`;
      if (fsRoomCode) fsRoomCode.textContent = currentRoom.code || '------';
      if (fsRoomPass) fsRoomPass.textContent = currentRoom.password || '------';
      if (fsRoomName) fsRoomName.textContent = currentRoom.name || 'Phòng Kênh Band';

      if (fsQrCanvasContainer) fsQrCanvasContainer.innerHTML = '';
      renderQrCode(bandUrl, fsQrCanvasContainer, 200);
      openModal(modalFullscreenQr);
    };

    if (btnFullscreenQr) btnFullscreenQr.addEventListener('click', handler);
    if (btnShowQrModal) btnShowQrModal.addEventListener('click', handler);
  }

  // Download QR Code
  if (btnDownloadQr) {
    btnDownloadQr.addEventListener('click', () => {
      const code = currentRoom.code || 'kenhband';
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(`https://channel.worship-official.link/m/?room=${code}`)}&margin=15`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `QR_KenhBand_${code}.png`;
      a.target = '_blank';
      a.click();
      showToast('Đang tải ảnh mã QR...');
    });
  }

  // =========================================================================
  // Logout Handling
  // =========================================================================
  if (btnHeaderLogout) {
    btnHeaderLogout.addEventListener('click', () => {
      if (confirm('Bạn có chắc chắn muốn đăng xuất khỏi Operator Portal?')) {
        clearSession();
        window.location.href = 'index.html#get-account';
      }
    });
  }

  // Initial Data Load
  renderHeaderAndHero();
  loadBandUsers();
});
