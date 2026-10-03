# Chuẩn bị phát hành lên Microsoft Store + Enterprise Review

Tài liệu này gồm hai phần: (A) quy trình và kỹ thuật để đưa app lên Microsoft Store, (B) đợt review mức enterprise (bảo mật, quyền riêng tư, pháp lý, chuỗi cung ứng, vận hành). Các phát hiện ở phần B dựa trên code thực tế của repo tại thời điểm viết (v3.1.8, Electron 41), có ghi file/dòng để kiểm chứng.

Ngày lập: 2026-10-02. Các thông tin về chính sách/giá của Microsoft thay đổi theo thời gian, mục nào ghi **[xác minh]** cần đối chiếu lại với tài liệu hiện hành của Microsoft trước khi làm.

---

## 0. Kết luận nhanh

**Trạng thái hiện tại: NO-GO.** Có 3 nhóm blocker phải xong trước khi nộp:

1. **Pháp lý/IP (B-08):** app đóng gói sẵn 5 bản Bible (gồm NIV, Bản Dịch Mới, Bản Phổ Thông), `songs.json` và bộ font CMG Sans. Chưa có bằng chứng giấy phép phân phối. Đây là lý do từ chối phổ biến nhất của Store (chính sách sở hữu trí tuệ).
2. **Bảo mật renderer (B-01, B-02, B-03):** cửa sổ operator nạp script từ CDN bên ngoài, không có CSP, và có 82 IPC handler trong main process không kiểm tra nguồn gọi. Đây là chuỗi tấn công hoàn chỉnh nếu một nguồn bên ngoài bị chiếm quyền (xem 5.1).
3. **Quyền riêng tư (B-14):** Store yêu cầu chính sách riêng tư công khai khi app truy cập Internet/dữ liệu cá nhân. App thu thập email, SĐT, tên hội thánh, khu vực khi xin cấp quyền, và đồng bộ thư viện bài hát lên cloud. Chưa có trang chính sách riêng tư.

Phần còn lại (đóng gói MSIX, tài sản đồ họa, hồ sơ listing) là việc kỹ thuật, làm được trong vài ngày.

---

## Phần A. Quy trình đưa app lên Store

### A1. Chọn hình thức nộp

| Hình thức | Ai ký | Phù hợp? |
|---|---|---|
| **MSIX/AppX** (app đóng gói) | **Microsoft ký lại** sau khi duyệt | ✅ Chọn cái này. Không cần mua chứng chỉ. |
| EXE/MSI (nộp link installer) | Bạn phải ký bằng chứng chỉ của CA tin cậy | ❌ Không dùng được: chính là vấn đề chưa có code signing ban đầu. **[xác minh]** |

Giữ song song bản NSIS/portable cho người dùng ngoài Store (vẫn bị cảnh báo SmartScreen, hướng dẫn "Unblock" như đã trao đổi).

### A2. Điều kiện tiên quyết về tài khoản (Identity & Access)

Tài khoản Partner Center là **tài sản có đặc quyền cao nhất** của chuỗi phát hành: ai chiếm được nó là đẩy được bản cập nhật độc hại đến toàn bộ người dùng, đã được Microsoft ký sẵn.

- [ ] Đăng ký tài khoản **cá nhân** (miễn phí từ 2025, cần giấy tờ tùy thân có ảnh + selfie; tài khoản tổ chức mất $99 một lần). **[xác minh]** Việt Nam có nằm trong danh sách thị trường hỗ trợ không.
- [ ] Tài khoản Microsoft dùng để đăng ký: **bật MFA** (ưu tiên passkey/app, không dùng SMS), email khôi phục riêng, không dùng chung với tài khoản cá nhân hằng ngày.
- [ ] Tối thiểu **2 người** có quyền Owner/Manager (tránh phụ thuộc một cá nhân; người rời đi không làm mất app). Mọi thành viên đều bật MFA.
- [ ] Lưu mã khôi phục tài khoản ở nơi tách biệt (không để trong repo).
- [ ] Đặt tên app trong Partner Center (**reserve name**): "Presentation For Church". Không dùng "EasyWorship" hay tên sản phẩm thương mại khác trong tên, mô tả, từ khóa, ảnh chụp (rủi ro nhãn hiệu).

