# Changelog - BlessingChurch Presentation App

Tất cả các thay đổi và cập nhật quan trọng của dự án được ghi lại tại đây.

## [Unreleased] - Kênh Band LAN (P1 + P2 + P2.5 + P4)

### M0 — thư viện ảnh hợp âm: điện thoại upload + xem theo yêu cầu (2026-09-09)
- **Điện thoại upload (người phụ trách ảnh)**:
  - `room.uploaderPin` (4–8 số, đặt ở sidebar operator — ô "Mã phụ trách"). Trống = điện thoại không upload được.
  - `POST /api/gallery/claim {pin}` — giành quyền; chỉ **1 người online** giữ, người cũ offline > 25s bị thay; người thứ 2 → `409`.
  - `POST /api/gallery/add` / `POST /api/gallery/remove` — chỉ người phụ trách. `readJson` nới giới hạn body 1MB → 12MB cho ảnh base64.
  - `POST /api/join` trả thêm `hasUploaderPin`; `getStatus()` trả `uploaderPin` cho sidebar.
  - Mobile: nút "Phụ trách ảnh" (nhập PIN, nhớ trong `localStorage` để tự giành lại sau reconnect) → hiện nút "＋ Thêm ảnh" (nén canvas ≤ 1400px q0.82) + nút "Xoá" trên mỗi ảnh.
- **Xem theo yêu cầu (M0c)**: ảnh hợp âm **không tự hiện** với người xem. Topbar mobile có nút **"🎼 Hợp âm"** (chấm đỏ khi bộ ảnh đổi, ẩn cho tới khi có ảnh) → bấm mới mở khu xem. Người phụ trách vẫn thấy khu này thường trực.
- Sidebar operator: khu "Ảnh hợp âm" tự refresh khi nhận envelope `gallery` (kể cả do điện thoại upload).
- Docs: `docs/data-contracts.md` — cập nhật endpoints gallery + `hasUploaderPin` + `uploaderPin`; sửa "SSE `/api/stream`" → "WebSocket `/api/ws`" cho khớp transport hiện tại.

### UI nâng cấp + thư viện ảnh hợp âm (2026-08-31)
- **Feed operator**: tên người gửi ra **ngoài** bong bóng chat (gọn hơn, dễ nhận ra ai gửi). **Mỗi user một màu** (hash tên → hue pastel) thay vì cam đồng loạt. Cảnh báo band vẫn nhấp nháy (giờ bằng box-shadow nên hợp mọi màu) → bấm = "đã tiếp nhận".
- **Toast operator→điện thoại**: 2s → **3s**, đổi sang **xanh đậm đặc `#1256b8` chữ trắng** — nổi bật hẳn trên theme sáng.
- **Thư viện ảnh hợp âm (P4)**:
  - Operator upload trong popup "Kết nối" (chọn nhiều ảnh → canvas nén cạnh dài ≤ 1400px, JPEG q0.82 → server). Danh sách + nút xoá.
  - Server: `/api/gallery` (manifest) + `/api/gallery/image/:id?token=` (bytes, cache 1 năm); ảnh lưu `band-comm-media/`, manifest ở `band-comm-gallery.json` (không đụng `store.js`); phát envelope `gallery` khi đổi.
  - Điện thoại: khu "Hợp âm" **ngay dưới các nút** (càng nhiều nút, ảnh càng xuống dưới). **Vuốt ngang** đổi ảnh (flex + scroll-snap); **hàng chấm** ở dưới theo dõi vị trí, **bấm chấm** để nhảy tới ảnh đó. Không có ảnh thì khu này ẩn.
  - IPC mới: `bandComm.galleryList / galleryAdd / galleryRemove / galleryReorder`.

