# Kế hoạch: Kênh Band LAN

Kênh liên lạc thời gian thực trong mạng nội bộ giữa **band nhạc**, **người hướng dẫn thờ phượng** và **người trình chiếu**.

> Trạng thái: **P1 + lõi P2 đã implement** (2026-08-31). UI operator đã chuyển từ cửa sổ riêng → **sidebar trắng trong `index.html`** + menu **Channel** (`Ctrl+Shift+B`) + tab mép trái. Còn lại: auto-start + QR ổn định (bắt buộc, xem dưới), P3, P4 (ảnh — 1 người upload), P5.
>
> Lệch so với plan gốc khi code: mobile client gộp CSS vào `comm/mobile/index.html`; token mang sẵn `name` để phone reload / sập nền tự vào lại; kênh operator là sidebar chứ không phải cửa sổ Electron riêng (`bandchat.html` đã xoá). **Cập nhật 2026-09-17: đã bỏ hẳn phân biệt vai trò `band`/`leader`** — xem mục cuối tài liệu.

## Yêu cầu BẮT BUỘC (chốt 2026-08-31)

### B1 — Server tự chạy ngầm khi mở app + báo lên kênh chat
- Mở app → comm server **tự `.start()` ngầm**, không cần bấm "Bắt đầu".
- Chạy xong → đẩy tin `system` "Kênh đã sẵn sàng · <URL>" vào feed sidebar; chấm trạng thái xanh.
- **Chạy lỗi → hiện lỗi chi tiết** ngay trong sidebar (tự bung panel), kèm `code` / `message` / `port` / gợi ý xử lý (VD `EADDRINUSE` → "Cổng 7071 đang bận…") + nút **Thử lại**. Không âm thầm đổi cổng.
- **Cổng cố định** (từ `band-comm.json`); cổng bận thì **báo lỗi to**, không nhảy cổng khác (để QR không đổi).

### B2 — QR kết nối lần đầu, KHÔNG đổi khi IP đổi
- Sidebar hiện **mã QR** cho thiết bị quét lần đầu.
- QR mã hoá **URL theo hostname mDNS** `http://worship.local:<port>` → IP laptop đổi (DHCP) thì QR / bookmark / "Add to Home Screen" vẫn dùng được.
- Dưới QR hiện thêm `worship.local:<port>` **và** IP thật `192.168.x.x:<port>` dạng chữ để gõ tay khi máy không resolve được `.local` (Android cũ).
- Cần một mDNS responder trả lời truy vấn A cho `worship.local` — hoặc `src/band-comm/mdns.js` tự viết tối giản (0 dep), hoặc thêm `bonjour-service` (JS thuần). QR encoder: vendor 1 file JS nhỏ (MIT) vào repo, **không** thêm vào `package.json`.

### B3 — Thư viện ảnh hợp âm: 1 tài khoản upload, xem theo yêu cầu
- **Đúng 1 "tài khoản phụ trách ảnh"** được upload + đồng bộ cho mọi người. Không ai khác upload được. Server chặn nếu đã có người phụ trách đang online.
- Ảnh **không tự hiện** với mọi user. Mỗi user có **nút "Xem hợp âm"** — chỉ mở khi cần (không phải ai cũng quên hợp âm).
- Ảnh đồng bộ = server phát manifest; điện thoại chỉ tải bytes khi user bấm Xem (rồi cache lại). Xem full-screen, vuốt đổi trang, pinch-zoom. Đóng là về màn hình thường, không bao giờ tự bung.

---

## 1. Bối cảnh & mục tiêu

Khi band đang chơi và người hướng dẫn đang hát, không ai rảnh tay để nói "guitar nhỏ", "mic nhỏ", "chuyển bài", "nền khó đọc chữ". Kênh này biến các câu đó thành **nút bấm một chạm** trên điện thoại, đẩy thẳng về máy trình chiếu và các thành viên khác. Máy trình chiếu còn gõ được chữ tự do từ bàn phím. Kèm một **thư viện ảnh hợp âm** xem gần full màn hình điện thoại.

**Không có bộ nút cấu hình sẵn.** Mỗi người tự tạo bộ nút của riêng mình ngay trên điện thoại (nhãn, icon, nhóm do họ đặt). App chỉ để trống + cho tạo nút; operator không dựng nút thay cho band. Không phân loại mức độ — mọi tin xử lý như nhau.

### Ba vai trò (cùng một Wi-Fi hội thánh)

| Vai trò | Thiết bị | Nhu cầu chính |
|---|---|---|
| `band` | điện thoại (trình duyệt) | Gửi cảnh báo bằng 1 ngón tay; xem ảnh hợp âm gần full màn hình |
| `leader` | điện thoại (trình duyệt) | Chủ yếu **nhận** tin ("chuyển bài sau câu này"); thỉnh thoảng báo "giữ câu này" |
| `operator` | máy tính (app Electron) | Nhận mọi cảnh báo, trả lời bằng nút nhanh / bàn phím, quản lý PIN + câu trả lời nhanh + thư viện ảnh (**không** quản lý nút của band) |

> **Cập nhật 2026-09-17:** đã bỏ hẳn phân biệt `band`/`leader` — bảng trên là mô tả USAGE PATTERN ban đầu, chưa từng là 1 permission thật (không route/UI nào từng rẽ nhánh theo giá trị này). Mọi client trên điện thoại giờ đối xử như nhau; chỉ còn phân biệt **thiết bị** (điện thoại vs `operator`). Xem mục cuối tài liệu.

### Coi như "xong" khi

- Band chạm 1 nút → dưới 1 giây, cảnh báo hiện trên máy operator **và** các điện thoại khác.
- Operator gõ 1 câu → mọi điện thoại thấy ngay, band **không phải rời** ảnh hợp âm đang xem.
- 10 cảnh báo trùng trong 30 giây **không** tạo 10 dòng — chỉ 1 dòng `×10`.
- Rớt Wi-Fi 5 giây rồi vào lại → điện thoại tự nối lại và nhận bù tin đã lỡ.

---

## 2. Kiến trúc

Điện thoại không chạy Electron nên cần một web server thật để nối vào. Server đó nằm **ngay trong `main.js`** (module `http` + `fs` có sẵn), chỉ bật khi operator bấm "Bắt đầu kênh". Nó phục vụ 2 thứ: **trang mobile client** và **một luồng sự kiện SSE**.

Phía operator, kênh chat **không nhúng vào `index.html`** — nó là **một cửa sổ Electron riêng (`bandchat.html`)**, sibling với cửa sổ Operator và cửa sổ Live, dựng theo đúng pattern `createLiveWindow` đã có trong `main.js`. Cửa sổ này **dock vào dải trống bên trái màn hình**, ngoài khung app chính (xem ảnh bạn gửi). Nó nói chuyện với comm server qua **IPC**, main process làm cầu nối hai chiều.