Sau khi giữ tên, Partner Center cấp các giá trị bắt buộc cho manifest: **Package/Identity/Name**, **Package/Identity/Publisher** (dạng `CN=...GUID...`), **PublisherDisplayName**. Ghi lại ở nơi an toàn.

### A3. Cấu hình build MSIX với electron-builder

Dùng **một file cấu hình riêng cho Store** thay vì nhồi chung vào `package.json`, để bản Store không mang theo thứ không cần thiết (đặc biệt `cloudflared.exe`, xem B-07).

Ví dụ `electron-builder.store.yml` (tên khóa cần đối chiếu với tài liệu electron-builder 26 **[xác minh]**):

```yaml
appId: com.church.presentation
productName: Presentation For Church
directories:
  output: dist-store
files:               # copy danh sách từ package.json, bỏ edit-song.html (dead code)
  - main.js
  - preload.js
  - index.html
  - live.html
  - src/**/*
  - comm/**/*
  - data/**/*        # tùy kết quả B-08: bỏ phần nội dung chưa rõ giấy phép
  - fonts/**/*
  - package.json
win:
  target: appx
  icon: icon.ico
  # KHÔNG có extraResources cloudflared
appx:
  identityName: <Package/Identity/Name từ Partner Center>
  publisher: <Package/Identity/Publisher từ Partner Center>
  publisherDisplayName: <PublisherDisplayName>
  applicationId: PresentationForChurch
  displayName: Presentation For Church
  languages: [vi-VN, en-US]
  backgroundColor: transparent
```

Build: `npx electron-builder --win --config electron-builder.store.yml`. Máy build cần Windows SDK (có `makeappx`).

Việc cần làm kèm theo:

- [ ] **Version:** Store dùng bốn số `x.y.z.0`, số cuối phải là 0 (Store dành riêng). `3.1.8` → `3.1.8.0`. Mỗi lần nộp lại phải tăng.
- [ ] **Tài sản đồ họa** trong `build/appx/`: `StoreLogo` (50x50), `Square44x44Logo`, `Square150x150Logo`, `Wide310x150Logo` (kèm các scale 100/125/150/200/400). Nên làm từ `icon.jpg`/logo hiện có; kiểm tra nền trong suốt không bị viền.
- [ ] **Capability:** Electron cần `runFullTrust` (restricted capability). Phải **giải trình** ở form nộp: "Ứng dụng desktop Electron/Chromium, cần truy cập hệ thống tệp do người dùng chọn (thư viện bài hát, media, lịch trình .bcsch) và điều khiển nhiều màn hình". Chỉ khai các capability thật sự cần.
- [ ] **File association `.bcsch`:** kiểm tra manifest sinh ra có khai báo `FileTypeAssociation`. Nếu electron-builder không sinh, dùng `customExtensionsPath`. Test: nhấp đúp file `.bcsch` mở đúng app (luồng `second-instance` + `deliverSchedulePath` trong `main.js`).
- [ ] **Single instance + multi-instance (`--instance`)**: kiểm thử dưới MSIX (alias thực thi, tham số dòng lệnh).

### A4. Sandbox dữ liệu MSIX: điểm dễ mất dữ liệu nhất

MSIX **ảo hóa ghi vào `%APPDATA%`** (chuyển vào `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming`). Hệ quả với app này:

