# Audit IPC (main process)

Ngày lập: 2026-10-03. Phạm vi: 80 `ipcMain.handle` trong `main.js` (sau khi gỡ 4 handler chết ở mục 3). Mục đích: ghi rõ mỗi handler cho renderer đụng tới tài nguyên nào, tin tham số nào, và đã/chưa được bảo vệ ra sao. Đây là một phần của B-03/B-16 trong `docs/microsoft-store-readiness.md`.

**Mức đọc code:** 🔍 = đã đọc thân handler; 📝 = chỉ phân loại theo tên/chữ ký (cần đọc thêm trước khi coi là "đã audit xong"). Bảng này **chưa phải audit đầy đủ**: khoảng 40% handler ở mức 📝.

## 1. Kiểm soát chung (áp dụng cho mọi handler)

| Lớp | Cơ chế | Vị trí |
|---|---|---|
| AuthZ theo nguồn gọi | Wrapper quanh `ipcMain.handle`: từ chối nếu `event.senderFrame.url` không phải `index.html`/`live.html` nạp từ `file://` | `main.js` đầu file (`isTrustedSender`) |
| Điều hướng | `will-navigate` chặn mọi URL ngoài hai trang trên; `window.open` bị `deny` (link ngoài chỉ `https:`/`mailto:` qua `openExternalSafe`); webview bị chặn | `app.on('web-contents-created')` |
| Quyền Chromium | Deny-by-default; chỉ `clipboard-sanitized-write`, `fullscreen` | `installPermissionPolicy()` |
| Cách ly renderer | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (cả 2 cửa sổ); CSP trên cả 2 trang | `createWindow`, `createLiveWindow`, `<meta CSP>` |
| Đường dẫn do renderer gửi | KHÔNG tin; chỉ nhận đường dẫn main đã thấy qua dialog/OS (`approvedSchedulePaths`, `approvedSongImportPaths`, `approvedMediaFolders`) | `approvePath()` / `isApprovedPath()` |

Hạn chế còn lại: nếu kẻ tấn công chạy được script trong `index.html` (CSP còn `script-src 'unsafe-inline'`), họ **vẫn gọi được mọi IPC hợp lệ** như người dùng. Wrapper chặn frame lạ, không chặn script lạ trong frame hợp lệ. Vì vậy từng handler vẫn phải tự kiểm tra đầu vào.

## 2. Bảng handler

Mức rủi ro nếu renderer bị chiếm: **Cao** (đọc/ghi ngoài thư mục dữ liệu, chạy tiến trình, đổi danh tính/quyền), **Vừa** (ghi dữ liệu app, gọi mạng thay người dùng), **Thấp** (đọc dữ liệu app, hiển thị).

### 2.1 Hệ thống, cài đặt, dữ liệu cục bộ

| Channel | Tham số từ renderer | Tài nguyên | Kiểm tra hiện có | Rủi ro | Mức đọc | Ghi chú / việc cần làm |
|---|---|---|---|---|---|---|
| `get-app-version` | — | đọc | — | Thấp | 📝 | |
| `get-cpu-usage` | — | đọc | — | Thấp | 📝 | |
| `quit-app` | — | thoát app | — | Thấp | 🔍 | |
| `select-folder` | — | dialog thư mục | Dialog của main; ghi nhận vào `approvedMediaFolders` | Thấp | 🔍 | |
| `load-settings` | — | đọc settings | — | Thấp | 🔍 | |
| `save-settings` | `data` (object tùy ý) | **ghi** settings.json | Chỉ làm sạch `liveWindowBounds`; **`mediaPath` chỉ nhận giá trị hiện tại hoặc thư mục đã qua dialog** (mới, 2026-10-03) | Vừa | 🔍 | Còn lại: toàn bộ object lưu nguyên, không schema. Nên whitelist khóa. |
| `load-system-fonts` | — | đọc | — | Thấp | 📝 | |
| `load-custom-fonts` | — | đọc | — | Thấp | 📝 | |
| `import-custom-font` | — | dialog → copy `.ttf/.otf` vào `custom-fonts/` | Dialog của main, kiểm đuôi, tên file có tiền tố thời gian | Thấp | 🔍 | |
| `load-style-templates` | — | đọc | — | Thấp | 📝 | |
| `save-style-template` | `payload` (object) | ghi `style-templates` | Làm sạch tên/scope/style; id tùy ý nhưng chỉ làm khóa trong JSON, không thành đường dẫn | Thấp | 🔍 | |
| `delete-style-template` | `templateId` | ghi | `String().trim()`, lọc theo id | Thấp | 🔍 | |
| `duplicate-style-template` | `templateId` | ghi | tương tự | Thấp | 📝 | |
| `get-data-path-info` | — | đọc | — | Thấp | 📝 | |
| `open-data-folder` | — | `shell.openPath(userDataPath)` | Đường dẫn cố định phía main | Thấp | 🔍 | |
| `change-data-folder` | — | dialog → di chuyển/đặt `userData` | Dialog của main; ghi `datadir.json` | Vừa | 🔍 | Cần kiểm thử dưới MSIX (A4). |
| `reload-default-data` | — | ghi songs.json từ bản đóng gói | Chỉ dùng dữ liệu đóng gói | Thấp | 🔍 | Liên quan B-08 (nội dung đóng gói). |
| `open-external` | `url` | `shell.openExternal` | Allowlist `https:`/`mailto:` (`openExternalSafe`) | Vừa | 🔍 | Vẫn mở được mọi domain https (phishing). Chấp nhận được; có thể thu hẹp theo allowlist domain nếu cần. |

