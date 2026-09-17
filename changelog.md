# Changelog - BlessingChurch Presentation App

Tất cả các thay đổi và cập nhật quan trọng của dự án được ghi lại tại đây.

## [Unreleased] - Kênh Band LAN (P1 + P2 + P2.5 + P4)

### refactor(band): bỏ hẳn phân biệt vai trò band/leader (2026-09-17)
- Rà lại lúc duyệt form tạo tài khoản: `role` (band/leader) chỉ được lưu/
  truyền/hiển thị từ lúc P1 tới giờ — không route hay UI nào từng rẽ nhánh
  theo giá trị này để cấp quyền hay đổi hành vi (grep xác nhận trên
  `server.js`, `accounts.js`, `store.js`, `protocol.js`, `comm/mobile/app.js`,
  `index.html`, cả 2 Worker). `ROLES` export ở `protocol.js` không ai import.
  Chỗ duy nhất có rẽ nhánh theo role là `role === 'operator'` (lọc echo tin +
  nháy taskbar) — khác hẳn phạm vi band/leader, thay bằng check
  `clientId === 'operator'` (tương đương, đã sẵn có).
- Xoá hẳn field `role` khỏi toàn hệ thống: token phiên 6 phần → **5 phần**
  (bỏ segment role); mọi client record/presence/envelope (`alert`, `text`,
  setlist `from`); schema account (`accounts.js`); `store.saveProfile()`;
  UI chọn "Bạn là" ở **cả 2** màn join còn dùng (mật khẩu phòng cũ + Cognito);
  dropdown Vai trò trong form tạo tài khoản operator.
- Verify bằng node script gọi server thật (không đoán): 15/15 case PASS —
  token đúng 5 phần, không response/envelope nào còn field `role`, gallery
  `ownerId` vẫn hoạt động đúng qua `profileId` (không bị ảnh hưởng). Đã
  restart app + curl trực tiếp xác nhận behavior thật trên máy đang chạy.
- Cập nhật `docs/data-contracts.md`, `docs/architecture.md` (2 chỗ còn nhắc
  `role`/`uploaderPin` cũ đã lỗi thời), `band-comm-plan.md` §1 + §12.

### fix(band): mã PIN phòng (4 số) đổi thành mật khẩu phòng chữ+số (2026-09-17)
- PIN 4-8 số chỉ tối đa 10.000 khả năng — không đủ chống brute-force nếu
  không có khoá backoff gánh gần hết việc chặn (lý do y hệt Zoom đổi từ PIN
  sang passcode chữ+số cho meeting). Đổi `room.pin` → `room.password`, charset
  chữ hoa/thường + số (bỏ ký tự dễ nhầm `0/O/1/l/I`), mặc định sinh 6 ký tự
  (~57^6 khả năng), operator vẫn chỉnh tay được 4-12 ký tự.
- Đổi tên nhất quán xuyên suốt: field `room.pin/pinSetAt/pinRequiredWithAccounts`
  → `room.password/passwordSetAt/passwordRequiredWithAccounts`; API field
  `pin` → `password` (`/api/join`, `/api/join-room`); response
  `needsRoomPin` → `needsRoomPassword`; UI "Mã PIN" → "Mật khẩu phòng"
  (sidebar, Settings, comm/mobile — cả label lẫn id phần tử liên quan như
  `#bpPin`→`#bpPassword`, `#roomPin`→`#roomPassword2`).
- **Tương thích ngược không cần migrate tay**: `store.js` vẫn đọc được
  `room.pin`/`pinSetAt`/`pinRequiredWithAccounts` của bản cài cũ (chữ số vốn
  là tập con hợp lệ của chữ+số), tự ghi lại dưới tên field mới ngay lần load
  đầu tiên sau khi cập nhật.
- Test thật: 20 case PASS (config mới, config cũ tự nâng cấp + xoá key cũ
  trên đĩa, validation, luồng `/api/join`/`/api/login`/`/api/join-room` đầy
  đủ với mật khẩu chữ+số) + verify UI thật qua Electron/CDP (sidebar hiển
  thị/tạo lại mật khẩu mới, toggle Settings đổi tên đúng lưu được).

### feat(band): đăng nhập tài khoản trung tâm qua Cloudflare + AWS Cognito (2026-09-17)
- Vấn đề với mô hình cục bộ vừa xong (mục dưới): band member chơi ở nhiều nhà
  thờ khác nhau phải có tài khoản/mật khẩu riêng cho từng máy — không có 1
  danh tính dùng chung. Cân nhắc lại lý do trước đó từ chối Cognito (đòi
  Internet lúc đang họp) — giải quyết được bằng **verify chữ ký JWT OFFLINE
  bằng JWKS cache**: chỉ bước ĐĂNG NHẬP (có mạng ngoài venue, kiểu Zoom) cần
  Internet, lúc đang họp trong LAN không phát sinh request mạng nào để verify.
- Kiến trúc **hybrid, không dồn hết về AWS**: Cloudflare (đã dùng sẵn cho
  `cloud/worker/`) làm hạ tầng chính — Worker mới `cloud/identity/` (deploy
  `identity.worship-official.link`) gọi Cognito CHỈ để xác thực (SigV4 qua
  `aws4fetch`, không Lambda/API Gateway/S3), gửi mail mời qua Resend (không
  SES — gọi `fetch()` thuần, không cần ký SigV4). Xem `cloud/identity-plan.md`
  cho toàn bộ lý do/lịch sử quyết định.
- **Resource thật đã tạo + verify** (không phải mock): Cognito User Pool
  `worship-band-users` + App Client + IAM user phạm vi hẹp (5 action, đúng 1
  User Pool) trên AWS; KV namespace `IDENTITY_RL` + Worker `band-identity`
  trên Cloudflare. AWS access key nằm trong Worker secret
  (`wrangler secret put`), không có trong bất kỳ file repo nào.
- **`cloud/identity/src/worker.js`**: `POST /request-access` (tạo user +
  mật khẩu tạm qua `AdminCreateUser`, gửi mail Resend — luôn trả `{ok:true}`
  dù email đã tồn tại, tránh lộ roster), `POST /login` (2 dạng body: mật khẩu
  thường, hoặc `{session, newPassword}` trả lời challenge
  `NEW_PASSWORD_REQUIRED`), `POST /refresh`. Verify thật bằng Cognito thật:
  tạo → đổi mật khẩu tạm → nhận JWT → refresh, cả 3 case lỗi (sai mật
  khẩu/email lạ/email sai định dạng) đều trả lỗi chung chung như nhau.
