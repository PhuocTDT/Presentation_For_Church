
/**
 * Main application logic for the Presentation app.
 * Handles state management, UI rendering, and IPC communication.
 */

// --- Global State ---
let songLibrary = [];
let bibleVersions = [];
let bibleLibrary = [];    // Current active Bible version chapters
let savedBibleList = [];  // Dynamic Bible edits from bible.json
let schedule = [];
let mediaLibrary = [];
let currentLibraryTab = 'songs';
let systemFonts = [];

let currentEditingSong = null;
let currentScheduleIndex = -1;
let currentSlides = [];
let currentPreviewIndex = -1;
let currentLiveScheduleIndex = -1;
let currentLiveSlideIndex = -1;
let isLiveWindowOpen = false;

// State cho các màn hình khác nhau
let currentPreviewStyle = null; // Style của bài hiện đang ở preview
let currentLiveStyle = null;    // Style của bài hiện đang ở live
let currentPreviewBackground = null; // Background đang hiển thị ở preview
let currentLiveBackground = null; // Background đang phát ở live/screen live
let shortcutActionMap = {};
let editorStyle = {}; // Style being edited in the modal

const PRIMARY_SHORTCUT_KEY = isMacPlatform() ? 'Cmd' : 'Ctrl';

const SHORTCUT_ACTIONS = [
    { id: 'open-settings', label: 'Mở Cài đặt (Settings)' },
    { id: 'import-file', label: 'Nhập file (Import)' },
    { id: 'save-schedule', label: 'Lưu Schedule' },
    { id: 'open-schedule', label: 'Mở Schedule' },
    { id: 'toggle-live-window', label: 'Trình chiếu Live (Bật/Tắt)' },
    { id: 'clear-live', label: 'Xóa màn hình Live' },
    { id: 'add-selected-to-schedule', label: 'Thêm vào Schedule' },
    { id: 'remove-selected-from-schedule', label: 'Xóa khỏi Schedule' },
    { id: 'focus-search', label: 'Tìm kiếm' },
    { id: 'go-preview', label: 'Xem trước (Preview)' },
    { id: 'go-live', label: 'Trình chiếu (Live)' },
    { id: 'live-current', label: 'Live hiện tại' },
    { id: 'background-1', label: 'Hình nền 1' },
    { id: 'background-2', label: 'Hình nền 2' },
    { id: 'tab-bible', label: 'Tab Kinh Thánh' },
    { id: 'tab-song', label: 'Tab Bài hát' },
    { id: 'new-schedule', label: 'Tạo Schedule mới' },
    { id: 'new-song', label: 'Tạo Bài hát mới' },
    { id: 'import-media', label: 'Nhập Media' },
    { id: 'quit-app', label: 'Thoát ứng dụng' },
    { id: 'close-live-window', label: 'Tắt màn hình Live' },
    { id: 'next-slide', label: 'Slide tiếp theo' },
    { id: 'prev-slide', label: 'Slide trước đó' }
];

const DEFAULT_SHORTCUT_ROWS = [
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'O', action: 'import-file' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'S', action: 'save-schedule' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'L', action: 'toggle-live-window' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'Esc', action: 'close-live-window' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'H', action: 'clear-live' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: 'Shift', key3: 'A', action: 'add-selected-to-schedule' },
    { key1: '', key2: '', key3: 'Delete', action: 'remove-selected-from-schedule' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'F', action: 'focus-search' },
    { key1: '', key2: '', key3: 'ArrowRight', action: 'next-slide' },
    { key1: '', key2: '', key3: 'ArrowLeft', action: 'prev-slide' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: 'Enter', action: 'go-preview' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: 'Shift', key3: 'Enter', action: 'go-live' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: '1', action: 'tab-bible' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: '', key3: '2', action: 'tab-song' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: 'Alt', key3: '1', action: 'background-1' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: 'Alt', key3: '2', action: 'background-2' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: 'Shift', key3: 'Q', action: 'quit-app' },
    { key1: PRIMARY_SHORTCUT_KEY, key2: 'Shift', key3: 'P', action: 'open-settings' }
];