- **Gỡ cài đặt bản Store sẽ xóa dữ liệu ảo hóa** (thư viện bài hát, settings, token Kênh Band nằm trong `userData`). Cần cảnh báo người dùng và có nút Export/Backup rõ ràng.
- **Bản NSIS đã cài trước đó dùng thư mục `userData` thật.** Bản Store **không thấy** dữ liệu này. Cần luồng di chuyển: Export thư viện từ bản cũ → Import ở bản Store. `src/library-sync.js` hiện dò các thư mục phiên bản trước (kể cả `datadir.json` trỏ sang ổ khác); kiểm tra xem nó có hoạt động qua ranh giới ảo hóa không, nếu không thì dùng import thủ công (`importLibraryFromCustomPath`).
- **`datadir.json` cho phép đặt `userData` sang ổ khác (D:\...).** Đường dẫn ngoài `%APPDATA%` không bị ảo hóa nhưng không bị xóa khi gỡ app. Kiểm thử cả hai.
- **Thư mục media do người dùng chọn** nằm ngoài package, không ảnh hưởng; nhưng `app-media://` phải tiếp tục hoạt động (kiểm tra bằng bản MSIX cài thật).
- Thư mục cài đặt của MSIX **chỉ đọc**. Mọi chỗ ghi vào `__dirname`/`resourcesPath` sẽ lỗi; grep trước khi build.
- **Kênh Band:** dưới MSIX, kết nối WebSocket ra ngoài hoạt động bình thường (không cần loopback exemption vì không còn LAN server).

### A5. Kiểm thử trước khi nộp (gate chất lượng)

1. **Cài thử cục bộ:** ký gói bằng chứng chỉ tự ký có `Subject` **trùng chính xác** `Publisher` trong manifest, import chứng chỉ vào *Trusted People*, rồi `Add-AppxPackage`. Gỡ chứng chỉ thử sau khi xong.
2. **Windows App Certification Kit (WACK):** chạy trên gói; sửa mọi lỗi (đây là phép thử Store dùng khi chứng nhận). Lưu báo cáo làm bằng chứng.
3. **Ma trận kiểm thử thủ công:**

| Luồng | Cần kiểm tra |
|---|---|
| Cài mới / nâng cấp / gỡ | Dữ liệu còn/mất đúng như dự kiến, shortcut, file association |
| Live window | Máy chiếu thứ 2, `alwaysOnTop 'screen-saver'`, hotplug màn hình |
| Media | `app-media://` với video/ảnh, thư mục media tùy chọn |
| Bible/thư viện | Nạp XML, tìm kiếm, import `.docx` (mammoth), import/export `.bcsch` |
| Kênh Band | Đăng nhập Cognito, tạo phòng, điện thoại vào phòng, mất mạng/nối lại, tin không trùng lặp |
| Offline | Toàn bộ UI chính phải chạy khi **không có Internet** (xem B-01) |
| Máy trắng | Windows 10 22H2 và Windows 11 sạch, tài khoản non-admin |

4. **Quét mã độc:** quét gói bằng Defender và VirusTotal (trước khi nộp, để phát hiện false positive sớm, nhất là nếu còn binary tunnel).

### A6. Hồ sơ listing (Store submission)

- [ ] **Chính sách riêng tư (URL công khai, HTTPS):** bắt buộc cho app có truy cập mạng/dữ liệu cá nhân. Đặt tại `worship-official.link/privacy`. Nội dung tối thiểu ở B-14.
- [ ] **Phân loại độ tuổi (IARC):** trả lời bảng câu hỏi (không có bạo lực, không mua hàng, có tương tác trực tuyến giữa người dùng qua Kênh Band: khai đúng).
- [ ] **Danh mục:** Productivity hoặc Lifestyle. **Giá:** miễn phí. **Thị trường:** vi-VN trước, mở rộng sau.
- [ ] **Mô tả (vi-VN, en-US):** nêu đúng chức năng; không khẳng định thứ chưa có (số liệu, so sánh với phần mềm khác). Landing v2 đã gỡ các số liệu không căn cứ, giữ nguyên nguyên tắc đó.
- [ ] **Ảnh chụp màn hình:** tối thiểu 1, khuyến nghị 4–6 (kích thước ≥ 1366x768). Chỉ dùng nội dung bạn có quyền (không dùng ảnh/video bản quyền, không logo bên thứ ba).
- [ ] **Liên hệ hỗ trợ:** email + trang hỗ trợ, ghi trong listing.
- [ ] **Ghi chú cho người chứng nhận (Notes for certification):** cung cấp **tài khoản thử nghiệm** nếu Kênh Band cần đăng nhập, giải thích `runFullTrust`, mô tả bước thử Kênh Band. Thiếu mục này là nguyên nhân từ chối thường gặp (reviewer không vào được tính năng).
- [ ] **Tuyên bố về thuê bao/giá:** không có mua trong app.
- [ ] Thời gian chứng nhận thường 1–3 ngày làm việc; dự phòng thêm cho lần bị yêu cầu sửa.