```
   ĐIỆN THOẠI BAND              ELECTRON — main process              3 CỬA SỔ RENDERER
  (band, leader)          ┌───────────────────────────────┐   ┌────────────────────────────┐
 ┌───────────────┐        │                               │   │  ▓ Kênh Band (bandchat.html)│ ← dock dải trái
 │  trình duyệt  │        │      ┌─────────────────┐      │IPC│    feed · pill · soạn tin   │
 │               │ SSE ◄──┼──────┤   Comm Server   ├──────┼──►├────────────────────────────┤
 │               │ /api/stream   │  http · SSE     │      │   │  Operator (index.html)      │
 │               │ (giữ mở, cam) │  token PIN      │◄─────┼───┤  Live (live.html)           │
 │               │ POST ──┼─────►│  ring buffer    │      │   └────────────────────────────┘
 │               │ /api/message  │  presence       │      │      (main forward = webContents.send
 └───────────────┘        │      └────────┬────────┘      │       tới cả bandchat + operator)
        └ LAN / HTTP ┘    │               │ đọc/ghi       │
                          │        ┌──────┴───────────┐   │
                          │        │ band-comm.json   │   │
                          │        │ band-comm-media/ │   │
                          │        └──────────────────┘   │
                          └───────────────────────────────┘
                                   └─ trong tiến trình ─┘
```

- **Đường SSE (một chiều, server→điện thoại)** luôn mở — là kênh mang mọi cảnh báo và tin nhắn xuống.
- **Chiều lên** dùng `fetch` POST rời từng lần.
- **Operator ↔ server**: qua IPC. Renderer (`bandchat.html`, và tùy chọn cả `index.html`) gọi `electronAPI.bandComm.*`; main forward tin từ điện thoại lên các cửa sổ đang mở bằng `webContents.send`.
- **Vị trí cửa sổ Kênh Band**: mặc định x=0, rộng = khoảng trống từ mép trái màn hình tới mép trái cửa sổ Operator, cao full; kéo/resize được; nhớ trong `settings.json` → `bandChatWindowBounds` (giống `liveWindowBounds`). Nếu không còn khoảng trống → fallback rộng ~360px.

**Vì sao không tách process riêng:** server nhẹ (vài kết nối, payload nhỏ). Đặt trong main process thì dùng lại được `safeWriteSync`, backup rotation, dialog chọn file và vòng đời `before-quit` đã có. Tách `child_process` chỉ thêm một lớp IPC nữa mà không giải quyết vấn đề gì.

---

## 3. Công nghệ & lý do chọn

> **CẬP NHẬT 2026-08-31 — transport đổi từ SSE sang WebSocket.**
> Khi thử đưa kênh ra ngoài LAN qua **Cloudflare Tunnel**, phát hiện tunnel (và
> nhiều reverse proxy) **buffer response streaming HTTP** → chiều operator→điện
> thoại (SSE) không bao giờ tới nơi; chiều điện thoại→operator (POST) vẫn ổn.
> WebSocket được proxy theo từng frame nên chạy cả qua tunnel lẫn LAN thô.
> Vẫn giữ **0 dependency**: WS server tự viết ~180 dòng ở `src/band-comm/ws.js`
> (handshake + framing tối giản, chỉ text frame). Downstream giờ là
> `ws(s)://host/api/ws?token=…&since=<lastId>`; `/api/stream` (SSE) đã bỏ.
> `fetch` POST cho join / message / profile giữ nguyên. Client tự reconnect
> (backoff + kiểm token) vì WebSocket không auto-retry như `EventSource`.
> Phần dưới của mục này giữ lại làm lịch sử quyết định ban đầu.

**Transport: ~~SSE~~ WebSocket + `fetch` POST, không thêm dependency.**

Nhu cầu thật: server đẩy tin xuống nhiều client *tức thì*; client gửi lên *thỉnh thoảng*, mỗi lần một tin nhỏ. Đúng hình dạng của SSE (một chiều server→client, tự động reconnect, có `Last-Event-ID` để phát lại) + `fetch` POST cho chiều ngược. WebSocket giải quyết bài toán lớn hơn (stream 2 chiều) mà ở đây không cần.

```
  SSE + POST  (CHỌN)                        WebSocket (ws)
  ┌─────────┐         ┌────────┐            ┌─────────┐         ┌────────┐
  │  phone  │◄────────┤ server │            │  phone  │◄───────►│ server │
  │         │  SSE (giữ mở)    │            │         │ 1 socket 2 chiều │
  │         ├────────►│        │            └─────────┘         └────────┘
  └─────────┘  POST (mỗi lần)                +1 dependency
  0 thư viện mới · reconnect + replay có sẵn  · tự viết heartbeat/reconnect/replay
```

Cả hai đều cho độ trễ dưới giây trên LAN. SSE + POST thắng vì đúng quy tắc dự án ("không thêm dependency nếu chưa cần") và ít mã tự-bảo-trì hơn.

| Hạng mục | Chọn | Lý do / phương án loại |
|---|---|---|
| Kênh thời gian thực | **SSE + `fetch` POST** | 0 dep. Loại: `ws` (+dep, tự viết reconnect); Socket.IO (nặng nhất) |
| Nơi chạy server | **Electron main process, bật theo yêu cầu** | Dùng lại safe-write / backup / dialog / lifecycle. Loại: child process |
| Mobile client | **Trang tĩnh HTML/CSS/JS server tự phục vụ** | Không CDN (điện thoại có thể không có 4G). PWA + service worker để cache ảnh |
| Ghép nối | **QR code + URL + chọn IP LAN thủ công** | QR sinh bằng JS thuần nhúng sẵn. mDNS/Bonjour để v2 |
| Xác thực | **PIN 4 số → token phiên ký HMAC** | Bí mật ký nằm trong RAM, đổi mỗi lần bật. Đủ cho LAN tin cậy |
| Bộ nút cảnh báo | **Cá nhân từng người, tạo trên điện thoại của họ** | Lưu `localStorage` (offline-first) + backup tùy chọn lên server theo hồ sơ (`profileId`). Operator **không** dựng nút cho band |
| UI phía operator | **Cửa sổ Electron riêng `bandchat.html`, dock dải trống bên trái** | Sibling với Operator + Live, theo pattern `createLiveWindow`. Không nhét vào monolith `index.html`. Bounds nhớ trong `settings.json` |
| Lưu cấu hình chung | **`userData/band-comm.json`** | Chỉ chứa PIN, port, câu trả lời nhanh, thư viện ảnh, và backup hồ sơ. File riêng + `safeWriteSync`, không đụng `schema.js` |
| Ảnh hợp âm | **`userData/band-comm-media/`, nén bằng canvas lúc upload** | Nén phía renderer trước khi đưa bytes cho main. Loại: `sharp` (native dep) |
| QR trong operator UI | **Vẽ canvas từ snippet QR ~4KB** | Loại: thư viện `qrcode` |

**Không cần** đổi `src/schema.js`, `live.html`, hay protocol `app-media://`. Đây là hệ con tách biệt, nối vào app qua một namespace IPC mới. Chạm vào `index.html` **rất ít** — chỉ 1 menu item / 1 nút mở cửa sổ Kênh Band. `settings.json` thêm đúng 1 khoá `bandChatWindowBounds` (không phải schema library, không cần `migrateItem`).

---

## 4. Giao thức & dữ liệu

### Phong bì tin nhắn — dùng chung cho mọi loại