### Cloud tunnel: transport SSE → WebSocket (2026-08-31)
- **Nguyên nhân**: đưa kênh ra ngoài LAN qua **Cloudflare Quick Tunnel** — chiều điện thoại→operator (POST) chạy, nhưng chiều operator→điện thoại **không tới**: `cloudflared` (và nhiều reverse proxy) **buffer response SSE**. `--protocol quic` treo, `--protocol http2` trả 502. SSE qua localhost thì bình thường.
- **Fix**: downstream đổi từ SSE sang **WebSocket** — proxy được từng frame nên chạy cả qua tunnel lẫn LAN. Giữ **0 dependency**: WS server tự viết `src/band-comm/ws.js` (handshake RFC 6455 + framing tối giản, chỉ text frame, xử lý mask/continuation/ping-pong/close).
  - `server.js`: bỏ `/api/stream`, thêm `server.on('upgrade')` → `/api/ws?token=&since=<lastId>`; `fanout` gửi JSON qua `ws.send`; ring buffer lưu `env` thay vì frame SSE; heartbeat = WS ping; presence coi WS-alive là online.
  - `comm/mobile/app.js`: `EventSource` → `WebSocket` (`wss:` khi trang https, `ws:` khi http); tự reconnect với backoff + kiểm token (WS không auto-retry như EventSource); track `lastId` làm con trỏ replay. CSP mobile thêm `ws: wss:` vào `connect-src`.
- **Ô "Public URL"** trong sidebar Kênh Band: dán URL cloud (Cloudflare Tunnel / domain) → lưu `band-comm.json` (`publicUrl`), QR encode URL đó. Nút xoay QR: **Public URL → IP LAN → worship.local**. Chuyển Quick Tunnel ↔ Named Tunnel sau này chỉ là dán lại 1 dòng.

### P2.5 UI refinements (2026-08-31)
- **Firewall**: nút "Mở cổng Firewall" giờ tạo rule bằng `netsh` + đọc file kết quả để xác nhận thật (bản cũ báo thành công giả). QR mặc định dùng **địa chỉ IP** (Android Chrome không phân giải `.local`); `worship.local` chỉ là dòng "cố định" + nút đổi.
- **Sidebar**: là dock trái thật (đẩy Schedule/Library sang phải, không đè); **kéo cạnh phải để đổi độ rộng** (nhớ `localStorage`); thu gọn = **tab xanh nhỏ nhô ra** (không còn dải phẳng). Bỏ transition (đơ trong môi trường GPU yếu). Sửa double-tin operator.
- **Sidebar gọn**: phần kết nối (QR + PIN + IP + Firewall...) **thu vào sau nút "Kết nối"**, mặc định chỉ hiện 1 dòng `ip:port · PIN · N người`. Bỏ mọi icon/emoji (tab, pill, feed).
- **Bỏ bảng cảnh báo riêng ở đầu**. Cảnh báo band giờ **là tin nhắn trong feed**: tin đó **nhấp nháy** cho tới khi operator **bấm vào tin = "đã tiếp nhận"** (tự báo người gửi). Không nút, không dedup/đếm, không bước "resolve".
- **Mobile client**: **theme sáng**, **bỏ toàn bộ icon** (nút text-only, bỏ trình chọn emoji), thu gọn khoảng cách. **Bỏ khu "Trao đổi"** (feed) — chỉ còn **toast 2 giây** để không che màn hình. Nút **"Tạo nút" chuyển lên đầu** danh sách.
- `operatorReplies` mặc định bỏ emoji; `store.js` tự lọc emoji khi load.

### P2.5 fixes (2026-08-31)
- **Sidebar là dock thật**: khi mở, body được chừa `padding-left` = bề rộng sidebar (336px) → **không còn đè lên cột Schedule / Library**. Đóng lại còn 22px gutter cho tab.
- **QR mặc định dùng địa chỉ IP** (`http://<ip>:<port>`) — mọi điện thoại mở được ngay. `worship.local` chuyển thành dòng "🔖 lưu lại" + nút **QR: dùng worship.local** để đổi (cho iPhone / Android mới).
- **Nút "🛡️ Mở cổng Firewall"** trong sidebar — thêm inbound-allow rule cho app qua UAC, để điện thoại LAN vào được (nguyên nhân hay gặp: Windows Firewall chặn cổng 7071 + mDNS 5353).
- mDNS: join/gửi multicast trên đúng card LAN (`addMembership` + `setMulticastInterface` theo IP LAN).
- Sửa **double tin**: tin operator gửi đi bị hiện 2 lần trong feed (bản lạc quan + bản echo qua SSE) → bỏ bản echo.

