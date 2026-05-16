
/**
 * Utility functions for the Presentation app.
 * Includes formatting, escaping, and normalization helpers.
 */

const bibleBookMap = {
    "Genesis": "Sáng Thế Ký", "Exodus": "Xuất Ê-díp-tô Ký", "Leviticus": "Lê-vi Ký", "Numbers": "Dân Số Ký", "Deuteronomy": "Phục Truyền Luật Lệ Ký",
    "Joshua": "Giô-suê", "Judges": "Các Quan Xét", "Ruth": "Ru-tơ", "1 Samuel": "1 Sa-mu-ên", "2 Samuel": "2 Sa-mu-ên",
    "1 Kings": "1 Các Vua", "2 Kings": "2 Các Vua", "1 Chronicles": "1 Sử Ký", "2 Chronicles": "2 Sử Ký", "Ezra": "Ê-xơ-ra",
    "Nehemiah": "Nê-hê-mi", "Esther": "Ê-xơ-tê", "Job": "Gióp", "Psalm": "Thi Thiên", "Psalms": "Thi Thiên", "Proverbs": "Châm Ngôn",
    "Ecclesiastes": "Truyền Đạo", "Song of Solomon": "Nhã Ca", "Isaiah": "Ê-sai", "Jeremiah": "Giê-rê-mi", "Lamentations": "Ca Thương",
    "Ezekiel": "Ê-xê-chi-ên", "Daniel": "Đa-ni-ên", "Hosea": "Ô-sê", "Joel": "Giô-ên", "Amos": "A-mốt",
    "Obadiah": "Áp-đia", "Jonah": "Giô-na", "Micah": "Mi-chê", "Nahum": "Na-hum", "Habakkuk": "Ha-ba-cúc",
    "Zephaniah": "Sô-phô-ni", "Haggai": "A-ghê", "Zechariah": "Xa-cha-ri", "Malachi": "Ma-la-chi", "Matthew": "Ma-thi-ơ",
    "Mark": "Mác", "Luke": "Lu-ca", "John": "Giăng", "Acts": "Công Vụ Các Sứ Đồ", "Romans": "Rô-ma",
    "1 Corinthians": "1 Cô-rinh-tô", "2 Corinthians": "2 Cô-rinh-tô", "Galatians": "Ga-la-ti", "Ephesians": "Ê-phê-sô", "Philippians": "Phi-líp",
    "Colossians": "Cô-lô-se", "1 Thessalonians": "1 Tê-sa-lô-ni-ca", "2 Thessalonians": "2 Tê-sa-lô-ni-ca", "1 Timothy": "1 Ti-mô-thê", "2 Timothy": "2 Ti-mô-thê",
    "Titus": "Tít", "Philemon": "Phi-lê-môn", "Hebrews": "Hê-bơ-rơ", "James": "Gia-cơ", "1 Peter": "1 Phi-e-rơ",
    "2 Peter": "2 Phi-e-rơ", "1 John": "1 Giăng", "2 John": "2 Giăng", "3 John": "3 Giăng", "Jude": "Giu-đe",
    "Revelation": "Khải Huyền"
};