```jsonc
{
  "id": "a1b2c3d4",              // crypto.randomUUID()
  "ts": 1730000000000,
  "type": "alert",              // alert | text | ack | resolve | presence | gallery | system
                                //   ack   = "Người vận hành đã tiếp nhận" (nhắm riêng người gửi)
                                //   resolve = operator đóng issue (phát cho mọi máy)
  "from": { "clientId": "c-8f2", "name": "Minh", "role": "band" },
  "to": "all",                  // "all" | "<clientId>"  — ack luôn nhắm "<clientId>"
  "refId": null,                // với ack/resolve: id của alert gốc
  "buttonId": "b-7a2",          // id nút cá nhân của người gửi; null nếu chữ tự do
  "dedupKey": "guitar nho",     // = text đã chuẩn hoá (bỏ dấu, thường, trim)
                                //   operator gộp cảnh báo theo khoá này
  "text": "Guitar nhỏ quá",
  "meta": {}                    // payload phụ, vd. manifest thư viện ảnh
}
```

`dedupKey` là cách gộp cảnh báo "cùng ý" khi mỗi người tự đặt nhãn nút khác nhau — xem §6.

**Không phân loại mức độ.** Mọi cảnh báo được đối xử như nhau — không có `severity`/ưu tiên. Phía nhận chỉ phân biệt **hướng** (tin của band vs tin của operator), không phân biệt "khẩn/thường".

### Bộ nút cá nhân — lưu trên điện thoại (`localStorage`)

Mỗi người tự dựng, không có mặc định. Server chỉ giữ một bản backup (xem §10).

```jsonc
{
  "profileId": "p-9c1",              // uuid tạo lần đầu, giữ trong localStorage
  "name": "Minh",
  "role": "band",
  "buttons": [
    { "id": "b-7a2", "label": "Guitar nhỏ", "icon": "🎸", "group": "Âm thanh" },
    { "id": "b-3f8", "label": "Mất in-ear", "icon": "🎧", "group": "Âm thanh" }
  ],
  "sound": true,
  "vibrate": true
}
```

### Cấu hình chung — `userData/band-comm.json`

```jsonc
{
  "version": 1,
  "room":  { "name": "Band HT Chính", "pin": "4821" },
  "port":  7071,
  "operatorReplies": ["Đã nghe 👍", "Đợi 1 chút", "Đang chỉnh", "Chuyển sau câu này"],
  "profiles": {                       // backup bộ nút cá nhân (tùy chọn, xem §10)
    "p-9c1": { "name": "Minh", "role": "band", "updatedAt": 1730000000000, "buttons": [ /* … */ ] }
  },
  "gallery": {
    "activeSetId": "set-0901",
    "sets": [
      { "id": "set-0901", "name": "CN 01/09", "images": [
        { "id": "img-01", "file": "hopam-amazing-grace.jpg", "title": "Amazing Grace", "order": 0 }
      ]}
    ]
  }
}
```

### IPC mới — `preload.js` → `electronAPI.bandComm`

```
openChatWindow()   / closeChatWindow()   → tạo/đóng cửa sổ bandchat.html, dock trái
dockChatWindowLeft()                      → tính lại bounds theo vị trí cửa sổ Operator
start()            → { running, url, ip, port, pin, clients }
stop()
getStatus()
getConfig()        / saveConfig(cfg)
send({ to, text })
ackAlert(alertId)      → phát `ack` cho mọi người gửi trong pill ("đã tiếp nhận")
resolveAlert(alertId)  → phát `resolve` cho mọi máy, pill rời bảng
galleryImport()    (mở dialog) / galleryDelete(imageId) / galleryReorder(setId, orderedIds)
gallerySetActive(setId) / galleryNewSet(name)

sự kiện → renderer:  onMessage(cb) · onPresence(cb) · onServerStatus(cb)
   main gửi các sự kiện này tới CẢ bandchat.html và index.html nếu đang mở
```

### HTTP endpoints (comm server)

```
GET  /                          → mobile client (html/js/css/manifest/sw)
POST /api/join   { name, role, pin, profileId? }  → { token, clientId, config, profile? }
GET  /api/stream?token=          → SSE (phát lại từ Last-Event-ID)
POST /api/message { token, buttonId?, label?, text?, to? }
POST /api/ping    { token }      → heartbeat presence
POST /api/profile { token, buttons }        → lưu backup bộ nút theo profileId
GET  /api/profile?token=&name=   → gợi ý khôi phục bộ nút theo tên (khi máy mới)
GET  /api/gallery/image/:id?token=
POST /api/leave   { token }
```

Mọi route trừ `join` yêu cầu token hợp lệ.

---

## 5. UX Mobile — thông báo không được che ảnh hợp âm

Đây là mối lo chính. Ảnh hợp âm phải chiếm gần hết màn hình mà cảnh báo vẫn thấy được. Giải pháp là **xếp lớp**, không chia ô: ảnh nằm dưới cùng full-bleed, mọi thứ khác là overlay `position: fixed` — không bao giờ đẩy layout.

```
┌───────────────────────────┐
│  ┌─────────────────────┐  │  ← pill gọn 1 dòng, ghim đỉnh giữa
│  │ 🎸 Minh · guitar nhỏ│  │    chạm → bung thành toast đầy đủ
│  └─────────────────────┘  │
│                           │
│      Ảnh hợp âm            │  ← full-bleed, pinch-zoom, vuốt đổi trang
│   pinch-zoom · vuốt        │
│                           │
│                     ( ! ) │  ← nút tròn gửi nhanh, luôn nổi (Focus mode)
│      ▁▁▁▁▁▁▁▁▁            │  ← tay nắm 6px: thanh nút cảnh báo tự thu,
└───────────────────────────┘    vuốt lên để hiện lại
```

### Tự tạo bộ nút (không có mặc định)

- Màn hình chính mở ra **trống** + một ô **"＋ Tạo nút"**.
- Tạo nút: nhập nhãn (vd. "Guitar nhỏ"), chọn icon/emoji, chọn nhóm (tự gõ, vd. "Âm thanh"). Không có "mức độ".
- Sửa / xóa / kéo sắp xếp thoải mái. Bộ nút lưu ngay vào `localStorage`, đồng thời `POST /api/profile` để backup.
- Máy mới / xóa cache: gõ lại tên ở màn join → server tìm hồ sơ trùng tên → hỏi "Khôi phục bộ nút của Minh?".
- (Tùy chọn, ưu tiên thấp) một người có thể **sao chép nhanh** bộ nút của người khác đang online để khỏi gõ lại từ đầu.

### Cách hiển thị tin đến (một kiểu cho tất cả)

Không phân loại mức độ — mọi tin đến xử lý giống nhau:

| | Trên điện thoại người khác | Trên cửa sổ Kênh Band (operator) |
|---|---|---|
| Tin mới | toast trượt xuống, **1 toast/lần**, tự tắt sau ~7s (vuốt để tắt sớm); rung nhẹ + beep ngắn nếu bật | pill mới trên **bảng cảnh báo** (gộp theo `dedupKey`); nếu cửa sổ đang khuất → nháy taskbar (`flashFrame`) 1 lần |
| Dồn nhiều tin | các tin xếp lại thành huy hiệu đếm; mở "Feed" để xem hết | pill có bộ đếm `×N` |

- Điện thoại người gửi **không** tự hiện toast tin của mình — chỉ dấu ✓ "đã gửi".
- **Chỉ phân biệt hướng, không phân biệt mức:**
  - Tin **từ operator** = xanh, canh trái, thẻ "Người chiếu máy".
  - Cảnh báo **từ band khác** = hổ phách, canh phải, kèm tên người gửi.
- Bật/tắt âm & rung cho từng máy (nhớ trong `localStorage`).

### Màn hình chính (khi không xem ảnh)

