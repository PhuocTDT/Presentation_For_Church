/**
 * Presentation For Church - Landing Page Interactive Logic
 * Handles Kênh Band Simulator, OS Detection, FAQ Accordions, and Navigation
 */

document.addEventListener('DOMContentLoaded', () => {

  /* ========================================================================
     1. Kênh Band Interactive Simulator Logic
     ======================================================================== */
  const phoneButtons = document.querySelectorAll('.phone-quick-btn');
  const phoneToast = document.getElementById('phoneToast');
  const toastMsg = document.getElementById('toastMsg');
  const simFeedList = document.getElementById('simFeedList');
  const feedCounter = document.getElementById('feedCounter');
  const opReplyInput = document.getElementById('opReplyInput');
  const btnOpSendReply = document.getElementById('btnOpSendReply');

  let unreadCount = 2;

  function showPhoneToast(message, isFromOp = false) {
    if (!phoneToast) return;
    toastMsg.textContent = message;
    if (isFromOp) {
      phoneToast.style.background = '#2563a8';
    } else {
      phoneToast.style.background = '#1e2430';
    }
    phoneToast.style.display = 'flex';

    setTimeout(() => {
      phoneToast.style.display = 'none';
    }, 2800);
  }

  // Handle Quick Alert Button Clicks
  phoneButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const msg = btn.getAttribute('data-msg');
      if (!msg) return;

      // Animate button
      btn.classList.add('active-click');
      setTimeout(() => btn.classList.remove('active-click'), 400);

      // Show toast on phone
      showPhoneToast('Đã gửi: ' + btn.textContent.trim());

      // Push alert to Operator Feed
      setTimeout(() => {
        addAlertToOperatorFeed('Ban Nhạc (Phone)', msg, true);
      }, 250);
    });
  });

  function addAlertToOperatorFeed(sender, text, isUrgent = false) {
    if (!simFeedList) return;

    unreadCount++;
    if (feedCounter) feedCounter.textContent = unreadCount;

    const alertCard = document.createElement('div');
    alertCard.className = `op-alert-card ${isUrgent ? 'urgent' : ''}`;
    alertCard.innerHTML = `
      <div class="alert-main-info">
        <div class="alert-meta">
          <span class="sender">${escapeHtml(sender)}</span>
          <span>• Vừa xong</span>
        </div>
        <div class="alert-text-body">${escapeHtml(text)}</div>
      </div>
      <button class="alert-ack-btn" onclick="ackAlert(this)">Đã tiếp nhận</button>
    `;

    simFeedList.insertBefore(alertCard, simFeedList.firstChild);
  }

  // Operator Ack Handler
  window.ackAlert = function(btn) {
    if (btn.classList.contains('acknowledged')) return;
    btn.classList.add('acknowledged');
    btn.textContent = '✓ Đã xác nhận';
    
    if (unreadCount > 0) {
      unreadCount--;
      if (feedCounter) feedCounter.textContent = unreadCount;
    }

    // Feedback back to phone toast
    showPhoneToast('Operator đã tiếp nhận yêu cầu!', true);
  };

  // Operator Reply Send
  if (btnOpSendReply && opReplyInput) {
    const handleOpReply = () => {
      const text = opReplyInput.value.trim();
      if (!text) return;

      showPhoneToast(`Tin từ Operator: "${text}"`, true);
      opReplyInput.value = '';

      // Add feedback item in feed
      const card = document.createElement('div');
      card.className = 'op-alert-card';
      card.style.background = 'rgba(56, 189, 248, 0.08)';
      card.style.borderColor = 'rgba(56, 189, 248, 0.25)';
      card.innerHTML = `
        <div class="alert-main-info">
          <div class="alert-meta">
            <span class="sender" style="color:var(--emerald);">Bạn (Operator)</span>
            <span>• Vừa gửi</span>
          </div>
          <div class="alert-text-body">↳ ${escapeHtml(text)}</div>
        </div>
        <span style="font-size:0.75rem; color:var(--emerald); align-self:center;">Đã phát tới Band</span>
      `;
      simFeedList.insertBefore(card, simFeedList.firstChild);
    };

    btnOpSendReply.addEventListener('click', handleOpReply);
    opReplyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleOpReply();
    });
  }

  // Phone Tab Switching (Alerts, Chords, Setlist)
  const tabAlerts = document.getElementById('tabAlerts');
  const tabChords = document.getElementById('tabChords');
  const tabSetlist = document.getElementById('tabSetlist');
  const phoneButtonsGrid = document.getElementById('phoneButtonsGrid');
  const phoneChordsPanel = document.getElementById('phoneChordsPanel');
  const phoneSetlistPanel = document.getElementById('phoneSetlistPanel');
  const phoneInstruction = document.querySelector('.phone-instruction');

  function switchPhoneTab(activeTab) {
    [tabAlerts, tabChords, tabSetlist].forEach(t => t && t.classList.remove('active'));
    if (phoneButtonsGrid) phoneButtonsGrid.style.display = 'none';
    if (phoneChordsPanel) phoneChordsPanel.style.display = 'none';
    if (phoneSetlistPanel) phoneSetlistPanel.style.display = 'none';

    if (activeTab === 'alerts') {
      if (tabAlerts) tabAlerts.classList.add('active');
      if (phoneButtonsGrid) phoneButtonsGrid.style.display = 'grid';
      if (phoneInstruction) phoneInstruction.textContent = 'Chạm 1 lần vào nút bên dưới để báo cho người bấm máy chiếu:';
    } else if (activeTab === 'chords') {
      if (tabChords) tabChords.classList.add('active');
      if (phoneChordsPanel) phoneChordsPanel.style.display = 'block';
      if (phoneInstruction) phoneInstruction.textContent = 'Thư viện hợp âm số đồng bộ thời gian thực:';
    } else if (activeTab === 'setlist') {
      if (tabSetlist) tabSetlist.classList.add('active');
      if (phoneSetlistPanel) phoneSetlistPanel.style.display = 'block';
      if (phoneInstruction) phoneInstruction.textContent = 'Soạn danh mục bài hát thờ phượng từ điện thoại:';
    }
  }

  if (tabAlerts) tabAlerts.addEventListener('click', () => switchPhoneTab('alerts'));
  if (tabChords) tabChords.addEventListener('click', () => switchPhoneTab('chords'));
  if (tabSetlist) tabSetlist.addEventListener('click', () => switchPhoneTab('setlist'));

  const btnSendSetlistSim = document.getElementById('btnSendSetlistSim');
  if (btnSendSetlistSim) {
    btnSendSetlistSim.addEventListener('click', () => {
      showPhoneToast('Đã gửi Setlist 3 bài về máy vận hành!');
      setTimeout(() => {
        addAlertToOperatorFeed('Trưởng Ban Hát', '📋 Gửi Setlist mới: [Chúa chính Ngài là Đấng..., Lớn Bấy Duy Ngài, Tình Yêu Thương Xót]', false);
      }, 300);
    });
  }

  /* ========================================================================
     2. OS Auto-Detection for Downloads
     ======================================================================== */
  const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
  const btnHeroDownload = document.getElementById('btnHeroDownload');
  
  if (isMac && btnHeroDownload) {
    const btnText = btnHeroDownload.querySelector('span');
    if (btnText) btnText.textContent = 'Tải Cho macOS (.dmg)';
  } else if (btnHeroDownload) {
    const btnText = btnHeroDownload.querySelector('span');
    if (btnText) btnText.textContent = 'Tải Cho Windows (.exe)';
  }

  /* ========================================================================
     3. FAQ Accordion Logic
     ======================================================================== */
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach((item) => {
    const questionBtn = item.querySelector('.faq-question');
    if (!questionBtn) return;

    questionBtn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      
      // Close other items
      faqItems.forEach(other => {
        if (other !== item) other.classList.remove('open');
      });

      if (isOpen) {
        item.classList.remove('open');
      } else {
        item.classList.add('open');
      }
    });
  });

  /* ========================================================================
     4. Navigation Active State on Scroll
     ======================================================================== */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');

  function updateActiveNav() {
    const scrollY = window.pageYOffset;
    sections.forEach(current => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop - 120;
      const sectionId = current.getAttribute('id');

      if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
        navLinks.forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
          }
        });
      }
    });
  }

  window.addEventListener('scroll', updateActiveNav);

  /* ========================================================================
     5. Mobile Menu Toggle
     ======================================================================== */
  const mobileNavToggle = document.getElementById('mobileNavToggle');
  const navLinksList = document.getElementById('navLinks');

  if (mobileNavToggle && navLinksList) {
    mobileNavToggle.addEventListener('click', () => {
      const isVisible = navLinksList.style.display === 'flex';
      if (isVisible) {
        navLinksList.style.display = 'none';
      } else {
        navLinksList.style.display = 'flex';
        navLinksList.style.flexDirection = 'column';
        navLinksList.style.position = 'absolute';
        navLinksList.style.top = '76px';
        navLinksList.style.left = '0';
        navLinksList.style.right = '0';
        navLinksList.style.background = 'rgba(6, 9, 17, 0.98)';
        navLinksList.style.padding = '20px 24px';
        navLinksList.style.borderBottom = '1px solid var(--border-subtle)';
      }
    });

    // Close mobile nav when clicking a link
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          navLinksList.style.display = 'none';
        }
      });
    });
  }

  /* ========================================================================
     6. Theme Toggle (Light / Dark Mode)
     ======================================================================== */
  const themeToggle = document.getElementById('themeToggle');
  const storedTheme = localStorage.getItem('theme') || 'dark';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  // Apply initial theme
  applyTheme(storedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    });
  }

  /* ========================================================================
     7. Interactive Drag-and-Drop Schedule Simulator (Bento Card)
     - AUTO DEMO: Tự động kéo thả định kỳ để thu hút người dùng
     - Tự động tạm dừng khi người dùng rê chuột / kéo thả thủ công
     ======================================================================== */
  const dragList = document.getElementById('scheduleDragList');
  const dragStatusFeedback = document.getElementById('dragStatusFeedback');
  const autoDragBadge = document.getElementById('autoDragBadge');
  let draggedItem = null;
  let isUserInteracting = false;
  let autoDragTimer = null;

  function updateItemNumbers() {
    if (!dragList) return;
    const items = dragList.querySelectorAll('.schedule-drag-item');
    items.forEach((item, index) => {
      const numSpan = item.querySelector('.drag-item-num');
      if (numSpan) numSpan.textContent = index + 1;
    });
  }

  // Chuỗi vị trí kéo thả phong phú và dứt khoát: 3->1, 2->4, 4->2, 1->3
  const moveSequence = [
    { from: 2, to: 0, label: '3 → 1' },
    { from: 1, to: 3, label: '2 → 4' },
    { from: 3, to: 1, label: '4 → 2' },
    { from: 0, to: 2, label: '1 → 3' }
  ];
  let currentSeqIdx = 0;

  // Tự động mô phỏng kéo thả đa vị trí, dứt khoát (Snappy FLIP Drag)
  function runAutoDragStep() {
    if (!dragList || isUserInteracting) return;

    const items = Array.from(dragList.querySelectorAll('.schedule-drag-item'));
    if (items.length < 4) return;

    const move = moveSequence[currentSeqIdx];
    currentSeqIdx = (currentSeqIdx + 1) % moveSequence.length;

    const sourceItem = items[move.from];
    const targetItem = items[move.to];
    if (!sourceItem || !targetItem) return;

    const sourceRect = sourceItem.getBoundingClientRect();
    const targetRect = targetItem.getBoundingClientRect();
    const distanceY = targetRect.top - sourceRect.top;

    // Pha 1: Nhấc bổng dứt khoát (Lift-up - 130ms)
    sourceItem.classList.add('auto-lifting');
    if (autoDragBadge) {
      autoDragBadge.style.borderColor = 'rgba(56, 189, 248, 0.6)';
      autoDragBadge.style.color = 'var(--primary)';
    }

    setTimeout(() => {
      if (isUserInteracting) {
        sourceItem.classList.remove('auto-lifting');
        return;
      }

      // Pha 2: Trượt dứt khoát đến đích (Glide - 280ms)
      sourceItem.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.9, 0.25, 1)';
      sourceItem.style.transform = `translateY(${distanceY}px) scale(1.035) rotate(-1deg)`;

      // Các mục ở giữa trượt nhường chỗ dứt khoát
      const step = move.from < move.to ? 1 : -1;
      const shiftY = (sourceRect.height + 8) * (move.from < move.to ? -1 : 1);

      for (let i = move.from + step; move.from < move.to ? i <= move.to : i >= move.to; i += step) {
        const itemToShift = items[i];
        if (itemToShift && itemToShift !== sourceItem) {
          itemToShift.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.9, 0.25, 1)';
          itemToShift.style.transform = `translateY(${shiftY}px)`;
        }
      }

      // Pha 3: Thả khớp vị trí dứt khoát (Snap Drop & Reorder - 290ms)
      setTimeout(() => {
        // Reset transforms
        items.forEach(el => {
          el.style.transition = '';
          el.style.transform = '';
        });
        sourceItem.classList.remove('auto-lifting');

        if (isUserInteracting) return;

        // Cập nhật DOM
        if (move.from > move.to) {
          dragList.insertBefore(sourceItem, targetItem);
        } else {
          dragList.insertBefore(sourceItem, targetItem.nextSibling);
        }

        updateItemNumbers();

        // Hiệu ứng drop sắc nét
        sourceItem.classList.add('just-dropped');
        setTimeout(() => sourceItem.classList.remove('just-dropped'), 450);

        const content = sourceItem.querySelector('.drag-item-content');
        const title = content ? content.textContent.trim() : 'Mục';
        if (dragStatusFeedback) {
          dragStatusFeedback.innerHTML = `✓ Kéo thả dứt khoát <strong>[${move.label}]</strong>: <em>${escapeHtml(title)}</em>`;
        }

        if (autoDragBadge) {
          autoDragBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
          autoDragBadge.style.color = 'var(--emerald)';
        }

        // Lên lịch lượt tiếp theo với chu kỳ ngắn, năng động (2.5 giây)
        scheduleNextAutoDrag(2500);
      }, 290);

    }, 130);
  }

  function scheduleNextAutoDrag(delay = 2500) {
    clearTimeout(autoDragTimer);
    if (!isUserInteracting) {
      autoDragTimer = setTimeout(runAutoDragStep, delay);
    }
  }

  // Khởi động auto drag sau 1.2 giây
  scheduleNextAutoDrag(1200);

  // Tạm dừng auto demo khi người dùng rê chuột vào
  if (dragList) {
    dragList.addEventListener('mouseenter', () => {
      isUserInteracting = true;
      clearTimeout(autoDragTimer);
      if (autoDragBadge) {
        autoDragBadge.innerHTML = `<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--gold);"></span><span>Bạn đang tương tác</span>`;
        autoDragBadge.style.color = 'var(--gold)';
        autoDragBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      }
    });

    dragList.addEventListener('mouseleave', () => {
      isUserInteracting = false;
      if (autoDragBadge) {
        autoDragBadge.innerHTML = `<span class="pulse-green"></span><span>Tự động demo kéo thả</span>`;
        autoDragBadge.style.color = 'var(--emerald)';
        autoDragBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
      }
      scheduleNextAutoDrag(3000);
    });

    // Kéo thả thủ công
    const bindDragEvents = (item) => {
      item.addEventListener('dragstart', (e) => {
        isUserInteracting = true;
        clearTimeout(autoDragTimer);
        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.id || '');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        const allItems = dragList.querySelectorAll('.schedule-drag-item');
        allItems.forEach(i => i.classList.remove('drag-over-top', 'drag-over-bottom'));
        draggedItem = null;
        updateItemNumbers();
        setTimeout(() => { 
          isUserInteracting = false; 
          scheduleNextAutoDrag(4000); 
        }, 1000);
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!draggedItem || draggedItem === item) return;

        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        const allItems = dragList.querySelectorAll('.schedule-drag-item');
        allItems.forEach(i => i.classList.remove('drag-over-top', 'drag-over-bottom'));

        if (e.clientY < midY) {
          item.classList.add('drag-over-top');
        } else {
          item.classList.add('drag-over-bottom');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over-top', 'drag-over-bottom');
        if (!draggedItem || draggedItem === item) return;

        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (e.clientY < midY) {
          dragList.insertBefore(draggedItem, item);
        } else {
          dragList.insertBefore(draggedItem, item.nextSibling);
        }

        updateItemNumbers();

        // Highlight drop
        draggedItem.classList.add('just-dropped');
        setTimeout(() => {
          if (draggedItem) draggedItem.classList.remove('just-dropped');
        }, 800);

        const content = draggedItem.querySelector('.drag-item-content');
        const title = content ? content.textContent.trim() : 'Mục';
        if (dragStatusFeedback) {
          dragStatusFeedback.innerHTML = `✓ Bạn đã chuyển <strong>${escapeHtml(title)}</strong> sang vị trí mới!`;
        }
      });
    };

    const initialItems = dragList.querySelectorAll('.schedule-drag-item');
    initialItems.forEach(bindDragEvents);
  }

  /* ========================================================================
     8. Bible Lookup Interactive Simulator (Bento Card 1)
     ======================================================================== */
  const bibleVerTabs = document.querySelectorAll('.bible-ver-tab');
  const bibleSearchQuery = document.getElementById('bibleSearchQuery');
  const bibleSugChips = document.querySelectorAll('.bible-sug-chip');
  const verseRefTitle = document.getElementById('verseRefTitle');
  const verseTextContent = document.getElementById('verseTextContent');
  const btnBibleAddToSchedule = document.getElementById('btnBibleAddToSchedule');
  const btnBibleGoLive = document.getElementById('btnBibleGoLive');

  let currentBibleVer = 'BẢN HIỆU ĐÍNH (RVV11)';
  let currentBibleRef = 'Thi Thiên 23:1-3';

  bibleVerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.getAttribute('data-ver') === 'xml') {
        alert('Tính năng nhập XML: Bạn có thể nhập file XML bản dịch Kinh Thánh bất kỳ vào phần mềm Presentation For Church qua mục Cài Đặt.');
        return;
      }
      bibleVerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentBibleVer = tab.textContent.toUpperCase();
      const verShort = tab.textContent.includes('(') ? tab.textContent.split('(')[1].replace(')', '') : 'RVV11';
      if (bibleSearchQuery) {
        bibleSearchQuery.textContent = `${currentBibleRef} (${verShort})`;
      }
      if (verseRefTitle) {
        verseRefTitle.textContent = `${currentBibleRef.toUpperCase()} • ${currentBibleVer}`;
      }
    });
  });

  bibleSugChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const ref = chip.getAttribute('data-ref');
      const text = chip.getAttribute('data-text');
      currentBibleRef = ref;
      const activeTab = document.querySelector('.bible-ver-tab.active');
      const verShort = activeTab && activeTab.textContent.includes('(') ? activeTab.textContent.split('(')[1].replace(')', '') : 'RVV11';
      if (bibleSearchQuery) {
        bibleSearchQuery.textContent = `${ref} (${verShort})`;
      }
      if (verseRefTitle) {
        verseRefTitle.textContent = `${ref.toUpperCase()} • ${currentBibleVer}`;
      }
      if (verseTextContent) {
        verseTextContent.textContent = `"${text}"`;
      }
    });
  });

  if (btnBibleAddToSchedule && dragList) {
    btnBibleAddToSchedule.addEventListener('click', () => {
      const newLi = document.createElement('li');
      newLi.className = 'schedule-drag-item just-dropped';
      newLi.draggable = true;
      newLi.setAttribute('data-id', Date.now());
      newLi.innerHTML = `
        <span class="drag-handle" title="Kéo để đổi vị trí">⋮⋮</span>
        <span class="drag-item-num">5</span>
        <span class="drag-item-content">📖 ${escapeHtml(currentBibleRef)}</span>
        <span class="drag-item-tag bible">Bible</span>
        <span class="virtual-cursor">👆</span>
      `;
      dragList.appendChild(newLi);
      if (typeof bindDragEvents === 'function') {
        bindDragEvents(newLi);
      }
      updateItemNumbers();
      btnBibleAddToSchedule.textContent = '✓ Đã Thêm!';
      setTimeout(() => {
        btnBibleAddToSchedule.textContent = '+ Đưa Vào Schedule';
      }, 1500);
      if (dragStatusFeedback) {
        dragStatusFeedback.innerHTML = `✓ Đã nạp <strong>${escapeHtml(currentBibleRef)}</strong> vào Schedule!`;
      }
    });
  }

  if (btnBibleGoLive) {
    btnBibleGoLive.addEventListener('click', () => {
      btnBibleGoLive.textContent = '● Đang Chiếu!';
      btnBibleGoLive.style.background = '#dc2626';
      btnBibleGoLive.style.color = '#fff';
      setTimeout(() => {
        btnBibleGoLive.textContent = '● Chiếu Trực Tiếp';
        btnBibleGoLive.style.background = '';
        btnBibleGoLive.style.color = '';
      }, 1800);
    });
  }

  /* ========================================================================
     9. Optional: request a Kênh Band account by email (standalone section,
        #get-account — kế bên FAQ, xem SECTION 6.5 trong index.html)
     ======================================================================== */
  const IDENTITY_API_BASE = 'https://identity.worship-official.link';
  const emailAccountForm = document.getElementById('emailAccountForm');
  const emailAccountInput = document.getElementById('emailAccountInput');
  const emailAccountBtn = document.getElementById('emailAccountBtn');
  const emailAccountStatus = document.getElementById('emailAccountStatus');

  if (emailAccountForm) {
    emailAccountForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = (emailAccountInput.value || '').trim();
      emailAccountStatus.textContent = '';
      emailAccountStatus.className = 'account-request-status';
      if (!email) return;

      emailAccountBtn.disabled = true;
      const btnText = emailAccountBtn.querySelector('span');
      const originalText = btnText ? btnText.textContent : '';
      if (btnText) btnText.textContent = 'Đang gửi...';

      fetch(`${IDENTITY_API_BASE}/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then((res) => {
          emailAccountBtn.disabled = false;
          if (btnText) btnText.textContent = originalText;
          if (!res.ok) {
            emailAccountStatus.textContent = (res.j && res.j.error) || 'Không gửi được, thử lại sau.';
            emailAccountStatus.className = 'account-request-status err';
            return;
          }
          // Server luôn trả {ok:true} dù email đã có tài khoản hay chưa —
          // tránh lộ danh sách email đã đăng ký, xem worker.js.
          emailAccountStatus.textContent = 'Nếu email hợp lệ, tài khoản + mật khẩu tạm đã được gửi tới hộp thư của bạn (kiểm tra cả mục Spam).';
          emailAccountStatus.className = 'account-request-status ok';
          emailAccountForm.reset();
        })
        .catch(() => {
          emailAccountBtn.disabled = false;
          if (btnText) btnText.textContent = originalText;
          emailAccountStatus.textContent = 'Không kết nối được máy chủ, kiểm tra mạng rồi thử lại.';
          emailAccountStatus.className = 'account-request-status err';
        });
    });
  }

  /* Utility: Escape HTML */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

});
