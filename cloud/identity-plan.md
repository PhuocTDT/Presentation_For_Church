# Kế hoạch: Định danh tập trung — Cloudflare + Cognito (hybrid)

> Trạng thái: **ĐÃ TRIỂN KHAI XONG toàn bộ, không còn việc nào treo lại** (2026-09-17). Thay thế mô hình "operator tạo tài khoản cục bộ" ở `band-comm-plan.md` §11 bằng 1 danh tính dùng chung cho mọi phòng/nhà thờ — nhưng **song song, không ép buộc** (§5). **Lớp mật khẩu phòng (`room.password`/`passwordRequiredWithAccounts`, đổi tên từ `pin` — xem changelog "PIN->mật khẩu phòng") không đổi luồng gì cả** — chỉ đổi lớp "đăng nhập cá nhân là ai".
>
> Đã xong + verify thật (xem §6): User Pool + IAM (bước 1), domain Resend `mail.worship-official.link` đã verify + `RESEND_API_KEY` đã set (bước 2), Worker `band-identity` deploy tại `identity.worship-official.link` + 3 endpoint test bằng Cognito thật + gửi mail thật thành công (bước 3), `server.js` verify JWT offline bằng `jose`+JWKS cache — test cả đường online lẫn "ngắt fetch giữa chừng vẫn verify được" (bước 4), UI `comm/mobile/` + toggle Settings (bước 5).
>
> Lịch sử quyết định (để hiểu vì sao kiến trúc ra dạng này, không lặp lại chi tiết argument):
> 1. Đề xuất ban đầu: full AWS (Cognito + S3 + Lambda + SES).
> 2. Rà lại: Cloudflare đã đáp ứng 3/4 mảnh (Pages thay S3, Workers thay Lambda, D1 thay chỗ lưu data) — chỉ Cognito (identity) và SES (email) không có tương đương trực tiếp trên Cloudflare.
> 3. Email: chọn **Resend** (gọi qua Worker bằng `fetch()` đơn giản) thay SES — không cần ký SigV4, verify domain dễ hơn.
> 4. Identity: **KHÔNG tự viết hết** (rủi ro bảo mật cao hơn cho đúng phần nhạy cảm nhất — mật khẩu thật của người dùng) — **gọi Cognito API từ 1 Cloudflare Worker** (SigV4 qua `aws4fetch`). Cognito chỉ đóng vai "API xác thực" bị gọi tới — không cần Lambda/API Gateway/S3 của AWS nữa.

## Kiến trúc cuối

```
┌──────────────────────┐
│  Web "Kênh Band"      │  Cloudflare Pages
│  - Đăng ký (email)    │
│  - Đăng nhập          │
│  - Đổi mật khẩu lần   │
│    đầu (nếu cần)      │
│  - Vào phòng: host/IP │
│    LAN + mã phòng     │
│  - Giao diện band     │  ← thay/song song comm/mobile/
└──────────┬───────────┘
           │ fetch() JSON, same Cloudflare account
           ▼
┌──────────────────────────────────┐
│  Cloudflare Worker "band-identity" │
│  - POST /request-access            │──┐
│    (email) → AdminCreateUser        │  │ email mời qua Resend
│  - POST /login (email+password)     │  │ (fetch() đơn giản, domain
│    → InitiateAuth/RespondToChallenge│  │  worship-official.link đã
│  - Mọi lệnh Cognito ký bằng          │  │  verify DKIM/SPF/DMARC)
│    SigV4 (aws4fetch), IAM secret    │  ▼
│    lưu dạng Worker secret          ┌──────────┐
└──────────┬─────────────────────────┤ Resend    │
           │ SigV4-signed HTTPS       └──────────┘
           ▼
┌──────────────────────┐
│  AWS Cognito           │  region ap-southeast-2, account 717090908088
│  User Pool             │  (đã có sẵn Amplify/tms-logistics pool khác trong
│  "worship-band-users"  │   account này — resource mới đặt tên/tag riêng)
│  - Chỉ 1 vai trò: API  │  JWKS PUBLIC, không cần SigV4 để fetch
│    xác thực bị gọi tới │  ┌────────────────────────────────────┐
└──────────┬─────────────┘  │ .well-known/jwks.json (public,      │
           │ JWT (id token) │  không cần credentials để đọc)      │
           ▼                └──────────────────┬───────────────────┘
┌──────────────────────┐                        │ fetch 1 lần lúc có mạng,
│  Điện thoại band       │                        │ cache trong userData,
│  giữ JWT, mang vào     │                        │ tự refresh khi có mạng
│  venue (offline OK)    │                        ▼
└──────────┬─────────────┘              ┌───────────────────────┐
           │ JWT + mã phòng qua LAN      │ server.js (laptop LAN) │
           └─────────────────────────────▶ verify chữ ký JWT bằng │
                                          │ JWKS cache — KHÔNG gọi │
                                          │ Internet lúc đang họp  │
                                          └───────────────────────┘
```