- Lưới nút **cá nhân** đã tạo (tối thiểu 64px), gom theo `group` người dùng tự đặt.
- Ô gõ chữ tự do — thu gọn, chạm để bung.
- Nút "＋ Tạo nút" và nút "Sửa bộ nút".
- Tab "Thư viện" có huy hiệu sáng khi operator đổi bộ ảnh đang dùng.
- Nền tối mặc định (sân khấu thiếu sáng), tương phản cao, thao tác một tay.
- Bật/tắt âm & rung cho từng máy, nhớ trong `localStorage` (bọc try/catch).

---

## 6. UX Operator — bảng cảnh báo gộp, không phải dòng thời gian trôi

Nếu mỗi lần chạm nút tạo một dòng mới, operator sẽ chết chìm. Cảnh báo **chưa xử lý** có cùng `dedupKey` được gộp thành một "pill" duy nhất có bộ đếm + mốc thời gian mới nhất.

Vì mỗi người tự đặt nhãn nút, không thể gộp theo id nút. `dedupKey` = `text` đã chuẩn hoá: **bỏ dấu, viết thường, gộp khoảng trắng**. "Guitar nhỏ", "guitar nho", "Guitar  nhỏ!" → cùng khoá `guitar nho`. Operator chỉnh được ngưỡng (vd. gộp khi khớp ≥ 90%) và có thể tách/gộp thủ công một pill nếu máy đoán sai.

```
  🎹 Piano nhỏ · Minh · t+0s ┐
  🎹 piano nho · An   · t+3s ├─ gộp theo dedupKey ─►  ┌─────────────────────────────────┐
  🎹 Piano nhỏ · Minh · t+6s ┘                       │ 🎹 Piano nhỏ  ×3   ● đang chờ    │ ← nhấp nháy / đổi màu
                                                     │ mới nhất 6s trước · Minh, An     │
                                                     └─────────────────────────────────┘
                        operator CLICK vào pill  ─►  ┌─────────────────────────────────┐
                                                     │ 🎹 Piano nhỏ  ×3   ✓ đã tiếp nhận│ ← hết nhấp nháy, màu dịu
                                                     │ [Đã xử lý]                       │
                                                     └─────────────────────────────────┘
                                                          │  ack → gửi riêng cho Minh & An:
                                                          ▼  "Người vận hành đã tiếp nhận: Piano nhỏ"
```

### Vòng đời một pill: `đang chờ → đã tiếp nhận → đã xử lý`

1. **`đang chờ`** (pending) — pill mới **nhấp nháy / đổi màu liên tục** cho tới khi operator chạm; nếu cửa sổ Kênh Band đang khuất → nháy taskbar (`flashFrame`) 1 lần. (Tôn trọng `prefers-reduced-motion`: thay nhấp nháy bằng viền đậm + chấm ●.)
2. **Operator click đúng pill đó → `đã tiếp nhận`** (ack, mặc định chỉ 1 cú click):
   - Ngừng nhấp nháy, đổi sang màu dịu, hiện ✓.
   - Server phát `ack` **nhắm riêng từng người đã gửi trong pill** (ở đây: Minh và An) → điện thoại họ hiện toast **"Người vận hành đã tiếp nhận: Piano nhỏ"**.
   - Pill **vẫn ở lại bảng** (đã dịu) để operator nhớ còn phải chỉnh.
3. **`đã xử lý`** (resolve, tùy chọn) — bấm "Đã xử lý" → pill rời bảng vào Nhật ký; phát `resolve` cho mọi máy. Nếu operator bỏ qua, pill tự hết hạn sau một khoảng.

Cảnh báo trùng đến **sau khi** đã tiếp nhận (cùng `dedupKey`) sẽ làm pill nhấp nháy lại và tăng bộ đếm — coi như "vẫn còn, chưa xong".

### Sidebar Kênh Band — trong `index.html` (ĐÃ LÀM)

Không phải cửa sổ riêng. Là **sidebar trắng `position: fixed` bên trái, ngay trong `index.html`** (`<aside id="bandPanel">`), mọi selector prefix `#bandPanel` để không đụng Tailwind/global.

- **Mở/đóng:** menu top-level **Channel** (`Ctrl+Shift+B`, kế bên View) → IPC `band-comm-toggle-panel` → sidebar trượt; hoặc **tab "💬 Kênh Band"** ghim mép trái; hoặc nút `×` trong sidebar; `Esc` khi focus trong sidebar.
- **Theme trắng** cố định (không theo dark mode của app).
- Không đụng script monolith của `index.html` — thêm 1 `<style>` + 1 `<aside>` + 1 `<script>` IIFE riêng, và 1 kênh IPC riêng để tránh cướp listener `onMenuAction`.

**Bố cục sidebar (cao & hẹp — kiểu khung chat):**

| Vùng | Nội dung |
|---|---|
| Đầu | Chấm trạng thái · **Bắt đầu/Dừng** · `×` đóng |
| Kết nối (khi chạy) | **QR** · `worship.local:port` + IP thật · số người online · nút Sao chép |
| **Bảng cảnh báo** (ghim trên) | Pill `đang chờ` **nhấp nháy**; click = tiếp nhận (tự báo người gửi); nút "Đã xử lý" |
| **Feed** (cuộn) | Cảnh báo band (hổ phách, canh trái) · tin operator (xanh, canh phải) · `ack`/`resolve`/`system` |
| Đáy (ghim) | Nút trả lời nhanh (`operatorReplies`) + ô soạn; Enter gửi cho cả band |

Khi sidebar đóng và có cảnh báo band mới → tab mép trái hiện chấm đỏ + đếm; `mainWindow.flashFrame(true)` nếu app không focus. Khi server **lỗi lúc auto-start** → sidebar tự bung (xem B1).

---

## 7. Bảo mật & độ tin cậy

| Chủ đề | Cách làm |
|---|---|
| **Vào phòng** | PIN 4 số → server cấp token ký HMAC (bí mật trong RAM, đổi mỗi lần bật) + `clientId`. Token nằm `localStorage`, gửi kèm mọi POST và khi mở SSE |
| **Chống spam / lỡ tay** | Cùng nút từ cùng client trong 5s → client báo "đã gửi rồi", không POST lại |
| **Hồ sơ cá nhân** | Bộ nút lưu `localStorage` (offline-first). Tùy chọn backup lên server theo `profileId`; máy mới gõ lại tên → server gợi ý khôi phục |
| **Nối lại & nhận bù** | SSE tự retry. Server giữ ring buffer ~50 tin/room; client vào lại kèm `Last-Event-ID` để nhận phần đã lỡ. Heartbeat comment mỗi 15s giữ luồng sống qua NAT |
| **Presence** | `POST /api/ping` mỗi 10s; server đánh dấu offline sau 25s im lặng và phát lại danh sách. Điện thoại khoá màn → rớt SSE → mở lại thì nối lại |
| **Vòng đời** | Server chỉ chạy khi operator bật; `before-quit` đóng mọi SSE, tắt http server, xóa token |

### Rủi ro lớn nhất: Wi-Fi cô lập client (AP isolation)

Nhiều mạng khách của hội thánh chặn thiết bị nói chuyện trực tiếp với nhau → điện thoại không thấy máy operator. Giảm thiểu:

1. Màn hình join có nút "Kiểm tra kết nối" báo lỗi rõ ràng.
2. Tài liệu ghi rõ phải cùng một SSID không bật cô lập.
3. Phương án dự phòng — máy operator phát hotspot cho band.

Windows sẽ hỏi firewall lần đầu Node mở port → hướng dẫn bấm "Cho phép". IP máy operator có thể đổi giữa các buổi (DHCP) → sinh lại QR mỗi lần bật, hiện IP hiện tại rõ ràng.

---

## 8. Luồng thao tác

### F1 — Operator mở kênh
1. View → **Kênh Band** (`Ctrl+Shift+B`) → main mở cửa sổ `bandchat.html`, dock vào dải trống bên trái (bounds từ `settings.json` hoặc tính theo vị trí cửa sổ Operator).
2. Trong cửa sổ đó bấm **Bắt đầu kênh** → `bandComm.start()` → main mở http+SSE ở `0.0.0.0:7071`, chọn IP LAN từ `os.networkInterfaces()`.
3. Main trả `{ url, ip, port, pin }`.
4. Cửa sổ hiện QR + URL + PIN. Operator đọc PIN / chìa QR cho band.

### F2 — Thành viên band vào
1. Quét QR (hoặc gõ URL) → tải mobile client từ comm server.
2. Có token cũ hợp lệ trong `localStorage` thì vào thẳng; nếu không → màn join: tên, vai trò, PIN.
3. `POST /api/join` → server kiểm PIN, cấp token + `clientId`, thêm vào presence.
4. Client mở `GET /api/stream?token=`; server phát lại tin đệm theo `Last-Event-ID`.
5. Server phát presence mới → cửa sổ Kênh Band hiện "Minh (band) đã vào".

### F3 — Band gửi cảnh báo bằng nút cá nhân
1. Chạm nút mình đã tạo, vd. "🎹 Piano nhỏ" → UI lạc quan hiện ✓ "đã gửi".
2. `POST /api/message { buttonId, label, token }`.
3. Server dựng phong bì (`text` = label, `dedupKey` = chuẩn hoá của label), đẩy vào ring buffer, fan-out SSE tới mọi client + `webContents.send('band-message')` tới operator.
4. Operator: pill **`đang chờ` nhấp nháy / đổi màu**; nếu `dedupKey` đó đã có & chưa xử lý → tăng bộ đếm + cập nhật mốc thời gian (và cho nhấp nháy lại nếu đang dịu). Nháy taskbar nếu cửa sổ Kênh Band đang khuất.
5. Điện thoại khác: toast hổ phách "Minh: Piano nhỏ", tự tắt sau ~7s.
6. Trùng trong 5s từ cùng máy → client không POST lại.

### F4 — Operator tiếp nhận & trả lời
1. Pill nhấp nháy thu hút mắt. Operator **click đúng pill đó** → mặc định = **tiếp nhận** (ack).
2. Server đánh dấu pill `đã tiếp nhận`, ngừng nhấp nháy, và phát `ack` **nhắm riêng từng người đã gửi trong pill**.
3. Điện thoại người gửi: toast **"Người vận hành đã tiếp nhận: Piano nhỏ"**.
4. (Tùy chọn) Operator bấm một câu trả lời nhanh hoặc gõ chữ → `bandComm.send({ to: 'all' | senderId, text })` → fan-out SSE → toast xanh "Người chiếu máy: …".
5. (Tùy chọn) Operator bấm **"Đã xử lý"** → server phát `resolve`; pill rời bảng vào Nhật ký.

### F5 — Operator gõ chữ tự do
1. Gõ vào ô soạn, Enter → `send({ to: 'all', text })`.
2. Fan-out như F4. Mọi điện thoại hiện toast xanh + một dòng trong feed.

### F6 — Thư viện ảnh hợp âm (1 người upload, xem theo yêu cầu — xem B3)
1. **Người phụ trách ảnh** (mặc định = operator ở sidebar; hoặc 1 điện thoại đăng nhập bằng `uploaderPin`) thêm ảnh. Server chặn nếu đã có người phụ trách khác đang online.
2. Renderer nén canvas (cạnh dài ≤ 1600px, JPEG q0.8) → main copy vào `band-comm-media/` → ghi `gallery` trong `band-comm.json`. Kéo sắp xếp, bấm **Đồng bộ**.
3. Server phát `gallery` kèm manifest (`setId`, `updatedAt`, `images:[{id,title,order}]`). Điện thoại lưu manifest, **chưa tải ảnh**.
4. User bấm nút **"🎼 Xem hợp âm"** (không tự bung) → tải ảnh từ `GET /api/gallery/image/:id?token=` → xem full-screen, vuốt đổi trang, pinch-zoom → cache (service worker) để lần sau mở tức thì / offline.
5. Manifest đổi → nút Xem có chấm nhỏ; vẫn không tự mở.

### F0 — Mở app (tự chạy kênh — xem B1)
1. `app.whenReady` → `initBandComm()` → **`commServer.start()` ngay** ở cổng cố định.
2. OK → `sendBandStatus()` + tin `system` "Kênh đã sẵn sàng · http://worship.local:7071" vào feed sidebar; mDNS responder announce `worship.local`.
3. Lỗi → bắt `err`, đẩy tin `system` lỗi chi tiết (`code`, `message`, `port`, gợi ý) + `band-comm-status-changed { error }`; sidebar **tự bung** + nút **Thử lại**.

### F7 — Đóng kênh
1. Thoát app → `before-quit` → `commServer.stop()` + mDNS stop; SSE đóng, token xoá.
2. Điện thoại hiện "Kênh đã đóng" + `EventSource` tự thử lại → bắt lần mở app kế tiếp.

---

## 9. Lộ trình triển khai

Mỗi phase kiểm được trên điện thoại thật trước khi qua phase sau.

### P1 — Khung truyền tải ✅ ĐÃ LÀM
Comm server (start/stop, PIN, SSE, presence), sidebar operator, mobile join + toast + feed. Test tích hợp Electron xanh.
- **Mới:** `src/band-comm/{server,protocol,store}.js` · `comm/mobile/{index.html,app.js}`
- **Sửa:** `main.js` · `preload.js` · `index.html` (sidebar trắng + menu Channel) · `package.json`

### P2 — Tự tạo nút & bảng cảnh báo gộp ✅ LÕI ĐÃ LÀM
Nút cá nhân + backup hồ sơ; bảng gộp `dedupKey`; pill nhấp nháy → tiếp nhận → đã xử lý; rate-limit; câu trả lời nhanh.
- **Còn thiếu:** kéo sắp xếp nút, chọn ngưỡng gộp.

### P2.5 — BẮT BUỘC: auto-start + QR ổn định (B1 + B2) ✅ ĐÃ LÀM
- `main.js`: `startBandComm()` chạy ngầm khi ready; cổng cố định, lỗi → tin `system` chi tiết + `band-comm-status-changed { error }` + `lastBandStartError` trong `band-comm-status`.
- `src/band-comm/mdns.js` — tự viết, 0 dep, trả A record cho `<hostname>.local` → IP LAN hiện tại (dò lại mỗi truy vấn).
- `server.js` `getStatus()` trả thêm `host` + `hostUrl`.
- Sidebar: **QR** (`src/band-comm/vendor/qrcode-generator.js`, MIT, không vào `package.json`) encode `hostUrl`; hiện host + IP thật; dropdown IP override khi máy nhiều card; hộp lỗi đỏ tự bung + **Thử lại**.
- Kiểm: 15/15 test tích hợp (load `index.html` thật + comm server thật) + smoke server + mdns query/response.

