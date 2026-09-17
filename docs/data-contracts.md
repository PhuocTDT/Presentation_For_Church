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
  - `room` (`name`, `pin` 4–8 chữ số — sinh ngẫu nhiên nếu thiếu, `pinSetAt` — timestamp lần đặt/đổi PIN gần nhất, `store.save()` tự stamp lại khi `pin` thật sự đổi giá trị; sidebar dùng để nhắc đổi PIN sau 7 ngày, `hostname` mặc định `worship`), `port` (mặc định 7071 — tự dò cổng khác nếu bị Windows/Hyper-V reserve, cổng chốt được lưu lại)
  - `publicUrl` — URL công khai (Cloudflare Tunnel / domain) để QR trỏ ra; rỗng = chỉ LAN. Từ khi có Named Tunnel: đặt 1 lần `https://blessing.worship-official.link` (xem "Named Tunnel" bên dưới), không cần dán lại URL tạm mỗi lần chạy nữa.
  - `cloudRoomId` — UUID cho hộp thư cloud (M2), xem mục Setlist bên dưới
  - `tunnelName` — tên Cloudflare Named Tunnel; đặt giá trị thì `main.js` chạy `cloudflared tunnel run <tunnelName>` (domain cố định). Rỗng (**mặc định**) **không** có nghĩa là tắt tunnel — app vẫn tự chạy Quick Tunnel (`*.trycloudflare.com`, đổi mỗi lần start), xem mục "Named Tunnel (thay Quick Tunnel)" bên dưới để biết đầy đủ 2 mode
  - `operatorReplies` — mảng câu trả lời nhanh của người vận hành
  - `profiles` — backup bộ nút cá nhân theo `profileId`: `{ name, role, updatedAt, buttons:[{id,label,icon,group}] }`
  - `gallery` — thư viện ảnh hợp âm. Metadata + file ảnh KHÔNG nằm trong `band-comm.json` mà ở `band-comm-gallery.json` + thư mục `band-comm-media/` (cùng `userData`). Manifest: `{ images: [{id, name, ownerId}], updatedAt }`; file ảnh lưu `<id><ext>` (`.jpg`/`.png`/`.webp`), nén phía client ≤ 1400px trước khi gửi. `ownerId` = `profileId` của điện thoại đã thêm ảnh đó (`null` cho ảnh operator thêm qua sidebar) — dùng để xác định ai được tự xoá, xem mục "Ảnh hợp âm — endpoints" bên dưới.
- **Bộ nút cảnh báo là của từng người**, tạo trên điện thoại, lưu `localStorage` phía client; server chỉ giữ 1 bản backup. Không có bộ nút mặc định. **Không có `severity`/mức độ** — mọi tin xử lý như nhau.
- Envelope tin nhắn trên dây (WebSocket + IPC `band-comm-event`): `{ id, ts, type, from:{clientId,name,role}, to, refId, buttonId, dedupKey, text, meta }`.
  - `type`: `alert` (từ band) · `text` (từ operator) · `ack` (đã tiếp nhận, nhắm riêng người gửi) · `resolve` (đã xử lý, phát tất cả) · `presence` · `system` · `gallery` (`meta` = manifest ảnh hợp âm; phát khi bộ ảnh đổi) · `room` (`meta` = `{setlistEnabled}`; phát khi operator đổi `tunnelName` — bù cho việc phone chỉ nhận field này 1 lần lúc `/api/join`, không tự re-fetch khi reconnect).
  - `dedupKey` = `text` chuẩn hoá (bỏ dấu, thường, gộp khoảng trắng) — sidebar Kênh Band gộp cảnh báo trùng theo khoá này.