### A7. Quy trình phát hành (gate)

```
G0  Đóng blocker (B-08, B-01..03, B-14)           → rà soát lại, ký duyệt nội bộ
G1  Build MSIX từ CI/máy sạch, bản tag trên git    → ghi checksum SHA-256
G2  WACK + ma trận kiểm thử + quét mã độc         → lưu báo cáo
G3  Dry-run trên máy trắng (cài, dùng 1 buổi nhóm)→ không lỗi nghiêm trọng
G4  Nộp Partner Center (hai người cùng xem form)   → chờ chứng nhận
G5  Phát hành 100% (hoặc dùng gradual rollout nếu khả dụng) → theo dõi 72 giờ đầu
```

Mọi thay đổi code kèm theo phải ghi vào `changelog.md` theo quy ước của repo.

---

## Phần B. Enterprise Review

### B0. Phạm vi và phương pháp

- **Đã làm:** đọc cấu hình cửa sổ/protocol/IPC trong `main.js`, `preload.js`, nơi lưu token (`src/band-comm/operator-auth.js`), các URL ngoài trong `index.html`/`live.html`, `package.json`/`installer.nsh`, `npm audit`, dữ liệu đóng gói. Đối chiếu với `changelog.md` (các lỗi đã vá ở đợt review 2026-09-23).
- **Chưa làm (cần làm trước G0, xem B-16):** audit từng IPC handler (82 cái), pentest backend `cloud/*` sau khi deploy, đánh giá bản quyền chi tiết từng nội dung, kiểm thử MSIX thực tế.
- Đánh giá dựa trên mô hình ranh giới tin cậy bên dưới.

#### Mô hình ranh giới tin cậy

```
[Nội dung không tin cậy]                    [Ranh giới đặc quyền]          [Tài nguyên]
 - Bible/bài hát XML, .docx, .bcsch   ──►   Renderer (index.html / live.html)
 - Script/font từ CDN bên ngoài       ──►     │ contextBridge (preload.js: electronAPI, ~113 điểm gọi IPC)
 - Điện thoại ban hát qua relay       ──►     ▼
                                             Main process (82 ipcMain.handle) ──► Hệ tệp, shell.openExternal,
                                                                                   mạng (Cognito, relay, library-sync)
```

Nguyên tắc: **renderer phải coi như có thể bị chiếm**; main process không được tin tham số từ renderer.

### B1. Bảng phát hiện

Mức độ: **Critical/High/Medium/Low**. Cột "Chặn nộp?" = phải xong trước G0.