### P3 — Operator → band, chữ tự do
Nhắm 1 người, feed lịch sử 2 phía.
- **Sửa:** `server.js` · `index.html` (sidebar) · `comm/mobile/app.js`

### P4 — Thư viện ảnh hợp âm (B3: 1 người upload, xem theo yêu cầu)
- **Người phụ trách ảnh** = operator (sidebar) mặc định; tuỳ chọn 1 điện thoại qua `room.uploaderPin`. Server ép **chỉ 1 uploader online**; endpoint upload/xoá/sắp xếp chặn role ≠ uploader.
- Đồng bộ manifest qua `gallery` envelope; điện thoại **chỉ tải ảnh khi bấm "🎼 Xem hợp âm"**, không tự bung. Cache offline.
- **Mới:** `comm/mobile/sw.js` · `comm/mobile/manifest.webmanifest`
- **Sửa:** `server.js` (endpoint `/api/gallery/*` + role uploader) · `store.js` · `index.html` (trình quản lý ảnh trong sidebar) · `comm/mobile/*`

### P5 — Hoàn thiện
Gia cố reconnect/replay, timeout presence, "Kiểm tra kết nối" ở màn join, nút "Dock trái" + toggle "Luôn trên cùng", tài liệu + changelog, chạy thử trong một buổi tập thật.
- **Mới:** `docs/band-comm.md`
- **Sửa:** `docs/architecture.md` · `docs/data-contracts.md` · `changelog.md`

---

## 10. Điểm cần bạn quyết

### Cho P2.5 (B1 + B2)
- **D1 — mDNS:** tự viết `src/band-comm/mdns.js` tối giản (0 dep, chỉ trả A record cho `worship.local`) **hay** thêm `bonjour-service` (JS thuần, đã kiểm nghiệm)? *Đề xuất: tự viết — đủ dùng, giữ 0 dep.*
- **D2 — QR encoder:** vendor 1 file `qrcode-generator` (MIT) vào `src/band-comm/vendor/` (không vào `package.json`). *Đề xuất: đồng ý.*
- **D3 — hostname:** `worship` (→ `worship.local`) cố định hay cho đổi trong `band-comm.json`? *Đề xuất: mặc định `worship`, cho đổi.*

### Cho P4 (B3 — ảnh)
- **D4 — ai là "người phụ trách ảnh":** (a) chỉ operator (sidebar); (b) chỉ 1 điện thoại qua `room.uploaderPin`; (c) cả hai — operator luôn có quyền + tuỳ chọn 1 điện thoại. *Đề xuất: (c).*
- **D5 — nén ảnh:** cạnh dài ≤ 1600px, JPEG q0.8 (~200–400KB/ảnh). *Đề xuất: đồng ý.*

### Chung
- **D6 — PIN:** cố định trong `band-comm.json` + nút "Đổi PIN" (đề xuất), hay xoay mỗi buổi?
- **D7 — Giới hạn số người:** chặn mềm ~16 client. *Đề xuất: đồng ý.*
- **D8 — Live window mirror tin?** Ngoài phạm vi; cần thì +1 IPC + 1 lớp trong `live.html`.
- **D9 — Gộp cảnh báo:** chuẩn hoá `text` (bỏ dấu/thường/trim) + gộp/tách tay; khớp mờ để v2.

---

## 11. Đăng nhập theo tài khoản (thay/kèm PIN phòng dùng chung) — PROPOSAL, chưa triển khai

*Bản gộp cuối sau 3 vòng review (2026-09-17) — xem "Lịch sử review" ở cuối mục để truy vết từng góp ý; nội dung dưới đây là thiết kế cuối, không lặp lại các bản nháp trung gian.*

### Vì sao

Hiện tại `/api/join` chỉ có 1 lớp gác: **PIN phòng dùng chung**. Ai biết PIN cũng vào được, tự gõ **bất kỳ tên nào** và tự chọn vai trò `band`/`leader` — không có gì đối chiếu người gõ có đúng là người đó không, cũng không gì ngăn 1 người ngoài tự xưng "Trưởng nhóm" để có vai trò cao hơn khi biết PIN. Muốn có: **operator (trên laptop) là nơi DUY NHẤT tạo "tài khoản"** cho từng thành viên; điện thoại/web **chỉ đăng nhập** bằng tài khoản đã được cấp, không tự tạo được.

### Vì sao không dùng AWS Cognito — đề xuất: **không**

Cognito hợp cho ứng dụng **luôn-online**, có 1 danh mục người dùng **tập trung trên cloud**. Kênh Band cố tình **LAN-first** — phone và laptop cùng 1 Wi-Fi là dùng được ngay, không cần Internet ở venue. Áp Cognito vào sẽ phá đúng tính chất đó:

- **Đăng nhập cần Internet:** Cognito xác thực qua gọi API tới endpoint vùng AWS — mất mạng ở venue thì không đăng nhập được dù phone/laptop vẫn chung Wi-Fi nội bộ.
- **"Tạo tài khoản chỉ qua laptop" cũng cần Internet + AWS credentials:** operator thêm 1 thành viên phải gọi Admin API từ `main.js` — ngược hẳn "chỉ cần mở app, cùng Wi-Fi là xong" đang có.
- **Phân vùng theo từng nhà thờ:** app phân phối cho nhiều nhà thờ khác nhau; 1 User Pool chung phải tự xây thêm lớp phân vùng, mỗi nhà thờ tự tạo User Pool riêng thì mất "zero-setup".
- Chi phí không phải vấn đề (free tier đủ rộng) — vấn đề là **kiến trúc lệch mục tiêu**.

→ Tự làm, đúng tinh thần "0 dependency mới" của `src/band-comm/*`, hash bằng `crypto.scryptSync` (built-in Node), lưu local, xác thực hoàn toàn trong LAN. *Cognito chỉ đáng cân nhắc nếu sau này có tính năng THẬT SỰ cần cloud luôn-online (vd. dashboard vận hành từ xa) — ngoài phạm vi hiện tại.*

### Mô hình 2 lớp, theo Zoom — đăng nhập cá nhân tách khỏi mã phòng

| | Đăng nhập cá nhân | Mã PIN phòng (tái dùng `room.pin`) |
|---|---|---|
| Xác định | **Ai** đang dùng máy | Có đúng buổi/phòng này không |
| Ai tạo/đổi | Chỉ operator, trên laptop | Operator, qua sidebar (nút 🔄 đã có) |
| Vòng đời | Dài hạn — ít đổi | Ngắn hạn — đổi mỗi buổi nếu muốn |
| Bắt buộc? | **Luôn bắt buộc** | **Tuỳ chọn**, cờ `room.pinRequiredWithAccounts`, mặc định tắt |

Lợi ích: operator đổi PIN phòng cho buổi tuần này mà **không ai mất/phải nhớ lại mật khẩu tài khoản cá nhân**. Nhóm nhỏ tin tưởng nhau thì tắt PIN phòng, chỉ cần đăng nhập cá nhân là đủ; ai cần chặt hơn thì bật.