- Token phiên = `clientId.issued.<b64url(name)>.role.<b64url(profileId)>.<hmac>`; secret ký sinh mới mỗi lần bật server (restart server = mọi phone phải vào lại). Token cũng tự hết hạn sau `TOKEN_MAX_AGE_MS` = 12 giờ kể từ `issued` (dù server không restart) — phone bị `401`, `comm/mobile/app.js`'s `scheduleReconnect()` tự xoá token cũ + bung lại màn hình nhập PIN, không cần code thêm phía mobile. `profileId` mang theo trong token để mọi lần rebuild client record từ token (reconnect WS, request HTTP sau restart RAM) đều giữ nguyên — đây là danh tính dùng để xác định "chủ ảnh" cho quyền tự xoá trong gallery (xem dưới), không phải chỉ có lúc `/api/join`. Khi đăng nhập qua tài khoản (xem "Đăng nhập tài khoản" bên dưới), `profileId` = `account.id` chứ không phải id ngẫu nhiên phía client — mọi cơ chế theo-`profileId` (bộ nút cảnh báo, `ownerId` gallery) tự động hoạt động đúng theo tài khoản, không cần sửa gì thêm.
- HTTP endpoints: `GET /api/mode`, `POST /api/join`, `POST /api/login`, `POST /api/join-room`, `POST /api/message`, `POST /api/ping`, `POST|GET /api/profile`, `POST /api/leave`. Downstream là **WebSocket** `GET /api/ws?token=…&since=<lastEnvelopeId>` (không còn `/api/stream` SSE — Cloudflare Tunnel buffer streaming HTTP). Mọi route trừ `mode`/`join`/`login`/`join-room` cần token.
- **Chống brute force PIN** trên `/api/join` (`joinAttempts` trong `server.js`, theo IP nguồn `req.socket.remoteAddress`, chỉ ở RAM — mất khi restart server): 5 lần sai đầu miễn phí (khớp gõ nhầm tay), từ lần sai thứ 5 trở đi khoá tăng dần — 30s (fails 5-9) → 5 phút (10-19) → 30 phút (≥20); trả `429` kèm header `Retry-After` khi đang bị khoá, kể cả nếu PIN gõ đúng lúc đó (không có cách nào bỏ qua khoá bằng cách đoán đúng). PIN mặc định chỉ 4 số (10.000 khả năng) nên không có khoá này thì dò được rất nhanh. Sinh qua Cloudflare Tunnel: mọi request đều tới từ `127.0.0.1` (cloudflared proxy nội bộ) nên khoá theo IP lúc đó thành khoá dùng chung cho toàn bộ traffic ngoài LAN — chấp nhận được, ưu tiên hơn không có gì chặn. Dọn entry cũ (> 1 giờ không hoạt động) mỗi nhịp heartbeat (`pruneJoinAttempts`, cùng interval `HEARTBEAT_MS` dọn presence). Operator có thể bấm 🔄 cạnh Mã PIN trong sidebar để đổi PIN ngay nếu nghi bị dò.
- Ảnh hợp âm — endpoints (không còn khái niệm "1 người phụ trách" — bất kỳ client nào đã join hợp lệ (token) đều thêm ảnh được, tránh 1 người cầm quyền/kẹt zombie chặn cả nhóm; xoá thì chỉ được xoá ảnh chính mình đã đăng):
  - `GET /api/gallery` → manifest.
  - `GET /api/gallery/image/:id?token=` → bytes ảnh.
  - `POST /api/gallery/add` `{name, ext, dataB64}` → ai có token hợp lệ cũng thêm được. Server tự gắn `ownerId = client.profileId` (rút từ token, không phải body — phone không tự khai được). Phát `gallery` envelope.
  - `POST /api/gallery/remove` `{id}` → chỉ xoá được nếu `item.ownerId === client.profileId` (và `profileId` phải hợp lệ), ngược lại `403 { error: 'Bạn chỉ xoá được ảnh mình đã đăng' }`.