| ID | Mức | Chặn nộp? | Phát hiện | Bằng chứng | Hành động |
|---|---|---|---|---|---|
| B-01 | High | ✅ | **Tải mã thực thi từ bên ngoài vào cửa sổ đặc quyền:** operator window nạp `https://cdn.tailwindcss.com` làm `<script>` lúc chạy; font từ Google Fonts. Nếu CDN bị chiếm/MITM/đổi nội dung, script chạy trong renderer có `electronAPI`. Đồng thời **UI vỡ khi offline** (nhà thờ thường mất mạng). | `index.html:9-16`, `live.html:5` | Build Tailwind thành CSS tĩnh (CLI) và đóng gói; tải font về `fonts/` rồi `@font-face` cục bộ. Không còn `<script src="https://...">`. |
| B-02 | High | ✅ | **Không có Content-Security-Policy** ở `index.html` và `live.html` (chỉ `comm/mobile` và `website` có). Không có lớp giảm thiểu khi xảy ra XSS (đã từng có 2 lỗi XSS lưu trữ, đã vá). | grep `Content-Security-Policy`: chỉ thấy ở `comm/mobile/index.html`, `website/index.html` | Thêm CSP `<meta>`: `default-src 'self'; script-src 'self'; img-src 'self' data: blob: app-media:; media-src 'self' app-media: blob:; connect-src` chỉ liệt kê domain cần. Chỗ nào còn inline script/handler thì cần refactor hoặc dùng hash/nonce. Làm sau B-01. |
| B-03 | High | ✅ | **Kiểm soát truy cập IPC yếu (AuthZ):** 82 `ipcMain.handle`, **không handler nào xác thực `event.senderFrame`/origin**. Không có `setWindowOpenHandler`/`will-navigate` để chặn điều hướng hoặc cửa sổ mới. Một số handler nhận tham số tùy ý từ renderer, ví dụ `show-open-dialog-multi` truyền nguyên `options` vào `dialog`, `import-songs-from-file` nhận danh sách `filePaths` và đọc file. Hợp với B-01/B-02 thành chuỗi: nội dung ngoài → renderer → IPC → đọc file cục bộ. | `main.js:3073-3099`, grep `senderFrame` = 0 kết quả | (1) Thêm helper `assertTrustedSender(event)` (chỉ cho `file://` đúng `index.html`/`live.html`) gọi đầu mỗi handler. (2) `will-navigate` + `setWindowOpenHandler` chỉ cho phép `https:` allowlist qua `shell.openExternal` (đã có allowlist ở `open-external`). (3) Handler nhận đường dẫn: chỉ chấp nhận đường dẫn do **dialog của main** trả về (lưu tạm trong main), không tin đường dẫn renderer gửi. (4) Đặt `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` tường minh cho **cả hai** cửa sổ (live window hiện không khai báo, dựa vào mặc định). |
| B-04 | Medium | Nên | **Token xác thực lưu rõ trong đĩa:** `band-comm-operator.json` chứa `idToken`, `accessToken`, `refreshToken` dạng plaintext trong `userData`. Refresh token của Cognito sống dài hạn: lấy được file này là chiếm được phiên operator. | `src/band-comm/operator-auth.js:14-55` | Mã hóa bằng Electron `safeStorage` (DPAPI trên Windows, gắn với tài khoản Windows). Có đường di trú: đọc file cũ → mã hóa → xóa bản rõ. Ghi chú: ảo hóa MSIX không thay thế mã hóa. |
| B-05 | Medium | Nên | **Rò dữ liệu sang bên thứ ba:** mã QR được tạo bằng `api.qrserver.com`, URL tham gia phòng (kèm **Room Code**) gửi cho dịch vụ này. Font gửi IP người dùng cho Google. Ảnh lỗi dùng `placehold.co`. | `index.html:5004-5007`, `index.html:7497` | Tạo QR cục bộ (thư viện JS nhỏ, đóng gói). Bỏ phụ thuộc Google Fonts (B-01). Ảnh lỗi dùng ảnh nội bộ. Room Code là bí mật phân quyền vào phòng, không được rời khỏi máy trừ tới relay của bạn. |
| B-06 | Medium | Nên | **Lỗ hổng phụ thuộc:** `npm audit --omit=dev`: **1 high** (`@xmldom/xmldom` qua `mammoth`, nhiều advisory ReDoS/parse). Toàn bộ cây phụ thuộc: **16 lỗ hổng (1 critical, 15 high)**, phần lớn thuộc công cụ build (`electron-builder`, `tmp`). Có `npm audit fix` khả dụng. | kết quả `npm audit` ngày 2026-10-02 | Chạy `npm audit fix`, kiểm tra lại import `.docx`. Với lỗi trong devDependencies: không vào gói phát hành nhưng vẫn cập nhật để build sạch. Thêm bước `npm audit` vào checklist phát hành. Nếu mammoth chỉ dùng cho `.docx` của người dùng chính mình, rủi ro ReDoS thấp nhưng vẫn nên vá. |
| B-07 | Medium | ✅ (cho bản Store) | **Binary tunnel và `postinstall` tải file từ Internet:** `scripts/fetch-cloudflared.js` tải `cloudflared` về mỗi lần `npm install` và đóng vào build Windows; nhưng toàn bộ code dùng nó là **dead code** (GĐ2). Rủi ro: (a) chuỗi cung ứng build, (b) binary tạo tunnel khiến antivirus/reviewer nghi ngờ ("cho phép truy cập từ xa"), (c) phình gói ~50MB. | `package.json` (`postinstall`, `extraResources`), `main.js` (`syncBandTunnel` không còn được gọi) | Với bản Store: bỏ hẳn (config riêng, A3). Về lâu dài: xóa dead code `syncBandTunnel`, `server.js`, script fetch, `vendor/cloudflared`. |
| B-08 | **Critical (pháp lý)** | ✅ | **Nội dung có bản quyền đóng gói sẵn:** 5 bản Bible (`EnglishNIVBible.xml`, `Bản_Dịch_Mới.xml`, `Bản_Phổ_Thông.xml`, `Ban_Pho_Thong_converted...`, `Bible_Vietnamese_Version_1925.xml` ~ 29MB), `songs.json`, 18MB font CMG Sans. NIV (Biblica), BDM và BPT thường có điều khoản phân phối riêng; bản 1925 nhiều khả năng thuộc phạm vi công cộng **[xác minh]**. Không có file LICENSE/NOTICE ghi nguồn và quyền. Store coi đây là vi phạm chính sách sở hữu trí tuệ, và bạn là nhà phát hành chịu trách nhiệm. | `data/`, `fonts/cmg-sans/`, `package.json` (`files`, `extraResources`) | Lập **bảng kê bản quyền** cho từng nội dung: nguồn, giấy phép, quyền phân phối lại, bằng chứng. Với mục không chứng minh được: **không đóng gói**, thay bằng cơ chế người dùng tự nhập (import XML của họ) hoặc tải theo giấy phép. Với font: kiểm tra EULA (nhiều font thương mại cấm nhúng/phân phối lại). Thêm `THIRD_PARTY_NOTICES.md` và màn hình "Giấy phép" trong app. |
| B-09 | Low | Không | **Installer NSIS tắt cưỡng bức mọi tiến trình `electron.exe`** khi khởi tạo, ảnh hưởng ứng dụng Electron khác (VS Code, Discord...) trên máy người dùng. Không áp dụng cho bản Store. | `build/installer.nsh:2-3` | Chỉ `taskkill` đúng `Presentation For Church.exe`; bỏ dòng `electron.exe`. |
| B-10 | Medium | ✅ | **Mất dữ liệu/chia tách dữ liệu do ảo hóa MSIX** và chuyển từ bản NSIS sang bản Store (xem A4). | `main.js` (`datadir.json`, `userData`), `src/library-sync.js` | Thiết kế luồng Export/Import, thông báo trong app, và kiểm thử đã nêu ở A4/A5. |
| B-11 | High | ✅ | **Backend phải ở trạng thái đã vá khi phát hành:** `changelog.md` ghi các bản sửa nghiêm trọng (bỏ qua xác thực `/operator/*`, thiếu kiểm tra quyền xóa member, `profileId` bị lộ) **cần `wrangler deploy` mới có hiệu lực**. Bản Store phụ thuộc trực tiếp vào các endpoint này. Không kiểm chứng được từ repo. | `changelog.md` mục "Critical — bảo mật" | Xác nhận đã deploy `cloud/identity` và `cloud/worker` bản mới; kiểm tra bằng request thử (không token → 401, token của người khác → 403). Ghi lại commit/phiên bản đã deploy. |
| B-12 | Low | Không | **Cấu hình chưa tường minh / code thừa:** live window thiếu `contextIsolation`/`nodeIntegration` khai báo (mặc định của Electron 41 vẫn an toàn); `edit-song.html` là dead code nhưng vẫn nằm trong `files`; `app.log` ở thư mục gốc. | `main.js:1128`, `package.json` | Khai báo tường minh (B-03), bỏ `edit-song.html` khỏi gói, kiểm tra log không chứa token/PII. |
| B-13 | Low | Không | **Tên nội bộ `easyworship-app`** (nhắc đến sản phẩm thương mại). Đừng đổi vội vì `name` ảnh hưởng thư mục `userData` (mất dữ liệu người dùng cũ). | `package.json:2`, `main.js` (tên instance) | Chỉ cần không dùng cụm này trong listing/ảnh chụp. Nếu đổi, phải có bước di trú `userData`. |
| B-14 | High | ✅ | **Quyền riêng tư chưa được tài liệu hóa:** app/portal thu thập email, SĐT, tên hội thánh, khu vực (`/request-access`), đăng nhập qua Cognito (AWS), đồng bộ thư viện bài hát lên Cloudflare (`/library-sync`), tin nhắn ban hát qua relay. Chưa có chính sách riêng tư. | `main.js:2828-2906`, `src/library-sync.js`, `website/` (không có trang privacy) | Viết chính sách riêng tư: dữ liệu thu thập, mục đích, nơi lưu (Cloudflare, AWS), thời hạn lưu, quyền xóa/xuất dữ liệu, liên hệ. Có luồng xóa tài khoản (Store và luật VN thường yêu cầu). Tham vấn pháp lý về Nghị định 13/2023/NĐ-CP (bảo vệ dữ liệu cá nhân) **[xác minh]**. Cập nhật khai báo trong Partner Center cho khớp. |
| B-15 | Medium | Nên | **Chưa có kênh tiếp nhận báo cáo lỗ hổng và quy trình ứng cứu.** | repo không có `SECURITY.md` | Thêm `SECURITY.md` (email nhận báo cáo, thời gian phản hồi); runbook thu hồi: đẩy bản vá qua Store, vô hiệu hóa token Cognito/phòng ở server khi nghi ngờ lộ. |