**Không có ô "mã phòng" riêng như Zoom thật:** ở Zoom 1 tài khoản vào được nhiều phòng do người khác tổ chức nên cần Mã phòng để chọn đúng cuộc họp. App này 1 laptop chỉ chạy đúng 1 phòng — quét QR/gõ đúng `worship.local`/IP đã tự nhiên xác định đúng phòng, không cần thêm 1 ô nhập số. Chỉ **mã PIN phòng** (tái dùng `room.pin` có sẵn, không phải khái niệm mới) là thứ thật sự cần 1 ô nhập, và nó tuỳ chọn.

### Data model

`src/band-comm/accounts.js` (mirror pattern `store.js`) quản lý `userData/band-comm-accounts.json`:

```json
{ "accounts": [
  { "id": "acc-xxxx", "username": "minh", "name": "Minh (Guitar)", "role": "band",
    "passwordHash": "...", "passwordSalt": "...", "active": true, "createdAt": 0, "lastLoginAt": 0 }
] }
```

- `passwordHash`/`passwordSalt`: `crypto.scryptSync(password, salt, 64).toString('hex')` (built-in Node, 0 dependency).
  **Giới hạn thật của lớp hash này (ghi thẳng vào `docs/data-contracts.md`):** scrypt chống lộ file trần (đọc thấy password ngay lập tức) — **không** chống được brute-force offline nếu file lộ VÀ password ngắn/yếu. Lớp phòng thủ thật sự vẫn là rate-limit theo `accountId` ở `/api/login` (xem mục API), không phải việc có hash hay không.
- `username`: dùng để đăng nhập, không đổi. `name`: tên hiển thị — nếu di trú từ mô hình free-text cũ, đặt khớp tên người đó từng gõ tay để bộ nút cảnh báo cũ tự khớp lại (xem "Di trú").
- `role`: gắn cứng lúc operator tạo — client không tự chọn.
- `passwordHash` **do operator tự đặt lúc tạo tài khoản** (đã chốt, xem D12) — không có bước "hệ thống tự sinh mật khẩu tạm", và **band member không tự đổi mật khẩu được** — chỉ operator có quyền đổi qua nút "Đổi mật khẩu" trong tab Tài khoản.

`band-comm.json`: thêm `accountsEnabled: false` và `room.pinRequiredWithAccounts: false`. Không thêm field mật khẩu-phòng riêng — dùng lại `room.pin`.

### API

- **`POST /api/login`** `{ username, password }` — verify qua `accounts.js` (scrypt), lấy `name`/`role` thật từ account (hết giả mạo).
  - Server luôn tự gán **`profileId = account.id`** khi cấp token (không phải khái niệm mới song song — dùng đúng slot `profileId` sẵn có trong token hiện tại, `makeToken(clientId, account.name, account.role, account.id)`, vẫn 6 phần, không đổi format). Vì `client.profileId` đã là khoá dùng chung cho bộ nút cảnh báo (`store.saveProfile`/`findProfileByName`) VÀ `ownerId` trong gallery, 1 người dùng nhiều máy tự động ra cùng `profileId` — không xung đột quyền xoá ảnh giữa các máy của cùng 1 người.
  - Nếu `room.pinRequiredWithAccounts=false` (mặc định) → trả token đầy đủ luôn.
  - Nếu `true` → sinh `tempToken = crypto.randomBytes(16).toString('hex')`, lưu tạm trong `Map pendingLogins` mới (cùng chỗ khai `clients`/`joinAttempts`): `pendingLogins.set(tempToken, { accountId, name, role, expiresAt: Date.now() + 5*60*1000 })`, trả `{ tempToken, needsRoomPin: true }`. **`tempToken` không đi qua `makeToken()`/`verifyToken()`** — vì nó không phải chuỗi ký HMAC hợp lệ (không có đủ 6 phần phân cách bằng dấu chấm), mọi route khác tự động `401` nếu lỡ dùng nhầm, ngay tại gate "everything else needs a valid token" hiện có, không cần sửa gì ở đó. Hạn 5 phút nằm trong chính `pendingLogins.expiresAt`, dọn cùng nhịp `pruneJoinAttempts()` ở heartbeat — không thêm hằng số hạn dùng song song với `TOKEN_MAX_AGE_MS`.
- **`POST /api/join-room`** `{ tempToken, pin }` (chỉ gọi khi `needsRoomPin`) — tra `pendingLogins.get(tempToken)`, hết hạn/không có → `401`; verify `pin` đúng `room.pin` (dùng lại y hệt check hiện có) → xoá khỏi `pendingLogins`, cấp `makeToken()` thật.
- **Không có** `GET/POST /api/accounts` — đăng nhập là **form thật** (username + password gõ tay, giống Zoom), không phải chọn tên từ danh sách công khai. Route `/api/join` (PIN phòng, luồng cũ) vẫn giữ nguyên cho D11; chỉ thêm 1 điều kiện: nếu `body.profileId` client tự khai trùng bất kỳ `accounts[].id` nào thật → coi như không hợp lệ (rớt về `null`, server tự sinh id khác) — chặn 1 client ở luồng cũ tự xưng đúng id của 1 account thật để chiếm quyền xoá ảnh/bộ nút của account đó (rủi ro thấp vì `newId()` ngẫu nhiên, nhưng chặn gần như miễn phí).
- Brute-force (`joinAttempts`, đã có theo IP) mở rộng khoá thêm theo `accountId` ở `/api/login`; `/api/join-room` dùng lại đúng khoá theo IP như PIN hiện tại.
- Giữ nguyên: HMAC token, hết hạn 12h, ring buffer, reconnect. Chỉ đổi điểm vào.

### UI operator (laptop)

- Tab "Tài khoản" (sidebar, popup Kết nối): danh sách username/tên/vai trò/lần đăng nhập; nút **Đổi mật khẩu** (chỉ operator, band member không tự đổi được) / Khoá / Xoá. Thêm thành viên: operator tự nhập username + tên hiển thị + vai trò + **mật khẩu**.
- Settings: toggle "Yêu cầu mã PIN phòng sau khi đăng nhập" (`room.pinRequiredWithAccounts`) — dùng lại đúng ô Mã PIN đã có trong sidebar.
- Bật/tắt `accountsEnabled`, đổi `pinRequiredWithAccounts`, hoặc Khoá/Xoá/Đổi mật khẩu 1 account đang online → server **tự sinh lại `secret`** (y hệt lúc `start()`), khiến mọi token đang tồn tại verify-fail ngay ở lần gọi kế tiếp — client tự bung màn đăng nhập lại qua đúng luồng 401 đã có (`scheduleReconnect()`), không cần cơ chế "kick" riêng.

### UI mobile (phone)

- Màn 1 "Đăng nhập": ô nhập username + password. Bỏ hẳn ô tên tự do + chọn vai trò.
- Màn 2 "Nhập mã PIN phòng" — chỉ hiện khi server trả `needsRoomPin: true`.

### Di trú

Cờ `accountsEnabled` (mặc định `false`) — tắt = y hệt hiện tại, không ảnh hưởng bản cài chưa muốn đổi. Khi bật: `store.findProfileByName(name)` đã là fallback có sẵn khi tra `cfg.profiles[profileId]` không khớp — nếu operator đặt tên hiển thị account trùng tên người đó từng gõ tay trước đây, bộ nút cảnh báo cũ tự động khớp lại, không cần migration code. Ghi rõ điều kiện này trong hướng dẫn bật tính năng.