function createDefaultGlobalSettings() {
    return {
        theme: 'dark',
        gpuAcceleration: true,
        fontFamilySong: 'CMG Sans',
        fontFamilyBible: 'Times New Roman',
        fontSize: '80px',
        color: '#ffffff',
        fontWeight: 'bold',
        textAlign: 'center',
        verticalAlign: 'middle',
        textStrokeWidth: 5,
        textStrokeColor: '#000000',
        textMargin: { top: 0, right: 0, bottom: 0, left: 0 },
        textPadding: { top: 0, right: 0, bottom: 0, left: 0 },
        mediaPath: '',
        shortcuts: {
            nextSlide: 'ArrowRight',
            prevSlide: 'ArrowLeft',
            clearScreen: 'Escape'
        },
        defaultShortcutRows: DEFAULT_SHORTCUT_ROWS.map(row => ({ ...row })),
        customShortcuts: [
            { key1: '', key2: '', key3: '', action: '' },
            { key1: '', key2: '', key3: '', action: '' },
            { key1: '', key2: '', key3: '', action: '' }
        ]
    };
}

let globalSettings = createDefaultGlobalSettings();

// --- Initialization ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    loadLibrary();
    loadBibleVersions();
    loadMedia();
    setTimeout(loadSystemFonts, 0);

    const scheduleContainer = document.getElementById('schedule-container');
    if (scheduleContainer) {
        scheduleContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        scheduleContainer.addEventListener('drop', (e) => {
            if (e.target.closest('[data-schedule-item]')) return;
            e.preventDefault();
            try {
                const mediaItem = JSON.parse(e.dataTransfer.getData('application/json'));
                addMediaToSchedule(mediaItem);
            } catch (err) { console.error('Schedule drop error:', err); }
        });
    }

    // Initialize resizers
    setTimeout(() => {
        const topRow = document.getElementById('top-row');
        const bottomRow = document.getElementById('bottom-row');
        if (!topRow || !bottomRow) return;
        const panelsTop = topRow.querySelectorAll('.panel');
        const panelsBottom = bottomRow.querySelectorAll('.panel');
        setupResizer('resizer-1', panelsTop[0], panelsTop[1]);
        setupResizer('resizer-2', panelsTop[1], panelsTop[2]);
        setupResizer('resizer-v-1', topRow, bottomRow, true);
        setupResizer('resizer-3', panelsBottom[0], panelsBottom[1]);
    }, 100);
});

async function loadSettings() {
    const saved = await window.electronAPI.loadSettings();
    if (saved) {
        globalSettings = mergeGlobalSettings(saved);
    }
    rebuildShortcutActionMap();
    applySettings();
}

function applySettings() {
    if (globalSettings.theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    
    if (currentScheduleIndex >= 0 && schedule[currentScheduleIndex]) {
        loadToPreview(schedule[currentScheduleIndex]);
    }
    if (currentLiveScheduleIndex >= 0 && schedule[currentLiveScheduleIndex]) {
        const liveText = document.getElementById('live-lyrics-text');
        if (liveText) {
            applyStyleToElement(liveText, currentLiveStyle);
        }
    }
}

async function loadBibleVersions() {
    try {
        bibleVersions = await window.electronAPI.loadBibleVersions();
        const preferredVersion = currentBibleVersionFileName || (bibleVersions[0] && bibleVersions[0].fileName) || null;
        
        const select = document.getElementById('bible-version-select');
        if (select) {
            select.innerHTML = '';
            bibleVersions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.fileName;
                opt.textContent = v.displayName || v.name;
                select.appendChild(opt);
            });
            if (preferredVersion) select.value = preferredVersion;
        }

        const status = document.getElementById('bible-version-status');
        const activeVersionName = preferredVersion
            ? (bibleVersions.find(v => v.fileName === preferredVersion)?.displayName || preferredVersion)
            : 'Chưa chọn bản dịch';
        if (status) status.textContent = `Đang dùng: ${activeVersionName}`;
        
        if (bibleVersions.length > 0 && bibleLibrary.length === 0) {
            await changeBibleVersion(currentBibleVersionFileName || bibleVersions[0].fileName);
        }
        renderLibrary();
    } catch (e) { console.error(e); }
}

async function changeBibleVersion(fileName) {
    if (!fileName) return;
    currentBibleVersionFileName = fileName;
    try {
        const data = await window.electronAPI.loadBibleParsed(fileName);
        bibleLibrary = data || [];
        renderLibrary();
        const status = document.getElementById('bible-version-status');
        const activeVersion = bibleVersions.find(v => v.fileName === fileName);
        if (status) status.textContent = activeVersion ? `Đang dùng: ${activeVersion.displayName || activeVersion.name}` : `Đang dùng: ${fileName}`;
    } catch (e) { console.error(e); }
}

function selectScheduleItem(index) {
    currentScheduleIndex = index;
    renderSchedule();
    loadToPreview(schedule[index]);
}