- **`src/band-comm/cognito-jwks.js`** (mới, dependency `jose` — dependency
  đầu tiên của `src/band-comm/`): cache JWKS ra `userData/cognito-jwks.json`,
  tự refresh 24h/lần khi có mạng, verify offline bằng cache cũ khi mất mạng.
- **`server.js`**: `store.js` thêm `authMode: 'local'|'cognito'` (mặc định
  `'local'`, không ảnh hưởng bản cài nào chưa đổi). `POST /api/login` nhánh
  `cognito` nhận `{idToken, name, role}` thay vì username/password — verify
  bằng JWKS cache, `profileId = sub` claim (tái dùng nguyên cơ chế `profileId`
  đã có, không sửa gallery/bộ nút cảnh báo). `POST /api/join-room` giữ
  nguyên 100% — fix 1 bug lúc code: nhánh cognito không được gọi
  `accountsStore.findById()` ở bước 2 vì `sub` không tồn tại trong
  `accounts.js`, phải dùng thẳng name/role đã lưu ở `pendingLogins` từ bước 1.
  Test thật bằng JWT thật lấy từ Worker: 16 case PASS gồm cả "ngắt hẳn
  `global.fetch` giữa chừng vẫn login được" (chứng minh không gọi mạng khi đã
  cache) + hồi quy 5 case mô hình cục bộ vẫn đúng.
- **`comm/mobile/`**: `GET /api/mode` thêm `authMode`; màn join thêm
  `#joinCognitoFields` (tên/vai trò tự khai + email/mật khẩu, gọi thẳng
  Worker — KHÔNG qua LAN server) + bước đổi mật khẩu tạm + nút "Yêu cầu qua
  email". Settings → Media & Band thêm chọn "Kiểu tài khoản" — verify thật
  qua Electron + CDP: toggle đúng UI, `saveConfig` round-trip đúng qua IPC.
- **Còn thiếu, chưa xong**: domain Resend chưa verify (dùng giả định
  `mail.worship-official.link`, cần xác nhận lại) — tới lúc đó
  `/request-access` tạo được tài khoản Cognito nhưng không gửi được mật khẩu
  tạm qua mail. Chưa có refresh-token tự động ở mobile (JWT hết hạn phải
  đăng nhập lại, cần mạng lúc đó — chấp nhận được cho v1).

### feat(band): đăng nhập tài khoản — thay/kèm PIN phòng dùng chung (2026-09-17)
- Yêu cầu: chỉ dùng PIN phòng thì không đủ an toàn (ai biết PIN cũng tự gõ
  tên/vai trò bất kỳ) — muốn operator (laptop) là nơi DUY NHẤT tạo tài khoản
  cho từng thành viên, web chỉ đăng nhập. Đã cân nhắc AWS Cognito, quyết định
  không dùng — cần Internet cho cả bước đăng nhập lẫn "operator tạo tài
  khoản qua Admin API", ngược nguyên tắc LAN-first của Kênh Band (chi tiết:
  `band-comm-plan.md` §11).
- **Mới `src/band-comm/accounts.js`**: `userData/band-comm-accounts.json`
  tách riêng khỏi `band-comm.json` (giống lý do tách gallery). Password hash
  bằng `crypto.scryptSync` (0 dependency) — chỉ chống lộ file trần, KHÔNG
  chống brute-force offline nếu file lộ + password yếu (ghi rõ trong docs,
  không để ai hiểu nhầm hash là đủ). Mật khẩu do operator tự đặt lúc tạo,
  band member không tự đổi được.
- **`server.js`**: `POST /api/login` (username+password) + `POST
  /api/join-room` (bước 2 tuỳ chọn — mã PIN phòng, dùng lại nguyên field
  `room.pin` sẵn có thay vì tạo "mật khẩu phòng" mới) + `GET /api/mode`
  (public, không lộ roster) cho mobile biết vẽ màn nào. **Không có**
  `GET/POST /api/accounts` liệt kê danh sách tài khoản — tránh lộ roster qua
  Cloudflare Tunnel công khai mặc định bật.
  - `profileId` trong token = `account.id` khi đăng nhập qua tài khoản
    (không phải field mới) — mọi cơ chế theo-`profileId` đã có (bộ nút cảnh
    báo, `ownerId` gallery vừa refactor sáng cùng ngày) tự động hoạt động
    đúng khi 1 người dùng nhiều máy, không cần sửa gallery lần nữa.
  - `tempToken` (bước 2) là nonce ngẫu nhiên lưu `Map` RAM riêng
    (`pendingLogins`), KHÔNG đi qua `makeToken()`/`verifyToken()` — fail-
    closed theo cấu trúc (route khác lỡ dùng nhầm tự 401) thay vì dựa vào
    quy ước.
  - Rate-limit brute-force (tái dùng `joinAttempts` đã có) mở rộng khoá theo
    `accountId` cho `/api/login`, bên cạnh khoá theo IP đã có.
  - `/api/join` (luồng PIN phòng cũ, vẫn chạy song song — feature-flag
    `accountsEnabled` mặc định tắt) chặn `profileId` tự khai trùng
    `accounts[].id` thật, tránh 1 client chiếm quyền của 1 tài khoản mà
    không cần đăng nhập.
  - Đổi mật khẩu/khoá/xoá account, hoặc bật/tắt `accountsEnabled`/
    `room.pinRequiredWithAccounts` → `commServer.rotateSecret()` — mọi
    token cũ verify-fail ngay, không cần cơ chế "kick" riêng.
- **`index.html`**: tab "Tài khoản" mới trong Settings → Media & Band —
  danh sách + thêm/đổi mật khẩu/khoá/xoá, cộng 2 toggle (`accountsEnabled`,
  `room.pinRequiredWithAccounts`).
- **`comm/mobile/`**: màn join giờ có 2 chế độ, tự chọn qua `GET api/mode`
  lúc tải trang — PIN phòng + tên tự gõ (mặc định) hoặc đăng nhập tài
  khoản (username+password, thêm màn PIN phòng nếu operator bật).
- Verify: 3 bộ test độc lập, 48/48 PASS — backend (Node, không cần
  Electron): token expiry/brute-force/tempToken fail-closed/profileId
  collision/rotateSecret đều test bằng request HTTP thật vào server thật;
  operator UI (Electron, DOM + IPC thật): tạo/khoá tài khoản qua đúng nút
  bấm thật; mobile UI (Electron load qua HTTP thật vào server thật): cả 3
  luồng (PIN phòng cũ, đăng nhập 1 bước, đăng nhập 2 bước) qua đúng
  input/click thật, không giả lập.

