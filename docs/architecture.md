# Kiến Trúc

## Tổng quan

Đây là ứng dụng Electron desktop cho trình chiếu nhà thờ. Kiến trúc hiện tại là kiểu hai cửa sổ:

- `main.js`: main process, tạo cửa sổ, IPC, protocol, file I/O
- `index.html`: cửa sổ operator, chứa phần lớn UI và logic renderer
- `live.html`: cửa sổ trình chiếu
- `edit-song.html`: modal/editor giao diện bài hát
- `preload.js`: cầu nối an toàn qua `window.electronAPI`
- `src/schema.js`: validate/migrate dữ liệu

## Luồng dữ liệu

1. Renderer gọi `window.electronAPI.*`
2. `preload.js` chuyển sang `ipcRenderer.invoke(...)`
3. `main.js` xử lý qua `ipcMain.handle(...)`
4. Dữ liệu được đọc/ghi trong `app.getPath('userData')`
5. Nếu có live window, `main.js` đẩy nội dung sang `live.html`

## File chịu trách nhiệm chính

| File | Trách nhiệm |
|---|---|
| `main.js` | Cửa sổ, menu, IPC, protocol `app-media://`, lưu file an toàn |
| `preload.js` | API cầu nối cho renderer |
| `index.html` | Library, schedule, editor, preview, control live |
| `live.html` | Hiển thị chữ/background trên màn hình chiếu |
| `edit-song.html` | UI chỉnh bài hát kiểu Windows cổ điển |
| `src/schema.js` | Migrate và validate item |

## Dữ liệu lưu ở userData

- `songs.json`
- `bible.json`
- `settings.json`
- `media/`
- `bible-versions/` cho XML Kinh Thánh do người dùng import
- `bible-cache-<xmlName>.json`
- `.backup.1/.backup.2/.backup.3` cho dữ liệu đã backup

## Đặc điểm quan trọng

- Renderer không nên dùng `require()` trực tiếp
- `index.html` là monolith, nên mỗi thay đổi phải rất có chủ đích
- `live.html` dùng virtual canvas và crossfade double-buffer
- `main.js` có safe write + backup rotation, không được ghi đè trực tiếp kiểu rủi ro
- Bible XML được parse và cache theo file nguồn