### P2.5 — Auto-start + QR ổn định (2026-08-31)
- **Comm server tự khởi chạy ngầm khi mở app** (không cần bấm "Bắt đầu"). Kết quả báo về sidebar: chạy OK → dòng `Kênh đã sẵn sàng · <URL>` + chấm xanh; lỗi → **hộp lỗi đỏ chi tiết** (`code` / `message` / `port` / gợi ý xử lý) tự bung sidebar + nút **Thử lại**. Cổng cố định (từ `band-comm.json`) — bận thì báo lỗi, không nhảy cổng khác.
- **mDNS `worship.local`** — `src/band-comm/mdns.js` (tự viết, 0 dependency): trả lời truy vấn A cho `<hostname>.local` với IP LAN hiện tại. IP laptop đổi (DHCP) thì QR / bookmark vẫn dùng được.
- **Mã QR trong sidebar** — encoder `qrcode-generator` (MIT) vendor vào `src/band-comm/vendor/`, **không** thêm vào `package.json`. QR mã hoá `http://worship.local:<port>`; dưới QR hiện thêm IP thật `192.168.x.x:<port>` để gõ tay khi máy không resolve `.local`.
- `band-comm.json` thêm `room.hostname` (mặc định `worship`) và `room.uploaderPin` (cho P4).

### P2 — Chuyển kênh operator thành sidebar
- Kênh operator **không còn là cửa sổ Electron riêng** — giờ là **sidebar trắng trong `index.html`**, mở bằng **menu Channel** (kế bên View, `Ctrl+Shift+B`) hoặc tab "💬 Kênh Band" ở mép trái. `bandchat.html` đã xoá; `settings.json → bandChatWindowBounds` không còn dùng.

### P1 (Added)
- **Kênh liên lạc trong mạng cho band & người trình chiếu** (`band-comm-plan.md`):
    - **Comm server** chạy trong main process (`src/band-comm/server.js`): HTTP + SSE, không thêm dependency. Bật/tắt bằng nút "Bắt đầu kênh".
        - Điện thoại vào bằng trình duyệt: URL LAN + mã PIN 4 số → token phiên ký HMAC (name + role nằm trong token nên phone bị sập nền / reload vẫn tự vào lại).
        - SSE có ring buffer + `Last-Event-ID` để nhận bù tin khi rớt mạng; heartbeat 15s; presence 25s.
        - Ưu tiên IP Wi-Fi/LAN thật, đẩy các card ảo (WSL, Hyper-V, VM) xuống cuối; cho operator chọn IP nếu máy có nhiều card.
    - **Mobile client** (`comm/mobile/`): mỗi người **tự tạo bộ nút cảnh báo của riêng mình** (nhãn + icon + nhóm), lưu `localStorage` + backup lên server theo hồ sơ. Không có nút cấu hình sẵn, **không phân loại mức độ** — mọi tin xử lý như nhau, chỉ phân biệt hướng (band / người vận hành). Toast trượt 1 tin/lần, rung + beep tùy chọn.
    - **Bảng cảnh báo gộp** ở cửa sổ Kênh Band: cảnh báo trùng (chuẩn hoá bỏ dấu) gộp thành 1 pill có bộ đếm. Pill mới **nhấp nháy** tới khi operator bấm → **tiếp nhận** (tự gửi "Người vận hành đã tiếp nhận: …" riêng cho từng người đã gửi). Nút **Đã xử lý** phát `resolve` cho mọi máy. Nháy taskbar khi có tin mới lúc cửa sổ khuất.
    - Operator gõ chữ tự do / bấm câu trả lời nhanh gửi cho cả band.
