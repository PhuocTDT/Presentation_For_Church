# Chuẩn Dữ Liệu

## Item cơ bản

Item được lưu trong library thường có dạng:

```json
{
  "id": 1234567890,
  "title": "Amazing Grace",
  "lyrics": "Line 1\nLine 2\n\nLine 3",
  "type": "song",
  "style": {
    "fontSize": "80px",
    "fontFamily": "CMG Sans",
    "color": "#ffffff",
    "textAlign": "center",
    "verticalAlign": "middle",
    "textBox": {
      "left": 48,
      "width": 864
    }
  },
  "background": null
}
```

## Quy ước migrate

- `fontColor` là field legacy, phải được chuyển sang `color`
- `fontSize` có thể từng là number hoặc chuỗi `pt`; dữ liệu mới nên là chuỗi `px`
- `migrateItem()` phải giữ tương thích ngược
- `validateItem()` phải chặn item thiếu `id`, `title`, `lyrics`

## Settings

Settings hiện lưu trong `settings.json`. Các field quan trọng gồm:

- `theme`
- `gpuAcceleration`
- `fontFamilySong`
- `fontFamilyBible`
- `fontSize`
- `color`
- `fontWeight`
- `textAlign`
- `verticalAlign`
- `textStrokeWidth`
- `textStrokeColor`
- `textMargin` (`top`, `right`, `bottom`, `left`)
- `textPadding` (`top`, `right`, `bottom`, `left`)
- `autoFitText` (`true`/`false`); tự động giảm cỡ chữ khi lyric/câu Kinh Thánh dài để không tràn khung chiếu
- `mediaPath`
- `allowSingleDisplayLiveWindow` (`true`/`false`); cho phép mở `Screen Live` khi không có màn hình phụ và hiển thị đè lên monitor trong app
- `liveWindowBounds` (`x`, `y`, `width`, `height`) hoặc `null`; dùng để ghi nhớ vị trí cửa sổ Live khi chỉ có một màn hình
- `shortcuts`
- `defaultShortcutRows`:
  - mỗi row gồm `key1`, `key2`, `key3`, `action`
- `customShortcuts`:
  - danh sách động, mỗi row gồm `key1`, `key2`, `key3`, `action`

## Media

Media object thường có:

- `name`
- `path`
- `type` = `image` hoặc `video`

Media thật nằm trong `userData/media` hoặc folder được cấu hình bởi `mediaPath`.

## Bulk replace

- Công cụ tìm kiếm và thay thế hàng loạt trong Settings áp dụng trực tiếp lên `songs.json` và các file XML trong `app.getPath('userData')/bible-versions`
- Chế độ `Preview` chỉ đếm số match và số item/file bị ảnh hưởng, không ghi dữ liệu
- Khi áp dụng cho Bible XML, cache theo version phải bị xóa để app parse lại nội dung mới

## Bible cache

- File cache được tạo theo từng XML nguồn
- Không nên coi cache là nguồn dữ liệu duy nhất
- Khi XML đổi, cache phải được rebuild
- XML bundled mặc định nằm trong `data/` của app package
- XML do người dùng import được lưu trong `app.getPath('userData')/bible-versions`
- Metadata quản lý tên hiển thị và trạng thái ẩn của version được lưu trong `app.getPath('userData')/bible-versions.json`
- Khi load danh sách version, userData phải được ưu tiên hơn bundled defaults
- `displayName` của version có thể khác tên file XML; rename chỉ đổi metadata, không đổi file vật lý
- Xóa version `user` sẽ xóa file XML và cache liên quan; xóa version `bundled` sẽ được thực hiện bằng cách ẩn version đó khỏi UI qua metadata

## Schedule

- Schedule item có thể lưu `style` override riêng cho buổi trình chiếu mà không ghi đè style của item gốc trong library
- Khi người dùng áp `Style Template`, app có thể lưu thêm `sourceStyle`, `appliedTemplateId`, `appliedTemplateName` vào schedule item để quay lại `Style mặc định` nhanh và giữ được style đã chọn khi save/open `.bcsch`

- File schedule dùng đuôi `.bcsch`
- Nội dung là JSON
- Save/Open đi qua native dialog

## Style templates và custom fonts

- `Style Templates` được lưu trong `app.getPath('userData')/style-templates.json`
- Mỗi template lưu `id`, `name`, `scope`, và `style`
- `style.boxStyle` hỗ trợ box nền cho chữ với `enabled`, `backgroundColor`, `backgroundOpacity`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius`
- Font custom được lưu trong `app.getPath('userData')/custom-fonts/` và metadata nằm trong `app.getPath('userData')/custom-fonts.json`
- V1 chỉ hỗ trợ upload font `.ttf` và `.otf`

## Kênh Band

Xem `band-comm-plan.md` để biết đầy đủ. Tóm tắt contract:

- UI phía operator là **sidebar `#bandPanel` trong `index.html`** (theme trắng), mở bằng menu top-level **Channel** (`Ctrl+Shift+B`) → IPC `band-comm-toggle-panel`, hoặc tab mép trái. Không còn cửa sổ riêng.
- Comm server **tự khởi chạy** khi mở app; kết quả (chạy / lỗi chi tiết) đẩy về sidebar qua `band-comm-status-changed` + tin `system` trong feed. Cổng cố định — bận thì báo lỗi, không đổi cổng.
- **mDNS** (`src/band-comm/mdns.js`, tự viết) announce `<room.hostname>.local` → IP LAN hiện tại; QR encode `http://<hostname>.local:<port>` nên IP đổi không ảnh hưởng.
- Cấu hình lưu ở `app.getPath('userData')/band-comm.json`, **không** đi qua `src/schema.js` / `migrateItem`. `src/band-comm/store.js` tự chuẩn hoá field thiếu khi load.
  - `room` (`name`, `pin` 4–8 chữ số — sinh ngẫu nhiên nếu thiếu, `hostname` mặc định `worship`, `uploaderPin` — `null` hoặc 4–8 số: mã cấp quyền **"người phụ trách ảnh hợp âm"** cho 1 điện thoại), `port` (mặc định 7071 — tự dò cổng khác nếu bị Windows/Hyper-V reserve, cổng chốt được lưu lại)
  - `publicUrl` — URL công khai (Cloudflare Tunnel / domain) để QR trỏ ra; rỗng = chỉ LAN
  - `operatorReplies` — mảng câu trả lời nhanh của người vận hành
  - `profiles` — backup bộ nút cá nhân theo `profileId`: `{ name, role, updatedAt, buttons:[{id,label,icon,group}] }`
  - `gallery` — thư viện ảnh hợp âm. Metadata + file ảnh KHÔNG nằm trong `band-comm.json` mà ở `band-comm-gallery.json` + thư mục `band-comm-media/` (cùng `userData`). Manifest: `{ images: [{id, name}], updatedAt }`; file ảnh lưu `<id><ext>` (`.jpg`/`.png`/`.webp`), nén phía client ≤ 1400px trước khi gửi.
