# CLAUDE.md — Blueprint: Presentation For Church

## 1. Tổng quan dự án

Ứng dụng desktop **Electron** dùng để quản lý và trình chiếu bài ca ngợi và Kinh Thánh cho nhà thờ. Giao diện giống **EasyWorship / ProPresenter** phong cách Windows cổ điển, gồm hai cửa sổ: cửa sổ điều khiển (Operator/Main) và cửa sổ trình chiếu trực tiếp (Live).

---

## 2. Kiến trúc & Tech Stack

| Lớp | Công nghệ |
|---|---|
| Runtime | Electron 36 |
| UI Framework | Vanilla HTML/CSS/JS (không có SPA framework) |
| Styling | Tailwind CSS (CDN), custom Win98-style CSS |
| IPC | `ipcRenderer` / `ipcMain` |
| File I/O | Node.js `fs`, `path` trong Main process |
| Packaging | `electron-builder` |
| Data | JSON files + XML (Kinh Thánh) |

### Cấu trúc thư mục
```
Presentation_For_Church/
├── main.js               # Electron main process
├── index.html            # Cửa sổ điều khiển (Operator UI) ~2338 dòng
├── live.html             # Cửa sổ trình chiếu (Live Window) ~288 dòng
├── package.json
├── data/
│   ├── songs.json        # Thư viện bài hát
│   ├── bible.json        # Bible đã chỉnh sửa/lưu (dynamic)
│   ├── Bible_Vietnamese.xml  # Toàn bộ Kinh Thánh tiếng Việt (static)
│   └── media/            # Thư mục ảnh/video nền
└── CLAUDE.md
```

---

## 3. Luồng dữ liệu (Data Flow)

```
main.js (Main Process)
  ├── IPC handlers: load-songs, save-song, delete-song
  ├── IPC handlers: load-bible, save-bible, delete-bible
  ├── IPC handlers: load-media, save-media-file
  ├── IPC handlers: go-live, update-live-slide, close-live, update-live-style, send-to-live-background, send-black-to-live, send-logo-to-live
  └── Quản lý 2 cửa sổ: mainWindow & liveWindow

index.html (Renderer - Operator)
  ├── State toàn cục (JS variables):
  │   ├── songLibrary[], bibleLibrary[], savedBibleList[], schedule[]
  │   ├── mediaLibrary[]
  │   ├── currentSlides[], currentPreviewIndex, currentLiveSlideIndex
  │   └── currentPreviewStyle, currentLiveStyle, currentPreviewBackground
  ├── 3 panel chính (resizable):
  │   ├── Panel trái: Library (Songs tab + Bible tab) + Media
  │   ├── Panel giữa: Schedule
  │   └── Panel phải: Preview + Live Monitor
  └── Giao tiếp với liveWindow qua ipcRenderer.send()

live.html (Renderer - Live)
  ├── Nhận IPC từ main: go-live, slide-update, style-update, background-update
  ├── Render slide với virtual canvas 1920×1080
  └── Hiển thị fullscreen trên màn hình thứ 2
```

---

## 4. Tính năng chi tiết

### 4.1 Thư viện bài hát (Song Library)
- Load từ `data/songs.json` qua IPC `load-songs`
- Tìm kiếm real-time theo tiêu đề
- Click đơn → chọn (highlight xanh)
- Double-click → thêm vào Schedule
- Right-click → Context menu: Edit / Delete / Add to Schedule
- Nút "New Song" → mở Song Editor

### 4.2 Thư viện Kinh Thánh (Bible Library)
- **Static**: Load từ `Bible_Vietnamese.xml` (toàn bộ 66 sách, ~31,000 câu)
- **Dynamic**: Load từ `data/bible.json` (các đoạn đã tuỳ chỉnh/lưu)
- Tab riêng "Bible" trong Library panel
- Hiển thị ưu tiên: savedBibleList trước, rồi bibleLibrary (dedup theo title)
- Map tên sách từ English → Vietnamese (`bibleBookMap` object)
- Không thể xóa dữ liệu Kinh Thánh mặc định (XML), chỉ xóa được bản dynamic

### 4.3 Song Editor (Modal)
- Mở bằng double-click / "New Song" / context menu Edit
- Fields: Title, Lyrics (textarea), Background, Font settings
- Preview canvas 1920×1080 được scale để hiển thị trong modal
- Apply: lưu không đóng modal | OK: lưu và đóng | Cancel: đóng
- Songs lưu vào `data/songs.json` qua IPC `save-song`

### 4.4 Schedule (Danh sách trình chiếu)
- Thêm item bằng double-click từ Library hoặc drag từ Media
- Click item → load slides vào Preview
- Double-click item → đưa lên Live ngay
- Up/Down để sắp xếp
- Delete để xoá khỏi schedule
- Support cả Songs, Bible, và Media items

### 4.5 Slides (Phân trang)
- Lyrics tự động phân chia thành các slides dựa trên dòng trống
- Preview panel hiển thị danh sách thumbnail slides
- Click thumbnail → Preview slide đó
- "Go Live" button → đưa slide đang xem lên màn hình Live

### 4.6 Preview & Live Monitor
- Preview: hiển thị slide đang được chọn (chưa live)
- Live Monitor: hiển thị trạng thái màn hình Live hiện tại
- Hai màn hình có virtual canvas 1920×1080 tự động scale theo container
- Styling: font size, font color, background color/image riêng biệt