- **IPC mới:** namespace `electronAPI.bandComm` (`start`, `stop`, `getStatus`, `getConfig`, `saveConfig`, `send`, `ackAlert`, `resolveAlert`) + sự kiện `onMessage` / `onPresence` / `onServerStatus` / `onTogglePanel`.

### Thay đổi (Changed)
- `main.js`: khởi tạo + auto-start comm server + mDNS; menu top-level **Channel**; dọn dẹp khi thoát app.
- `preload.js`: expose namespace `bandComm`.
- `package.json`: thêm `comm/**/*` vào `build.files` (đã bỏ `bandchat.html`).

### Ghi chú
- Chưa làm: thư viện ảnh hợp âm (P4 — 1 người upload, xem theo yêu cầu), P3 (nhắm 1 người), P5. Không đụng `src/schema.js`. `settings.json` không thêm khoá mới.

## [1.1.6] - 2026-05-15

### Đã thêm (Added)
- **Giao diện Soạn thảo (Song Editor UI):**
    - Tối giản thanh công cụ: Loại bỏ nhãn chữ dư thừa, chuyển sang các nút icon chuyên nghiệp để tăng không gian làm việc.
    - Thêm trình chọn Media trực tiếp trong thanh công cụ, cho phép gán hình nền riêng cho từng bài hát ngay khi soạn thảo.
    - Tự động hiển thị thumbnail hình nền đã chọn trong danh sách Schedule (Lịch trình).
- **Trình chọn Media (Media Picker):**
    - Giao diện lưới (Grid) 3 cột chuyên nghiệp với tỉ lệ khung hình 4:3 chuẩn.
    - Icon "Play" nổi bật cho các tệp video để dễ dàng phân biệt với ảnh tĩnh.
    - Hiệu ứng hover và tương tác mượt mà hơn khi chọn media.

### Thay đổi (Changed)
- **Cải tiến hiển thị lời bài hát & hợp âm:**
    - Nâng độ cao hợp âm thêm 5px để tránh đè lên các chữ viết hoa (A, G, C...).
    - Rút ngắn khoảng cách dòng (line-height) xuống 1.2 giúp bố cục gọn gàng hơn.
    - Giới hạn tự động cỡ chữ: Đảm bảo lời bài hát tối đa 4 dòng khi có hợp âm và câu tiếp theo (Next Verse) để tránh chồng lấp.
    - Giữ hợp âm và từ đi kèm luôn nằm trên cùng một dòng (no-wrap).
- **Tối ưu hiệu suất:**
    - Danh sách Schedule giờ đây sử dụng ảnh thumbnail tĩnh thay vì nạp toàn bộ video, giúp ứng dụng chạy nhẹ hơn đáng kể.
    - Đồng bộ hóa logic gán background: Ưu tiên background riêng của bài hát, sau đó mới đến background mặc định của hệ thống.

### Đã sửa (Fixed)
- **Lỗi hiển thị Dark Mode:** Cưỡng bức màu chữ đen cho các menu chọn Font và ô nhập liệu trong trình soạn thảo khi ở chế độ tối, giải quyết vấn đề "chữ trắng trên nền trắng".
- **Vị trí "Next Verse":** Hạ thấp vị trí câu tiếp theo xuống sát đáy màn hình để không bao giờ bị đè bởi dòng lyric cuối cùng.
- **Lỗi đồng bộ Schedule:** Sửa lỗi bài hát trong Schedule hiển thị sai hình nền so với lựa chọn trong Editor.

## [1.1.5] - 2026-05-13 (Unreleased)

