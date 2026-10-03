# Kiến Trúc

> Cập nhật 2026-10-03 theo kiến trúc **hiện tại** (sau GĐ2: relay trên Cloudflare, không còn LAN server/mDNS/Cloudflare Tunnel). Các tài liệu `band-comm-plan.md` và mục "Named Tunnel" trong `docs/data-contracts.md` là **lịch sử**, không còn đúng với code.

## Tổng quan

Ứng dụng Electron desktop cho trình chiếu thờ phượng. Hai cửa sổ renderer (Operator, Live) + một **client relay** trong main process. **Kênh Band** là sidebar bên trong `index.html` (`#bandPanel`), không phải cửa sổ riêng. Cả máy operator lẫn điện thoại ban hát đều là **client kết nối ra ngoài** tới relay trên Cloudflare (`channel.worship-official.link`); không có server nào lắng nghe trên máy operator, không có LAN, không có tunnel.

Bản phát hành **không đóng gói nội dung** (Kinh Thánh, bài hát, media): người dùng tự nhập theo `templates/import/HUONG-DAN-NHAP-DU-LIEU.md`.

### Thành phần chạy trên máy

- `main.js`: main process — cửa sổ, menu, IPC, protocol `app-media://`, file I/O an toàn, client relay Kênh Band, đăng nhập operator, chặn điều hướng/quyền (xem "Mô hình bảo mật")
- `preload.js`: cầu nối `window.electronAPI` (`contextBridge`)
- `index.html`: cửa sổ operator (gồm sidebar Kênh Band), chứa phần lớn UI và logic renderer (monolith)
- `live.html`: cửa sổ trình chiếu
- `src/schema.js`: validate/migrate bài hát/Kinh Thánh
- `src/library-sync.js`: gộp thư viện từ các bản cài cũ trên cùng máy
- `src/band-comm/`: `relay-client.js` (WebSocket operator + đồng bộ thư viện/ảnh nền lên cloud, debounce/retry), `store.js` (cấu hình Kênh Band, `relayAdminSecret` mã hóa bằng `safeStorage`), `operator-auth.js` (phiên Cognito của operator, token mã hóa), `vendor/qrcode-generator.js` (QR tạo ngay trên máy)
- `src/css/`: `tailwind.generated.css` (Tailwind **build tĩnh**, `npm run build:css`), `google-fonts.css` (+ `fonts/google/`, tạo bằng `scripts/fetch-google-fonts.js`) — giao diện chạy offline, không nạp tài nguyên từ Internet
- `fonts/cmg-sans/`: phông CMG Sans (SIL OFL); giấy phép ở `THIRD_PARTY_NOTICES.md`, `licenses/`
- `templates/import/`: file mẫu + hướng dẫn định dạng nhập dữ liệu (đóng gói theo app)

### Thành phần chạy trên cloud (deploy độc lập bằng `wrangler`, KHÔNG đóng gói vào app)

- `cloud/worker/` (`channel.worship-official.link`): `worker.js` (KV/R2: hộp thư setlist, đồng bộ thư viện, ảnh hợp âm; phục vụ `comm/mobile/` ở `/m/` và `comm/setlist/` ở `/setlist/`) + `room-relay.js` (**Durable Object** mỗi phòng: WebSocket realtime, replay 120 tin, tài khoản thành viên, hồ sơ nút, hộp thư bài hát mới chờ duyệt, manifest ảnh nền, route `/admin/purge` xóa dữ liệu phòng)
- `cloud/identity/` (`identity.worship-official.link`): Worker "band-identity" — cầu nối duy nhất tới AWS Cognito (đăng nhập operator), quản lý phòng/thành viên, gửi mail qua Resend
- `cloud/website/` + `website/`: website tĩnh (landing, portal, admin, `privacy.html`)
- `comm/mobile/`: web client điện thoại ban hát; `comm/setlist/`: trang soạn setlist + bài mới + xem trước slide

## Luồng dữ liệu

