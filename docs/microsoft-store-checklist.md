# Checklist phát hành Microsoft Store

Theo dõi tiến độ. Chi tiết lý do và cách làm: `docs/microsoft-store-readiness.md` (mã B-xx trỏ tới bảng phát hiện trong đó).
Quy ước: 🔴 chặn nộp · 🟡 nên làm trước khi nộp · ⚪ làm được sau. Đánh `[x]` khi xong và có bằng chứng (commit, file, ảnh chụp, báo cáo).

---

## LỘ TRÌNH XỬ LÝ (cập nhật 2026-10-03, theo thứ tự làm)

**Trạng thái Partner Center:** Product submission "In draft" — Packages ✅ Validated/Complete (`Presentation For Church 3.1.10.appx`); Pricing and availability, Properties, Age ratings, Store listings: Not started; Submission options: Incomplete. Tên app giữ **3 tháng** (khoảng đến 03/01/2027, xem ngày chính xác trong Partner Center).
Ký hiệu: 👤 bạn làm · 🤖 tôi làm được ngay · 🤝 cần cả hai · ⏳ chờ điều kiện.

### Bước 1 — Mở khóa các mục bắt buộc (không có bước này không nộp được)
- [ ] 👤 1.1 **Pricing and availability:** Free, chọn thị trường (Việt Nam trước nếu muốn), Public, hiển thị trên Store. *(5 phút)*
- [x] 🤝 1.2 **Chính sách riêng tư (URL công khai)** — chặn mục Properties.  
  ↳ **ĐÃ ĐĂNG 2026-10-03** tại https://worship-official.link/privacy (200, song ngữ, email đã điền, đã kiểm trên mạng). Dùng URL này ở Partner Center → Properties.
  - 👤 Điền: tên người/tổ chức phát hành, email liên hệ quyền riêng tư, thời hạn lưu dữ liệu, quy trình xóa tài khoản (đề xuất: xóa thủ công khi có email yêu cầu, trả lời trong N ngày).
  - 🤖 Tôi viết bản cuối từ `docs/drafts/privacy-policy.vi.md`, tạo trang `website/privacy.html` (đúng CSP của website), và sau khi bạn đồng ý mới deploy lên `worship-official.link/privacy`.
- [ ] 👤 1.3 **Properties:** danh mục Productivity, dán URL chính sách riêng tư, website `https://worship-official.link`. (`docs/drafts/store-listing.vi.md` mục 2)
- [ ] 👤 1.4 **Age ratings:** trả lời bảng IARC; nhớ khai **"người dùng giao tiếp với nhau"** (Kênh Band). (mục 3 của nháp)
- [x] 🤖 1.5 **Ảnh chụp màn hình** (ít nhất 1, nên 4–6, ≥ 1366×768): tôi chụp bằng chính app thật, dùng **file mẫu (nội dung giả)** và ảnh nền do chính tôi tạo, che mọi thông tin cá nhân — bạn không cần chụp tay. *(cần bạn đồng ý để tôi chạy app và lưu ảnh vào `docs/drafts/screenshots/`)*  
  ↳ xong 2026-10-03: 4 ảnh 1920×1080 ở `docs/drafts/screenshots/` (script `scripts/make-store-screenshots.mjs`), đã soát không lộ thông tin cá nhân.
- [x] 🤖 1.6 **Store logos** (ảnh vuông 1080×1080 và các cỡ Partner Center yêu cầu): tôi tạo từ `icon.jpg`, kể cả các scale 125/150/200/400 còn thiếu cho gói.  
  ↳ xong 2026-10-03: 20 file scale trong `build/appx/` + `docs/drafts/store-assets/store-logo-1080x1080.png` (Partner Center từ chối 300×300, chỉ nhận PNG 1080×1080 hoặc 2160×2160; nguồn `icon.jpg` 732px nên phóng lên 1080, hơi mềm).