- Operator side: sidebar `#bandPanel` (khu "Ảnh hợp âm" trong popup "Kết nối") có nút Thêm ảnh + danh sách xoá. Operator luôn thêm/xoá được **bất kỳ ảnh nào** qua IPC `band-comm-gallery-list|add|remove|reorder` — kênh này gọi thẳng hàm core (`galleryAdd`/`galleryRemove` trong `server.js`), không đi qua check `ownerId` (check đó chỉ nằm ở route HTTP `/api/gallery/remove` cho phone).
- Mobile: ảnh **không tự hiện** — nút "🎼 Hợp âm" ở topbar (chấm đỏ khi bộ ảnh đổi), bấm mới mở khu xem (vuốt ngang + dot pager) kèm nút Thêm ảnh, luôn hiện với mọi client. Nút "Xoá" trên từng ảnh chỉ hiện khi `ảnh.ownerId === state.profileId` của chính điện thoại đó.
- **Mirror lên Cloudflare R2 để xem ổn định, không phụ thuộc tunnel** (`cloud/worker/`, bucket `band-comm-gallery`, binding `GALLERY`): `galleryAdd()`/`galleryRemove()` ở `server.js` gọi `POST /gallery` / `POST /gallery/remove` trên Worker ngay sau khi thao tác local thành công — fire-and-forget, không chặn response, ảnh vẫn dùng được qua local/LAN nếu mirror lỗi. Object key `<cloudRoomId>/<id>` (không phần mở rộng, content-type lưu ở `httpMetadata`). **Tự xoá sau 4 ngày** qua lifecycle rule `expire-4d` đặt trên bucket (đủ trải tối T6 tập → CN diễn) — không cần dọn tay. Mobile (`renderChords()`) dựng `<img>` ưu tiên URL cloud `https://api.worship-official.link/gallery/image/<cloudRoomId>/<id>`, `onerror` tự rớt về URL local (`api/gallery/image/:id?token=`) nếu cloud lỗi/chưa kịp mirror. Danh sách ảnh nào tồn tại (metadata) **vẫn do local quyết định** như cũ (WS `gallery` envelope + `/api/join`) — Worker chỉ lưu/phục vụ bytes, không phải nguồn sự thật.

### Đăng nhập tài khoản (thay/kèm PIN phòng dùng chung) — band-comm-plan.md §11

- **Tắt theo mặc định** (`accountsEnabled: false` trong `band-comm.json`) — không ảnh hưởng bản cài nào chưa bật; mọi hành vi `/api/join` (PIN phòng + tên tự gõ) giữ nguyên như trước.
- Khi bật: **operator (laptop) là nơi DUY NHẤT tạo/sửa/xoá tài khoản** — không có endpoint tự đăng ký. Dữ liệu tách file riêng `userData/band-comm-accounts.json` (`src/band-comm/accounts.js`, mirror pattern `store.js`) — lý do tách giống gallery: giảm đụng độ khi sửa đồng thời.
  - Mỗi account: `{ id, username, name, role, passwordHash, passwordSalt, active, createdAt, lastLoginAt }`. `passwordHash`/`Salt` = `crypto.scryptSync(password, salt, 64)` (built-in Node, 0 dependency). **Giới hạn thật của hash này:** chỉ chống lộ file trần, KHÔNG chống brute-force offline nếu file lộ VÀ password ngắn/yếu — lớp phòng thủ thật là rate-limit theo `accountId` ở `/api/login` (xem dưới), không phải việc có hash hay không.
  - Mật khẩu **do operator tự đặt lúc tạo** (không có "hệ thống tự sinh rồi hiện 1 lần"), và **band member không tự đổi được** — chỉ operator đổi qua tab "Tài khoản" (Settings → Media & Band).
- `GET /api/mode` (public, không cần token, không lộ roster) → `{ accountsEnabled, pinRequiredWithAccounts }` — mobile dùng để biết vẽ màn hình nào lúc tải trang.
- `POST /api/login` `{ username, password }` — verify qua `accounts.js`, lấy `name`/`role` thật từ account (client không tự khai). **Không có** `GET/POST /api/accounts` liệt kê roster — cố tình, tránh lộ danh sách tên/vai trò qua Cloudflare Tunnel công khai (mặc định bật, xem CLAUDE.md). Trả:
  - `room.pinRequiredWithAccounts=false` (mặc định) → token đầy đủ ngay (cùng shape response với `/api/join`, cộng thêm `name`/`role`).
  - `true` → `{ needsRoomPin: true, tempToken }`. `tempToken` = `crypto.randomBytes(16).toString('hex')`, lưu trong `Map pendingLogins` (accountId/name/role/expiresAt, TTL 5 phút, dọn cùng nhịp heartbeat) — **không đi qua `makeToken()`/`verifyToken()`** (không đủ 6 phần cách nhau bằng dấu chấm) nên mọi route khác tự động `401` nếu lỡ dùng nhầm, fail-closed theo đúng cấu trúc dữ liệu chứ không phải vì có route nào tự nhớ kiểm tra 1 cờ.