### B2. Phần dưới đây là đã tốt (giữ nguyên, ghi nhận để reviewer biết)

- `contextIsolation: true`, `nodeIntegration: false` cho cửa sổ operator; dữ liệu qua `contextBridge`.
- `app-media://` đã chặn path traversal bằng `path.resolve` + kiểm tra tiền tố (`main.js:1683-1699`).
- `open-external` có allowlist scheme `https:`/`mailto:` (`main.js:3073`).
- Gate đăng nhập Kênh Band ở tầng main (`startBandComm()` kiểm tra `isLoggedIn()`), không chỉ ở UI.
- Backend đã sửa xác thực token Cognito bằng JWKS, kiểm tra quyền sở hữu, so sánh hằng thời gian cho `ADMIN_KEY`, rate-limit (xem changelog).
- `website/` và `comm/mobile/` đặt CSP nghiêm.
- Không phát hiện secret nào bị commit (đợt audit trước); secret đi qua Worker secrets.
- Electron 41 là phiên bản mới (nhận bản vá Chromium kịp thời).

### B3. Danh sách việc còn lại để review đủ mức enterprise (B-16)

| Hạng mục | Cách làm | Kết quả cần có |
|---|---|---|
| Audit 82 IPC handler | Lập bảng: handler → tham số → tài nguyên đụng tới → kiểm tra đầu vào → quyền cần. Ưu tiên handler đọc/ghi tệp, `shell`, mạng, band-comm, library-sync | Bảng IPC + danh sách sửa |
| Fuzz/độc hại hóa đầu vào | `.bcsch`, XML Bible, `.docx`, `songs.json` độc hại (path traversal, XML bomb, prototype pollution, payload XSS) | Báo cáo + test case lưu lại |
| Pentest backend | `cloud/identity`, `cloud/worker`: bypass auth, IDOR giữa phòng, rate-limit, replay, WebSocket abuse. Chạy **sau** khi deploy bản vá | Báo cáo + bằng chứng đã khắc phục |
| Electron fuses | Bật fuses khi đóng gói: `RunAsNode=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true` **[xác minh]** | Gói chặn được lạm dụng `ELECTRON_RUN_AS_NODE`/sửa asar |
| SBOM + giấy phép phụ thuộc | Sinh SBOM (CycloneDX) và liệt kê license của mọi phụ thuộc đóng gói (kể cả Chromium/Electron) | `THIRD_PARTY_NOTICES.md` |
| Build có thể tái lập | Build từ tag sạch trên máy/CI sạch; `npm ci` (không `npm install`); ghi SHA-256 | Quy trình build ghi lại |
| Bảo vệ nhánh & tài khoản | Branch protection `main`, MFA GitHub/Cloudflare/AWS/Partner Center, token tối thiểu quyền | Danh sách tài khoản + MFA đã bật |
| Truy cập & phân quyền hệ thống | Vai trò operator/member/admin: ma trận quyền (ai gọi được endpoint nào), kiểm thử âm | Ma trận AuthZ |
| Logging & PII | Kiểm tra `app.log`, log server không ghi token/Room Code/SĐT | Xác nhận + che dữ liệu |
| Khả năng truy cập & bản địa hóa | Điều hướng bàn phím, độ tương phản, tên hiển thị tiếng Việt/Anh nhất quán | Danh sách lỗi UI |
| Tính sẵn sàng | Chạy thử 3 giờ liên tục (live window, video nền) trên máy cấu hình thấp; đã có sửa rò CPU/GPU video nền trong changelog | Số đo CPU/RAM |