function isMacPlatform() {
    const platform = (navigator.platform || navigator.userAgent || '').toLowerCase();
    return platform.includes('mac');
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeForSearch(str) {
    if (!str) return "";
    return str.toLowerCase().normalize('NFC').replace(/[-\/,.!?():;"']/g, '');
}

function stripLabel(text) {
    const labelPattern = /^(Verse|Chorus|Bridge|Pre-Chorus|Tag|End|Đoạn|Điệp khúc|Kết)/i;
    const lines = text.split('\n');
    if (lines.length > 0 && labelPattern.test(lines[0].trim())) {
        return { label: lines[0].trim(), content: lines.slice(1).join('\n').trim() };
    }
    return { label: '', content: text.trim() };
}

function getLabelColor(label) {
    if (!label) return '';
    const l = label.toLowerCase();
    if (/verse|đoạn/i.test(l)) return '#3366ff';
    if (/chorus|pre-chorus|điệp khúc/i.test(l)) return '#993366';
    if (/end|kết/i.test(l)) return '#800000';
    if (/bridge/i.test(l)) return '#800080';
    return '';
}

function normalizeShortcutCombo(input = '') {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const parts = raw.split('+').map(p => p.trim()).filter(Boolean);
    const mods = [];
    let key = '';
    parts.forEach(part => {
        const p = part.toLowerCase();
        if (p === 'cmdorctrl' || p === 'ctrl' || p === 'control' || p === 'cmd' || p === 'meta') mods.push('cmdorctrl');
        else if (p === 'shift') mods.push('shift');
        else if (p === 'alt' || p === 'option') mods.push('alt');
        else key = part;
    });
    const orderedMods = ['cmdorctrl', 'shift', 'alt'].filter(m => mods.includes(m));
    return [...orderedMods, key.toLowerCase()].filter(Boolean).join('+');
}

function normalizeShortcutKey(input = '') {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower === 'cmdorctrl') return isMacPlatform() ? 'cmd' : 'ctrl';
    if (lower === 'control') return 'ctrl';
    if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'cmd';
    if (lower === 'option') return 'alt';
    if (lower === ' ') return 'space';
    return lower;
}

function formatShortcutKey(input = '') {
    const k = normalizeShortcutKey(input);
    if (!k) return '';
    if (k === 'ctrl') return 'Ctrl';
    if (k === 'cmd') return 'Cmd';
    if (k === 'shift') return 'Shift';
    if (k === 'alt') return 'Alt';
    if (k === 'space') return 'Space';
    if (k === 'arrowright') return 'ArrowRight';
    if (k === 'arrowleft') return 'ArrowLeft';
    if (k === 'arrowup') return 'ArrowUp';
    if (k === 'arrowdown') return 'ArrowDown';
    if (k === 'escape') return 'Esc';
    if (k === 'enter') return 'Enter';
    if (k === 'tab') return 'Tab';
    return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
}

function eventToCombo(event) {
    const tokens = [];
    if (event.ctrlKey) tokens.push('ctrl');
    if (event.metaKey) tokens.push('cmd');
    if (event.shiftKey) tokens.push('shift');
    if (event.altKey) tokens.push('alt');
    const key = normalizeShortcutKey(event.key || '');
    if (!['ctrl', 'cmd', 'shift', 'alt'].includes(key)) tokens.push(key);
    return tokens.join('+');
}

function normalizeSpacingBox(source, fallback) {
    const input = source && typeof source === 'object' ? source : {};
    return {
        top: Number.isFinite(Number(input.top)) ? Number(input.top) : fallback.top,
        right: Number.isFinite(Number(input.right)) ? Number(input.right) : fallback.right,
        bottom: Number.isFinite(Number(input.bottom)) ? Number(input.bottom) : fallback.bottom,
        left: Number.isFinite(Number(input.left)) ? Number(input.left) : fallback.left
    };
}

function setupResizer(resizerId, panelBefore, panelAfter, isVertical = false) {
    const resizer = document.getElementById(resizerId);
    if (!resizer) return;
    let startX, startY, startWidth, startHeight;

    resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
        startWidth = panelBefore.offsetWidth;
        startHeight = panelBefore.offsetHeight;
        resizer.classList.add('dragging');
        document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (isVertical) {
            const dy = e.clientY - startY;
            panelBefore.style.height = `${startHeight + dy}px`;
            panelBefore.style.flex = 'none';
        } else {
            const dx = e.clientX - startX;
            panelBefore.style.width = `${startWidth + dx}px`;
            panelBefore.style.flex = 'none';
        }
    }

    function onMouseUp() {
        resizer.classList.remove('dragging');
        document.body.style.cursor = 'default';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (typeof scaleAllCanvases === 'function') scaleAllCanvases();
    }
}

function createDefaultSlideStyle(contentType = 'song') {
    const defaultFontFamily = contentType === 'bible'
        ? (globalSettings.fontFamilyBible || globalSettings.fontFamilySong || 'Times New Roman')
        : (globalSettings.fontFamilySong || globalSettings.fontFamilyBible || 'CMG Sans');
    return {
        fontFamily: defaultFontFamily,
        fontSize: globalSettings.fontSize || '80px',
        color: globalSettings.color || '#ffffff',
        fontWeight: globalSettings.fontWeight || 'bold',
        fontStyle: 'normal',
        textDecoration: 'none',
        textAlign: globalSettings.textAlign || 'center',
        verticalAlign: globalSettings.verticalAlign || 'middle',
        textStrokeWidth: Number.isFinite(Number(globalSettings.textStrokeWidth)) ? Number(globalSettings.textStrokeWidth) : 5,
        textStrokeColor: globalSettings.textStrokeColor || '#000000',
        textMargin: { ...(globalSettings.textMargin || { top: 0, right: 0, bottom: 0, left: 0 }) },
        textPadding: { ...(globalSettings.textPadding || { top: 0, right: 0, bottom: 0, left: 0 }) },
        textBox: { left: 48, width: 864, top: null }
    };
}

function normalizeSlideStyle(style = {}, overrides = {}, contentType = 'song') {
    const defaults = createDefaultSlideStyle(contentType);
    const source = style && typeof style === 'object' ? style : {};
    const extra = overrides && typeof overrides === 'object' ? overrides : {};
    const normalized = { ...defaults, ...source, ...extra };

    if (normalized.fontColor && !normalized.color) {
        normalized.color = normalized.fontColor;
    }
    delete normalized.fontColor;

    normalized.textBox = {
        ...defaults.textBox,
        ...((source && source.textBox) || {}),
        ...((extra && extra.textBox) || {})
    };
    normalized.textMargin = normalizeSpacingBox(
        { ...((source && source.textMargin) || {}), ...((extra && extra.textMargin) || {}) },
        defaults.textMargin
    );
    normalized.textPadding = normalizeSpacingBox(
        { ...((source && source.textPadding) || {}), ...((extra && extra.textPadding) || {}) },
        defaults.textPadding
    );

    if (!normalized.fontFamily) normalized.fontFamily = defaults.fontFamily;
    if (!normalized.fontSize) normalized.fontSize = defaults.fontSize;
    if (!normalized.color) normalized.color = defaults.color;
    if (!normalized.fontWeight) normalized.fontWeight = defaults.fontWeight;
    if (!normalized.fontStyle) normalized.fontStyle = defaults.fontStyle;
    if (!normalized.textDecoration) normalized.textDecoration = defaults.textDecoration;
    if (!normalized.textAlign) normalized.textAlign = defaults.textAlign;
    if (!normalized.verticalAlign) normalized.verticalAlign = defaults.verticalAlign;
    if (!Number.isFinite(Number(normalized.textStrokeWidth))) normalized.textStrokeWidth = defaults.textStrokeWidth;
    if (!normalized.textStrokeColor) normalized.textStrokeColor = defaults.textStrokeColor;

    return normalized;
}

function normalizeSlideBackground(background) {
    if (!background) return null;
    const inferMediaType = (value) => {
        const source = (value || '').toString().toLowerCase().split(/[?#]/)[0];
        return /\.(mp4|mov|m4v|webm|wmv)$/.test(source) ? 'video' : 'image';
    };

    if (!background.mediaName) {
        const name = background.name || background.fileName;
        if (!name) return null;
        const mediaType = background.mediaType === 'video' || background.type === 'video'
            ? 'video'
            : background.mediaType === 'image' || background.type === 'image'
                ? 'image'
                : inferMediaType(background.url || name);
        return {
            mediaName: name,
            mediaType: mediaType,
            url: background.url || `app-media://${encodeURIComponent(name)}`
        };
    }

    const mediaType = background.mediaType === 'video' || background.type === 'video'
        ? 'video'
        : background.mediaType === 'image' || background.type === 'image'
            ? 'image'
            : inferMediaType(background.url || background.mediaName);

    return {
        mediaName: background.mediaName,
        mediaType: mediaType,
        url: background.url || `app-media://${encodeURIComponent(background.mediaName)}`
    };
}