**Không đổi:** toàn bộ phần thực thi realtime (WebSocket, alert, gallery, setlist, `POST /api/join-room` mã PIN phòng) — vẫn 100% LAN, không phụ thuộc bước nào ở trên.

## 1. AWS — chỉ 1 việc: Cognito User Pool + IAM user phạm vi hẹp

- **User Pool:** `worship-band-users`, region `ap-southeast-2`. Tag `Project=presentation-church` để tách biệt khỏi các User Pool khác đã có sẵn trong account (`amplifyAuthUserPool*`, `tms-logistics-users`).
- **Self sign-up: OFF.** Tạo user qua `AdminCreateUser` (gọi từ Worker) — tránh spam đăng ký công khai trên 1 danh mục dùng chung.
- **App Client:** 1 client "public" (không secret) — Worker dùng `USER_PASSWORD_AUTH`/`ADMIN_USER_PASSWORD_AUTH` flow, không cần Hosted UI của Cognito (web tự làm giao diện, gọi qua Worker).
- **IAM:** 1 user/role mới, **policy hẹp tới mức chỉ đúng các action cần** trên đúng 1 User Pool này:
  ```json
  {
    "Effect": "Allow",
    "Action": [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminInitiateAuth",
      "cognito-idp:AdminRespondToAuthChallenge",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminGetUser"
    ],
    "Resource": "arn:aws:cognito-idp:ap-southeast-2:717090908088:userpool/<poolId>"
  }
  ```
  Access Key/Secret của user này lưu làm Cloudflare Worker secret (`wrangler secret put`), **không commit vào repo**.
- **JWKS:** endpoint `https://cognito-idp.ap-southeast-2.amazonaws.com/<poolId>/.well-known/jwks.json` — public, không cần SigV4, `server.js`/`main.js` fetch trực tiếp (không qua Worker).

## 2. Cloudflare Worker mới — `cloud/identity/` (mirror cấu trúc `cloud/worker/` đã có)

- `POST /request-access` `{ email }` → `AdminCreateUser` (sinh mật khẩu tạm, cờ `NEW_PASSWORD_REQUIRED`) → gửi email qua Resend (không dùng email mặc định của Cognito).
- `POST /login` `{ email, password }` → `AdminInitiateAuth` → nếu challenge `NEW_PASSWORD_REQUIRED`, trả về cho web biết để hỏi mật khẩu mới → `AdminRespondToAuthChallenge`. Thành công → trả JWT (id token + refresh token) thẳng cho web/app.
- `POST /refresh` `{ refreshToken }` → làm mới JWT khi hết hạn (id token Cognito mặc định ~1h) mà không cần nhập lại mật khẩu.
- Dependency: `aws4fetch` (ký SigV4 cho Cognito), gọi Resend bằng `fetch()` thuần (không cần SDK).
- Rate-limit `/request-access` + `/login` theo IP (cùng kiểu `checkRateLimit` đã viết cho `cloud/worker/src/worker.js`, tái dùng pattern).

## 3. `comm/mobile/` hoặc web mới trên Cloudflare Pages