### refactor(band): bỏ "1 người phụ trách ảnh" — ai đã vào phòng cũng thêm được, chỉ tự xoá ảnh mình đăng (2026-09-17)
- Yêu cầu: cơ chế cũ (giành quyền qua `room.uploaderPin`, chỉ 1 người online
  giữ quyền tại 1 thời điểm) khiến cả nhóm phụ thuộc vào đúng 1 người cầm
  điện thoại — người đó thoát app/mất mạng/zombie connection (xem entry
  ngay dưới) là cả nhóm không ai thêm được ảnh hợp âm nữa.
- Đổi mô hình: **mọi client đã join phòng hợp lệ (có token) đều thêm ảnh
  được**. Xoá thì **chỉ được xoá ảnh chính mình đã đăng**, tránh 1 người xoá
  nhầm/cố ý ảnh người khác — so theo `profileId` (định danh ổn định điện
  thoại tự sinh 1 lần, đã có sẵn cho tính năng phục hồi bộ nút cảnh báo),
  không dùng `clientId` (đổi mỗi lần join lại).
- Xoá hẳn (không giữ code chết): route `POST /api/gallery/claim`, field
  `room.uploaderPin`, biến `isUploader`/`hasUploaderPin` phía server + mobile
  + operator sidebar, ô "Mã phụ trách" trong sidebar.
- Đổi token phiên từ 5 phần sang 6 phần để mang thêm `profileId`
  (`clientId.issued.<b64url(name)>.role.<b64url(profileId)>.<hmac>`) —
  `profileId` giờ phải sống sót qua *mọi* lần rebuild client record từ token
  (WS reconnect, request HTTP sau khi RAM server mất client record), không
  chỉ lúc `/api/join` như trước.
- Gallery manifest (`{images:[{id,name}], ...}`) thêm field `ownerId` mỗi
  ảnh; ảnh operator thêm qua sidebar (IPC) có `ownerId: null` — operator vẫn
  luôn xoá được mọi ảnh vì IPC gọi thẳng hàm core, không qua check quyền.
- Mobile: nút "🎼 Hợp âm" và "+ Thêm ảnh" giờ **luôn hiện** cho mọi client
  (bỏ điều kiện "đã bật quyền phụ trách"); nút "Xoá" trên từng ảnh chỉ hiện
  khi `ảnh.ownerId === profileId` của chính điện thoại đó.
- Verify bằng test thật (`node` script gọi server thật qua HTTP/WS, không
  đoán): (a) 2 client khác `profileId` cùng join, cả 2 đều `POST
  /api/gallery/add` thành công; (b) client B thử `POST /api/gallery/remove`
  ảnh của client A → `403`; client A xoá ảnh của chính mình → `200`; (c)
  disconnect + reconnect WS bằng token cũ, `profileId` vẫn giữ nguyên trong
  client record (verify qua vẫn xoá được ảnh mình đã đăng trước đó).

### fix(band): CSP chặn cả upload ảnh lẫn xem qua cloud + fallback setlist cloud (2026-09-17)
- Báo lỗi kèm ảnh chụp DevTools Console: `Content-Security-Policy` của
  `comm/mobile/index.html` chặn cả `blob:` (dùng để nén ảnh qua canvas trước
  khi upload — `downscaleChordImg()`) lẫn domain `api.worship-official.link`
  (ảnh xem qua cloud mới thêm hôm nay).
- Phát hiện thêm khi rà soát toàn bộ điểm kết nối ra ngoài: `connect-src`
  cũng thiếu domain đó — `sendSetlistToCloud()` (M2, fallback gửi setlist
  qua cloud khi LAN lỗi) **nhiều khả năng chưa từng hoạt động trên trình
  duyệt thật** từ lúc thêm, vì mọi test trước giờ chỉ chạy qua Node script
  (không bị CSP áp) chứ chưa qua trình duyệt thật có bật CSP.
- Fix: `img-src` thêm `blob:` + domain Worker; `connect-src` thêm domain
  Worker. Đã rà lại toàn bộ `fetch()`/`<img src>`/`new Image()`/WebSocket
  trong `comm/mobile/app.js` để chắc chắn không còn điểm nào khác bị chặn.
- **Giới hạn công cụ**: không có trình duyệt thật để tự bấm-thử ở môi trường
  này (không có browser automation) — đã sửa đúng theo phân tích CSP, nhưng
  cần bạn tự xác nhận lại trên điện thoại + xem DevTools Console không còn
  dòng đỏ nào về CSP nữa.

### fix(band): zombie WebSocket connection khiến "người phụ trách ảnh" bị kẹt vĩnh viễn (2026-09-17)
- Báo lỗi: sau khi fix upload không báo lỗi, debug trực tiếp trên server thật
  lộ ra nguyên nhân gốc — `POST /api/gallery/claim` trả 409 "Đã có người phụ
  trách ảnh (...) đang online" dù người đó đã rời từ lâu, kéo theo mọi lần
  upload đều 403.
- Nguyên nhân thật: `src/band-comm/ws.js`'s `ping()` trước đây chỉ GỬI frame
  PING, không hề theo dõi PONG có phản hồi hay không. `isAlive()` chỉ dựa vào
  sự kiện TCP `'close'/'error'/'end'` — nếu điện thoại rời mạng đột ngột
  (khoá màn hình lâu, mất sóng, đổi WiFi/4G giữa chừng, app bị kill) mà
  không có gói FIN/RST nào được gửi, OS có thể giữ socket ở trạng thái
  "half-open" rất lâu KHÔNG BAO GIỜ phát sự kiện lỗi — server tưởng client đó
  còn sống mãi mãi. Ảnh hưởng không chỉ upload ảnh mà cả đếm presence
  ("Đang nối: N người" có thể sai).
- Fix: `ping()` giờ tự theo dõi — nếu lần ping TRƯỚC chưa được trả lời (bất
  kỳ dữ liệu nào từ client, không riêng PONG, đều tính là "còn sống") thì
  coi kết nối đã chết, tự đóng ngay thay vì tiếp tục ping vô thời hạn vào
  một socket không ai lắng nghe. Trình duyệt tự trả PONG theo chuẩn WebSocket
  (không cần sửa gì ở `comm/mobile/app.js`).