### 2.2 Thư viện bài hát và Kinh Thánh

| Channel | Tham số | Tài nguyên | Kiểm tra hiện có | Rủi ro | Mức đọc | Ghi chú |
|---|---|---|---|---|---|---|
| `load-songs` | — | đọc | — | Thấp | 📝 | |
| `save-song` | `rawSong` | ghi songs.json | `validateItem`/`migrateItem` (src/schema.js) | Vừa | 📝 | Xác nhận schema chặn trường lạ; sau đó `syncLibraryToCloud`. |
| `delete-song` | `data` | ghi | 📝 | Vừa | 📝 | |
| `export-songs-to-file` | — | dialog lưu | Dialog của main | Thấp | 📝 | |
| `import-songs-from-file` | `filePaths[]` | **đọc file** (.txt/.docx/.json), ghi songs.json | **Chỉ nhận đường dẫn đã qua `show-open-dialog-multi`** (mới) | Vừa | 🔍 | `.docx` đi qua `mammoth` (0 lỗ hổng đã biết, 2026-10-03). |
| `show-open-dialog-multi` | `options.title` | dialog | **Không còn nhận `options` tùy ý**; filters cố định; ghi nhận file vào allowlist (mới) | Thấp | 🔍 | |
| `scan-and-sync-previous-library` | — | đọc thư mục dữ liệu bản cũ | Đường dẫn do main dò | Vừa | 📝 | Đọc `datadir.json` → có thể trỏ ổ khác; xem `src/library-sync.js`. |
| `import-library-from-folder` | — | dialog thư mục → đọc | Dialog của main | Vừa | 📝 | |
| `bulk-replace-library-text` | `payload` | ghi songs/bible | Tạo regex từ chuỗi người dùng (`buildReplaceRegex`) | Vừa | 🔍 | Kiểm tra `buildReplaceRegex` escape đúng để tránh ReDoS do người dùng nhập. |
| `load-bible`, `load-bible-xml`, `load-bible-versions`, `load-bible-version-manager-list` | — | đọc | — | Thấp | 📝 | |
| `load-bible-parsed` | `fileName` | đọc XML + ghi cache | `path.basename` + NFC (`normalizeBibleFileName`) → không thoát thư mục | Thấp | 🔍 | |
| `import-bible-version` | — | dialog → copy XML vào `userBibleDataPath` | Dialog của main, kiểm đuôi `.xml`, `basename` | Thấp | 🔍 | |
| `rename-bible-version`, `delete-bible-version` | `payload.fileName` | ghi/xóa file XML của user | `basename` + phải khớp danh sách có sẵn; chỉ xóa file nguồn `user` | Thấp | 🔍 | |
| `set-default-bible-version`, `save-bible-version-order` | `payload` | ghi registry | 📝 | Thấp | 📝 | |

### 2.3 Lịch trình, media, cửa sổ live

| Channel | Tham số | Tài nguyên | Kiểm tra hiện có | Rủi ro | Mức đọc | Ghi chú |
|---|---|---|---|---|---|---|
| `show-open-dialog` | — | dialog → đọc `.bcsch` | Dialog của main; ghi nhận vào `approvedSchedulePaths` | Thấp | 🔍 | |
| `show-save-dialog` | `d` (dữ liệu) | dialog → ghi `.bcsch` | Dialog của main; ghi nhận đường dẫn | Thấp | 🔍 | |
| `save-schedule-to-path` | `{filePath, data}` | **ghi file** | Đuôi `.bcsch` **và** phải nằm trong `approvedSchedulePaths` (mới) | Vừa | 🔍 | Trước đây ghi được mọi đường dẫn `.bcsch`. |
| `import-media` | — | dialog → copy vào thư mục media | Dialog của main, lọc đuôi | Thấp | 📝 | |
| `load-media` | — | liệt kê thư mục media | Gốc = `mediaPath` (đã khóa bằng `approvedMediaFolders`) | Thấp | 📝 | |
| `open-live-window`, `close-live-window` | `bounds` | cửa sổ | `sanitizeLiveWindowBounds` | Thấp | 🔍 | |
| `live-send-content`, `live-send-background`, `live-send-clear` | `d` | chuyển tiếp sang live window | Không kiểm tra nội dung; live.html phải escape khi render | Vừa | 🔍 | Live window có `app-media://`; nội dung từ `.bcsch` không tin cậy → đã có chặn path traversal ở protocol. |