- [ ] 👤 1.7 **Store listings (vi-VN và en-US):** dán mô tả, tính năng, từ khóa, "What's new", bản quyền từ `docs/drafts/store-listing.vi.md` mục 4–5; tải ảnh ở 1.5 và logo ở 1.6.
- [ ] 🤝 1.8 **Tài khoản thử cho Kênh Band** (người duyệt cần đăng nhập thử): bạn tạo một tài khoản operator **riêng cho việc chứng nhận** và một mã phòng; không dùng tài khoản thật.
- [ ] 👤 1.9 **Submission options:** dán lời giải trình `runFullTrust` và "Notes for certification" (mục 7 của nháp), điền tài khoản thử từ 1.8. → mục này hết "Incomplete".

### Bước 2 — Giảm rủi ro bị từ chối trước khi bấm Submit
- [ ] 🤖 2.1 **Commit và gắn tag `v3.1.10`** để gói đã nộp khớp với mã nguồn (hiện *toàn bộ thay đổi chưa commit*, gồm cả backend đã deploy). *(chỉ làm khi bạn bảo)*
- [ ] 🤝 2.2 **Cài thử gói MSIX trên máy thật** bằng chứng chỉ tự ký (Subject `CN=7AC85BE8-EB2F-4CC6-BD67-37D5C5204F9B`): kiểm tra khởi động, dữ liệu, nhập dữ liệu, file `.bcsch`, Kênh Band, offline, gỡ cài đặt; chạy **WACK**. *(cần bạn trả lời "chạy"; tôi gỡ chứng chỉ thử sau khi xong)*
- [ ] 👤 2.3 **Thử cửa sổ Live với máy chiếu/màn hình thứ hai** (tôi chưa kiểm chứng bằng 2 màn hình thật).
- [ ] 👤 2.4 Kiểm tra tên trên trang app trong Partner Center trùng **"Presentation For Church"**.
- [ ] 👤 2.5 Hai người cùng đọc lại toàn bộ form trước khi nộp.

### Bước 3 — Nộp và theo dõi
- [ ] 👤 3.1 **Submit for certification** (chờ khoảng 1–3 ngày làm việc). Nếu bị yêu cầu sửa: gửi tôi nguyên văn lý do.
- [ ] 🤖 3.2 Sửa theo phản hồi, tăng version (`3.1.11`), build lại, nộp lại.
- [ ] 👤 3.3 Sau khi lên Store: theo dõi **Health/crash 72 giờ đầu**; cập nhật hướng dẫn người dùng "Cài từ Store".

### Bước 4 — Backend và vận hành (làm khi đủ điều kiện)
- [ ] ⏳ 4.1 **Chuyển `OPERATOR_AUTH_MODE` sang `enforce`** và deploy lại `cloud/worker`. Điều kiện: mọi máy operator đã cài 3.1.10 trở lên. *(tôi làm sau khi bạn xác nhận)*
- [ ] ⏳ 4.2 Kiểm thử "token operator A xóa member của operator B → 403" (cần 2 tài khoản operator thật).
- [ ] 🤝 4.3 `SECURITY.md` công khai (cần email báo lỗi) và quy trình xoay `relayAdminSecret` khi nghi bị lộ.

### Bước 5 — Dọn dẹp, không chặn việc nộp
- [ ] 🤝 5.1 **Bản cài ngoài Store (SmartScreen / Smart App Control):** gửi tôi kết quả `Get-MpComputerStatus | Select SmartAppControlState` và thông báo chặn chính xác; chọn hướng (chỉ phát cho máy tự quản lý, hoặc SignPath nếu mở nguồn).
- [ ] 🤝 5.2 **Repo GitHub đang public và còn theo dõi `data/*.xml`, `songs.json`:** quyết định gỡ khỏi bản theo dõi (giữ lịch sử) hay xóa cả lịch sử.
- [ ] 🤖 5.3 Bỏ `script-src 'unsafe-inline'` (chuyển ~124 inline handler sang `addEventListener`).
- [ ] 🤖 5.4 Đọc nốt ~40% handler IPC còn phân loại theo tên; whitelist khóa cho `save-settings`.
- [x] 🤖 5.5 SBOM CycloneDX; file giấy phép riêng của Material Symbols; nâng cấp công cụ build để hết 13 cảnh báo `npm audit` (dev).  
  ↳ SBOM CycloneDX xong: `sbom/cyclonedx.json` (23 thành phần production). Giấy phép Material Symbols đã nằm trong `licenses/fonts/Apache-2.0.txt`. Còn lại: 13 cảnh báo `npm audit` ở công cụ build (cần nâng bản major).
