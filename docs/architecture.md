# Kiến Trúc

## Tổng quan

Đây là ứng dụng Electron desktop cho trình chiếu nhà thờ. Hai cửa sổ renderer (Operator, Live) + một comm server LAN trong main process; Kênh Band là **sidebar bên trong `index.html`**, không phải cửa sổ riêng:

- `main.js`: main process, tạo cửa sổ, IPC, protocol, file I/O, comm server + mDNS Kênh Band
- `index.html`: cửa sổ operator (gồm sidebar Kênh Band `#bandPanel`), chứa phần lớn UI và logic renderer
- `live.html`: cửa sổ trình chiếu
- `edit-song.html`: modal/editor giao diện bài hát
- `preload.js`: cầu nối an toàn qua `window.electronAPI`
- `src/schema.js`: validate/migrate dữ liệu
- `src/band-comm/`: server (HTTP + SSE) + store + protocol + mDNS + vendor QR encoder cho Kênh Band
- `comm/mobile/`: web client cho điện thoại band (server tự phục vụ)

## Luồng dữ liệu

1. Renderer gọi `window.electronAPI.*`
2. `preload.js` chuyển sang `ipcRenderer.invoke(...)`
3. `main.js` xử lý qua `ipcMain.handle(...)`
4. Dữ liệu được đọc/ghi trong `app.getPath('userData')`
5. Nếu có live window, `main.js` đẩy nội dung sang `live.html`

### Kênh Band (LAN)

1. Mở app → `main.js` **auto-start** comm server + mDNS; kết quả (chạy / lỗi) đẩy vào sidebar `#bandPanel`.
2. Điện thoại band quét QR (`http://<hostname>.local:<port>`) hoặc gõ IP → tải `comm/mobile/` từ comm server.
3. `POST /api/join` (name + role + PIN) → token; `GET /api/stream` mở SSE.
4. Điện thoại gửi lên bằng `fetch` POST; server fan-out qua SSE cho các điện thoại khác **và** gọi `onEvent` → `main.js` `webContents.send('band-comm-event', …)` tới sidebar trong `index.html`.
5. Operator thao tác trong sidebar → `electronAPI.bandComm.*` → `main.js` → `commServer.operator*()` → SSE.
6. Cấu hình + backup hồ sơ nút lưu ở `userData/band-comm.json` (qua `safeWriteSync`).

## File chịu trách nhiệm chính

| File | Trách nhiệm |
|---|---|
| `main.js` | Cửa sổ, menu, IPC, protocol `app-media://`, lưu file an toàn |
| `preload.js` | API cầu nối cho renderer |
| `index.html` | Library, schedule, editor, preview, control live |
| `live.html` | Hiển thị chữ/background trên màn hình chiếu |
| `edit-song.html` | UI chỉnh bài hát kiểu Windows cổ điển |
| `index.html` (sidebar `#bandPanel`) | Kênh Band: QR, bảng cảnh báo gộp, feed, soạn tin |
| `src/schema.js` | Migrate và validate item |
| `src/band-comm/server.js` | HTTP + SSE, PIN/token, presence, ring buffer |
| `src/band-comm/store.js` | Đọc/ghi `band-comm.json` + backup hồ sơ nút |
| `src/band-comm/protocol.js` | Envelope tin nhắn, chuẩn hoá `dedupKey` |
| `src/band-comm/mdns.js` | mDNS responder cho `<hostname>.local` |

## Dữ liệu lưu ở userData

- `songs.json`
- `bible.json`
- `settings.json`
- `media/`
- `bible-versions/` cho XML Kinh Thánh do người dùng import
- `bible-cache-<xmlName>.json`
- `.backup.1/.backup.2/.backup.3` cho dữ liệu đã backup
- `band-comm.json` — cấu hình Kênh Band (PIN, port, câu trả lời nhanh, backup hồ sơ nút, thư viện ảnh)
- `band-comm-media/` — ảnh hợp âm upload (P4, chưa dùng)

## Đặc điểm quan trọng

- Renderer không nên dùng `require()` trực tiếp
- `index.html` là monolith, nên mỗi thay đổi phải rất có chủ đích
- `live.html` dùng virtual canvas và crossfade double-buffer
- `main.js` có safe write + backup rotation, không được ghi đè trực tiếp kiểu rủi ro
- Bible XML được parse và cache theo file nguồn