- `POST /api/join-room` `{ tempToken, pin }` (chỉ gọi khi bước trên báo `needsRoomPin`) — verify `pin` đúng `room.pin` hiện có (dùng lại nguyên cơ chế PIN phòng, không phải field mới) → đổi `tempToken` lấy token đầy đủ.
- Rate-limit (dùng lại `joinAttempts`/`pinBackoffMs` của PIN phòng, xem mục "Chống brute force PIN" phía trên): `/api/login` khoá theo **cả** `login-ip:<ip>` **và** `login-acct:<username>` (gõ sai password của chính mình nhiều lần không khoá lây người khác cùng IP/Tunnel, nhưng account đó vẫn bị khoá dù đổi IP); `/api/join-room` khoá theo `joinroom-ip:<ip>`.
- `/api/join` (luồng PIN phòng cũ) chặn thêm 1 điều kiện khi cả 2 luồng cùng bật (`accountsEnabled=true` + vẫn cho PIN phòng chạy song song): `body.profileId` client tự khai **không được trùng bất kỳ `accounts[].id` thật nào** — nếu trùng, coi như không hợp lệ (server tự sinh id khác) — chặn 1 client biết/đoán đúng id 1 account thật chiếm quyền xoá ảnh/bộ nút của account đó mà không cần đăng nhập.
- Đổi mật khẩu / khoá / xoá 1 account, hoặc bật/tắt `accountsEnabled`/`room.pinRequiredWithAccounts` → gọi `commServer.rotateSecret()` (sinh lại secret ký HMAC) — mọi token đang tồn tại verify-fail ngay ở lần gọi kế tiếp, client tự bung màn đăng nhập lại qua đúng luồng `401` đã có, không cần cơ chế "kick" riêng theo từng WebSocket.

### Setlist (soạn danh sách bài từ điện thoại) — M1, LAN

- `GET /api/library` → `{ songs:[{id,title,lyrics}], count, updatedAt }` — chỉ mục thư viện bài hát để điện thoại chọn (lyrics kèm để nhận diện đúng bài). Do `main.js` cung cấp qua callback `getLibraryIndex` (đọc `songs.json` + `migrateItem`).
- `POST /api/setlist` `{ id?, name, items:[{type:'song', id, title?}] }` → server lưu vào bộ nhớ **phiên** (RAM, tối đa 30, idempotent theo `id`), phát callback `onSetlist` → main.js `broadcastToRenderers('band-comm-setlist', setlist)` + nháy taskbar. Trả `{ok, id}`. `items` lọc còn `type:'song'`, tối đa 60. Rỗng → `400`.
- `GET /api/setlist` → `{ setlists }` — xem lại các setlist đã gửi trong phiên.
- Setlist qua LAN KHÔNG bền qua restart server (M1). Hàng đợi khi laptop tắt hẳn = M2, xem dưới.
- **Chỉ bật khi có Named Tunnel** (`cfg.tunnelName` khác rỗng) — hàm `setlistEnabled()` trong `server.js`. Quick Tunnel đổi URL mỗi lần chạy nên không có cách nào gửi cho band 1 link soạn-từ-xa dùng lại được; thay vì hứa hẹn nửa vời, `GET /api/library`, `GET/POST /api/setlist` trả `404` và mobile ẩn hẳn nút "📋 Setlist" khi tắt (server trả `setlistEnabled` trong `POST /api/join`).
- IPC operator: `band-comm-setlist` (envelope setlist) → sidebar hiện thẻ "📋 Setlist: … · N bài · từ …" với [Xem] / [Nạp vào Schedule]. **Nạp = luôn thay thế** toàn bộ `schedule`; bài khớp `id` trong `songLibrary` thì lấy đủ (lyrics/style), không khớp → item tạm chỉ có tiêu đề.