1. Renderer gọi `window.electronAPI.*`
2. `preload.js` chuyển sang `ipcRenderer.invoke(...)`
3. `main.js` xử lý qua `ipcMain.handle(...)` (mọi handler chỉ nhận lệnh từ `index.html`/`live.html` nạp từ `file://`)
4. Dữ liệu được đọc/ghi trong `app.getPath('userData')`
5. Nếu có live window, `main.js` đẩy nội dung sang `live.html`

### Kênh Band

1. Operator đăng nhập Cognito trong app (gate bắt buộc, `operator-auth.js`); chưa đăng nhập thì relay client không khởi động.
2. `relay-client.js` kết nối WebSocket tới Durable Object của phòng (`/api/room/<mã phòng>/ws?adminSecret=…`), và gọi `POST /admin/config` để đăng ký cấu hình phòng. Quyền đặt/đặt lại `adminSecret`: đang giữ đúng secret, hoặc **chủ phòng** (token Cognito có email trùng `operatorEmail` của phòng).
3. Điện thoại quét QR hoặc mở link `https://channel.worship-official.link/m/?room=<mã>` → `POST /join` (tên + mật khẩu phòng) → token; downstream là **WebSocket** (không dùng SSE).
4. Điện thoại gửi bằng `fetch` POST; Durable Object fan-out cho các điện thoại khác và cho operator (client relay gọi `onEvent` → `main.js` gửi `band-comm-event` tới sidebar).
5. Operator thao tác trong sidebar → `electronAPI.bandComm.*` → `main.js` → `commServer.operator*()` (tên biến giữ nguyên, thực chất là relay client).
6. Cấu hình lưu ở `userData/band-comm.json` (`relayAdminSecret` được mã hóa), phiên operator ở `band-comm-operator.json` (token mã hóa).
7. **Ảnh hợp âm**: client đã join thêm được, chỉ tự xóa được ảnh mình đăng (`ownerId` so theo `profileId`); R2 tự xóa sau 4 ngày (lifecycle rule `expire-4d`).
8. **Setlist**: điện thoại gửi `POST /setlist`; operator nhận (qua WebSocket hoặc kéo từ hộp thư cloud khi vừa mở máy) và "Nạp" thay thế toàn bộ Schedule. Các endpoint ghi dành riêng cho operator (`/library-sync`, `/setlist/ack`, `GET /setlist`, `/gallery*`) yêu cầu `X-Admin-Secret` (chế độ `OPERATOR_AUTH_MODE`, xem `cloud/worker/wrangler.toml`).

## Mô hình bảo mật (tóm tắt)

- **Ranh giới tin cậy:** renderer coi như có thể bị chiếm. `contextIsolation`, `sandbox`, không `nodeIntegration`; CSP trên `index.html`/`live.html` (không nạp script/phông/ảnh từ ngoài); chặn điều hướng/`window.open`/webview; quyền Chromium mặc định từ chối.
- **IPC:** bọc toàn bộ `ipcMain.handle` kiểm nguồn gọi; đường dẫn do renderer gửi (`save-schedule-to-path`, `import-songs-from-file`, `mediaPath`) chỉ được tin khi đã đi qua dialog của main. Bảng audit: `docs/ipc-audit.md`.
- **Bí mật trên đĩa:** token Cognito và `relayAdminSecret` mã hóa bằng Electron `safeStorage` (DPAPI trên Windows).
- **Đóng gói:** Electron fuses (`runAsNode`, `NODE_OPTIONS`, `--inspect` tắt; kiểm toàn vẹn `app.asar`, chỉ nạp từ asar). Dữ liệu import (JSON/XML/DOCX) được kiểm tra kích thước, schema, loại trùng theo nội dung.
- **Relay:** xem `docs/microsoft-store-readiness.md` (B-17, B-18, B-19) và `docs/runbooks/xoa-du-lieu-nguoi-dung.md`.

## File chịu trách nhiệm chính