- Verify thật: mô phỏng client TCP thật bắt tay WebSocket thật rồi cố ý im
  lặng không trả PONG — xác nhận bị phát hiện + đóng đúng sau 2 chu kỳ ping
  (~30s); ca đối chứng (client trả PONG bình thường như trình duyệt thật)
  xác nhận không bị ảnh hưởng gì — PASS cả 2.

### feat(band): ảnh hợp âm mirror lên Cloudflare R2, tự xoá sau 4 ngày (2026-09-17)
- Lý do: band cần xem lại ảnh hợp âm ổn định (tối T6 tập, Chủ nhật mới diễn)
  mà không phụ thuộc Cloudflare Tunnel còn sống lúc đang xem; không cần lưu
  dài hạn — 4 ngày là đủ trải hết chu kỳ tập→diễn.
- `cloud/worker/`: tạo R2 bucket `band-comm-gallery` (bind `GALLERY`), lifecycle
  rule `expire-4d` tự xoá object sau 4 ngày (đặt trên bucket, không cần code
  dọn tay). 3 route mới trên Worker: `POST /gallery` (mirror 1 ảnh), `GET
  /gallery/image/<roomId>/<id>` (phục vụ bytes trực tiếp cho điện thoại),
  `POST /gallery/remove`. Dùng chung `cloudRoomId`/rate-limit/cap kích thước
  8MB với các route đã có.
- `src/band-comm/server.js`: `galleryAdd()`/`galleryRemove()` gọi mirror
  fire-and-forget ngay sau khi thao tác local thành công — không chặn
  response, ảnh vẫn dùng được qua LAN nếu mirror lỗi. **Danh sách ảnh nào tồn
  tại vẫn do local quyết định như cũ** (WS `gallery` envelope), Worker chỉ
  lưu/phục vụ bytes chứ không phải nguồn sự thật.
- `comm/mobile/app.js` (`renderChords()`): `<img>` ưu tiên URL cloud, `onerror`
  tự rớt về URL local nếu cloud lỗi/chưa kịp mirror — không có điểm hỏng đơn.
- Verify thật đầy đủ: (1) upload/xem/xoá trực tiếp qua Worker+R2 — PASS; (2)
  toàn chuỗi thật local→mirror→xem qua cloud→xoá→cloud cũng mất theo — PASS.

### fix(band): upload ảnh hợp âm thất bại âm thầm, không báo lỗi (2026-09-17)
- Báo lỗi: "đã upload nhưng ảnh không hiển thị" — server hoàn toàn bình
  thường (verify thật: file ghi đúng đĩa, manifest đúng), lỗi chỉ ở client.