function loadToPreview(song) {
    if (song.isMediaOnly || (!song.lyrics && song.background)) {
        currentSlides = [{ content: '', label: '', isBible: false }];
        currentPreviewIndex = 0;
        renderPreview();
        updatePreviewOutput('');
        if (song.background) previewBackground(song.background);
        return;
    }

    currentPreviewStyle = normalizeSlideStyle(song.style, {}, song.type === 'bible' ? 'bible' : 'song');
    if (song.type === 'bible' && (!song.style || !song.style.fontSize)) {
        currentPreviewStyle = normalizeSlideStyle(currentPreviewStyle, { fontSize: '48px' });
    }

    const lyrics = song.lyrics || "";
    if (song.type === 'bible') {
        currentSlides = lyrics.split(/\n\n/).filter(s => s.trim() !== "").map(s => ({ content: s.trim(), label: '', isBible: true }));
    } else {
        currentSlides = lyrics.split(/\n\s*\n/).filter(s => s.trim() !== "").map(s => {
            const parsed = stripLabel(s.trim());
            return { content: parsed.content, label: parsed.label, isBible: false };
        });
    }

    currentPreviewIndex = 0;
    renderPreview();
    if (currentSlides.length > 0) updatePreviewOutput(currentSlides[0].content);
}

function renderPreview() {
    const container = document.getElementById('preview-slides-container');
    if (!container) return;
    container.innerHTML = '';
    currentSlides.forEach((slide, index) => {
        const div = document.createElement('div');
        const isActive = index === currentPreviewIndex;
        const labelColor = getLabelColor(slide.label);
        div.className = `rounded-md overflow-hidden bg-white dark:bg-slate-900 shadow-sm cursor-pointer`;
        div.innerHTML = `
            <div class="${isActive ? 'bg-indigo-600' : 'bg-slate-500'} text-white px-2 py-0.5 text-[9px] font-bold uppercase" ${labelColor ? `style="background-color:${labelColor}"` : ''}>
                ${slide.label || `Slide ${index + 1}`}
            </div>
            <div class="p-2 text-xs ${isActive ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-700 dark:text-slate-300'}" ${isActive ? 'style="background-color:#b3e4ff"' : ''}>
                ${slide.content.replace(/\n/g, '<br/>')}
            </div>
        `;
        div.onclick = () => { currentPreviewIndex = index; renderPreview(); updatePreviewOutput(currentSlides[index].content); };
        container.appendChild(div);
    });
}

function updatePreviewOutput(content) {
    const previewText = document.getElementById('preview-lyrics-text');
    if (previewText) {
        previewText.innerText = content;
        applyStyleToElement(previewText, currentPreviewStyle);
    }
    scaleVirtualCanvas('preview-virtual-canvas', 'preview-output-box');
}

function goLiveSlide(index) {
    currentLiveIndex = index;
    currentLiveSlideIndex = index;
    const slide = liveSlides[index];
    updateLiveOutput(slide.content);
    renderLiveSlides();

    const scheduleItem = schedule[currentLiveScheduleIndex];
    const background = (scheduleItem && scheduleItem.background) ? scheduleItem.background : (currentLiveBackground || null);
    updateInAppLiveBackground(background);
    
    window.electronAPI.liveSendContent(prepareLivePayload({ text: slide.content, background: background }));
}

function prepareLivePayload(data = {}) {
    const payload = { ...data };
    payload.style = normalizeSlideStyle(payload.style || currentLiveStyle || {});
    if (data.hasOwnProperty('background')) payload.background = normalizeSlideBackground(payload.background);
    return payload;
}

function updateLiveOutput(content) {
    const liveOutputText = document.getElementById('live-lyrics-text');
    if (liveOutputText) {
        liveOutputText.innerText = content;
        applyStyleToElement(liveOutputText, currentLiveStyle);
    }
    scaleVirtualCanvas('live-virtual-canvas', 'live-output-box');
}

function applyStyleToElement(el, styleOverride = null) {
    if (!el) return;
    const style = normalizeSlideStyle(styleOverride || {});
    el.style.fontFamily = style.fontFamily;
    el.style.fontSize = style.fontSize;
    el.style.color = style.color;
    el.style.fontWeight = style.fontWeight;
    el.style.textAlign = style.textAlign;
    const textBox = el.parentElement;
    if (textBox && textBox.classList.contains('text-layer-box')) {
        el.style.webkitTextStroke = `${style.textStrokeWidth}px ${style.textStrokeColor}`;
        el.style.paintOrder = "stroke fill";
        positionTextBox(textBox, style);
    }
}