### Đã thêm (Added)
- Thêm export thư viện bài hát ra JSON từ UI Songs.
- Thêm nút chọn nhanh Sách/Chương cho tab Bible.
- Chia khu vực Media thành danh sách media và screen monitor nội bộ mirror Live.
- Thêm nút bật/tắt monitor nhỏ gọn cho Preview, Live và Media monitor.
- Thêm tùy chọn Settings để cho phép hoặc chặn mở `Screen Live` khi không có màn hình phụ.
- Thêm Bible Version Manager trong tab Bible để quản lý danh sách bản dịch XML đã lưu.
- Thêm công cụ tìm kiếm và thay thế hàng loạt trong Settings cho Songs và Bible XML, có preview số match trước khi áp dụng.
- Thêm tùy chọn `Auto-fit text` trong Settings để tự giảm font khi lời bài hát hoặc câu Kinh Thánh quá dài.
- Bỏ giới hạn cứng `3 dòng` trong phần phím tắt tùy chỉnh và thêm nút `+` để tạo thêm dòng cấu hình phím tắt ngay trong modal.
- Thêm `Style Templates` cạnh `Preview Output`, có `Style mặc định`, `Apply`, `Apply All`, `Manage`, và manager modal để tạo/sửa/xóa preset style.
- Thêm hỗ trợ upload font custom `.ttf`/`.otf` để dùng lại trong template và renderer.
- Thêm nút `ADD NEW SONG` ở footer tab Songs để mở nhanh modal `Edit Song` và nhập thủ công bài hát mới vào thư viện.

### Thay đổi (Changed)
- Ghi nhớ vị trí Live window bền vững hơn bằng `settings.json` khi dùng một màn hình.
- Đồng bộ cơ chế co chữ tự động giữa Editor preview, Preview, Live monitor trong app và cửa sổ `Screen Live`.
- Hỗ trợ lưu style override theo từng schedule item để áp template cho buổi trình chiếu mà không ghi đè style bài gốc trong library.

### Đã sửa (Fixed)
- Ổn định lại logic `Screen Live` khi có màn hình phụ để tránh vòng lặp ép fullscreen gây nhấp nháy liên tục.
- Khi không có màn hình phụ, `Screen Live` giờ neo vào monitor trong app thay vì đè lên danh sách Live slides.
- Khôi phục `index.html` về bản renderer đầy đủ sau khi lần tách module làm file bị cắt dở, gây lỗi cú pháp `Unexpected token '<'` và chặn toàn bộ luồng load Songs, Bible, Media khi mở ứng dụng.
- Nâng cấp tìm kiếm thông minh cho Songs và Bible: chuẩn hóa alias tên riêng (`Jesus`/`Giê-xu`/`Gie-su`, `John`/`Giăng`, `Peter`/`Phi-e-rơ`, `Paul`/`Phao-lô`, `James`/`Gia-cơ`) và ưu tiên kết quả khớp nguyên câu lời bài hát ngay dưới khớp tiêu đề.
- Hoàn thiện snippet tìm kiếm cho Songs và Bible với highlight an toàn theo query không dấu/alias, đồng thời escape HTML để tránh render nội dung độc hại trong kết quả thư viện.
- Thu gọn khung chọn bản dịch Kinh Thánh và bổ sung metadata registry để đổi tên hiển thị, xóa version user, và ẩn version bundled khỏi UI một cách bền vững.
- Sửa false-positive search trong tab Bible khi tìm theo tham chiếu chương như `Giăng 15`, đổi màu highlight sang nền vàng/chữ đỏ, thay nút import header bằng icon, và thay nút import footer bằng action `Add To Schedule`.
- Sửa crash startup ở renderer do dùng biến `editorStyle` trước khi khai báo trong `applySettings()`, vốn làm ngắt chuỗi `DOMContentLoaded` và khiến Songs cùng Media không load dù Bible vẫn còn hoạt động.
- Mở rộng renderer Preview/Live/Screen Live với `boxStyle` để template có thể thêm khung nền, viền và bo góc cho vùng chữ.
- Sửa lỗi lưu `Style Template` không báo lỗi đúng khi ghi file thất bại; giờ `Save Template` trả lỗi rõ ràng thay vì im lặng, và renderer có `try/catch` để hiển thị thông báo.
- Sửa lỗi duplicate khi tạo bài hát mới: nếu đã `Apply` rồi bấm `OK` mà không chỉnh gì thêm thì modal chỉ đóng, không tạo thêm một bản ghi mới.