- Nguyên nhân: `comm/mobile/app.js` gọi `fetch('api/gallery/add').then(r =>
  r.json()).then(renderChords)` — `fetch()` KHÔNG coi status lỗi (403 "không
  phải người phụ trách", 413 quá dung lượng...) là promise reject, nên khi
  server từ chối, code cũ vẫn gọi `renderChords({error:...})` — bị hiểu nhầm
  thành gallery rỗng, không có gì báo cho người dùng biết là đã thất bại.
- Fix: kiểm tra `r.ok` trước khi render, toast đúng lỗi từ server khi thất bại.
- Verify thật bằng server thật: upload khi đang là uploader -> 200 + file
  thật trên đĩa; upload khi KHÔNG phải uploader -> 403 + body `{error}` —
  đúng chính xác ca mà code cũ nuốt mất.

### feat(security): hardening thêm cho API requests (2026-09-17)
- **Token phiên tự hết hạn sau 12h** (`TOKEN_MAX_AGE_MS`, `src/band-comm/server.js`
  `verifyToken()`) — trước đây token sống vô thời hạn tới khi ai đó restart
  server (restart thì MỌI phone mất, không chỉ 1 token bị lộ). Timestamp
  `issued` vốn đã nằm trong token, chỉ chưa bị kiểm tra. Phone bị `401` sau
  12h; `comm/mobile/app.js`'s `scheduleReconnect()` đã tự xử lý đúng case này
  từ trước (xoá token cũ + bung màn hình nhập PIN), không cần sửa gì thêm
  phía mobile. Verify bằng test giả lập đồng hồ (mint token với `issued` giả
  13h trước, xác nhận bị từ chối; 11h trước vẫn được chấp nhận).
- **Rate-limit Cloudflare Worker theo `roomId`** (`cloud/worker/src/worker.js`):
  tối đa 30 lượt ghi (`POST /setlist`, `POST /setlist/ack`)/5 phút/phòng, đếm
  qua KV (`rl:<roomId>:<bucket>`). Worker này dùng chung cho mọi bản cài app
  (không auth thật, chỉ roomId làm namespace) nên trước đây 1 roomId có thể
  gọi liên tục không giới hạn, đốt quota request/KV chung của mọi nhà thờ
  khác. Verify bằng test đếm giả lập: 30 lượt đầu qua, lượt 31+ bị chặn,
  roomId khác không bị ảnh hưởng.
- **Nhắc đổi PIN định kỳ**: `store.js` thêm `room.pinSetAt` (stamp lại mỗi khi
  PIN thật sự đổi giá trị, không đổi khi save các field khác), sidebar hiện
  dòng nhắc màu vàng cạnh Mã PIN sau 7 ngày dùng cùng 1 mã.

### fix(security): stored XSS qua tiêu đề bài trong setlist Kênh Band (2026-09-16)
- `/api/setlist` chỉ `String()` + cắt 200 ký tự cho `item.title`, không lọc
  HTML. Khi `item.id` không khớp bài trong thư viện local,
  `loadSetlistIntoSchedule()` (`index.html`) dùng thẳng `title` chưa escape
  để tạo item Schedule mới → `renderSchedule()` ghi vào `div.innerHTML`
  không qua `escapeHtml()`. Điện thoại đã join (biết PIN, hoặc qua Quick
  Tunnel công khai) có thể chèn HTML/JS chạy trong renderer chính của
  operator — có quyền gọi `window.electronAPI` đầy đủ (đọc/ghi file, xoá bài
  hát, `openExternal`...).
- Fix 2 lớp: `escapeHtml(item.title)` ở điểm render (`index.html:6069`) + lọc
  `<`/`>` phía server trong `/api/setlist` (defense-in-depth). Verify bằng
  test gửi payload `<img onerror>` thật, xác nhận bị strip trước khi tới
  renderer.
- Phát hiện qua `/security-review` — 5 agent review song song + chấm điểm
  tin cậy độc lập cho từng phát hiện, chỉ giữ lại phát hiện ≥8/10; quét
  hardcoded secrets riêng trên toàn bộ lịch sử git — sạch, không có gì cần fix.

### fix(band): 4 vấn đề từ code review PR #5 (2026-09-16)
- **`readJson()` bị treo vĩnh viễn với body quá 12MB** (`src/band-comm/server.js`):
  `req.destroy()` không tham số chỉ phát `'close'`, không phát `'end'`/`'error'`
  — promise cũ không bao giờ resolve, treo request mãi mãi trên `/api/join`
  (endpoint duy nhất không cần xác thực). Fix: thêm listener `'close'` +
  resolve ngay khi vượt giới hạn, có guard chống resolve 2 lần. Verify bằng
  test đơn vị mô phỏng đúng hành vi `destroy()` thật của Node.
- **`spawnSync` làm đứng hình toàn bộ app** (`main.js`, 2 IPC handler
  `band-comm-open-firewall` + `band-comm-tunnel-create`): `spawnSync` chặn cả
  main process Electron (mọi cửa sổ, mọi IPC khác) trong lúc chờ UAC prompt
  (tới 120s) hoặc gọi API Cloudflare. Thêm helper `spawnAsync()` (dựa trên
  `spawn` bất đồng bộ, giữ nguyên shape `{status,stdout,stderr}`) thay thế cả 2
  chỗ.
- **`profileId` không lọc → có thể ghi `__proto__`** (`src/band-comm/store.js`,
  `saveProfile()`): `cur.profiles[profileId] = entry` với `profileId` từ
  client, gửi `"__proto__"` sẽ đổi prototype của object `profiles`. Thêm
  `isSafeProfileId()` chặn `__proto__`/`constructor`/`prototype`, áp dụng cả
  lúc ghi (`store.saveProfile`) lẫn lúc đọc (`/api/join`'s restore-by-id).
- **`datadir.json` ghi bằng `fs.writeFileSync` thô** (`main.js`, tính năng
  chọn nơi lưu dữ liệu): đổi cả 4 chỗ sang `safeWriteSync` (tmp+rename) —
  nhất quán với mọi file dữ liệu khác trong app, tránh việc ghi dở bị ngắt
  quãng làm marker hỏng, âm thầm hỏi lại "chọn nơi lưu" dù user đã chọn rồi.
- **`hasUploaderPin`/`setlistEnabled` bị "đông cứng" từ lúc join** (bug mà 2
  fix trước đó chưa xử lý hết): nếu operator đặt mã phụ trách ảnh SAU KHI điện
  thoại đã join, điện thoại đó không có cách nào biết — reconnect chỉ gọi lại
  `/api/ping`, không gọi lại `/api/join`. Thêm envelope type mới `'room'`
  (`protocol.js`'s `MSG_TYPES`) + `announceRoomConfig()` trong `server.js`
  (mirror `announceGallery()`), gọi từ `main.js` mỗi khi `band-comm-save-config`
  hoặc wizard Named Tunnel đổi `uploaderPin`/`tunnelName`; `comm/mobile/app.js`
  nghe type `'room'` để cập nhật UI ngay không cần rejoin.
- Sửa 2 comment còn ghi "SSE" sót lại từ đợt chuyển sang WebSocket
  (`index.html`, `main.js`).
- Sửa mô tả sai/tự mâu thuẫn về hành vi Quick Tunnel mặc định trong
  `CLAUDE.md`, `docs/architecture.md`, `docs/data-contracts.md` — cả 3 trước
  đây nói tunnelName rỗng = "không tự chạy gì"/"không do main.js spawn", thực
  tế app luôn tự chạy Quick Tunnel mặc định (public URL ngẫu nhiên đổi mỗi
  lần chạy) từ commit `94276e3`.
- Verify: test Node độc lập (không cần Electron) cho cả 4 vấn đề kỹ thuật —
  11/11 PASS; test riêng phát hiện `announceRoomConfig()` ban đầu không gửi
  được vì `makeEnvelope()` tự hạ type lạ về `'system'` — phải thêm `'room'`
  vào `MSG_TYPES` mới hoạt động thật.

### fix(band): bug thứ 2 cùng họ — bấm "Hợp âm" xong section vẫn ẩn (2026-09-16)
- Fix trước chỉ sửa được nút TOGGLE hiện ra; bấm vào thì `renderChords()` tính
  `show = isUploader || (chOpen && ids.length)` — thư viện trống thì `ids.length`
  vẫn = 0 nên `show` vẫn sai dù đã bấm mở, section (chứa nút "Phụ trách ảnh")
  tiếp tục ẩn, `updateUploaderUI()` không bao giờ được gọi.
- Fix: `show = isUploader || (chOpen && (ids.length || hasUploaderPin))`.
- Xoá nút "Âm/rung" ở topbar mobile (`#gearBtn`) theo yêu cầu — sound/vibrate
  giữ nguyên mặc định bật (không còn cách tắt qua UI).
- Verify: bảng chân trị 6 kịch bản (trống+có mã, trống+không mã, đã có ảnh,
  đã có ảnh nhưng chưa bấm mở, đã là uploader×2 trạng thái gallery) — chạy
  đúng biểu thức thật trong code, PASS cả 6.

### fix(band): nút "Hợp âm" bị kẹt vòng lặp không lối ra khi thư viện còn trống (2026-09-16)
- Báo lỗi: join role "người hướng dẫn" chỉ thấy nút Setlist, không thấy chỗ
  upload ảnh hợp âm dù operator đã đặt mã phụ trách.
- Nguyên nhân: `updateChToggle()` (`comm/mobile/app.js`) chỉ hiện nút "🎼 Hợp
  âm" khi `chIds.length || isUploader` — lúc thư viện CÒN TRỐNG và CHƯA AI
  giành quyền phụ trách, cả 2 điều kiện đều sai nên nút không bao giờ hiện.
  Nút "Phụ trách ảnh" (để giành quyền lần đầu) lại nằm BÊN TRONG section chỉ
  mở được bằng cách bấm đúng nút đang bị ẩn đó — kẹt vòng lặp không lối ra,
  không phải do role.
- Fix: thêm `hasUploaderPin` vào điều kiện hiện nút — operator đã bật tính
  năng (đặt mã) thì nút phải hiện để có người bấm vào giành quyền lần đầu,
  không phụ thuộc thư viện đã có ảnh hay chưa.
- Verify thật: server thật với mã phụ trách đã đặt + gallery trống — xác
  nhận `/api/join` trả đúng `hasUploaderPin:true` cùng `gallery.images:[]`.

### fix(band): chống brute force mã PIN + UI đi kèm (2026-09-16)
- `src/band-comm/server.js`: `/api/join` giờ khoá tạm theo IP nguồn sau 5 lần
  sai PIN liên tiếp — 30s → 5 phút → 30 phút tuỳ số lần sai, trả `429` +
  `Retry-After`, không bỏ qua khoá kể cả gõ đúng PIN lúc đang bị khoá. Dọn
  entry cũ mỗi nhịp heartbeat. PIN mặc định chỉ 4 số nên trước đây dò được
  toàn bộ (10.000 khả năng) chỉ bằng vài giây gọi HTTP thô, không có gì chặn.
- `index.html` sidebar: nút 🔄 cạnh "Mã PIN" trong popup Kết nối — tạo PIN mới
  ngay lập tức (xác nhận trước), không cần khởi động lại server; hữu ích nếu
  nghi mã bị dò/lộ.
- `index.html` sidebar: khung "Hỗ trợ kỹ thuật" đổi từ list tĩnh sang
  speech-bubble nổi neo dưới nút 🆘 (tail nhọn chỉ lên nút), không còn chiếm
  chỗ cố định trong popup.

### feat(ui): viết lại Settings modal — sidebar danh mục + tìm kiếm (2026-09-16)
- Thay hẳn Settings cũ (list dài cuộn, style "classic Windows" lệch chuẩn UI
  của `index.html` — docs ghi rõ operator window phải "hiện đại, dark-ish,
  dense") bằng thiết kế mới: sidebar 6 danh mục (Chung / Hiển thị Live / Chữ
  & kiểu mặc định / Media & Band / Phím tắt / Dữ liệu), ô tìm kiếm lọc theo
  `data-search` trên từng dòng, nút chuyển theme (☀️/🌙) ngay trên header áp
  dụng ngay lập tức cho cả app (không cần bấm Lưu).
- Toàn bộ ~20 control giữ nguyên ID + hành vi thật (`openSettings()`/
  `saveSettings()` chỉ đổi 2 chỗ: GPU Acceleration + Tự co chữ chuyển từ
  `<select>` sang toggle switch thật — đọc `.checked` thay vì `.value`).
  Tab "Media & Band" giữ nguyên field Thư mục Media + toàn bộ wizard Named
  Tunnel đã chuyển vào đây trước đó. Tab "Dữ liệu" giữ nguyên đầy đủ công cụ
  Tìm & thay thế hàng loạt (không rút gọn như bản mockup ban đầu).
- Màu sắc đồng bộ với app thật: lấy `primary:#5048e5`/`background-light:
  #f6f6f8`/`background-dark:#121121` từ chính `tailwind.config` của
  `index.html` (không dùng màu vàng/cam của bản mockup gốc).
- CSS scope hoàn toàn dưới `#settings-modal` (biến `--stg-*`), không đụng
  `.win-modal-container` dùng chung với `song-editor-modal`/`shortcuts-modal`.

### fix: cho chọn nơi lưu dữ liệu, không cố định ổ C (2026-09-16)
- Lý do: `app.getPath('userData')` mặc định của Electron luôn ở `%APPDATA%`
  (ổ hệ thống, thường là ổ C) — ổ C đầy (dễ xảy ra khi thêm nhiều ảnh/video
  làm nền) thì app không ghi được gì nữa, coi như không dùng được.
- `main.js`: `applyStoredUserDataLocation()` (chạy trước `app.whenReady()`,
  cần thiết vì `bootstrapGpuAccelerationPreference()` cũng chạy trước ready
  và phải đọc đúng `settings.json` ở vị trí đã redirect) + `promptUserDataLocationIfNeeded()`
  (chạy trong `whenReady()`, an toàn hiện dialog). Lần đầu mở app (chưa có
  dữ liệu) → hỏi chọn thư mục khác hoặc dùng mặc định; lựa chọn ghi vào
  marker `datadir.json` tại vị trí mặc định (vài chục byte, luôn ghi được dù
  ổ C gần đầy). Bản cài cũ đã có `songs.json`/`settings.json` sẵn → im lặng
  coi như đã chọn mặc định, KHÔNG hỏi gì (tránh làm người dùng cũ hoảng vì
  tưởng mất dữ liệu). Thư mục cũ không truy cập được (ổ ngoài rút mất) →
  cảnh báo + tự dùng lại mặc định cho lần chạy đó.
- Verify thật: chạy trên máy đang có dữ liệu sẵn ở ổ C — xác nhận app khởi
  động thẳng, không hiện dialog, marker tự ghi đúng, band-comm/tunnel vẫn
  hoạt động bình thường sau đó.

### fix(ui): chuyển wizard Named Tunnel vào File → Cài đặt + fix Email xuống dòng (2026-09-16)
- Wizard "⚙️ Thiết lập domain riêng tự động" + `#bpTunnelName` chuyển từ popup
  Kết nối (sidebar Kênh Band) sang `#settings-modal` (File → Cài đặt) — tách
  "cấu hình 1 lần" khỏi "thông tin kết nối hằng ngày" (QR/PIN/Public URL vẫn
  ở popup Kết nối). Style đổi theo quy ước classic-Windows của Settings
  (`win-button`, `border-win-border`) thay vì `.bp-btn` của Kênh Band; dùng
  Tailwind `hidden` thay `.bp-hidden` vì phần tử giờ nằm ngoài `#bandPanel`.
  Logic JS không đổi chỗ, chỉ HTML — event listener vẫn hoạt động bình
  thường. `openSettings()` gọi thêm `bandComm.getConfig()` để refresh
  `#bpTunnelName` phòng khi mở Settings trước khi band-comm kịp phát status.
- Bong bóng "🆘 Hỗ trợ kỹ thuật": dòng Email bị xuống dòng do box cố định
  236px không đủ rộng — đổi `width: max-content` + `white-space: nowrap`
  cho từng dòng, box tự giãn theo nội dung dài nhất, mọi dòng luôn 1 hàng.

### feat(band): wizard tự động thiết lập Named Tunnel domain riêng (2026-09-15)
- Sidebar Kênh Band, popup Kết nối: nút "⚙️ Thiết lập domain riêng tự động"
  mở wizard 2 bước — thay thế hoàn toàn việc gõ tay `cloudflared tunnel
  login/create/route dns` trong terminal.
- `main.js`: 3 IPC handler mới — `band-comm-tunnel-check-login` (đọc
  cert.pem), `band-comm-tunnel-login` (spawn login, bắt URL, mở trình
  duyệt, chờ tới khi xong), `band-comm-tunnel-create({name,domain})`
  (create → route dns -f → ghi config.yml → lưu tunnelName+publicUrl →
  syncBandTunnel()). `preload.js` expose cả 3 + event `onTunnelLoginUrl`.
- **Bug tìm thấy + fix qua test thật (cùng họ với bug Quick Tunnel)**:
  `cloudflared tunnel route dns <name> <domain>` bỏ qua tên tunnel truyền
  trên CLI nếu máy đã có `~/.cloudflared/config.yml` từ trước — domain mới
  bị trỏ NHẦM sang tunnel cũ trong config đó. Test thật tái hiện đúng lỗi
  (domain test bị trỏ sang `blessing-band` dù tạo tunnel khác). Fix: mọi
  lệnh wizard dùng `--config <file rỗng riêng>` + `-f` để cô lập + cho phép
  ghi đè.
- Verify thật toàn chuỗi bằng tunnel/domain throwaway: create → route dns
  (đúng tunnel, không bị đè) → config.yml → chạy → domain trả 200 qua
  origin thật — PASS, đã dọn sạch tunnel/DNS test sau khi xong.
- Ghi chú: phát hiện có phiên Claude Code khác đang làm việc song song trên
  cùng repo (thêm nút "Tạo mã PIN mới" trong sidebar) — đã nhắn phối hợp để
  tránh đụng độ, không có xung đột code thực sự xảy ra.

### feat(band): bundle cloudflared + tự động Quick Tunnel mặc định (2026-09-15)
- Lý do: app sắp phân phối cho nhiều nhà thờ khác, không phải ai cũng có
  Cloudflare account/domain/cloudflared cài sẵn — cần zero-setup cho ai cũng
  ra internet được ngay khi mở app.
- `scripts/fetch-cloudflared.js` (mới) — tải binary `cloudflared` chính thức
  (GitHub Releases) vào `vendor/cloudflared/win/`, chạy tự động qua
  `npm run postinstall`; lỗi mạng chỉ cảnh báo, không phá install.
  `.gitignore` thêm `vendor/cloudflared/` (không commit binary).
- `package.json`: `build.win.extraResources` đóng gói binary vào bộ cài.
- `main.js`: `syncBandTunnel()` viết lại — 2 mode `named:<tên>` (như cũ) và
  `quick` (MẶC ĐỊNH khi `tunnelName` rỗng): tự spawn `cloudflared tunnel
  --url http://127.0.0.1:<port>`, tự bắt URL `*.trycloudflare.com` từ
  stdout/stderr, tự lưu vào `publicUrl` — không cần gõ tay. `resolveCloudflaredCmd()`
  ưu tiên binary đóng gói > bản dev > PATH hệ thống.
- **Bug tìm thấy + fix qua test thật**: Quick Tunnel bị `cloudflared` tự nạp
  nhầm `config.yml` mặc định của Named Tunnel (nếu máy có), áp catch-all
  `http_status:404` đè lên `--url` → mọi request qua Quick Tunnel trả 404 dù
  origin sống. Fix: truyền `--config` trỏ file rỗng riêng (`userData/cloudflared-quick.yml`).
- Verify thật đầy đủ: Quick Tunnel tự spawn + tự điền publicUrl + HTTP 200
  qua domain `*.trycloudflare.com` thật; sau đó test hồi quy Named Tunnel
  (`blessing-band`) vẫn hoạt động đúng sau khi refactor chung 1 hàm.

### feat(ui): icon Hỗ trợ kỹ thuật trong sidebar Kênh Band (2026-09-15)
- Popup Kết nối thêm nút "🆘 Hỗ trợ kỹ thuật" → hiện 3 kênh liên hệ (Email,
  Zalo, Facebook) — người dùng tự chọn, không tự động gửi gì cả.
- `main.js`: IPC `open-external` mở link qua `shell.openExternal` (allowlist
  `https:`/`mailto:`), thay vì điều hướng cả cửa sổ renderer.
- `preload.js`: expose `electronAPI.openExternal(url)`.

### fix(band): setlist chỉ bật khi có Named Tunnel (2026-09-15)
- Lý do: app sắp phân phối cho nhiều nhà thờ khác, đa số sẽ dùng Quick Tunnel
  (URL đổi mỗi lần chạy) hoặc chỉ LAN — không có link cố định để band soạn
  setlist từ xa, nên tính năng vô nghĩa/gây hiểu lầm nếu vẫn hiện ra.
- `src/band-comm/server.js`: `setlistEnabled() = !!store.load().tunnelName`,
  áp cho `GET /api/library`, `GET/POST /api/setlist` (404 khi tắt); `POST
  /api/join` trả thêm `setlistEnabled`.
- `comm/mobile/app.js` + `index.html`: nút "📋 Setlist" mặc định `hidden`,
  chỉ hiện khi `setlistEnabled` từ response join.
- Test thật bằng server thật cả 2 nhánh (tunnelName rỗng vs có giá trị) —
  PASS: rỗng → 404 + ẩn nút; có → 200 + hiện nút.

### cloud/worker hardening (2026-09-15)
- Worker `api.worship-official.link` dùng chung cho MỌI bản cài app (không
  auth thật, roomId làm namespace) — thêm cap cứng 40 setlist/phòng (dọn cũ
  nhất trước khi ghi thêm), cắt độ dài field `id` (trước đây không giới hạn),
  chặn sớm mảng `items` > 500 phần tử. Verify thật trên production: cap từ
  45 xuống 41 (soft cap, xê dịch do KV eventually-consistent), id 5000 ký tự
  bị cắt đúng còn 100.
- Domain `worship-official.link`: xác nhận đã bật auto-renew + transfer-lock
  sẵn (hết hạn 2027) — không cần làm thêm cho rủi ro hết hạn/bị cướp domain.

### fix(ui): header Kênh Band đồng bộ style + cảnh báo đỏ khi đóng khung (2026-09-15)
- `.bp-head` (header sidebar Kênh Band, gồm chấm trạng thái + "Kênh Band" + nút
  Kết nối/Bắt đầu-Dừng + ×) đổi sang cùng style với header Schedule/Preview/Live:
  nền `#1e293b`, chữ trắng, bo góc trên `7px`.
  Chấm xanh khi đang kết nối (`.bp-dot.on`) có hiệu ứng lan sóng (vòng tròn giãn
  ra + mờ dần, lặp lại) qua `::after` + `@keyframes bpDotWave`.
- Tab thu gọn (`#bandPanelTab`) khi có **cảnh báo band bấm nút** (khẩn) lúc
  khung đang đóng → chuyển đỏ + hiệu ứng pulse (`@keyframes bpTabPulse`), thay
  vì chỉ badge vàng như trước (dễ bị bỏ sót). Hoạt động thường (setlist…) vẫn
  chỉ hiện badge vàng, không đỏ hoá tràn lan. `bumpUnread(isAlert)` nhận thêm
  cờ để phân biệt 2 mức; xoá cả `has-unread` + `has-alert` khi mở panel.

### M2 — app tự chạy Named Tunnel cùng band-comm (2026-09-15)
- `band-comm.json`: thêm `tunnelName` (rỗng mặc định — không ảnh hưởng máy chưa
  cấu hình cloudflared).
- `main.js`: `syncBandTunnel()`/`stopBandTunnel()` — tự spawn `cloudflared tunnel
  run <tunnelName>` ngay sau khi band-comm server start, tự kill lúc dừng/app
  quit; đổi tên lúc đang chạy tự restart, xoá trắng tự dừng; lỗi (ENOENT, tunnel
  không tồn tại…) chỉ log vào feed sidebar, không chặn LAN.
- Sidebar Kênh Band: thêm ô "Tên Cloudflare Named Tunnel" cạnh Public URL.
- Test cô lập bằng tunnel thật (`blessing-band`): rỗng không spawn, tên sai
  không crash app, tên đúng ra PID thật, gọi lại không trùng, dừng sạch không
  mồ côi tiến trình — cả 5 kịch bản PASS.

### M2 — Named Tunnel: domain cố định thay Quick Tunnel (2026-09-15)
- Tạo Cloudflare Named Tunnel `blessing-band` (`cloudflared tunnel login` → `create` →
  `route dns`), trỏ `blessing.worship-official.link` cố định — không còn URL đổi mỗi
  lần chạy như Quick Tunnel. Config (`%USERPROFILE%\.cloudflared\config.yml`) ingress
  về `127.0.0.1:7071`, credentials không commit vào repo.
- `cloud/tunnel/start-tunnel.bat` — script chạy tunnel (`cloudflared tunnel run
  blessing-band`), thay cho lệnh Quick Tunnel gõ tay trước đây.
- Verify thật: chạy server band-comm thật + tunnel thật, `GET
  https://blessing.worship-official.link/` trả 200 đúng nội dung trang mobile.
- Việc còn lại: đặt Public URL trong sidebar Kênh Band = domain cố định này (1 lần).

### M2 — hộp thư setlist cloud khi laptop tắt hẳn (2026-09-15)
- Hạ tầng mới `cloud/worker/`: Cloudflare Worker + Workers KV (`band-comm-relay`),
  domain riêng `api.worship-official.link` (Route 53 trỏ NS sang Cloudflare, DNS/route
  thật nằm ở Cloudflare; deploy kiểu Custom Domain để tự tạo DNS record). Endpoints
  `POST/GET /setlist`, `POST/GET /setlist/ack`, `GET /health`. Verify thật qua
  `curl`/test script — POST/GET/ack đều PASS trên KV thật.
- `src/band-comm/store.js`: thêm `cloudRoomId` (UUID sinh 1 lần, ổn định qua restart
  và qua nâng cấp từ config cũ chưa có field này — đã test cả 2 kịch bản).
- `src/band-comm/server.js`: `ingestSetlist()` — điểm nhận chung cho setlist từ LAN
  lẫn cloud (idempotent theo `id`, không trùng dù về từ 2 đường). `pollCloud()` chạy
  lúc `start()` (vét hộp thư sau khi laptop mở lại) + định kỳ 60s trong lúc chạy, ack
  lại từng id đã nhận. `POST /api/join` trả thêm `cloudRoomId`.
- `comm/mobile/app.js`: `sendSetlist()` thử LAN trước; lỗi mạng (không phải lỗi
  validate) mới fallback gửi thẳng lên Worker bằng `state.cloudRoomId`. Toast báo rõ
  khi gửi qua đường cloud.
- Còn lại của M2: chuyển Cloudflare Tunnel từ Quick Tunnel sang Named Tunnel gắn
  `band.worship-official.link`.

### M1b — setlist LAN: UI soạn trên điện thoại (2026-09-09)
- `comm/mobile`: nút "📋 Setlist" ở topbar → section soạn: danh sách bài đã chọn
  (nút ↑ ↓ ×), ô tìm bài (khớp không dấu theo tiêu đề + lời), chạm để thêm/bỏ,
  ô tên + nút "Gửi". `GET /api/library` (cache `state.slLibCache` cho lần sau /
  lúc mạng chờn). Draft giữ trong `localStorage` (`state.slDraft`) — không mất khi
  đóng app. Gửi 200 → xoá draft + đóng section; lỗi → giữ draft, báo "máy chiếu
  chưa online" (retry queue = M2/M3).

### M1a — setlist LAN: server + operator nhận (2026-09-09)
- `src/band-comm/server.js`: `createCommServer` nhận thêm `getLibraryIndex` + `onSetlist`.
  - `GET /api/library` → chỉ mục thư viện bài hát `{id,title,lyrics}` (điện thoại chọn bài).
  - `POST /api/setlist {name, items}` → lưu RAM phiên (≤30, idempotent theo `id`), phát `onSetlist`; `items` lọc `type:'song'` ≤60; rỗng → 400. `GET /api/setlist` xem lại.
  - `stop()` xoá `setlists` + `receivedSetlistIds`.
- `main.js`: `getLibraryIndex` (đọc `songs.json` + `migrateItem`), `onSetlist` → `broadcastToRenderers('band-comm-setlist', sl)` + nháy taskbar.
- `preload.js`: `bandComm.onSetlist(cb)`.
- `index.html` sidebar: nhận `onSetlist` → thẻ "📋 Setlist" trong feed với [Xem] (bung danh sách bài) / [Nạp vào Schedule] (xác nhận → **luôn thay thế** `schedule`; bài khớp `id` lấy đủ, không khớp → item tạm).
- Còn M1b: UI soạn setlist trên điện thoại.

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