### 2.4 Kênh Band và tài khoản

| Channel | Tham số | Tài nguyên | Kiểm tra hiện có | Rủi ro | Mức đọc | Ghi chú |
|---|---|---|---|---|---|---|
| `band-operator-auth-status` | — | đọc phiên | — | Thấp | 📝 | Không trả token cho renderer? **Cần xác minh** giá trị trả về. |
| `band-operator-request-access`, `band-operator-forgot-password` | `{email}` | gọi `identity` (mạng) | 📝 | Vừa | 📝 | Rate-limit nằm ở server. |
| `band-operator-auth-login`, `band-operator-auth-new-password` | `{email, password}`/`{newPassword}` | gọi `identity`, lưu token **mã hóa** | Token mã hóa `safeStorage` (mới) | Cao | 📝 | Mật khẩu đi qua renderer (không tránh được với form hiện tại). Không log mật khẩu — cần grep xác nhận. |
| `band-operator-auth-logout` | — | xóa phiên | — | Thấp | 📝 | |
| `band-comm-start`, `band-comm-stop`, `band-comm-status` | — | relay client | `startBandComm` kiểm `isLoggedIn()` ở main | Vừa | 🔍 (start) | |
| `band-comm-get-config`, `band-comm-save-config` | `cfg` | đọc/ghi `band-comm.json` | `store.save` chuẩn hóa field; **`relayAdminSecret` bị lọc khỏi phản hồi và renderer không đặt được** (mới, B-18); `cloudRoomId` giữ nguyên ở main | Vừa | 🔍 | Còn `relayAdminSecret` lưu rõ trên đĩa. |
| `band-accounts-*` (6 handler) | `payload` | gọi relay `/admin/accounts/*` | AuthZ ở server (secret của operator) | Cao | 📝 | Tạo/đổi mật khẩu/xóa tài khoản band member. Kiểm tra server từ chối khi thiếu secret (B-17). |
| `band-comm-gallery-*` (6 handler) | `payload`, `id`, `ids` | upload/xóa ảnh trên relay | Kích thước/định dạng kiểm ở `relay-client.js` và server | Vừa | 🔍 (add) | Server giới hạn `MAX_IMAGE_BYTES`; xác nhận client cũng giới hạn trước khi đọc vào RAM. |
| `band-comm-presence-list`, `band-comm-blocked-list`, `band-song-pending` | — | đọc | — | Thấp | 📝 | |
| `band-song-reject`, `band-comm-kick`, `band-comm-block`, `band-comm-unblock` | `{webId, reason}` / `clientId` / `profileId` | gửi lệnh qua relay | 📝 | Vừa | 📝 | |
| `band-comm-send`, `band-comm-ack`, `band-comm-resolve` | `payload` | gửi tin qua relay | Server giới hạn độ dài/rate-limit | Vừa | 📝 | |

## 3. Handler đã gỡ

`band-comm-open-firewall`, `band-comm-tunnel-check-login`, `band-comm-tunnel-login`, `band-comm-tunnel-create` (kèm bind trong `preload.js`: `openFirewall`, `tunnelCheckLogin`, `tunnelLogin`, `tunnelCreate`).

Lý do:
- **Không có caller nào** trong `index.html`/`live.html` (code chết từ GĐ2: LAN server + Cloudflare Tunnel).
- `band-comm-open-firewall` **ghi script PowerShell vào `%TEMP%\bandcomm-fw.ps1` rồi chạy nâng quyền qua UAC với `-ExecutionPolicy Bypass`**. Đường dẫn dự đoán được và nằm trong thư mục ghi được bởi tiến trình cùng người dùng: một tiến trình khác của cùng người dùng có thể ghi đè script giữa lúc ghi và lúc chạy để lấy quyền admin (khi người dùng bấm "Yes" ở UAC). Ngoài ra nó thêm luật tường lửa inbound cho app, điều Store reviewer rất dễ nghi ngờ.
- Các handler `tunnel-*` spawn `cloudflared` (đã không còn đóng gói).

Phần helper chết còn lại (`spawnAsync`, `resolveCloudflaredCmd`, `syncBandTunnel`, `src/band-comm/server.js`, `scripts/fetch-cloudflared.js`) chưa xóa; không còn đường nào từ renderer tới chúng.

## 4. Việc còn lại để coi như audit xong

1. Đọc nốt các handler 📝 (đặc biệt `save-song`, `delete-song`, `band-accounts-*`, `band-comm-gallery-*`, `band-operator-auth-*`).
2. `save-settings`: chuyển sang whitelist khóa thay vì lưu nguyên object.
3. Xác nhận `band-operator-auth-status` và các handler trả dữ liệu **không trả token/mật khẩu/secret** về renderer.
4. Grep log: không `console.log` mật khẩu, token, Room Code.
5. Bỏ `script-src 'unsafe-inline'` (refactor ~124 inline handler) để wrapper IPC thật sự có ý nghĩa chống XSS.
6. Xóa helper chết ở mục 3.
