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
     5. Mobile Menu Toggle & Side Drawer
     ======================================================================== */
  const mobileNavToggle = document.getElementById('mobileNavToggle');
  const navLinksList = document.getElementById('navLinks');
  const mobileNavBackdrop = document.getElementById('mobileNavBackdrop');

  if (mobileNavToggle && navLinksList) {
    function closeMobileNav() {
      navLinksList.classList.remove('mobile-open');
      mobileNavToggle.classList.remove('is-active');
      mobileNavToggle.setAttribute('aria-expanded', 'false');
      if (mobileNavBackdrop) mobileNavBackdrop.classList.remove('active');
      document.body.style.overflow = '';
    }

    function openMobileNav() {
      navLinksList.classList.add('mobile-open');
      mobileNavToggle.classList.add('is-active');
      mobileNavToggle.setAttribute('aria-expanded', 'true');
      if (mobileNavBackdrop) mobileNavBackdrop.classList.add('active');
    }

    mobileNavToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCurrentlyOpen = navLinksList.classList.contains('mobile-open');
      if (isCurrentlyOpen) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });

    if (mobileNavBackdrop) {
      mobileNavBackdrop.addEventListener('click', () => {
        closeMobileNav();
      });
    }

    // Close mobile nav when clicking any link
    navLinksList.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        closeMobileNav();
      });
    });

    // Close mobile nav when clicking outside
    document.addEventListener('click', (e) => {
      if (!navLinksList.contains(e.target) && !mobileNavToggle.contains(e.target)) {
        closeMobileNav();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinksList.classList.contains('mobile-open')) {
        closeMobileNav();
      }
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

    // Pha 1: Nhấc bổng mượt mà (Lift-up - 180ms)
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

      // Pha 2: Trượt mượt mà đến đích (Glide - 520ms) - Giảm tốc độ kéo thả để người xem nhìn rõ
      sourceItem.style.transition = 'transform 0.52s cubic-bezier(0.25, 1, 0.5, 1)';
      sourceItem.style.transform = `translateY(${distanceY}px) scale(1.035) rotate(-1deg)`;

      // Các mục ở giữa trượt nhường chỗ mượt mà
      const step = move.from < move.to ? 1 : -1;
      const shiftY = (sourceRect.height + 8) * (move.from < move.to ? -1 : 1);

      for (let i = move.from + step; move.from < move.to ? i <= move.to : i >= move.to; i += step) {
        const itemToShift = items[i];
        if (itemToShift && itemToShift !== sourceItem) {
          itemToShift.style.transition = 'transform 0.52s cubic-bezier(0.25, 1, 0.5, 1)';
          itemToShift.style.transform = `translateY(${shiftY}px)`;
        }
      }

      // Pha 3: Thả khớp vị trí (Snap Drop & Reorder - 540ms)
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
        setTimeout(() => sourceItem.classList.remove('just-dropped'), 400);

        const content = sourceItem.querySelector('.drag-item-content');
        const title = content ? content.textContent.trim() : 'Mục';
        if (dragStatusFeedback) {
          dragStatusFeedback.innerHTML = `✓ Kéo thả mượt mà <strong>[${move.label}]</strong>: <em>${escapeHtml(title)}</em>`;
        }

        if (autoDragBadge) {
          autoDragBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
          autoDragBadge.style.color = 'var(--emerald)';
        }

        // Giảm thời gian nghỉ giữa 2 lần kéo thả lại (1.2 giây thay vì 2.5 giây)
        scheduleNextAutoDrag(1200);
      }, 540);

    }, 180);
  }

  function scheduleNextAutoDrag(delay = 1200) {
    clearTimeout(autoDragTimer);
    if (!isUserInteracting) {
      autoDragTimer = setTimeout(runAutoDragStep, delay);
    }
  }

  // Khởi động auto drag sớm sau 800ms
  scheduleNextAutoDrag(800);

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
      scheduleNextAutoDrag(1400);
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
  const verseCountLabel = document.getElementById('verseCountLabel');
  const btnBibleAddToSchedule = document.getElementById('btnBibleAddToSchedule');
  const btnBibleGoLive = document.getElementById('btnBibleGoLive');

  const BIBLE_VERSIONS = {
    rvv11: { name: 'BẢN HIỆU ĐÍNH (RVV11)', short: 'RVV11' },
    btt: { name: 'BẢN TRUYỀN THỐNG (1925)', short: '1925' },
    bdm: { name: 'BẢN DỊCH MỚI (BDM)', short: 'BDM' }
  };

  const BIBLE_DATABASE = {
    'Thi Thiên 23:1-3': {
      count: '3 CÂU',
      rvv11: 'Đức Giê-hô-va là Đấng chăn giữ tôi, tôi sẽ chẳng thiếu thốn gì. Ngài khiến tôi an nghỉ nơi đồng cỏ xanh tươi, dẫn tôi đến mé nước bình tịnh. Ngài phục hồi linh hồn tôi, dẫn tôi vào các lối công chính vì cớ danh Ngài.',
      btt: 'Đức Giê-hô-va là Đấng chăn giữ tôi: tôi sẽ chẳng thiếu thốn gì. Ngài khiến tôi an nghỉ nơi đồng cỏ xanh tươi, Dẫn tôi đến mé nước bình tịnh. Ngài bổ lại linh hồn tôi, Dẫn tôi vào các lối công bình, vì cớ danh Ngài.',
      bdm: 'CHÚA là Đấng chăn giữ tôi, tôi sẽ không thiếu thốn gì. Ngài giúp tôi an nghỉ nơi đồng cỏ xanh tươi, dẫn tôi đến bên bờ suối yên tịnh. Ngài phục hồi linh hồn tôi, dẫn tôi vào đường lối công bình vì cớ danh Ngài.'
    },
    'Giăng 3:16': {
      count: '1 CÂU',
      rvv11: 'Vì Đức Chúa Trời yêu thương thế gian đến nỗi đã ban Con Một của Ngài, để ai tin Con ấy không bị hư mất mà được sự sống đời đời.',
      btt: 'Vì Đức Chúa Trời yêu thương thế gian, đến nỗi đã ban Con một của Ngài, hầu cho hễ ai tin Con ấy không bị hư mất mà được sự sống đời đời.',
      bdm: 'Vì Đức Chúa Trời yêu thương nhân loại, đến nỗi đã ban Con Một của Ngài, để ai tin nhận Đấng ấy sẽ không bị hư mất nhưng được sự sống vĩnh phúc.'
    },
    'Rô-ma 8:28': {
      count: '1 CÂU',
      rvv11: 'Chúng ta biết rằng mọi sự hiệp lại làm ích cho những ai yêu mến Đức Chúa Trời, tức là cho những người được kêu gọi theo mục đích của Ngài.',
      btt: 'Vả, chúng ta biết rằng mọi sự hiệp lại làm ích cho kẻ yêu mến Đức Chúa Trời, tức là cho kẻ được gọi theo ý muốn Ngài đã định.',
      bdm: 'Chúng ta biết rằng mọi sự hiệp lại làm ích cho những người yêu kính Đức Chúa Trời, tức là những người được kêu gọi theo mục đích của Ngài.'
    },
    'Ma-thi-ơ 6:9-13': {
      count: '5 CÂU',
      rvv11: 'Lạy Cha chúng con ở trên trời, Danh Cha được thánh; Vương quốc Cha được đến, Ý Cha được nên, ở đất như ở trời. Xin cho chúng con hôm nay thức ăn đủ dùng; Xin tha tội lỗi cho chúng con, như chúng con cũng tha kẻ có lỗi với chúng con; Xin đừng để chúng con bị cám dỗ, nhưng cứu chúng con khỏi điều ác.',
      btt: 'Lạy Cha chúng tôi ở trên trời; Danh Cha được thánh; Nước Cha được đến; Ý Cha được nên, ở đất như trời! Xin cho chúng tôi hôm nay đồ ăn đủ ngày; Xin tha tội lỗi cho chúng tôi, như chúng tôi cũng tha kẻ phạm tội nghịch cùng chúng tôi; Xin chớ để chúng tôi bị cám dỗ, mà cứu chúng tôi khỏi điều ác!',
      bdm: 'Lạy Cha chúng con ở trên trời, Danh Cha được tôn thánh, Nước Cha được đến, Ý Cha được nên, ở đất như ở trời. Xin cho chúng con hôm nay thức ăn đủ ngày. Xin tha tội cho chúng con, như chính chúng con cũng tha kẻ mắc tội với chúng con. Xin đừng để chúng con sa vào chước cám dỗ nhưng cứu chúng con khỏi Kẻ Ác.'
    }
  };

  let currentBibleVerKey = 'rvv11';
  let currentBibleRef = 'Thi Thiên 23:1-3';

  function renderBibleVerse(animate = true) {
    const data = BIBLE_DATABASE[currentBibleRef] || BIBLE_DATABASE['Thi Thiên 23:1-3'];
    const ver = BIBLE_VERSIONS[currentBibleVerKey] || BIBLE_VERSIONS.rvv11;
    const text = data[currentBibleVerKey] || data.rvv11;

    if (bibleSearchQuery) {
      bibleSearchQuery.textContent = currentBibleRef;
    }
    if (verseRefTitle) {
      verseRefTitle.textContent = `${currentBibleRef.toUpperCase()} • ${ver.name}`;
    }
    if (verseCountLabel) {
      verseCountLabel.textContent = data.count;
    }
    if (verseTextContent) {
      if (animate) {
        verseTextContent.style.opacity = '0.3';
        verseTextContent.style.transform = 'translateY(3px)';
        setTimeout(() => {
          verseTextContent.textContent = `"${text}"`;
          verseTextContent.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          verseTextContent.style.opacity = '1';
          verseTextContent.style.transform = 'translateY(0)';
        }, 80);
      } else {
        verseTextContent.textContent = `"${text}"`;
      }
    }
  }

  bibleVerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const verKey = tab.getAttribute('data-ver');
      if (!BIBLE_VERSIONS[verKey]) return;
      bibleVerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentBibleVerKey = verKey;
      renderBibleVerse(true);
    });
  });

  bibleSugChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const ref = chip.getAttribute('data-ref');
      if (ref && BIBLE_DATABASE[ref]) {
        currentBibleRef = ref;
        bibleSugChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderBibleVerse(true);
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
     9. Operator Portal & Kênh Band Management (#get-account / #auth-portal)
     ======================================================================== */
  const IDENTITY_API_BASE = 'https://identity.worship-official.link';
  const OP_SESSION_KEY = 'kenhband_operator_session';

  // Tabs & Views
  const portalTabBar = document.getElementById('portalTabBar');
  const portalTabBtnLogin = document.getElementById('portalTabBtnLogin') || document.getElementById('tabBtnLogin');
  const portalTabBtnRegister = document.getElementById('portalTabBtnRegister') || document.getElementById('tabBtnRegister');
  const portalViewLogin = document.getElementById('portalViewLogin');
  const portalViewRegister = document.getElementById('portalViewRegister');
  const portalViewNewPassword = document.getElementById('portalViewNewPassword');
  const portalViewCreateRoom = document.getElementById('portalViewCreateRoom');
  const portalViewDashboard = document.getElementById('portalViewDashboard');
  const portalStatus = document.getElementById('portalStatus');

  // Forms & Buttons
  const portalLoginForm = document.getElementById('portalLoginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const btnForgotPass = document.getElementById('btnForgotPass');
  const btnRegisterForgotPass = document.getElementById('btnRegisterForgotPass');
  const btnSwitchToRegister = document.getElementById('btnSwitchToRegister');
  const btnSwitchToLogin = document.getElementById('btnSwitchToLogin');

  const portalRegisterForm = document.getElementById('portalRegisterForm');
  const regName = document.getElementById('regName');
  const regPhone = document.getElementById('regPhone');
  const regEmail = document.getElementById('regEmail');
  const regChurch = document.getElementById('regChurch');
  const regArea = document.getElementById('regArea');
  const btnRegisterSubmit = document.getElementById('btnRegisterSubmit');

  const portalNewPasswordForm = document.getElementById('portalNewPasswordForm');
  const newPasswordInput = document.getElementById('newPasswordInput');
  const newPasswordConfirmInput = document.getElementById('newPasswordConfirmInput');
  const btnNewPasswordSubmit = document.getElementById('btnNewPasswordSubmit');

  const portalCreateRoomForm = document.getElementById('portalCreateRoomForm');
  const createRoomName = document.getElementById('createRoomName');
  const createRoomPassword = document.getElementById('createRoomPassword');
  const createRoomPasswordConfirm = document.getElementById('createRoomPasswordConfirm');
  const btnCreateRoomSubmit = document.getElementById('btnCreateRoomSubmit');

  // Dashboard Elements
  const dashAvatar = document.getElementById('dashAvatar');
  const dashOpName = document.getElementById('dashOpName');
  const dashOpChurch = document.getElementById('dashOpChurch');
  const btnLogout = document.getElementById('btnLogout');
  const dashRoomName = document.getElementById('dashRoomName');
  const dashRoomCode = document.getElementById('dashRoomCode');
  const dashRoomPassword = document.getElementById('dashRoomPassword');
  const btnCopyRoomCode = document.getElementById('btnCopyRoomCode');
  const btnToggleRoomPassword = document.getElementById('btnToggleRoomPassword');
  const dashJoinLink = document.getElementById('dashJoinLink');
  const btnCopyJoinLink = document.getElementById('btnCopyJoinLink');

  // User Management Elements
  const dashUsersCount = document.getElementById('dashUsersCount');
  const formCreateUser = document.getElementById('formCreateUser');
  const newUserName = document.getElementById('newUserName');
  const newUserUsername = document.getElementById('newUserUsername');
  const newUserPassword = document.getElementById('newUserPassword');
  const newUserPasswordConfirm = document.getElementById('newUserPasswordConfirm');
  const btnCreateUserSubmit = document.getElementById('btnCreateUserSubmit');
  const dashUsersList = document.getElementById('dashUsersList');

  // In-memory Auth State
  let pendingNewPasswordAuth = null; // { email, session }
  let currentSession = null;
  let isPasswordMasked = true;

  function showPortalStatus(msg, type = 'ok', duration = 7000, isHtml = false) {
    if (!portalStatus) return;
    if (isHtml) {
      portalStatus.innerHTML = msg;
    } else {
      portalStatus.textContent = msg;
    }
    portalStatus.className = `account-request-status ${type}`;
    if (duration > 0) {
      setTimeout(() => {
        if (portalStatus.innerHTML === msg || portalStatus.textContent === msg) {
          portalStatus.textContent = '';
          portalStatus.className = 'account-request-status';
        }
      }, duration);
    }
  }

  function clearPortalStatus() {
    if (!portalStatus) return;
    portalStatus.textContent = '';
    portalStatus.className = 'account-request-status';
  }

  function setView(viewName) {
    clearPortalStatus();
    const views = [
      portalViewLogin,
      portalViewRegister,
      portalViewNewPassword,
      portalViewCreateRoom,
      portalViewDashboard
    ];
    views.forEach(v => v && v.classList.add('portal-hidden'));

    if (portalTabBar) {
      if (viewName === 'login' || viewName === 'register') {
        portalTabBar.style.display = 'flex';
        const activeLoginBtn = document.getElementById('portalTabBtnLogin') || document.getElementById('tabBtnLogin');
        const activeRegBtn = document.getElementById('portalTabBtnRegister') || document.getElementById('tabBtnRegister');
        if (activeLoginBtn) activeLoginBtn.classList.toggle('active', viewName === 'login');
        if (activeRegBtn) activeRegBtn.classList.toggle('active', viewName === 'register');
      } else {
        portalTabBar.style.display = 'none';
      }
    }

    if (viewName === 'login' && portalViewLogin) portalViewLogin.classList.remove('portal-hidden');
    if (viewName === 'register' && portalViewRegister) portalViewRegister.classList.remove('portal-hidden');
    if (viewName === 'newPassword' && portalViewNewPassword) portalViewNewPassword.classList.remove('portal-hidden');
    if (viewName === 'createRoom' && portalViewCreateRoom) portalViewCreateRoom.classList.remove('portal-hidden');
    if (viewName === 'dashboard' && portalViewDashboard) portalViewDashboard.classList.remove('portal-hidden');
  }

  // Delegated Tab Switching on container + direct button events
  if (portalTabBar) {
    portalTabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.portal-tab-btn');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab') || (btn.id.toLowerCase().includes('register') ? 'register' : 'login');
      setView(tab);
    });
  }

  const loginBtnDirect = document.getElementById('portalTabBtnLogin') || document.getElementById('tabBtnLogin');
  if (loginBtnDirect) {
    loginBtnDirect.addEventListener('click', () => setView('login'));
  }
  const regBtnDirect = document.getElementById('portalTabBtnRegister') || document.getElementById('tabBtnRegister');
  if (regBtnDirect) {
    regBtnDirect.addEventListener('click', () => setView('register'));
  }
  if (btnSwitchToRegister) {
    btnSwitchToRegister.addEventListener('click', () => setView('register'));
  }
  if (btnSwitchToLogin) {
    btnSwitchToLogin.addEventListener('click', () => setView('login'));
  }

  async function triggerForgotPassword(targetEmail) {
    const email = (targetEmail || (loginEmail && loginEmail.value) || '').trim().toLowerCase() || prompt('Nhập địa chỉ email tài khoản Operator của bạn:');
    if (!email) return;
    setView('login');
    if (loginEmail) loginEmail.value = email;
    showPortalStatus('Đang gửi yêu cầu cấp lại mật khẩu tạm...', 'ok', 4000);
    try {
      const res = await fetch(`${IDENTITY_API_BASE}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPortalStatus(data.error || 'Không thể gửi yêu cầu cấp lại mật khẩu. Thử lại sau.', 'err');
        return;
      }
      showPortalStatus('✓ Mật khẩu tạm mới đã được cấp và gửi tới email của bạn. Vui lòng kiểm tra hộp thư (cả mục Thư rác / Spam) để đăng nhập và đổi mật khẩu.', 'ok', 14000);
    } catch (err) {
      showPortalStatus('Không thể kết nối máy chủ xác thực.', 'err');
    }
  }

  if (btnForgotPass) {
    btnForgotPass.addEventListener('click', () => triggerForgotPassword());
  }
  if (btnRegisterForgotPass) {
    btnRegisterForgotPass.addEventListener('click', () => {
      const currentEmail = (regEmail && regEmail.value || '').trim();
      triggerForgotPassword(currentEmail);
    });
  }

  // 1. REGISTER OPERATOR (5 FIELDS)
  if (portalRegisterForm) {
    portalRegisterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPortalStatus();

      const name = (regName && regName.value || '').trim();
      const phone = (regPhone && regPhone.value || '').trim();
      const email = (regEmail && regEmail.value || '').trim().toLowerCase();
      const church = (regChurch && regChurch.value || '').trim();
      const area = (regArea && regArea.value || '').trim();

      if (!name || !phone || !email || !church || !area) {
        showPortalStatus('Vui lòng điền đầy đủ cả 5 thông tin đăng ký.', 'err');
        return;
      }

      btnRegisterSubmit.disabled = true;
      const btnSpan = btnRegisterSubmit.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : '';
      if (btnSpan) btnSpan.textContent = 'Đang khởi tạo tài khoản...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, email, church, area })
        });
        const data = await res.json().catch(() => ({}));

        btnRegisterSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;

        if (!res.ok || !data.ok) {
          const isUserAlreadyExists = data.exists || res.status === 409 || (data.error && (data.error.includes('đã tồn tại') || data.error.includes('đã được')));
          if (isUserAlreadyExists) {
            const errorHtml = `
              <div style="line-height: 1.5;">
                <div>⚠️ <strong>Tài khoản với email này đã tồn tại trên hệ thống.</strong></div>
                <div style="font-size: 0.88rem; margin: 6px 0;">Nếu quên mật khẩu, hãy nhấp bên dưới để nhận mật khẩu tạm mới hoặc đăng nhập:</div>
                <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                  <button type="button" id="btnStatusForgotAction" style="background: var(--gold); color: #000; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 4px;">
                    🔑 Quên Mật Khẩu (Cấp Mới)
                  </button>
                  <button type="button" id="btnStatusLoginAction" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.25); padding: 6px 12px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.82rem;">
                    ➡️ Đăng Nhập Ngay
                  </button>
                </div>
              </div>
            `;
            showPortalStatus(errorHtml, 'err', 0, true);

            const btnStatusForgot = document.getElementById('btnStatusForgotAction');
            if (btnStatusForgot) {
              btnStatusForgot.addEventListener('click', () => {
                triggerForgotPassword(email);
              });
            }
            const btnStatusLogin = document.getElementById('btnStatusLoginAction');
            if (btnStatusLogin) {
              btnStatusLogin.addEventListener('click', () => {
                setView('login');
                if (loginEmail) loginEmail.value = email;
                if (loginPassword) loginPassword.focus();
              });
            }
            return;
          }

          showPortalStatus(data.error || 'Đăng ký không thành công. Vui lòng kiểm tra lại thông tin.', 'err');
          return;
        }

        // Registration successful
        portalRegisterForm.reset();
        if (loginEmail) loginEmail.value = email;
        setView('login');
        const alertMsg = data.message || (data.isExisting
          ? 'ℹ️ Email này đã từng được đăng ký trong hệ thống. Một mật khẩu tạm mới vừa được cấp và gửi tới hộp thư của bạn (vui lòng kiểm tra cả mục Thư rác / Spam) để bạn đăng nhập.'
          : '🎉 Đăng ký thành công! Mật khẩu tạm đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư (cả mục Thư rác / Spam) để đăng nhập và đổi mật khẩu.');
        showPortalStatus(alertMsg, 'ok', 14000);
      } catch (err) {
        btnRegisterSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
        showPortalStatus('Không thể kết nối máy chủ xác thực. Vui lòng kiểm tra kết nối mạng.', 'err');
      }
    });
  }

  // 2. LOGIN OPERATOR
  if (portalLoginForm) {
    portalLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPortalStatus();

      const email = (loginEmail && loginEmail.value || '').trim().toLowerCase();
      const password = (loginPassword && loginPassword.value || '');

      if (!email || !password) {
        showPortalStatus('Vui lòng nhập email và mật khẩu.', 'err');
        return;
      }

      btnLoginSubmit.disabled = true;
      const btnSpan = btnLoginSubmit.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : '';
      if (btnSpan) btnSpan.textContent = 'Đang đăng nhập...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));

        btnLoginSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;

        if (!res.ok) {
          showPortalStatus(data.error || 'Email hoặc mật khẩu không chính xác.', 'err');
          return;
        }

        // Handle Cognito Challenge: NEW_PASSWORD_REQUIRED
        if (data.challenge === 'NEW_PASSWORD_REQUIRED') {
          pendingNewPasswordAuth = { email, session: data.session };
          setView('newPassword');
          showPortalStatus('Đây là lần đăng nhập đầu tiên. Vui lòng đặt mật khẩu mới (tối thiểu 8 ký tự).', 'ok', 8000);
          return;
        }

        if (!data.idToken) {
          showPortalStatus(data.error || 'Đăng nhập thất bại, vui lòng thử lại.', 'err');
          return;
        }

        // Login Success
        currentSession = {
          email,
          idToken: data.idToken,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          operator: data.operator || { email, name: email.split('@')[0] },
          room: data.room || null
        };
        saveSession(currentSession);

        if (!currentSession.room || !currentSession.room.code) {
          setView('createRoom');
          showPortalStatus('Bạn chưa có phòng Kênh Band cố định. Hãy tạo phòng ngay bên dưới.', 'ok', 6000);
        } else {
          showPortalStatus('✓ Đăng nhập thành công! Đang chuyển hướng sang Bảng Quản Lý Kênh Band...', 'ok', 3000);
          setTimeout(() => {
            window.location.href = 'portal.html';
          }, 350);
        }
      } catch (err) {
        btnLoginSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
        showPortalStatus('Không thể kết nối máy chủ xác thực. Kiểm tra mạng rồi thử lại.', 'err');
      }
    });
  }

  // 3. FIRST-TIME PASSWORD CHANGE
  if (portalNewPasswordForm) {
    portalNewPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPortalStatus();

      if (!pendingNewPasswordAuth || !pendingNewPasswordAuth.session) {
        showPortalStatus('Phiên đổi mật khẩu đã hết hạn, vui lòng đăng nhập lại.', 'err');
        setView('login');
        return;
      }

      const newPass = (newPasswordInput && newPasswordInput.value || '');
      const confirmPass = (newPasswordConfirmInput && newPasswordConfirmInput.value || '');

      if (newPass.length < 8) {
        showPortalStatus('Mật khẩu mới phải có tối thiểu 8 ký tự.', 'err');
        return;
      }
      if (newPass !== confirmPass) {
        showPortalStatus('Xác nhận mật khẩu mới không khớp.', 'err');
        return;
      }

      btnNewPasswordSubmit.disabled = true;
      const btnSpan = btnNewPasswordSubmit.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : '';
      if (btnSpan) btnSpan.textContent = 'Đang lưu mật khẩu mới...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: pendingNewPasswordAuth.email,
            session: pendingNewPasswordAuth.session,
            newPassword: newPass
          })
        });
        const data = await res.json().catch(() => ({}));

        btnNewPasswordSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;

        if (!res.ok || (!data.ok && !data.idToken)) {
          showPortalStatus(data.error || 'Không đổi được mật khẩu. Vui lòng thử lại.', 'err');
          return;
        }

        const email = pendingNewPasswordAuth.email;
        pendingNewPasswordAuth = null;
        portalNewPasswordForm.reset();

        currentSession = {
          email,
          idToken: data.idToken,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          operator: data.operator || { email, name: email.split('@')[0] },
          room: data.room || null
        };
        saveSession(currentSession);

        if (!currentSession.room || !currentSession.room.code) {
          setView('createRoom');
          showPortalStatus('✓ Đổi mật khẩu thành công! Giờ hãy khởi tạo phòng riêng cố định cho Kênh Band của bạn.', 'ok', 8000);
        } else {
          showPortalStatus('✓ Đổi mật khẩu thành công! Đang chuyển hướng sang Bảng Quản Lý...', 'ok', 3000);
          setTimeout(() => {
            window.location.href = 'portal.html';
          }, 350);
        }
      } catch (err) {
        btnNewPasswordSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
        showPortalStatus('Không thể kết nối máy chủ xác thực. Kiểm tra mạng rồi thử lại.', 'err');
      }
    });
  }

  // 4. CREATE PERMANENT ROOM (1 ACCOUNT = 1 ROOM)
  if (portalCreateRoomForm) {
    portalCreateRoomForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPortalStatus();

      if (!currentSession || !currentSession.idToken) {
        showPortalStatus('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'err');
        setView('login');
        return;
      }

      const name = (createRoomName && createRoomName.value || '').trim();
      const password = (createRoomPassword && createRoomPassword.value || '').trim();
      const passwordConfirm = (createRoomPasswordConfirm && createRoomPasswordConfirm.value || '').trim();

      if (!name) {
        showPortalStatus('Vui lòng nhập tên phòng.', 'err');
        return;
      }
      if (password.length < 4 || password.length > 12) {
        showPortalStatus('Mật khẩu phòng từ 4 đến 12 ký tự.', 'err');
        return;
      }
      if (password !== passwordConfirm) {
        showPortalStatus('Xác nhận mật khẩu phòng không khớp.', 'err');
        return;
      }

      btnCreateRoomSubmit.disabled = true;
      const btnSpan = btnCreateRoomSubmit.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : '';
      if (btnSpan) btnSpan.textContent = 'Đang khởi tạo phòng...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/room`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.idToken}`
          },
          body: JSON.stringify({ name, password, email: currentSession.email })
        });
        const data = await res.json().catch(() => ({}));

        btnCreateRoomSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;

        if (!res.ok || !data.ok) {
          showPortalStatus(data.error || 'Không thể tạo phòng. Thử lại sau.', 'err');
          return;
        }

        currentSession.room = data.room;
        saveSession(currentSession);
        portalCreateRoomForm.reset();

        showPortalStatus('🎉 Khởi tạo phòng cố định thành công! Đang chuyển hướng sang Bảng Quản Lý...', 'ok', 3000);
        setTimeout(() => {
          window.location.href = 'portal.html';
        }, 350);
      } catch (err) {
        btnCreateRoomSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
        showPortalStatus('Không thể kết nối máy chủ. Kiểm tra kết nối mạng rồi thử lại.', 'err');
      }
    });
  }

  // 5. DASHBOARD & GLOBAL USER MANAGEMENT
  function renderDashboard(session) {
    if (!session) return;
    const op = session.operator || {};
    const room = session.room || {};

    if (dashOpName) dashOpName.textContent = op.name || session.email;
    if (dashOpChurch) dashOpChurch.textContent = `${op.church || 'Hội Thánh'} • ${op.area || 'Việt Nam'}`;
    if (dashAvatar) {
      const initials = (op.name || 'OP').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      dashAvatar.textContent = initials || 'OP';
    }

    if (dashRoomName) dashRoomName.textContent = room.name || 'Phòng Kênh Band';
    if (dashRoomCode) dashRoomCode.textContent = room.code || '------';
    if (dashRoomPassword) {
      dashRoomPassword.textContent = isPasswordMasked ? '••••••' : (room.password || '');
    }

    const joinUrl = `https://channel.worship-official.link/m/?room=${room.code || ''}`;
    if (dashJoinLink) dashJoinLink.textContent = joinUrl;
  }

  // Password toggle in room card
  if (btnToggleRoomPassword) {
    btnToggleRoomPassword.addEventListener('click', () => {
      isPasswordMasked = !isPasswordMasked;
      if (dashRoomPassword && currentSession && currentSession.room) {
        dashRoomPassword.textContent = isPasswordMasked ? '••••••' : (currentSession.room.password || '');
      }
      btnToggleRoomPassword.textContent = isPasswordMasked ? '👁️' : '🔒';
    });
  }

  // Copy Room Code
  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener('click', () => {
      if (!currentSession || !currentSession.room || !currentSession.room.code) return;
      navigator.clipboard.writeText(currentSession.room.code).then(() => {
        btnCopyRoomCode.textContent = '✓ Copied';
        setTimeout(() => { btnCopyRoomCode.textContent = 'Copy'; }, 1800);
      });
    });
  }

  // Copy Join Link
  if (btnCopyJoinLink) {
    btnCopyJoinLink.addEventListener('click', () => {
      if (!dashJoinLink) return;
      navigator.clipboard.writeText(dashJoinLink.textContent).then(() => {
        btnCopyJoinLink.textContent = '✓ Đã sao chép';
        setTimeout(() => { btnCopyJoinLink.textContent = 'Copy Link'; }, 1800);
      });
    });
  }

  // Load Band Member Users
  async function loadBandUsers() {
    if (!currentSession || !currentSession.idToken || !dashUsersList) return;
    try {
      const emailParam = currentSession.email ? `?email=${encodeURIComponent(currentSession.email)}` : '';
      const res = await fetch(`${IDENTITY_API_BASE}/operator/users${emailParam}`, {
        headers: { 'Authorization': `Bearer ${currentSession.idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;

      const users = data.users || [];
      if (dashUsersCount) dashUsersCount.textContent = `${users.length} thành viên`;

      if (users.length === 0) {
        dashUsersList.innerHTML = '<div class="portal-empty-users">Chưa có user ban nhạc nào. Hãy tạo tài khoản đầu tiên ở trên!</div>';
        return;
      }

      dashUsersList.innerHTML = '';
      users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'portal-user-row';
        row.innerHTML = `
          <div class="portal-user-left">
            <span class="portal-user-badge">👤</span>
            <div class="portal-user-info">
              <strong>${escapeHtml(u.name || u.username)}</strong>
              <span>@${escapeHtml(u.username)}</span>
            </div>
          </div>
          <button type="button" class="btn-del-user" data-username="${escapeHtml(u.username)}" title="Xoá user">
            🗑️ Xoá
          </button>
        `;

        const delBtn = row.querySelector('.btn-del-user');
        if (delBtn) {
          delBtn.addEventListener('click', () => deleteBandUser(u.username));
        }

        dashUsersList.appendChild(row);
      });
    } catch (e) {
      console.error('Failed to load band users:', e);
    }
  }

  // Create Band Member User
  if (formCreateUser) {
    formCreateUser.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPortalStatus();

      if (!currentSession || !currentSession.idToken) {
        showPortalStatus('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'err');
        return;
      }

      const name = (newUserName && newUserName.value || '').trim();
      const username = (newUserUsername && newUserUsername.value || '').trim().toLowerCase();
      const password = (newUserPassword && newUserPassword.value || '');
      const confirmPassword = (newUserPasswordConfirm && newUserPasswordConfirm.value || '');

      if (!name || !username || !password) {
        showPortalStatus('Vui lòng nhập đầy đủ thông tin thành viên.', 'err');
        return;
      }
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        showPortalStatus('Tên tài khoản (username) 3-32 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới.', 'err');
        return;
      }
      if (password.length < 6) {
        showPortalStatus('Mật khẩu thành viên tối thiểu 6 ký tự.', 'err');
        return;
      }
      if (password !== confirmPassword) {
        showPortalStatus('Xác nhận mật khẩu thành viên không khớp.', 'err');
        return;
      }

      btnCreateUserSubmit.disabled = true;
      const btnSpan = btnCreateUserSubmit.querySelector('span');
      const origText = btnSpan ? btnSpan.textContent : '';
      if (btnSpan) btnSpan.textContent = 'Đang tạo user...';

      try {
        const res = await fetch(`${IDENTITY_API_BASE}/operator/users/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.idToken}`
          },
          body: JSON.stringify({ name, username, password, email: currentSession.email })
        });
        const data = await res.json().catch(() => ({}));

        btnCreateUserSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = origText;

        if (!res.ok || !data.ok) {
          showPortalStatus(data.error || 'Không tạo được user.', 'err');
          return;
        }

        formCreateUser.reset();
        showPortalStatus(`✓ Đã tạo thành công user @${username}! User này có thể tham gia bất kỳ phòng Kênh Band nào.`, 'ok', 6000);
        loadBandUsers();
      } catch (err) {
        btnCreateUserSubmit.disabled = false;
        if (btnSpan) btnSpan.textContent = origText;
        showPortalStatus('Không thể kết nối máy chủ tạo user.', 'err');
      }
    });
  }

  // Delete Band Member User
  async function deleteBandUser(username) {
    if (!currentSession || !currentSession.idToken || !username) return;
    if (!confirm(`Bạn có chắc chắn muốn xoá tài khoản user @${username}?`)) return;

    try {
      const res = await fetch(`${IDENTITY_API_BASE}/operator/users/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.idToken}`
        },
        body: JSON.stringify({ username, email: currentSession.email })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        showPortalStatus(data.error || 'Không thể xoá user.', 'err');
        return;
      }

      showPortalStatus(`✓ Đã xoá tài khoản @${username}.`, 'ok', 4000);
      loadBandUsers();
    } catch (e) {
      showPortalStatus('Lỗi kết nối khi xoá user.', 'err');
    }
  }

  // Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      clearSession();
      currentSession = null;
      if (portalLoginForm) portalLoginForm.reset();
      setView('login');
      showPortalStatus('Bạn đã đăng xuất khỏi Operator Portal.', 'ok', 4000);
    });
  }

  // Session storage helpers
  function saveSession(session) {
    try {
      localStorage.setItem(OP_SESSION_KEY, JSON.stringify(session));
    } catch (e) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(OP_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    try {
      localStorage.removeItem(OP_SESSION_KEY);
    } catch (e) {}
  }

  // Initialize Portal State from Local Storage
  const savedSession = loadSession();
  if (savedSession && savedSession.idToken) {
    currentSession = savedSession;

    // Update navbar item to link to portal.html
    const navLoginItem = document.getElementById('navItemLogin') || document.querySelector('a[href="#get-account"]');
    if (navLoginItem) {
      navLoginItem.href = 'portal.html';
      navLoginItem.innerHTML = 'Quản Lý (Dashboard)';
      navLoginItem.title = 'Mở Bảng Điều Khiển Kênh Band (Operator Dashboard)';
    }

    if (savedSession.room && savedSession.room.code) {
      renderDashboard(savedSession);
      setView('dashboard');
    } else {
      setView('createRoom');
    }
  } else {
    setView('login');
  }

  /* Utility: Escape HTML */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

});
