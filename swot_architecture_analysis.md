# Phân tích SWOT & Roadmap Cải tiến Kiến trúc
## Presentation_For_Church · Electron Desktop App

---

## 🔍 SWOT Analysis

### ✅ Strengths — Điểm mạnh

| # | Điểm mạnh | Chi tiết |
|---|---|---|
| S1 | **Single-file UI, zero build step** | [index.html](file:///Users/tinpham/Presentation_For_Church/index.html) chạy ngay trong Electron, không cần webpack/vite → phát triển nhanh |
| S2 | **Tailwind CDN** | Styling nhanh, không cần config phức tạp |
| S3 | **Virtual canvas 1920×1080** | Render slide nhất quán trên mọi độ phân giải màn hình chiếu |
| S4 | **Dual-window architecture** | Tách biệt Operator UI và Live Display rõ ràng qua IPC |
| S5 | **Full Vietnamese Bible XML** | Data Kinh Thánh đầy đủ sẵn có, không cần API ngoài |
| S6 | **Electron fs access** | CRUD file JSON trực tiếp, không cần backend server |

---

### ❌ Weaknesses — Điểm yếu

| # | Điểm yếu | Hệ quả |
|---|---|---|
| W1 | **`nodeIntegration: true`, `contextIsolation: false`** | Remote code execution risk; cấm dùng nếu load URL ngoài |
| W2 | **State là biến JS global trong 1 file 2300+ dòng** | Không có reactive UI → mỗi thay đổi phải gọi lại `render*()` thủ công, dễ out-of-sync |
| W3 | **Không có data schema validation** | `songs.json` / `bible.json` không có type guard → corrupt data âm thầm |
| W4 | **Bible XML load toàn bộ vào RAM mỗi lần start** | ~10MB+ DOM parsing, ~31k objects → startup chậm khi library lớn |
| W5 | **Không có undo/redo** | Xóa nhầm bài hát hoặc slide là mất dữ liệu vĩnh viễn |
| W6 | **Không lưu trạng thái UI** | Panel widths, window size, schedule hiện tại reset sau mỗi lần khởi động |
| W7 | **[index.html](file:///Users/tinpham/Presentation_For_Church/index.html) monolith** | HTML + CSS + 2000+ dòng JS trong 1 file → impossible to test, debug khó |
| W8 | **Không có error boundary** | 1 lỗi JS bất kỳ → cả UI đứng, không có recovery |
| W9 | **Slide split logic dựa trên dòng trống** | Không kiểm soát overflow text → text có thể bị cắt trên màn hình chiếu |
| W10 | **Không có keyboard shortcuts** | User phải dùng chuột cho tất cả thao tác trong khi đang dẫn chương trình |

---

### 🚀 Opportunities — Cơ hội

| # | Cơ hội |
|---|---|
| O1 | Thêm **multi-language Bible** (KJV, NIV...) với cùng XML schema |
| O2 | **Cloud sync** schedule qua Google Drive / iCloud |
| O3 | **Remote control** từ điện thoại (phone as clicker) qua local WebSocket |
| O4 | **Themes/Templates** hệ thống — lưu preset style cho mùa lễ |
| O5 | **Import từ PowerPoint / EasyWorship** để migrate |
| O6 | **Video background** và overlay transparency |
| O7 | **Timer / Countdown** overlay lên Live window |
| O8 | Đóng gói và chia sẻ **backup trọn bộ** (songs + bible + media) |

---

### ⚠️ Threats — Rủi ro

| # | Rủi ro | Xác suất | Mức độ |
|---|---|---|---|
| T1 | **Data loss** do corrupt JSON khi crash trong lúc ghi | Cao | Nghiêm trọng |
| T2 | **Electron deprecation** của `nodeIntegration: true` | Trung bình | Cao |
| T3 | **Memory leak** do Bible XML 31k objects không free | Cao | Trung bình |
| T4 | **Race condition** IPC khi nhiều thao tác song song | Thấp | Cao |
| T5 | Scale library > 1000 bài → UI render chậm (toàn bộ DOM) | Trung bình | Trung bình |

---

## 🏗️ Đề xuất cải tiến kiến trúc

> **Nguyên tắc**: Cải tiến incrementally, không rewrite từ đầu. Mỗi thay đổi phải có lợi ích rõ ràng và không phá vỡ tính năng hiện có.

---

### 🔴 Priority 1 — Critical: Bảo mật & Ổn định

#### [A1] Bật Context Isolation + Preload Script

**Vấn đề**: `nodeIntegration: true` tạo attack surface lớn.

**Giải pháp**:
```
main.js
├── webPreferences: { contextIsolation: true, nodeIntegration: false }
└── preload.js (MỚI):
    ├── Expose API an toàn qua contextBridge.exposeInMainWorld('electronAPI', {...})
    └── Chỉ expose các function cần thiết: loadSongs, saveSong, deleteX...

index.html
└── Thay require('electron') → window.electronAPI.loadSongs()
```

**Lợi ích**: Tuân thủ Electron security guidelines; sẵn sàng cho future update Electron.

---

#### [A2] Atomic File Writes + Auto-backup

**Vấn đề**: Ghi thẳng vào `songs.json` → crash giữa chừng = corrupt file.

**Giải pháp** trong [main.js](file:///Users/tinpham/Presentation_For_Church/main.js):
```javascript
// Write pattern: write-to-temp → rename (atomic on most OS)
async function safeWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, filePath);
}

// Auto-backup: giữ 3 bản backup cuối
async function backupBeforeWrite(filePath) {
  // songs.json → songs.backup.1.json, songs.backup.2.json, songs.backup.3.json
}
```

**Lợi ích**: Loại bỏ T1 (data loss). Chi phí: ~20 dòng code.

---

### 🟠 Priority 2 — High: Kiến trúc dữ liệu

#### [A3] Tách JS ra file riêng + Module pattern

**Vấn đề**: 2300+ dòng trong 1 file HTML — không thể test, debug khó.

**Cấu trúc đề xuất**:
```
src/
├── renderer/
│   ├── app.js          # Main entry, global state
│   ├── library.js      # Song/Bible library logic
│   ├── schedule.js     # Schedule management
│   ├── slides.js       # Slide splitting & rendering
│   ├── live.js         # Live window IPC
│   ├── media.js        # Media library
│   └── ui/
│       ├── resizer.js  # Panel resize logic
│       └── canvas.js   # Virtual canvas scaling
├── main/
│   ├── main.js         # Electron entry
│   ├── ipc-handlers.js # IPC handlers tách riêng
│   └── file-service.js # File I/O với atomic writes
└── preload.js
```

**Kích hoạt**: Dùng `<script type="module">` trong Electron renderer (không cần bundler).

---

#### [A4] Định nghĩa Data Schema + Validation

**Vấn đề**: Không có kiểm tra kiểu dữ liệu → data corrupt âm thầm.

**Giải pháp**: Tạo `src/schema.js`:
```javascript
// Schema đơn giản không cần thư viện
const SongSchema = {
  required: ['id', 'title', 'lyrics'],
  defaults: {
    style: { fontSize: 36, fontColor: '#ffffff', textAlign: 'center' },
    background: { type: 'color', value: '#000000' }
  }
};

function validateSong(data) {
  const errors = [];
  if (!data.id) errors.push('Missing id');
  if (!data.title?.trim()) errors.push('Missing title');
  if (!data.lyrics) errors.push('Missing lyrics');
  return { valid: errors.length === 0, errors };
}

function migrateSong(data) {
  // Thêm fields mới với giá trị mặc định cho bài cũ
  return { ...SongSchema.defaults, ...data };
}
```

**Đặc biệt quan trọng**: `migrateSong()` để backward compatibility khi thêm field mới.

---

#### [A5] Lazy-load Bible XML + IndexedDB Cache

**Vấn đề**: Parse 31k-verse XML mỗi lần startup → chậm, tốn RAM.

**Giải pháp**:
```javascript
// Chiến lược: Parse 1 lần → cache vào file JSON nhỏ gọn hơn
// main.js:
async function loadBibleCached() {
  const cachePath = path.join(app.getPath('userData'), 'bible-cache.json');
  const xmlPath = path.join(__dirname, 'data', 'Bible_Vietnamese.xml');
  
  // Check cache còn mới hơn XML không
  if (fs.existsSync(cachePath)) {
    const cacheTime = fs.statSync(cachePath).mtimeMs;
    const xmlTime = fs.statSync(xmlPath).mtimeMs;
    if (cacheTime > xmlTime) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  }
  
  // Parse XML và lưu cache
  const parsed = parseBibleXML(xmlPath);
  fs.writeFileSync(cachePath, JSON.stringify(parsed));
  return parsed;
}

// Renderer: chỉ load chapter khi cần (on-demand)
// Thay vì load 31k objects, chỉ load danh sách sách/chương
```

**Lợi ích**: Startup nhanh hơn ~300-500ms; RAM giảm thực sự khi dùng lazy load.

---

### 🟡 Priority 3 — Medium: UX & Trải nghiệm vận hành

#### [A6] Persisted App State

**Vấn đề**: Mọi thứ reset sau khi khởi động lại.

**Giải pháp**: Lưu vào `userData/app-state.json`:
```javascript
const AppState = {
  // Lưu tự động mỗi 30s và khi đóng app
  schedule: [],           // Schedule hiện tại
  currentScheduleIndex: -1,
  panelWidths: {},        // Kích thước panels
  windowBounds: {},       // Position/size của main window
  lastLibraryTab: 'songs',
  librarySearchQuery: ''
};
```

**Lợi ích**: Mở lại app → tiếp tục từ đúng chỗ dừng. Thiết yếu khi dùng trong buổi thờ phượng.

---

#### [A7] Keyboard Shortcuts

**Vấn đề**: Operator phải dùng chuột trong khi đang dẫn chương trình.

**Bảng phím đề xuất**:

| Phím | Hành động |
|---|---|
| `→` / `Space` | Slide tiếp theo |
| `←` | Slide trước |
| `↑` / `↓` | Di chuyển trong Schedule |
| `Enter` | Go Live (slide đang xem) |
| `B` | Black screen |
| `L` | Logo screen |
| `Ctrl+F` | Focus search |
| `Ctrl+N` | New Song |
| `Escape` | Đóng modal |

```javascript
// renderer/keyboard.js
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const handlers = { 'ArrowRight': nextSlide, 'ArrowLeft': prevSlide, ... };
  handlers[e.key]?.();
});
```

---

## 📋 Roadmap thực hiện

```
Pha 1 — Ổn định (1-2 tuần)
├── [A2] Atomic writes + backup     → Ngăn data loss
├── [A1] Context isolation          → Security hardening
└── [A4] Schema + migration         → Data integrity

Pha 2 — Refactor (2-4 tuần)
├── [A3] Tách JS thành modules      → Maintainability
├── [A5] Bible lazy-load            → Performance
└── [A6] Persisted state            → UX cốt lõi

Pha 3 — Mở rộng (ongoing)
├── [A7] Keyboard shortcuts         → Operator efficiency
├── Undo/redo stack                 → Safety net
├── Virtual list rendering          → Scale > 1000 bài
└── Remote control WebSocket        → Phone as clicker
```

---

## 📊 Ma trận nỗ lực / lợi ích

```
Lợi ích cao ┤
            │  [A2]★  [A7]★        [A5]
            │  [A4]★     [A6]★
            │        [A3]
            │                 [A1]
Lợi ích thấp┤
            └─────────────────────────
           Nỗ lực thấp    Nỗ lực cao

★ = Khuyến nghị làm trước
```

> **Khuyến nghị bắt đầu ngay**: [A2] Atomic writes (~30 phút) và [A4] Schema validation (~1 giờ) — chi phí thấp, lợi ích bảo vệ dữ liệu ngay lập tức.