| File | Trách nhiệm |
|---|---|
| `main.js` | Cửa sổ, menu, IPC, protocol `app-media://`, lưu file an toàn, client relay, hardening renderer |
| `preload.js` | API cầu nối cho renderer |
| `index.html` | Library, schedule, editor bài hát (modal `#song-editor-modal`, giao diện kiểu Windows cổ điển có chủ đích), preview, control live, sidebar `#bandPanel` |
| `live.html` | Hiển thị chữ/background trên màn hình chiếu |
| `src/schema.js` | Migrate và validate item |
| `src/library-sync.js` | Gộp thư viện từ bản cài cũ / thư mục dữ liệu cũ |
| `src/band-comm/relay-client.js` | Client WebSocket operator + đồng bộ thư viện/ảnh nền lên cloud + kéo bài mới chờ duyệt |
| `src/band-comm/store.js` | Đọc/ghi `band-comm.json`, hồ sơ nút, `cloudRoomId`, `relayAdminSecret` (mã hóa) |
| `src/band-comm/operator-auth.js` | Phiên đăng nhập Cognito của operator (token mã hóa) |
| `cloud/worker/src/worker.js` | Endpoint HTTP của relay (KV/R2), xác thực operator qua Durable Object |
| `cloud/worker/src/room-relay.js` | Durable Object: realtime, tài khoản thành viên, hồ sơ, `songInbox`, `bgManifest`, `/admin/verify`, `/admin/purge` |
| `cloud/identity/src/worker.js` | Cầu nối AWS Cognito (SigV4), quản trị operator/phòng/thành viên, gửi mail |
| `comm/mobile/`, `comm/setlist/` | Trang web cho điện thoại ban hát / soạn setlist |
| `scripts/` | `fetch-google-fonts.js`, `make-store-screenshots.mjs`, `check-privacy-page.js`, `kill-running.js` |
| `test/` | Test unit (`*.test.mjs`) và e2e chạy app Electron thật (`*.e2e.mjs`, helper `_e2e-app.mjs`) |

## Dữ liệu lưu ở userData

`userData` **không cố định ở `%APPDATA%`** — `main.js` (`applyStoredUserDataLocation()` chạy trước `app.whenReady()`, `promptUserDataLocationIfNeeded()` chạy trong đó) cho phép người dùng chọn ổ khác (marker `datadir.json` ở vị trí mặc định). Bản Microsoft Store (MSIX) ảo hóa `%APPDATA%` nên dữ liệu ở thư mục mặc định bị xóa khi gỡ cài đặt; app cảnh báo trong Cài đặt → Dữ liệu.

- `songs.json`, `bible.json`, `settings.json`
- `media/` — ảnh/video nền do người dùng nhập
- `bible-versions/` — XML Kinh Thánh do người dùng nhập; `bible-versions.json` — sổ đăng ký bản dịch
- `bible-cache-<xmlName>.json` — cache parse
- `style-templates.json`, `custom-fonts.json`, `custom-fonts/`
- `.backup.1/.backup.2/.backup.3` — backup luân phiên
- `band-comm.json` — cấu hình Kênh Band (mật khẩu phòng, `cloudRoomId`, hồ sơ nút, `relayAdminSecretEnc`…)
- `band-comm-operator.json` — phiên đăng nhập operator (token mã hóa)
- `band-comm-media/`, `band-comm-gallery.json` — dữ liệu ảnh hợp âm cục bộ

## Đặc điểm quan trọng

- Renderer không dùng `require()` trực tiếp
- `index.html` là monolith, nên mỗi thay đổi phải rất có chủ đích; sau khi đổi class Tailwind phải `npm run build:css`
- `live.html` dùng virtual canvas và crossfade double-buffer
- `main.js` có safe write + backup rotation, không được ghi đè trực tiếp kiểu rủi ro
- Bible XML được parse (regex) và cache theo file nguồn; nhập file qua `validateBibleXmlText`
- Bản phát hành không kèm dữ liệu; code phải chạy được khi `getBundledDataDirs()` rỗng