### 4.7 Live Window (`live.html`)
- `BrowserWindow` thứ 2, fullscreen trên màn hình thứ 2
- Nhận IPC events:
  - `go-live`: switch sang live display
  - `slide-update`: cập nhật nội dung slide
  - `style-update`: cập nhật style (font, màu sắc)
  - `background-update`: cập nhật background
  - `go-black`: màn hình đen
  - `go-logo`: hiển thị logo
- `ipcRenderer.on('display-update', ...)`: nhận và render

### 4.8 Media Library
- Load files từ `data/media/` folder
- Hỗ trợ image & video
- Drag từ Media panel → thả vào Schedule để thêm media item
- Dùng làm background cho slides

### 4.9 Resizable Panels
- 4 resizers: giữa 3 panel trên, giữa row trên/dưới, giữa 2 panel dưới
- Drag handle để resize
- Logic: `setupResizer(id, panelBefore, panelAfter, isVertical)`

### 4.10 Styling System
- `currentPreviewStyle` và `currentLiveStyle` lưu độc lập
- Style gồm: fontFamily, fontSize, fontColor, textAlign, lineHeight, textShadow
- Background: color hoặc image/video path
- Style được đồng bộ sang live window qua IPC `update-live-style`

---

## 5. IPC Channels (Main ↔ Renderer)

| Channel | Hướng | Mô tả |
|---|---|---|
| `load-songs` | invoke | Đọc data/songs.json |
| `save-song` | invoke | Ghi/cập nhật data/songs.json |
| `delete-song` | invoke | Xóa bài hát khỏi JSON |
| `load-bible` | invoke | Đọc data/bible.json |
| `save-bible` | invoke | Ghi data/bible.json |
| `delete-bible` | invoke | Xóa bible entry |
| `load-media` | invoke | Liệt kê data/media/ |
| `save-media-file` | invoke | Copy file vào data/media/ |
| `go-live` | send | Mở/focus Live window và push slide |
| `update-live-slide` | send | Cập nhật nội dung slide trên Live |
| `update-live-style` | send | Cập nhật style trên Live |
| `send-to-live-background` | send | Gửi background lên Live |
| `send-black-to-live` | send | Hiển thị màn đen |
| `send-logo-to-live` | send | Hiển thị logo |
| `close-live` | send | Đóng Live window |

---

## 6. Conventions & Patterns

### Rendering Slides
```javascript
// Virtual canvas approach: render ở 1920×1080, scale CSS để vừa container
function scaleVirtualCanvas(canvasId, containerId) { ... }

// Slide render: generate HTML với style được apply
function renderSlideToCanvas(canvasId, text, style, background) { ... }
```

### State Management
- Không dùng framework → state là biến JS global trong renderer
- `currentEditingSong`, `currentScheduleIndex`, `currentSlides[]` là các biến chính
- Sau mỗi thao tác CRUD → gọi lại `renderLibrary()` hoặc `renderSchedule()`

### Data Format (songs.json)
```json
[
  {
    "id": "uuid-v4",
    "title": "Tên bài hát",
    "lyrics": "Lời bài 1...\n\nLời bài 2...",
    "style": { "fontSize": 36, "fontColor": "#ffffff", ... },
    "background": { "type": "color|image|video", "value": "#000000|path" }
  }
]
```

### Data Format (bible.json)
```json
[
  {
    "id": "uuid-v4",
    "title": "Giăng 3",
    "lyrics": "16 Vì Đức Chúa Trời...\n\n17 ...",
    "type": "bible",
    "style": { ... }
  }
]
```

---

## 7. Build & Run

```bash
npm start          # Chạy dev với Electron
npm run build      # Build production (electron-builder)
```

**Entry points:**
- `main.js` → Electron main process
- `index.html` → Operator UI (mainWindow)
- `live.html` → Live Display (liveWindow, fullscreen)

---

## 8. Hướng dẫn phát triển (Development Guidelines)

### Thêm tính năng mới:
1. Nếu cần đọc/ghi file → thêm IPC handler trong `main.js`
2. UI thêm vào `index.html` theo layout Tailwind + custom `.win-*` classes
3. Nếu ảnh hưởng Live window → thêm IPC listener trong `live.html`
4. Style consistency: dùng `win-button`, `panel`, `win-input` classes

### Điều chỉnh Slide Renderer:
- Function `renderSlideToCanvas()` là trung tâm — mọi thay đổi style đi qua đây
- Virtual canvas luôn là 1920×1080 → scale CSS để fit container
- Cập nhật style → gọi `scaleVirtualCanvas()` sau khi render

### Thêm kiểu nền (background types):
- Current: color, image
- Pattern: `background.type` switch/case trong render function

### Debug:
- `Ctrl+Shift+I` → DevTools trong Electron (nếu bật `webPreferences.devTools`)
- Console log trong main.js → hiện trong terminal
- Console log trong renderer → hiện trong DevTools

---

## 9. Vấn đề đã biết / Lưu ý

- **Tailwind CDN**: Dùng CDN nên không có tree-shaking; nếu bundle size là vấn đề, chuyển sang CLI
- **require() trong Renderer**: App dùng `nodeIntegration: true` và `contextIsolation: false` — bảo mật thấp nhưng OK cho desktop app nội bộ
- **Bible XML**: File lớn, load một lần khi startup, không cache lại sau lần đầu
- **Dedup Bible**: Logic dedup theo `title` có thể miss nếu title formatted khác nhau
- **Resizer state**: Không lưu width/height khi restart — panels reset về default mỗi lần mở app
