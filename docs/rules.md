# Quy Tắc Làm Việc

## Bắt buộc

1. Đọc kiến trúc và contract trước khi sửa.
2. Kiểm tra `git status` để biết file nào là thay đổi của user.
3. Chỉ sửa file thật sự liên quan đến task.
4. Không revert, không overwrite thay đổi không thuộc phạm vi.
5. Nếu thay đổi data shape, phải có migration hoặc tương thích ngược.
6. Nếu thay đổi IPC, phải sửa cả `main.js` và `preload.js`.
7. Nếu thay đổi render/live UI, phải kiểm tra cả operator window và live window.
8. Nếu thay đổi hành vi, phải cập nhật tài liệu tương ứng.
9. Sau mỗi hành động chỉnh sửa, phải ghi changelog ngắn gọn nhưng đầy đủ vào `changelog.md`.

## Chuẩn an toàn

- Dùng safe write và backup rotation cho file dữ liệu.
- Không thêm dependency mới nếu chưa cần thiết.
- Không phá vỡ cách load media hiện tại trừ khi đang sửa chính luồng đó.
- Không giả định cache là hợp lệ; luôn có đường fallback/rebuild.

## Done nghĩa là gì

Một thay đổi chỉ coi là xong khi:

- code đã được chỉnh đúng phạm vi
- docs liên quan đã cập nhật
- app đã chạy được
- luồng chính đã được kiểm tra
- log không có lỗi mới