## [1.0.5] - 2026-05-11

### Đã thêm (Added)
- **Hệ thống (System):** Hiển thị **Phần trăm CPU thực tế** (cập nhật mỗi 3 giây) trên thanh trạng thái thay vì con số tĩnh 14%.
- **Phím tắt (Shortcuts):**
    - Bổ sung phím tắt mặc định mới: `Ctrl+F` (Tìm kiếm), `Ctrl+Enter` (Go Preview), `Ctrl+Shift+Enter` (Go Live), `Ctrl+1/2` (Chuyển Tab), `Ctrl+Alt+1/2` (Chọn Background), `Ctrl+Shift+Q` (Thoát).
    - Phím tắt `Ctrl+Esc` để tắt nhanh màn hình Screen Live.
    - Thêm action **Xóa khỏi Schedule** vào danh sách phím tắt (mặc định phím `Delete`).
- **Tìm kiếm (Search):** Hỗ trợ `Ctrl+A` để chọn tất cả text ngay trong ô tìm kiếm.

### Thay đổi (Changed)
- **Màn hình trình chiếu (Live Window):**
    - Cơ chế hiển thị thông minh: Tự động chiếu **Full Screen** trên màn hình thứ 2 nếu có kết nối.
    - Tự động hiển thị đè lên khung danh sách Slide (Live Panel) ở màn hình chính khi không có màn hình phụ, giúp dễ dàng kiểm tra nội dung tại chỗ.
    - Hỗ trợ kéo thả để di chuyển cửa sổ Live và tự động ghi nhớ vị trí trong suốt phiên làm việc.
    - Cải tiến nút **Clear**: Chỉ xóa phần văn bản (lyrics), vẫn giữ nguyên hình nền đang phát trên Screen Live.
- **Phím tắt (Shortcuts):**
    - Việt hóa toàn bộ nhãn chức năng trong hộp thoại cấu hình phím tắt để thân thiện hơn.
    - Cải tiến phím tắt `Ctrl+F`: tự động focus và bôi đen toàn bộ nội dung ô tìm kiếm để gõ đè nhanh.
    - Refactor logic lưu phím tắt để hỗ trợ danh sách phím mặc định có độ dài linh hoạt.
- **Giao diện (UI):**
    - Đồng bộ cấu trúc 3 ô phím cho cả phím tắt mặc định và tùy chỉnh.
    - Sửa lỗi không xóa trạng thái chọn bài hát khi chuyển đổi giữa tab Bài hát và Kinh Thánh.
- **Tính ổn định (Stability):**
    - Sửa lỗi rò rỉ biến toàn cục trong logic tính toán CPU.
    - Thêm cơ chế bảo vệ (try/catch) cho hệ thống backup dữ liệu tự động.
    - Cải thiện độ chính xác của việc ghi nhớ vị trí cửa sổ Screen Live khi thay đổi cấu hình màn hình.

## [1.0.3] - 2026-05-11

### Đã thêm (Added)
- Hỗ trợ build release cho cả Windows (`nsis`, `portable`) và macOS (`dmg`) trong cùng cấu hình `electron-builder`.
- Chuẩn hóa tên artifact release theo mẫu `Presentation.For.Church.Setup.[version].[ext]`.
- Bổ sung thêm các bản Kinh Thánh XML (VI/EN) để mở rộng nội dung trình chiếu.