- [x] 🤖 5.6 Xóa file chết `src/js/core.js`, `utils.js`, `src/css/styles.css`, `edit-song.html`; viết lại `docs/architecture.md`, `README.md`, `band-comm-plan.md` (còn mô tả kiến trúc trước GĐ2).  
  ↳ xong 2026-10-03: đã xóa `src/js/core.js`, `utils.js`, `src/css/styles.css`, `edit-song.html`; viết lại `docs/architecture.md`, sửa `README.md`, `band-comm-plan.md` (gắn nhãn lịch sử), `CLAUDE.md`.
- [ ] 👤 5.7 Hai quyết định nhỏ: `Ctrl+O` có đổi sang "Mở Schedule" theo thông lệ không; thanh menu cấp 1 (File/Edit/View/Channel) có Việt hóa không.

### Con đường găng (chỉ những việc quyết định bạn nộp được sớm hay muộn)
1.2 chính sách riêng tư → 1.3 Properties → 1.7 listing → 1.9 submission options → 3.1 Submit.
Song song bạn làm 1.1, 1.4; tôi làm 1.5, 1.6 và viết 1.2. Việc **chậm nhất do bên ngoài**: 1.2 (cần bạn điền thông tin) và 1.8 (cần tài khoản thử).

---

## G0 — Quyết định & tài khoản (làm trước, không cần code)