1 account đăng nhập nhiều máy cùng lúc: **cho phép, không chặn** — vì `profileId = accountId` dùng chung, nhiều máy cùng account tự nhiên chia sẻ bộ nút + quyền xoá ảnh, hợp lý khi đổi/mượn máy. Không xây cơ chế 1-phiên-1-account.

### Điểm cần bạn quyết

- **D10 — Cognito hay tự làm?** *Đề xuất: tự làm.*
- **D11 — Giữ PIN phòng chung (mô hình cũ) song song hay thay hẳn?** *Đề xuất: giữ cả 2, feature-flag `accountsEnabled`.*
- **D12 — Mật khẩu cá nhân: ai đặt, ai đổi được?** ✅ **Đã chốt:** operator tự đặt lúc tạo tài khoản; band member **không** tự đổi được, chỉ operator đổi qua tab Tài khoản.
- **D13 — `operator` có "tài khoản" không?** *Đề xuất: không — operator vẫn là danh tính cố định `clientId:'operator'`.*
- **D14 — `room.pinRequiredWithAccounts` mặc định tắt hay bật?** *Đề xuất: tắt.*
- **D15 — 1 account đăng nhập nhiều máy cùng lúc: cho phép hay chặn?** *Đề xuất: cho phép, không xây cơ chế 1-phiên-1-account.*
- **D16 — `tempToken`: nonce ngẫu nhiên + `Map` RAM riêng, hay nhét cờ `pending` vào chính token ký HMAC?** *Đề xuất: nonce + Map — fail-closed tự nhiên theo cấu trúc, không đụng format token thật.*
- **D17 — có cần chặn `profileId` tự khai (luồng cũ) trùng vào `accounts[].id` không?** *Đề xuất: có — chặn gần như miễn phí.*

**Mới:** `src/band-comm/accounts.js`, tab "Tài khoản" trong sidebar, 2 màn đăng nhập trong `comm/mobile/`.
**Sửa:** `server.js` (`POST /api/login` + `POST /api/join-room` thay 1 phần `/api/join`, `Map pendingLogins`, brute-force theo accountId, secret-rotate on mode-switch, chặn profileId trùng account id), `store.js` (cờ `accountsEnabled`/`room.pinRequiredWithAccounts`), `main.js`/`preload.js` (IPC quản lý account), `comm/mobile/index.html` + `app.js` (2 màn đăng nhập), `docs/data-contracts.md`.

### Lịch sử review (để truy vết, không lặp lại chi tiết — đã gộp hết vào bản trên)

- **Vòng 1:** đề xuất ban đầu (PIN cá nhân 4 số/account, cấu trúc giống bản P4 gallery). Góp ý: PIN quá yếu, nên tách hẳn "đăng nhập cá nhân" khỏi "khoá phòng" kiểu Zoom (username+password thật + PIN phòng tuỳ chọn).
- **Vòng 2** (dựa trên commit `96f48d0` — refactor gallery bỏ "1 người phụ trách ảnh", đổi quyền xoá theo `profileId`, token 5→6 phần mang `profileId`): 7 điểm kỹ thuật — xung đột `profileId` giữa gallery/account khi 1 người dùng nhiều máy; không nên thêm phần thứ 7 vào token; roster không được public qua tunnel; scrypt trên secret ngắn không phải lớp phòng thủ chính; hành vi khi đổi mode giữa buổi; di trú bộ nút cảnh báo cũ; nhiều máy cùng 1 account. Toàn bộ đã gộp vào thiết kế trên (đặc biệt: `profileId = account.id` giải quyết gọn xung đột gallery/token cùng lúc).
- **Vòng 3** (review `tempToken`): `tempToken` phải *về bản chất không verify được* như token thật (nonce + `Map pendingLogins`, không phải cờ `pending` gắn vào token ký HMAC) để fail-closed theo cấu trúc chứ không phải theo quy ước; hạn dùng nằm trong `pendingLogins`, không thêm hằng số hạn song song; chặn `profileId` tự khai (luồng cũ) trùng `accounts[].id`. Đã gộp vào mục API/Data model ở trên.

## 12. Bỏ hẳn phân biệt vai trò band/leader (2026-09-17)

Trong lúc duyệt lại form tạo tài khoản ở sidebar, câu hỏi đặt ra: có còn cần phân biệt `band`/`leader` không? Soát toàn bộ codebase (`server.js`, `accounts.js`, `store.js`, `protocol.js`, `comm/mobile/app.js`, `index.html` operator, `cloud/worker/src/worker.js`, `cloud/identity/src/worker.js`) bằng grep + đọc từng điểm dùng `role`: **không route hay UI nào từng rẽ nhánh theo `role === 'leader'`** để cấp quyền hay đổi hành vi khác `band` — field này chỉ được lưu/truyền/hiển thị (badge, presence list) từ lúc P1 tới giờ. `ROLES` export ở `protocol.js` không ai import. Chỗ duy nhất có rẽ nhánh theo role là `role === 'operator'` (lọc echo tin operator khỏi feed, và nháy taskbar khi có alert không phải từ operator) — khác hẳn phạm vi band/leader, đã thay bằng check `clientId === 'operator'` (tương đương, đã có sẵn, không cần field `role`).

**Đã xoá field `role` khỏi toàn bộ hệ thống** (không giữ code chết):
- Token phiên: 6 phần → **5 phần**, bỏ segment `role` — `clientId.issued.<b64url(name)>.<b64url(profileId)>.<hmac>`. `makeToken()`/`verifyToken()` sửa theo.
- `server.js`: bỏ `sanitizeJoinRole()`, bỏ `role` khỏi mọi client record, `presenceList()`, `finishLogin()`, `afterIdentityVerified()`, `pendingLogins`, cả 3 luồng (`/api/join` PIN phòng cũ, `/api/login` local account, `/api/login` nhánh `authMode='cognito'`), envelope `from` (alert + setlist), `OPERATOR` const.
- `accounts.js`: bỏ `role` khỏi schema account, `create()`, `update()`, `publicAccount()`.
- `store.js`: bỏ `role` khỏi `saveProfile()` (bộ nút cảnh báo không còn gắn role).
- `protocol.js`: bỏ hẳn `ROLES` export (dead code).
- `comm/mobile/`: bỏ hẳn UI chọn "Bạn là" (2 nút Thành viên band / Người hướng dẫn) ở **cả 2** màn join còn dùng nó (PIN phòng cũ + Cognito) — `app.js` bỏ biến `role`, mọi tham số `role`/`roleVal` xuyên suốt chuỗi hàm `doLegacyJoin → doCognitoLogin → doCognitoNewPassword → doCognitoFinish → finalizeJoin`.
- Operator `index.html`: form "Tài khoản thành viên" bỏ dropdown Vai trò (còn 2 field: Tên đăng nhập + Tên hiển thị); bỏ badge vai trò trong danh sách account.
- `cloud/worker/src/worker.js`: bỏ `role` khỏi `from` khi lưu setlist vào KV.
- `docs/data-contracts.md`: cập nhật toàn bộ mô tả envelope/token/account schema khớp theo.

**Không đổi:** vai trò `operator` (là danh tính cố định `clientId:'operator'`, không phải giá trị field `role` — vốn đã tách biệt khỏi band/leader trong thiết kế) — D13 vẫn đúng nguyên: operator không có "tài khoản" theo nghĩa §11.