### Đã sửa (Fixed)
- Sửa lỗi `Import Media` không phản hồi do callback menu bị nuốt.
- Sửa luồng load video media (MIME type, `playsinline`, autoplay policy) để preview/live ổn định hơn.
- Sửa các trường hợp video hiển thị nền đen dù file đã import.
- Tăng độ ổn định cửa sổ Screen Live với ưu tiên hiển thị và đồng bộ trạng thái foreground.
- Thay icon text fallback bằng nhãn chữ ở các nút chính để không còn hiện slug như `play_arrow`, `upload_file`, `cast`, `play_circle`.
- Rút gọn danh sách font khởi tạo xuống bộ font cơ bản 10-15 font và không chặn startup bằng bước load font hệ thống.

### Thay đổi (Changed)
- Nâng cấp trải nghiệm Bible: truy cập trực tiếp theo chương, chọn bản dịch ngay trong tab Bible, cải tiến tìm kiếm.
- Thêm hệ thống Settings toàn cục (theme, font, cỡ chữ, màu, căn lề, phím tắt) và lưu cấu hình bền vững.
- Đồng bộ cấu trúc dữ liệu/style giữa editor, preview, schedule và live output để giảm lệch trạng thái hiển thị.

## [1.1.5] - 2026-05-11

### Đã thêm (Added)
- Thêm target Windows `portable` bên cạnh installer `nsis`.
- Đổi tên artifact đóng gói theo mẫu `Presentation.For.Church.Setup.[version].[type]`.

### Thay đổi (Changed)
- Đồng bộ cấu hình build để xuất được file `.exe` cho Windows và `.dmg` cho macOS từ cùng một `electron-builder` config.

## [1.1.4] - 2026-05-11

### Đã sửa (Fixed)
- Sửa luồng load video media để thumbnail, preview, live output và Screen Live dùng MIME type đúng và `playsinline`.
- Giới hạn các định dạng video được nạp vào nhóm phát ổn định hơn để giảm trường hợp file hiện nhưng chỉ ra nền đen.
- Loại bỏ lỗi menu action bị nuốt khiến `Import Media` không phản hồi.

### Thay đổi (Changed)
- Đồng bộ lại cách nhận diện video giữa `load-media`, `import-media` và renderer.

## [1.1.3] - 2026-05-11

### Đã sửa (Fixed)
- Sửa menu `Import Media` để callback menu action không bị nuốt và có thể mở hộp thoại import bình thường.
- Cải thiện luồng load video media bằng MIME type đúng, `playsinline`, và autoplay policy phù hợp cho Electron.
- Giới hạn định dạng video vào nhóm phát ổn định hơn để tránh trường hợp file xuất hiện nhưng chỉ hiện nền đen.

### Thay đổi (Changed)
- Đồng bộ lại cách render thumbnail và background video giữa media library, preview, live output và Screen Live.

## [1.1.2] - 2026-05-11

### Đã sửa (Fixed)
- Media loading giờ dùng URL tuyệt đối từ main process, giúp preview, schedule và live output không còn phụ thuộc hoàn toàn vào `app-media://`.
- Background cũ được normalize theo đuôi file để nhận đúng ảnh/video thay vì mặc định về ảnh.
- Screen Live được tăng ưu tiên hiển thị bằng `always-on-top`, `moveTop()`, và kiosk mode khi có màn hình phụ.
- Mỗi lần gửi content/background/clear đều re-assert lại trạng thái luôn nổi của Screen Live.

### Thay đổi (Changed)
- Thêm changelog cho đợt sửa ổn định media và cửa sổ live này.

## [1.1.1] - 2026-05-11

### Đã thêm (Added)
- **Bộ tài liệu vận hành chuẩn:**
    - Thêm `docs/` với các hướng dẫn về architecture, rules, debugging, feature workflow, UI guidelines và data contracts.
    - Thêm skill repo-local để thống nhất quy trình phân tích, debug và mở rộng tính năng.