- Màn đăng ký/đăng nhập gọi Worker `band-identity` ở trên (không gọi Cognito trực tiếp từ trình duyệt — Worker là lớp trung gian duy nhất giữ AWS credentials).
- Sau khi có JWT: màn "Vào phòng" y hệt luồng đã có (`comm/mobile/index.html`'s `joinRoomPinFields`) — nhập host/IP LAN nhà thờ + mã phòng, gọi thẳng `server.js` của đúng laptop đó bằng JWT (cross-origin — `server.js` cần thêm CORS header cho domain Pages).
- Cân nhắc: **giữ `comm/mobile/` phục vụ bởi chính LAN server như hiện tại** (đơn giản, không cần domain HTTPS ổn định, không cần CORS) và **chỉ màn đăng nhập/đăng ký chuyển sang gọi Worker** — tránh phải dựng cả 1 web app Pages riêng ngay từ v1. Xem D20 bên dưới.

## 4. `server.js` — verify JWT offline (thay local `/api/login`)

- Thêm dependency `jose` (JWT verify + JWKS, thuần JS, không cần AWS SDK) vào `src/band-comm/` — **dependency mới đầu tiên** ở khu vực này (đã giữ 0 dependency từ đầu, cần bạn xác nhận chấp nhận thêm 1 gói nhỏ, đã kiểm nghiệm rộng rãi).
- `POST /api/login` đổi input: `{ idToken }` (JWT từ Cognito) thay vì `{ username, password }`. Verify chữ ký + `exp` bằng JWKS cache (`userData/cognito-jwks.json`, tự fetch lại khi có mạng, dùng lại khi offline).
- `profileId` = `sub` claim của JWT (id Cognito, ổn định vĩnh viễn cho 1 người) — **tái dùng nguyên cơ chế `profileId` đã build** (gallery `ownerId`, bộ nút cảnh báo) không cần sửa gì thêm, đúng bài học đã áp dụng ở đợt account cục bộ trước.
- `POST /api/join-room` (mã PIN phòng) **giữ nguyên 100%**.
- `GET /api/mode` thêm field `authMode: 'local' | 'cognito'`.

## 5. Song song với mô hình cục bộ, không ép buộc

`src/band-comm/accounts.js` (đã build) **giữ nguyên làm phương án dự phòng** — nhà thờ nào không muốn phụ thuộc tài khoản trung tâm thì dùng `authMode: 'local'` như hiện tại. `authMode: 'cognito'` là tuỳ chọn nâng cao, không mặc định bật.

## 6. Thứ tự triển khai

1. ✅ **Cognito User Pool + IAM user** — User Pool `worship-band-users` (`ap-southeast-2_OH1kbdXdE`), App Client `band-identity-worker` (`7revs0o9tj9eqhpqrd03i3daof`), IAM user `band-identity-worker` + policy hẹp 5 action. Verify thật: `AdminInitiateAuth` trả token thật, JWKS endpoint `HTTP 200`. User test đã xoá sạch sau verify.
2. ✅ **Domain email cho Resend** — domain `mail.worship-official.link` đã verify trên Resend (3 bản ghi qua Cloudflare DNS: 2 CNAME `send.mail`/`rsend.mail` + 1 TXT DKIM `resend._domainkey.mail`), `RESEND_API_KEY` đã `wrangler secret put` vào Worker. Verify thật: gọi `/request-access` bằng email thật, theo dõi `wrangler tail` lúc gọi — không có lỗi Resend, tài khoản Cognito tạo thành công (`admin-get-user` xác nhận).
3. ✅ **Worker `band-identity`** (`cloud/identity/src/worker.js`, deploy tại `identity.worship-official.link`) — `/request-access`, `/login` (cả 2 nhánh: mật khẩu thường + đổi mật khẩu tạm `NEW_PASSWORD_REQUIRED`), `/refresh`. Verify thật bằng Cognito thật: tạo user qua Worker (xác nhận bằng `admin-get-user`), toàn bộ luồng đổi mật khẩu tạm → nhận JWT, refresh token, và 3 trường hợp lỗi (sai mật khẩu/email không tồn tại/email sai định dạng) đều không lộ thông tin. `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` đã nằm trong Worker secrets (`wrangler secret put`), không có trong repo.
4. ✅ **`server.js`: verify JWT offline** — `POST /api/login` nhận `{ idToken, name }` khi `authMode='cognito'`, verify bằng `src/band-comm/cognito-jwks.js` (`jose`). `POST /api/join-room` giữ nguyên (đã fix 1 bug lúc code: nhánh cognito không được gọi `accountsStore.findById()` vì id đó là Cognito `sub`, không tồn tại trong `accounts.js`). Verify thật bằng JWT thật lấy từ Worker: 16 test case PASS bao gồm **tắt hẳn `global.fetch` giữa chừng vẫn login được** (chứng minh không phát sinh request mạng khi key đã cache) + hồi quy 5 test case mô hình local vẫn PASS. (Field `role` đã bỏ hẳn khỏi toàn hệ thống ở 1 refactor song song — không còn phân biệt band/leader.)
5. ✅ **Màn đăng nhập trong `comm/mobile/`** — thêm `#joinCognitoFields` (tên tự khai + email/mật khẩu, gọi thẳng Worker) + `#joinCognitoNewPasswordFields` (đổi mật khẩu tạm) + nút "Yêu cầu qua email" gọi `/request-access`. Settings → Media & Band thêm chọn "Kiểu tài khoản" (`local`/`cognito`) — verify thật qua CDP: toggle đúng UI + `saveConfig` round-trip đúng qua IPC.
6. (Sau, nếu cần) Web Pages riêng nếu quyết định tách hẳn khỏi LAN server phục vụ tĩnh.

**Đã biết nhưng chưa làm (không chặn dùng):** chưa có refresh-token tự động ở `comm/mobile/` (JWT Cognito hết hạn ~1h chỉ dùng để bootstrap token LAN 12h lúc đăng nhập — hết 12h phải đăng nhập lại, cần mạng lúc đó) — chấp nhận được cho v1, đúng tinh thần "chỉ bắt buộc có mạng lúc đăng nhập, không bắt buộc lúc đang họp".

## 7. Điểm cần bạn quyết trước khi bắt đầu — ĐÃ CHỐT

- **D18 — Thêm dependency `jose`?** → "ok". Đã thêm (`package.json` gốc, 0 dependency phụ, không liên quan tới 16 lỗ hổng có sẵn từ trước của `electron-builder`/devDependencies khác — đã kiểm tra bằng `npm audit`).
- **D19 — Domain Resend:** → "ok" — đã dùng `mail.worship-official.link` (`MAIL_FROM` trong `cloud/identity/wrangler.toml`), subdomain riêng tách uy tín gửi mail khỏi domain chính. Đã verify xong trên Resend + gửi mail thật thành công (bước 2, §6).
- **D20 — Pages riêng hay thêm vào `comm/mobile/`?** → "Thêm vào hiện có". Đã làm — không có site Cloudflare Pages riêng nào được tạo cho v1.
- **D21 — IAM Access Key/Secret:** → "cho phép bạn tạo". Đã tạo IAM user `band-identity-worker` + access key, lưu ngay vào Worker secret qua `wrangler secret put` (không có trong bất kỳ file repo nào), không đưa qua kênh nào khác.
- **D22 — Xác nhận triển khai thật:** → "Ok". Đã tạo resource thật: User Pool + App Client + IAM user/policy/key (AWS), KV namespace `IDENTITY_RL` + Worker `band-identity` (Cloudflare) — tất cả tồn tại vĩnh viễn tới khi xoá tay, đã verify hoạt động đúng bằng dữ liệu thật (user test tạo/xoá sạch sau mỗi lần verify).

## 8. Việc hoãn lại — DynamoDB "danh sách phòng" (chưa làm, ghi lại để khỏi quên)

Bối cảnh: bàn về mật khẩu phòng dạng chữ+số (đã làm, xem changelog) có dẫn tới câu hỏi cần 1 nơi lưu "danh sách phòng" trung tâm hay không. Đã chốt rõ **2 việc tách biệt, không đánh đổi lẫn nhau**:

- **Verify mật khẩu phòng lúc vào phòng: giữ 100% cục bộ** — không dùng bảng trung tâm cho việc này, giữ đúng nguyên tắc LAN-first (band đang họp mất mạng ngoài LAN vẫn vào được phòng).
- **Bảng DynamoDB riêng, mục đích quản lý/dọn dẹp** (không phải verify): theo dõi phòng nào còn hoạt động, **tự xoá/đánh dấu phòng đã lâu không ai truy cập**. Lý do nêu ra: chuẩn bị cho 1 trang web quản lý sau này (chưa xây). Cụ thể sẽ lưu gì (roomId, lastAccessAt, có kèm mật khẩu/địa chỉ hay chỉ metadata) **chưa thiết kế** — để tới khi thật sự bắt tay xây trang web đó.
- **Chưa triển khai** — không tạo bảng/resource nào ngay bây giờ, tránh dựng hạ tầng trước khi có tính năng thật sự dùng tới nó. DynamoDB (không phải Cloudflare D1/KV) là lựa chọn đã nêu rõ — giữ nguyên khi tới lúc làm, không cần hỏi lại trừ khi có lý do mới.