function positionTextBox(textBox, style) {
    const tb = style.textBox;
    textBox.style.left = (tb?.left ?? 48) + 'px';
    textBox.style.width = (tb?.width ?? 864) + 'px';
    if (tb?.top != null) {
        textBox.style.top = tb.top + 'px';
        textBox.style.transform = '';
    } else {
        const align = style.verticalAlign || 'middle';
        if (align === 'top') { textBox.style.top = '43px'; textBox.style.transform = ''; }
        else if (align === 'bottom') { textBox.style.top = 'auto'; textBox.style.bottom = '43px'; textBox.style.transform = ''; }
        else { textBox.style.top = '50%'; textBox.style.transform = 'translateY(-50%)'; }
    }
}

function scaleVirtualCanvas(canvasId, containerId) {
    const canvas = document.getElementById(canvasId);
    const container = document.getElementById(containerId);
    if (!canvas || !container) return;
    const scale = Math.min(container.clientWidth / 960, container.clientHeight / 540);
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

// Thêm các hàm còn lại (renderSchedule, executeAction, v.v.) tuỳ vào nhu cầu...

function renderSchedule() {
    const container = document.getElementById('schedule-container');
    if (!container) return;
    container.innerHTML = '';
    if (schedule.length === 0) {
        container.innerHTML = '<p class="text-[10px] text-slate-400 p-2 text-center italic">No items in schedule.</p>';
        return;
    }
    schedule.forEach((item, index) => {
        const div = document.createElement('div');
        const isActive = index === currentScheduleIndex;
        div.className = `flex items-center gap-2 p-1.5 rounded-md ${isActive ? 'bg-blue-500 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'} cursor-pointer group`;
        div.innerHTML = `
            <div class="w-[60px] h-[40px] bg-black rounded flex-shrink-0 overflow-hidden">
                ${item.background ? `<img src="${item.background.url}" class="w-full h-full object-cover" />` : ''}
            </div>
            <div class="flex-1 min-w-0">
                <span class="text-[11px] font-semibold truncate block">${item.title}</span>
            </div>
        `;
        div.onclick = () => selectScheduleItem(index);
        container.appendChild(div);
    });
}

function renderLibrary() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const query = normalizeForSearch(document.getElementById('library-search')?.value || '');
    const library = currentLibraryTab === 'songs' ? songLibrary : bibleLibrary;

    const filtered = library.filter(s => normalizeForSearch(s.title).includes(query) || (s.lyrics && normalizeForSearch(s.lyrics).includes(query)));
    
    filtered.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'cursor-pointer select-none';
        tr.innerHTML = `<td class="px-3 py-1.5"><div class="text-[11px] font-medium">${item.title}</div></td>`;
        tr.onclick = () => { currentEditingSong = item; };
        tr.ondblclick = () => addToSchedule(item);
        tbody.appendChild(tr);
    });
}

function addToSchedule(item) {
    schedule.push({ ...item, scheduleId: Date.now() });
    renderSchedule();
}

async function executeAction(action) {
    console.log('Executing action:', action);
    switch (action) {
        case 'new-song': openSongEditor('Create New Song'); break;
        case 'open-settings': openSettings(); break;
        case 'clear-live': updateLiveOutput(''); break;
        case 'quit-app': await window.electronAPI.quitApp(); break;
        case 'toggle-live-window': await toggleLiveWindow(); break;
    }
}

// Map menu/shortcut actions
window.electronAPI.onMenuAction((event, action) => executeAction(action));

window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const combo = eventToCombo(e);
    const action = shortcutActionMap[combo];
    if (action) { e.preventDefault(); executeAction(action); }
});

async function updateCpuUsage() {
    try {
        const usage = await window.electronAPI.getCpuUsage();
        const display = document.getElementById('cpu-usage-display');
        if (display) display.innerText = `CPU: ${usage}%`;
    } catch (e) {}
}
setInterval(updateCpuUsage, 3000);

function scaleAllCanvases() {
    scaleVirtualCanvas('preview-virtual-canvas', 'preview-output-box');
    scaleVirtualCanvas('live-virtual-canvas', 'live-output-box');
}
window.addEventListener('resize', scaleAllCanvases);

// --- Functions Placeholder ---
// Ghi chú: Tôi đã gom các logic chính. Các hàm UI cụ thể (openSongEditor, v.v.) 
// nên được giữ nguyên hoặc chuyển sang một file UI riêng nếu cần.
