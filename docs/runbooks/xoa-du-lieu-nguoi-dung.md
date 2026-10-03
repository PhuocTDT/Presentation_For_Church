# Quy trình xử lý yêu cầu xóa dữ liệu người dùng

Cam kết trong chính sách riêng tư (`website/privacy.html`, mục 5): phản hồi trong **30 ngày**; khi xóa, xóa tài khoản đăng nhập, hồ sơ, phòng, tài khoản thành viên và **toàn bộ dữ liệu của phòng trên máy chủ**.

## Điều kiện cần có (làm một lần)
1. **Đặt khóa xóa dữ liệu phòng** cho relay (đã code, cần bạn đặt khóa và deploy):
   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # sinh khóa 48 ký tự, cất vào nơi lưu mật khẩu của bạn
   cd cloud/worker
   npx wrangler secret put ADMIN_PURGE_KEY      # dán khóa vừa sinh
   npx wrangler deploy                          # đưa route /admin/purge lên production
   ```
2. **`ADMIN_KEY` của identity** (đã có, dùng cho `/admin/*`) — lấy từ nơi bạn lưu.
3. Không để hai khóa này trong repo, trong lịch sử lệnh chia sẻ, hay trong email.

## Các bước khi nhận được yêu cầu
1. **Xác minh người yêu cầu:** thư phải gửi từ đúng **email đã đăng ký tài khoản**. Nếu khác, trả lời tới email đã đăng ký và yêu cầu xác nhận. Ghi lại ngày nhận.
2. **Lấy mã phòng** của người đó: `curl -H "Authorization: Bearer <ADMIN_KEY>" https://identity.worship-official.link/admin/operators` rồi tìm đúng email trong danh sách; trường `room.code` là mã 6 ký tự (ví dụ `ABC123`). Không có `room` nghĩa là người đó chưa tạo phòng, bỏ qua bước 3.
3. **Xóa dữ liệu phòng trên relay** (làm TRƯỚC khi xóa tài khoản, vì bước này không cần tài khoản còn tồn tại):
   ```
   curl -X POST "https://channel.worship-official.link/api/room/<MÃ_PHÒNG>/admin/purge" -H "X-Purge-Key: <ADMIN_PURGE_KEY>"
   ```
   Kết quả đúng: `{"ok":true,"deleted":{"r2Gallery":..,"r2Backgrounds":..,"kvSetlists":..,"kvLibrary":..}}`. (403 = sai khóa hoặc chưa đặt `ADMIN_PURGE_KEY`; 400 = mã phòng sai.)
4. **Xóa tài khoản trên identity** (xóa Cognito, hồ sơ, phòng, tài khoản thành viên):
   ```
   curl -X DELETE "https://identity.worship-official.link/admin/operator/<EMAIL_URL_ENCODED>" -H "Authorization: Bearer <ADMIN_KEY>"
   ```
   Kết quả đúng: `{"ok":true}`.
5. **Kiểm tra lại:** gọi lại bước 3 (phải trả `deleted` toàn số 0 nếu không còn dữ liệu), thử đăng nhập bằng email đó (phải thất bại).
6. **Phản hồi** người yêu cầu bằng email, xác nhận đã xóa và ngày xóa. Không lưu lại nội dung dữ liệu đã xóa.

## Lưu ý
- Bước 3 xóa dữ liệu của ĐÚNG một phòng (kiểm bằng test `test/relay-purge.test.mjs`: phòng khác còn nguyên).
- Dữ liệu trên máy người dùng không nằm trong phạm vi của bạn; họ tự xóa bằng cách gỡ app hoặc xóa thư mục dữ liệu.
- Bản sao lưu: hiện chưa có bản sao lưu riêng của KV/R2/Durable Object do chúng tôi quản lý; nếu sau này bật sao lưu thì phải cập nhật quy trình và chính sách.
- Nếu yêu cầu liên quan sự cố bảo mật (nghi lộ dữ liệu), làm thêm: đổi mật khẩu phòng (tự xoay token thành viên), thu hồi phiên Cognito, ghi vào `changelog.md`.
