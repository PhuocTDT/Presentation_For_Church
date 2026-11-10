# Chuẩn Giao Diện

## Nguyên tắc theo cửa sổ

### `index.html`

- Là cửa sổ operator
- Dùng phong cách hiện đại, dark-ish, dense
- Ưu tiên tốc độ thao tác và mật độ thông tin

### Hộp "Edit Song" (`#song-editor-modal` trong `index.html`)

- Là modal chỉnh sửa bài hát (file `edit-song.html` cũ đã xóa). Từ bản thiết kế lại, hộp này dùng phong cách **tối giản hiện đại, cùng ngôn ngữ với hộp Cài đặt** (không còn kiểu Windows cổ điển/Tahoma).
- Toàn bộ phần trình bày nằm trong MỘT khối `<style id="song-editor-redesign">` ở cuối `<head>` của `index.html`, mọi luật có tiền tố `#song-editor-modal`; token màu `--se-*` khớp với `--stg-*` của hộp Cài đặt (accent `#5048e5`, nền `#f6f6f8`, viền `#dcdce6`).
- **Màu phẳng, không gradient.** Thanh tiêu đề nền trắng + viền mảnh; nút OK là nút chính (màu accent đặc), Apply/Cancel phụ.
- Hộp luôn nền sáng (như trước): JS đặt vài màu inline giả định nền sáng (màu nhãn slide `getLabelColor`, `#color-indicator`).
- Khi sửa: giữ nguyên ID/lớp mà JS dùng; thanh tiêu đề phải là `div` đầu tiên của `.win-modal-container` (tay kéo); `.win-button` và `.toolbar-btn` dùng chung nơi khác nên chỉ override trong phạm vi `#song-editor-modal`.

### `live.html`

- Là màn hình chiếu
- Tối giản, đen, không chrome
- Chữ và background phải đọc được từ xa

## Virtual canvas

- Live/preview nên giữ logic canvas 16:9 ổn định
- Không tự ý đổi kích thước logic nếu chưa test scale
- Text box và background phải kiểm tra ở màn hình phụ thật

## Typography và màu

- Chỉ đổi font khi có lý do rõ ràng
- Không làm mất tính tương phản của text trên nền media
- Tránh đưa style riêng lẻ không có token hoặc quy tắc

## Khi chỉnh layout

- Giữ khoảng cách thao tác đủ lớn cho live use
- Tránh làm UI cần quá nhiều click
- Kiểm tra trạng thái hover, focus, active nếu có control mới