### Setlist — hộp thư cloud khi laptop tắt hẳn (M2)

- Hạ tầng: Cloudflare Worker (`cloud/worker/src/worker.js`) + Workers KV, domain riêng `api.worship-official.link` (Route 53 chỉ dùng để trỏ NS sang Cloudflare — DNS/route thật nằm ở Cloudflare). Deploy bằng `npx wrangler deploy` trong `cloud/worker/`. Route khai báo kiểu **Custom Domain** (`custom_domain = true` trong `wrangler.toml`) chứ không phải `routes` + `zone_name` thường — cách này để `wrangler deploy` tự tạo DNS record cần thiết, không phải chỉnh DNS zone thủ công.
- `cfg.cloudRoomId`: UUID sinh 1 lần trong `band-comm.json` (`src/band-comm/store.js`), namespace hoá dữ liệu trên KV (`sl:<roomId>:<id>`, `ack:<roomId>:<id>`, TTL 7 ngày). Không phải bí mật mạnh — đủ khó đoán cho quy mô LAN nội bộ, PIN thật vẫn ở tầng server local. Trả về cho điện thoại trong response `POST /api/join`.
- Worker endpoints (không cần token — xác thực bằng `roomId` khó đoán): `POST /setlist {roomId, setlist:{id,name,from:{name,role},items}}`, `GET /setlist?roomId=` → `{setlists}`, `POST /setlist/ack {roomId,id}`, `GET /setlist/ack?roomId=&ids=a,b,c` → `{acked}`, `GET /health`.
- Rate-limit theo `roomId` trên 2 endpoint ghi (`POST /setlist`, `POST /setlist/ack`): tối đa `RATE_LIMIT_MAX`=30 lượt/`RATE_LIMIT_WINDOW_MS`=5 phút, đếm bằng key KV `rl:<roomId>:<bucket>` (get rồi put, không atomic — chấp nhận sai số nhỏ, cùng kiểu đánh đổi như cap `MAX_SETLISTS_PER_ROOM`). Vượt giới hạn → `429`. Vì Worker dùng chung cho mọi bản cài app (không auth thật), giới hạn này chặn 1 roomId đốt hết quota request/KV chung của mọi nhà thờ khác.
- Mobile (`comm/mobile/app.js`, `sendSetlist()`): thử `POST api/setlist` qua LAN trước; **chỉ khi lỗi mạng** (laptop/tunnel không tới được, không phải lỗi validate) mới fallback `POST` thẳng lên `CLOUD_API_BASE` bằng `state.cloudRoomId` đã lưu lúc join.
- Server local (`src/band-comm/server.js`): `ingestSetlist()` là điểm nhận chung cho cả 2 nguồn (LAN + cloud), idempotent theo `id` giống nhau nên không trùng dù phone gửi lặp qua 2 đường. `pollCloud()` chạy ngay lúc `start()` (vét hộp thư sau khi laptop mở lại) + định kỳ mỗi 60s trong lúc server đang chạy (vét trường hợp phone rơi vào nhánh cloud dù laptop vẫn đang mở), ack lại từng id đã nhận. Cloud không tới được → im lặng bỏ qua, không ảnh hưởng LAN.

### Named Tunnel (thay Quick Tunnel) — domain cố định cho band-comm