### B4. Rủi ro bị Store từ chối và cách giảm

| Lý do từ chối thường gặp | Liên quan trong repo | Giảm thiểu |
|---|---|---|
| Vi phạm sở hữu trí tuệ | B-08 | Bảng kê bản quyền, bỏ nội dung không rõ quyền |
| Thiếu/không hợp lệ chính sách riêng tư | B-14 | Trang privacy + khai báo trùng khớp |
| Reviewer không dùng được tính năng chính | Kênh Band cần đăng nhập | Cung cấp tài khoản thử + ghi chú |
| Lỗi WACK/crash khi khởi động | MSIX, đường dẫn ghi | A5 |
| Capability `runFullTrust` không giải trình | Electron | Ghi rõ lý do ở A3 |
| Nghi ngờ phần mềm không mong muốn (tunnel, tải code ngoài) | B-01, B-07 | Bỏ `cloudflared`, bỏ script CDN |
| Metadata gây hiểu lầm | Mô tả/ảnh chụp | Chỉ nêu chức năng có thật |

### B5. Sau phát hành

- Theo dõi **Partner Center → Analytics/Health** (crash, lỗi cài đặt) trong 72 giờ đầu; có người trực.
- Quy trình cập nhật: mỗi bản vá bảo mật = tăng version → build → WACK → nộp lại (thời gian chứng nhận là độ trễ vá, dự trù khi có sự cố).
- Hồ sơ lưu: báo cáo WACK, bảng kê bản quyền, bảng IPC, báo cáo pentest, commit/tag đã phát hành, SHA-256 gói.
- Rà soát định kỳ mỗi quý: `npm audit`, cập nhật Electron, chính sách Store, quyền tài khoản.

---

## Phụ lục: việc đề xuất, theo thứ tự

1. Quyết định nội dung đóng gói (B-08), bảng kê bản quyền.
2. Gỡ CDN/QR bên ngoài + CSP (B-01, B-02, B-05).
3. Cứng hóa IPC/navigation + mã hóa token (B-03, B-04).
4. Cập nhật phụ thuộc, gỡ `cloudflared` (B-06, B-07).
5. Xác nhận deploy backend (B-11), viết chính sách riêng tư (B-14), `SECURITY.md` (B-15).
6. Tạo `electron-builder.store.yml`, tài sản đồ họa, build MSIX, WACK, kiểm thử (Phần A).
7. Đăng ký Partner Center, nộp hồ sơ.