- **Bộ nút cảnh báo là của từng người**, tạo trên điện thoại, lưu `localStorage` phía client; server chỉ giữ 1 bản backup. Không có bộ nút mặc định. **Không có `severity`/mức độ** — mọi tin xử lý như nhau.
- Envelope tin nhắn trên dây (WebSocket + IPC `band-comm-event`): `{ id, ts, type, from:{clientId,name,role}, to, refId, buttonId, dedupKey, text, meta }`.
  - `type`: `alert` (từ band) · `text` (từ operator) · `ack` (đã tiếp nhận, nhắm riêng người gửi) · `resolve` (đã xử lý, phát tất cả) · `presence` · `system` · `gallery` (`meta` = manifest ảnh hợp âm; phát khi bộ ảnh đổi).
  - `dedupKey` = `text` chuẩn hoá (bỏ dấu, thường, gộp khoảng trắng) — sidebar Kênh Band gộp cảnh báo trùng theo khoá này.
- Token phiên = `clientId.issued.<b64url(name)>.role.<hmac>`; secret ký sinh mới mỗi lần bật server (restart server = mọi phone phải vào lại).
- HTTP endpoints: `POST /api/join`, `POST /api/message`, `POST /api/ping`, `POST|GET /api/profile`, `POST /api/leave`. Downstream là **WebSocket** `GET /api/ws?token=…&since=<lastEnvelopeId>` (không còn `/api/stream` SSE — Cloudflare Tunnel buffer streaming HTTP). Mọi route trừ `join` cần token.
- Ảnh hợp âm — endpoints:
  - `GET /api/gallery` → manifest.
  - `GET /api/gallery/image/:id?token=` → bytes ảnh.
  - `POST /api/gallery/claim` `{pin}` → giành quyền "người phụ trách ảnh" bằng `room.uploaderPin`; chỉ **1 người online** giữ quyền, người cũ offline > 25s bị thay. Trả `{ok, uploader:true}` hoặc `409`.
  - `POST /api/gallery/add` `{name, ext, dataB64}` → thêm ảnh (chỉ người phụ trách). Phát `gallery` envelope.
  - `POST /api/gallery/remove` `{id}` → xoá ảnh (chỉ người phụ trách).
  - `POST /api/join` trả thêm `hasUploaderPin` (điện thoại biết có nên hiện nút "Phụ trách ảnh").
- Operator side: sidebar `#bandPanel` (khu "Ảnh hợp âm" trong popup "Kết nối") có nút Thêm ảnh + danh sách xoá + ô "Mã phụ trách" (đặt `room.uploaderPin`). Operator luôn thêm/xoá được qua IPC `band-comm-gallery-list|add|remove|reorder`.
- Mobile: ảnh **không tự hiện** — nút "🎼 Hợp âm" ở topbar (chấm đỏ khi bộ ảnh đổi), bấm mới mở khu xem (vuốt ngang + dot pager). Người phụ trách thấy khu này thường trực kèm nút Thêm / Xoá.

### Setlist (soạn danh sách bài từ điện thoại) — M1, LAN

- `GET /api/library` → `{ songs:[{id,title,lyrics}], count, updatedAt }` — chỉ mục thư viện bài hát để điện thoại chọn (lyrics kèm để nhận diện đúng bài). Do `main.js` cung cấp qua callback `getLibraryIndex` (đọc `songs.json` + `migrateItem`).
- `POST /api/setlist` `{ id?, name, items:[{type:'song', id, title?}] }` → server lưu vào bộ nhớ **phiên** (RAM, tối đa 30, idempotent theo `id`), phát callback `onSetlist` → main.js `broadcastToRenderers('band-comm-setlist', setlist)` + nháy taskbar. Trả `{ok, id}`. `items` lọc còn `type:'song'`, tối đa 60. Rỗng → `400`.
- `GET /api/setlist` → `{ setlists }` — xem lại các setlist đã gửi trong phiên.
- Setlist KHÔNG bền qua restart server (M1). Hàng đợi khi laptop tắt hẳn = M2 (Cloudflare Worker + KV).
- IPC operator: `band-comm-setlist` (envelope setlist) → sidebar hiện thẻ "📋 Setlist: … · N bài · từ …" với [Xem] / [Nạp vào Schedule]. **Nạp = luôn thay thế** toàn bộ `schedule`; bài khớp `id` trong `songLibrary` thì lấy đủ (lyrics/style), không khớp → item tạm chỉ có tiêu đề.