- Setup 1 lần trên máy vận hành (đã làm): `cloudflared tunnel login` (đăng nhập trình duyệt, tải `cert.pem`) → `cloudflared tunnel create blessing-band` (sinh tunnel id + file credentials JSON, cả 2 nằm trong `%USERPROFILE%\.cloudflared\`, KHÔNG commit vào repo) → `cloudflared tunnel route dns blessing-band blessing.worship-official.link` (tạo CNAME trỏ tunnel).
- `%USERPROFILE%\.cloudflared\config.yml` (không nằm trong repo, máy nào chạy tunnel phải tự có): ingress `blessing.worship-official.link` → `http://127.0.0.1:7071` (khớp `DEFAULT_PORT` trong `store.js`; nếu server fallback sang cổng khác do bị Windows/Hyper-V reserve, phải sửa lại `service:` trong file này cho khớp cổng thật).
- **App LUÔN tự chạy `cloudflared`** (`main.js`, hàm `syncBandTunnel()`) ngay sau khi band-comm server start — không còn trạng thái "tắt hẳn", chỉ có 2 mode:
  - `cfg.tunnelName` có giá trị → **Named Tunnel**: `cloudflared tunnel run <tunnelName>`. Cấu hình 1 lần qua sidebar, ô "Tên Cloudflare Named Tunnel" (`#bpTunnelName`) — nâng cao, cho church đã có domain riêng (xem wizard, mục dưới).
  - `cfg.tunnelName` rỗng (**mặc định**) → **Quick Tunnel**: `cloudflared tunnel --url http://127.0.0.1:<port>`, tự bắt URL `*.trycloudflare.com` in ra stdout/stderr rồi lưu thẳng vào `publicUrl` (không cần ai gõ tay) → QR tự cập nhật. Đổi URL mỗi lần band-comm start (bản chất Quick Tunnel), vì vậy **Setlist bị ẩn khi ở mode này** (xem mục Setlist).
  - ⚠️ Quick Tunnel PHẢI truyền `--config <file rỗng riêng>` (ghi vào `userData/cloudflared-quick.yml` mỗi lần dùng) — nếu không, cloudflared tự nạp `%USERPROFILE%\.cloudflared\config.yml` mặc định (của Named Tunnel, nếu máy đó có) và áp `ingress` catch-all `http_status:404` của config đó đè lên `--url`, khiến mọi request qua Quick Tunnel trả 404 dù origin sống bình thường. Đã tái hiện + fix + verify thật lỗi này.
  - Đổi `tunnelName` trong lúc đang chạy (qua `band-comm-save-config`) → tự restart đúng mode mới; không có state cũ nào bị treo lại.
  - Không tìm thấy lệnh `cloudflared` (ENOENT) hoặc tunnel lỗi → chỉ log 1 dòng `system` vào feed sidebar, không chặn LAN.
- **Binary `cloudflared` được đóng gói sẵn**, không cần user tự cài: `scripts/fetch-cloudflared.js` (chạy tự động qua `npm run postinstall`) tải bản Windows chính thức từ GitHub Releases (`cloudflare/cloudflared`) vào `vendor/cloudflared/win/` (gitignore, không commit — ~50-90MB). `electron-builder` đóng gói qua `build.win.extraResources` vào `resources/cloudflared/cloudflared.exe`. `main.js` hàm `resolveCloudflaredCmd()` ưu tiên: bản đóng gói (`process.resourcesPath`) → bản dev (`vendor/cloudflared/win/`) → PATH hệ thống (máy đã tự cài từ trước). Tải lỗi (offline, firewall) → chỉ cảnh báo, không phá `npm install`.
- Chạy tay Named Tunnel (không cần app) vẫn dùng được như cũ: `cloud/tunnel/start-tunnel.bat`.
- **Wizard "⚙️ Thiết lập domain riêng tự động"** nằm trong **File → Cài đặt** (`#settings-modal`, không phải popup Kết nối của sidebar Kênh Band — đã chuyển sang đó để tách rõ "cấu hình 1 lần" khỏi "thông tin kết nối hằng ngày"). `#bpTunnelName` cũng chuyển theo cùng. `#bpPublicUrl`/QR/PIN/Firewall/Gallery/Hỗ trợ vẫn ở popup Kết nối như cũ. Vì các phần tử này giờ nằm ngoài `#bandPanel`, dùng class Tailwind `hidden` (không phải `.bp-hidden` — class đó scope theo `#bandPanel` nên không áp dụng được ở đây) và style theo quy ước "classic Windows" của `#settings-modal` (`win-button`, `border-win-border`) thay vì `.bp-btn`/`.bp-purl` của Kênh Band. Logic JS (biến, hàm) không đổi chỗ — vẫn nằm trong script của sidebar Kênh Band, chỉ HTML chuyển vị trí (event listener hoạt động bình thường bất kể phần tử nằm đâu trong DOM). `main.js` menu **Settings** (`Ctrl+Shift+P`) → IPC `menu-action:'open-settings'` → `openSettings()` (đã thêm gọi `bandComm.getConfig()` để refresh `#bpTunnelName` phòng khi mở Settings trước khi band-comm kịp phát status đầu tiên).
  - Wizard tự động hoá đúng quy trình `cloudflared tunnel login/create/route dns` (trước đây phải gõ tay terminal), và tự điền cả `tunnelName` lẫn `publicUrl` khi xong (không cần gõ tay `#bpPublicUrl` nữa cho Named Tunnel).
  - Bước 1 — đăng nhập: IPC `band-comm-tunnel-check-login` (đọc `~/.cloudflared/cert.pem`) quyết định hiện bước 1 hay nhảy thẳng bước 2. `band-comm-tunnel-login` spawn `cloudflared tunnel login`, bắt URL đăng nhập từ stdout/stderr (`https://dash.cloudflare.com/argotunnel...`) để `shell.openExternal` + phát `band-comm-tunnel-login-url` cho renderer hiện fallback link, chờ tới khi `cert.pem` xuất hiện (timeout 5 phút).
  - Bước 2 — tạo + kết nối: IPC `band-comm-tunnel-create({name, domain})` chạy `tunnel create` → `tunnel route dns -f` → ghi `~/.cloudflared/config.yml` (ingress trỏ `http://127.0.0.1:<port>`) → lưu `tunnelName`+`publicUrl` vào `band-comm.json` → `syncBandTunnel()`.
  - ⚠️ **Cùng loại bug với Quick Tunnel**: `cloudflared tunnel route dns <name> <domain>` KHÔNG DÙNG tên tunnel truyền trên CLI nếu có sẵn `~/.cloudflared/config.yml` — nó âm thầm trỏ domain mới sang tunnel ID nằm trong `tunnel:` của config.yml CŨ (tái hiện + verify thật: domain test bị trỏ nhầm sang `blessing-band` dù truyền tên khác hẳn). Fix: mọi lệnh `create`/`route dns` trong wizard đều bắt buộc `--config <file rỗng riêng, ghi vào userData mỗi lần>` để cô lập khỏi config.yml cũ, cộng `-f`/`--overwrite-dns` để ghi đè record cũ nếu wizard chạy lại.
  - KHÔNG tự động hoá: đổi Nameserver domain ở nơi mua domain (luôn thủ công, UI wizard chỉ nhắc).
  - Verify thật đầy đủ: toàn bộ chuỗi create → route dns (đúng tunnel, không bị đè) → ghi config.yml → chạy tunnel → domain trả `200` qua origin thật — PASS.
- **Icon "🆘 Hỗ trợ kỹ thuật"** ở góc phải header popup Kết nối (`#bpSupportBtn`, nền xanh dương) — mở danh sách 3 kênh liên hệ (Email/Zalo/Facebook của tác giả), mỗi nút gọi `window.electronAPI.openExternal(url)` → IPC `open-external` (`main.js`) → `shell.openExternal` (allowlist scheme `https:`/`mailto:`, chặn scheme khác). Chủ động, không tự động hoá gì — chỉ hỗ trợ khi người dùng bấm liên hệ.
- Đã verify thật (không chỉ đọc log): chạy server local thật ở cổng 7071 + tunnel thật → `GET https://blessing.worship-official.link/` trả `200` và đúng nội dung trang mobile. Cơ chế spawn/kill (`syncBandTunnel`/`stopBandTunnel`) đã test cô lập bằng tunnel thật: rỗng không spawn, tên sai không crash app, tên đúng ra PID thật, gọi lại không tạo trùng, dừng sạch không để tiến trình mồ côi.