### Đã sửa (Fixed)
- **Bible parser và selector:**
    - Bổ sung fallback rõ hơn cho XML không có header ngôn ngữ.
    - Hiển thị tên version kèm ngôn ngữ trong selector để dễ nhận biết bản đang dùng.
    - Đồng bộ tên sách theo đúng ngôn ngữ của từng version Kinh Thánh.
- **Giao diện modal Edit Song / Bible / Settings:**
    - Tăng tương phản text, icon, toolbar, input, placeholder và border trên nền trắng.
    - Sửa lỗi font name và các label trong modal bị chìm do kế thừa màu sáng từ shell.

### Thay đổi (Changed)
- **Chuẩn hóa data và hiển thị:**
    - Cập nhật contract style/background, schedule normalization và các helper liên quan để giảm lỗi lệch trạng thái giữa preview, editor và live window.
    - Chuẩn hóa thêm cấu trúc import/export schedule và Bible version metadata.

## [1.1.0] - 2026-05-11

### Đã thêm (Added)
- **Hệ thống Cài đặt (Global Settings):**
    - Thêm mục "Settings" vào menu File của Electron.
    - Hộp thoại Cài đặt hệ thống cho phép tùy chỉnh: Giao diện (Dark/Light), Font chữ mặc định, Kích thước chữ, Màu sắc, Căn lề.
    - Cấu hình phím tắt (Keyboard Shortcuts) cho Slide tiếp theo, Slide trước đó và Xóa màn hình nhanh (Clear).
    - Lưu trữ cài đặt bền vững trong file `settings.json`.
- **Quản lý Media linh hoạt:**
    - Cho phép chọn thư mục Media tùy ý trong Settings.
    - Tự động copy file media vào thư mục đã chọn khi Import.
    - Tự động quét và hiển thị toàn bộ media từ thư mục cấu hình mỗi khi khởi động.
- **Trải nghiệm Kinh Thánh mới (Direct Bible Access):**
    - Liệt kê trực tiếp toàn bộ Chương Kinh Thánh trong thư viện sidebar (tương tự như Bài hát).
    - Thêm ô chọn bản dịch (Version selector) ngay trong tab Bible.
    - Hỗ trợ tìm kiếm nội dung câu gốc trực tiếp từ thanh Search thư viện.
- **Nút Import thông minh:**
    - Tự động chuyển đổi giữa "IMPORT SONG" và "IMPORT BIBLE" tùy theo tab đang chọn.
    - Hỗ trợ import trực tiếp dữ liệu bài hát từ file `.json` và bản dịch Kinh Thánh từ file `.xml`.

### Đã sửa (Fixed)
- **Lỗi hiển thị dữ liệu:** Sửa lỗi cú pháp trong `index.html` gây mất danh sách bài hát và Kinh Thánh.
- **Lỗi lưu trữ Import:** Dữ liệu import hiện đã được ghi đè bền vững vào `songs.json` trong `userData`.
- **Độ tin cậy Bible:** Nâng cấp bộ phân tích XML (Regex) mạnh mẽ hơn, hỗ trợ nhiều định dạng và tự động sửa lỗi cache.
- **Cải tiến tìm kiếm:** Gộp 2 khung tìm kiếm thành 1 khung duy nhất, hỗ trợ tìm kiếm linh hoạt hơn (chứa từ khóa thay vì chỉ bắt đầu bằng).
- **Khôi phục giao diện:** Sửa lỗi vô tình xóa mất hộp thoại chọn Kinh Thánh trong các phiên bản cập nhật trước.

### Thay đổi (Changed)
- **Cơ chế ưu tiên Style:** Cập nhật logic hiển thị để ưu tiên Style riêng của từng bài hát, nếu không có sẽ tự động lấy thông số mặc định từ Settings hệ thống.
- **Dữ liệu bài hát:** Import thành công 286 bài hát từ `data/songs.json` vào cơ sở dữ liệu chính của ứng dụng.

---
*Ghi chú: Phiên bản này tập trung vào tính ổn định của dữ liệu và trải nghiệm người dùng trong việc cấu hình hệ thống.*