- [ ] 🔴 Chốt nội dung đóng gói: lập bảng kê bản quyền cho từng mục (nguồn, giấy phép, quyền phân phối lại, bằng chứng) — **B-08**  
  ↳ **2026-10-03: đã chốt không đóng gói Kinh Thánh/bài hát/media** (xem `docs/drafts/content-license-inventory.md`). Còn lại: phông CMG Sans (#7) và `THIRD_PARTY_NOTICES.md`.
  - [ ] `EnglishNIVBible.xml`
  - [ ] `Bản_Dịch_Mới.xml`
  - [ ] `Bản_Phổ_Thông.xml` và `Ban_Pho_Thong_converted_to_XMLBIBLE.xml`
  - [ ] `Bible_Vietnamese_Version_1925.xml`
  - [ ] `songs.json`
  - [ ] Font `fonts/cmg-sans/` (đọc EULA: có cho nhúng/phân phối lại không)
  - [ ] Quyết định với mục không chứng minh được: bỏ khỏi gói, để người dùng tự import
- [x] 🔴 Đăng ký tài khoản Partner Center (cá nhân, xác minh giấy tờ + selfie); xác nhận Việt Nam được hỗ trợ  
  ↳ xong 2026-10-03
- [ ] 🔴 Bật MFA (passkey/app) cho tài khoản Microsoft đăng ký; email khôi phục riêng; cất mã khôi phục ngoài repo
- [ ] 🟡 Thêm người thứ 2 có quyền Manager, cũng bật MFA
- [x] 🔴 Reserve tên "Presentation For Church"; ghi lại Identity Name, Publisher (`CN=...`), PublisherDisplayName  
  ↳ đã giữ; identity ghi ở `build/store-identity.json`. **Tên giữ 3 tháng — phải nộp app trước hạn, nếu không bị thu hồi**
- [ ] 🟡 Bật MFA GitHub, Cloudflare, AWS; bật branch protection cho `main`

## G1 — Bảo mật & pháp lý (blocker kỹ thuật)

**Renderer / chuỗi cung ứng**
- [x] 🔴 Gỡ `cdn.tailwindcss.com`: build Tailwind ra CSS tĩnh, đóng gói (`index.html:9`) — **B-01**  
  ↳ đã build tĩnh: `npm run build:css` → `src/css/tailwind.generated.css`
- [x] 🔴 Tải font Google về cục bộ (`index.html:10-16`, `live.html:5`), dùng `@font-face` — **B-01**  
  ↳ `fonts/google/` + `src/css/google-fonts.css`, tạo bằng `scripts/fetch-google-fonts.js`
- [x] 🔴 Xác nhận UI chính chạy khi **tắt Internet** (cả operator và live)  
  ↳ đã kiểm tra: 0 request ra ngoài khi khởi động (CDP); CHƯA thử ngắt mạng thật
- [x] 🔴 Thêm CSP cho `index.html` và `live.html`; không còn `<script src="https://...">` — **B-02**  
  ↳ còn `script-src 'unsafe-inline'` do ~124 inline handler — xem ghi chú cuối file
- [x] 🟡 Thay `api.qrserver.com` bằng tạo QR cục bộ (`index.html:5004-5007`) — **B-05**  
  ↳ bỏ nhánh dự phòng, QR chỉ tạo cục bộ
- [x] 🟡 Thay `placehold.co` bằng ảnh nội bộ (`index.html:7497`) — **B-05**  
  ↳ 2 chỗ

**IPC / điều hướng**
- [x] 🔴 Helper `assertTrustedSender(event)` gọi đầu mọi `ipcMain.handle` (82 handler) — **B-03**  
  ↳ wrapper toàn cục quanh `ipcMain.handle` (main.js, đầu file)
- [x] 🔴 `will-navigate` + `setWindowOpenHandler` chặn điều hướng/cửa sổ lạ, chỉ cho `https:` allowlist — **B-03**  
  ↳ + chặn webview + permission deny-by-default
- [x] 🔴 Handler nhận đường dẫn (`import-songs-from-file`, `show-open-dialog-multi`…): chỉ tin đường dẫn do dialog của main trả về — **B-03**  
  ↳ save-schedule-to-path, import-songs-from-file, show-open-dialog-multi
- [x] 🟡 Khai báo tường minh `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` cho **cả live window** (`main.js:1128`) — **B-03/B-12**  
  ↳ cả hai cửa sổ
- [ ] 🟡 Lập bảng audit IPC: handler → tham số → tài nguyên → kiểm tra đầu vào — **B-16**  
  ↳ đã có `docs/ipc-audit.md` (80 handler); khoảng 40% mới phân loại theo tên (📝), cần đọc nốt rồi mới tick

**Xác thực & dữ liệu**
- [x] 🟡 Mã hóa token bằng `safeStorage`, di trú file `band-comm-operator.json` cũ, xóa bản rõ — **B-04**  
  ↳ đã test 6 kịch bản với DPAPI thật, có di trú file cũ
- [x] 🔴 Xác nhận đã `wrangler deploy` `cloud/identity` và `cloud/worker` bản vá; ghi lại commit đã deploy — **B-11**  
  ↳ 2026-10-03: `cloud/identity` đã vá (không token / JWT giả → 401 trên update-password, delete). `cloud/worker`: 400/health OK, nhưng xem B-17
  - [x] Request không token tới `/operator/*` → 401 (đã probe production 2026-10-03, kể cả JWT giả không chữ ký)
  - [ ] Token của người khác xóa/đổi mật khẩu member → 403 (cần 2 tài khoản operator thật để thử; chưa làm)
- [ ] 🟡 Kiểm tra `app.log` và log server không chứa token, Room Code, SĐT — **B-12**

**Phụ thuộc & build**
- [x] 🟡 `npm audit fix`; chạy lại import `.docx` (mammoth); `npm audit --omit=dev` về 0 high — **B-06**  
  ↳ prod: 0 lỗ hổng; còn 13 high thuộc chuỗi build (electron-builder, tailwind v3), chỉ vá bằng nâng major
- [x] 🔴 Bỏ `cloudflared` khỏi bản Store (config riêng) — **B-07**  
  ↳ bỏ luôn khỏi bản thường + bỏ `postinstall`
- [ ] ⚪ Xóa dead code: `syncBandTunnel`, `src/band-comm/server.js`, `scripts/fetch-cloudflared.js`, `vendor/cloudflared`, `postinstall`
- [x] 🟡 Sửa `build/installer.nsh`: chỉ kill `Presentation For Church.exe`, bỏ `electron.exe` — **B-09**  
  ↳ chỉ kill đúng exe của app
- [x] 🟡 Bỏ `edit-song.html` khỏi `files` — **B-12**
- [x] ⚪ Bật Electron fuses (5 fuse; xem changelog)  
  ↳ đã kiểm trên bản đóng gói thật. Cố ý KHÔNG tắt `grantFileProtocolExtraPrivileges` vì app nạp giao diện từ `file://`
- [ ] ⚪ Sinh SBOM (CycloneDX)  
  ↳ `THIRD_PARTY_NOTICES.md` + `licenses/fonts/` đã có và được đóng gói (2026-10-03); SBOM CycloneDX chưa làm

**Riêng tư & minh bạch**
- [ ] 🔴 Viết chính sách riêng tư, đăng tại `worship-official.link/privacy` — **B-14**
  - [ ] Dữ liệu thu thập: email, SĐT, tên hội thánh, khu vực, thư viện bài hát, tin nhắn ban hát
  - [ ] Nơi lưu (Cloudflare, AWS), thời hạn lưu, quyền xóa/xuất, liên hệ
- [ ] 🟡 Có luồng xóa tài khoản/dữ liệu
- [ ] 🟡 Tham vấn pháp lý Nghị định 13/2023/NĐ-CP
- [ ] 🟡 Thêm `SECURITY.md` (kênh báo lỗ hổng, thời gian phản hồi) — **B-15**
- [ ] 🟡 Màn hình "Giấy phép/Third-party" trong app

## G2 — Đóng gói MSIX

- [x] 🔴 Tạo `electron-builder.store.yml` (target `appx`, identity từ G0, không có `extraResources` cloudflared)  
  ↳ thực tế là `electron-builder.store.js` (YAML không nội suy env); build thử OK với identity giả, đã kiểm manifest
- [x] 🔴 Tài sản đồ họa trong `build/appx/`: StoreLogo, Square44x44, Square150x150, Wide310x150 (các scale)  
  ↳ mới có 4 file kích thước gốc (scale-100); nên làm thêm scale 125/150/200/400 từ logo vector
- [x] 🔴 Version dạng `x.y.z.0`  
  ↳ electron-builder tự sinh 3.1.9.0
- [ ] 🔴 Chuẩn bị giải trình capability `runFullTrust`
- [x] 🔴 File association `.bcsch` có trong manifest; nhấp đúp mở đúng app  
  ↳ manifest đã có; chưa thử nhấp đúp (cần cài được gói)
- [ ] 🟡 Đã grep: không còn chỗ ghi vào `__dirname`/`resourcesPath` (thư mục cài của MSIX chỉ đọc)
- [ ] 🔴 Thiết kế Export/Import dữ liệu giữa bản NSIS ↔ bản Store; cảnh báo "gỡ app sẽ mất dữ liệu" — **B-10**
- [ ] 🟡 Kiểm tra `library-sync` dò dữ liệu bản cũ có hoạt động qua ảo hóa MSIX

## G3 — Kiểm thử

- [ ] 🔴 Cài thử cục bộ (chứng chỉ tự ký, Subject khớp Publisher), sau đó gỡ chứng chỉ thử
- [ ] 🔴 Chạy WACK, sửa mọi lỗi, lưu báo cáo
- [ ] 🔴 Quét Defender và VirusTotal trên gói
- [ ] 🔴 Ma trận thủ công, máy trắng Windows 10 22H2 và Windows 11, tài khoản non-admin:
  - [ ] Cài mới / nâng cấp / gỡ
  - [ ] Live window trên máy chiếu thứ 2, cắm/rút màn hình
  - [ ] `app-media://` video/ảnh, thư mục media tùy chọn
  - [ ] Bible: nạp XML, tìm kiếm
  - [ ] Import `.docx`, import/export `.bcsch`
  - [ ] Kênh Band: đăng nhập, tạo phòng, điện thoại vào, mất mạng/nối lại, không trùng tin
  - [ ] Offline toàn bộ
  - [ ] Chạy liên tục 3 giờ (CPU/RAM)
- [ ] 🟡 Fuzz đầu vào độc hại: `.bcsch` (path traversal), XML bomb, `.docx`, payload XSS — **B-16**
- [ ] 🟡 Pentest backend sau khi deploy (bypass auth, IDOR giữa phòng, rate-limit, replay, WebSocket) — **B-16**
- [ ] 🟡 Dry-run một buổi nhóm thật trên bản MSIX

## G4 — Hồ sơ Partner Center

- [ ] 🔴 Mô tả vi-VN và en-US, chỉ nêu chức năng có thật
- [ ] 🔴 Ảnh chụp màn hình (≥1, nên 4–6; ≥1366x768), không chứa nội dung bản quyền hay logo bên thứ ba
- [ ] 🔴 URL chính sách riêng tư, trang hỗ trợ, email liên hệ
- [ ] 🔴 Bảng câu hỏi IARC (khai đúng tương tác trực tuyến qua Kênh Band)
- [ ] 🔴 Danh mục, giá miễn phí, thị trường (vi-VN trước)
- [ ] 🔴 Notes for certification: tài khoản thử Kênh Band, giải thích `runFullTrust`, các bước thử
- [ ] 🔴 Không dùng "EasyWorship" ở tên/mô tả/từ khóa/ảnh — **B-13**
- [ ] 🟡 Hai người cùng rà form trước khi bấm Submit

## G5 — Phát hành & vận hành

- [ ] 🔴 Build từ tag git sạch, `npm ci`, ghi SHA-256 gói
- [ ] 🔴 Nộp; xử lý phản hồi chứng nhận (dự trù 1–3 ngày làm việc + lần sửa)
- [ ] 🟡 Có người trực 72 giờ đầu: Partner Center Health/Crash
- [ ] 🟡 Lưu hồ sơ: báo cáo WACK, bảng kê bản quyền, bảng IPC, báo cáo pentest, tag/commit, SHA-256
- [ ] 🟡 Runbook sự cố: đẩy bản vá qua Store, thu hồi token Cognito/phòng ở server
- [ ] ⚪ Lịch rà soát mỗi quý: `npm audit`, cập nhật Electron, chính sách Store, quyền tài khoản
- [ ] ⚪ Giữ bản NSIS/portable song song (hướng dẫn "Unblock")

---

## Thứ tự đề xuất

1. G0 (song song: bảng kê bản quyền + đăng ký tài khoản + MFA)
2. G1 phần renderer (CDN → CSP) rồi IPC
3. G1 riêng tư + deploy backend
4. G2 → G3 → G4 → G5

---

## Ghi chú trạng thái (2026-10-03)

- Đã làm xong phần code của G1 (renderer, IPC, token, phụ thuộc, build). **Chưa làm:** bảng audit 82 IPC, `SECURITY.md`, chính sách riêng tư, bảng kê bản quyền (G0/B-08), Export/Import dữ liệu MSIX, G3–G5.
- **CSP còn `unsafe-inline` cho script** vì `index.html` có ~124 inline handler (`onclick=…`) và 3 khối script inline. Vẫn chặn script/font/ảnh từ nguồn ngoài, `connect-src` chỉ `self`, `object-src`/`base-uri`/`frame-src` đóng. Bỏ `unsafe-inline` cần chuyển handler sang `addEventListener` (việc lớn, làm riêng).
- **B-17 + B-19 (backend relay):** đã sửa trong code + test (xem `docs/microsoft-store-readiness.md`). **Chưa deploy.** Thứ tự: `wrangler deploy` (log mode) → phát hành app mới → đổi `OPERATOR_AUTH_MODE` sang `"enforce"` → deploy lại.

- **Dữ liệu người dùng (2026-10-03):** bản phát hành không đóng gói `data/`, người dùng tự nhập theo `templates/import/`. Đã kiểm trên `.exe` đóng gói: người dùng cũ giữ nguyên dữ liệu và chạy bình thường; luồng import bài hát/Kinh Thánh đã được kiểm tra dữ liệu + test e2e (`test/data-import-flow.e2e.mjs`). Chưa kiểm: đồng bộ dữ liệu từ bản NSIS sang bản MSIX trên máy thật (cần cài gói ký thử).

- **Gói cần nộp (2026-10-03):** `dist-store/Presentation For Church 3.1.12.appx` (SHA-256 `a93cfc9271924c6344b232b4360dd9f82c6a231c9766a2936ed2f1dad0145db8`). Gói 3.1.10 đang ở bản nháp Partner Center phải **xóa và tải lại bằng 3.1.12** (mục Packages).
