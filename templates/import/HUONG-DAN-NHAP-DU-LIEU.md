# Hướng dẫn nhập dữ liệu vào Presentation For Church

Phần mềm **không kèm sẵn** bài hát, Kinh Thánh hay ảnh/video nền. Bạn tự chuẩn bị dữ liệu của hội thánh mình theo các định dạng dưới đây rồi nhập vào. Các file mẫu nằm cùng thư mục với tài liệu này (nội dung mẫu là giả, chỉ để minh họa).

> **Về bản quyền:** bạn chịu trách nhiệm đảm bảo mình có quyền sử dụng nội dung nhập vào (bản dịch Kinh Thánh, lời bài hát, hình/video nền).

---

## 1. Bài hát

### Cách A — Từng bài từ file `.txt` hoặc `.docx`
- Tên file = **tên bài hát**. Nội dung file = **lời bài hát**.
- **Mỗi slide cách nhau bằng một dòng trống.** Các dòng liền nhau (không có dòng trống) nằm chung một slide.
- Nhập: tab **Songs** → nút **Import** ở đầu danh sách → chọn một hoặc nhiều file `.txt` / `.docx`.
- File mẫu: `songs.sample.txt`.

### Cách B — Nhiều bài cùng lúc từ file `.json` (khuyên dùng để nhập hàng loạt)
File là một **mảng** các bài hát. Mỗi bài:

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `id` | Không (app tự tạo nếu thiếu) | Số nguyên. Nếu `id` đã có trong thư viện nhưng bài khác nội dung, app tự cấp `id` mới (không mất bài). Bài **trùng cả tên lẫn lời** với bài đã có thì bị bỏ qua, nên nhập lại cùng một file không bị nhân đôi. |
| `type` | Không | Luôn là `"song"`. |
| `title` | **Có** | Tên bài hát (chuỗi, không rỗng). |
| `lyrics` | **Có** | Lời bài hát. Slide cách nhau bằng dòng trống (`\n\n`). Hợp âm đặt trong ngoặc vuông, ví dụ `[C]`. |
| `style` | Không | Kiểu chữ: `fontFamily`, `fontSize` (ví dụ `"80px"`), `color`, `textAlign`, ... Thiếu trường nào app dùng mặc định. |
| `background` | Không | `null` (nền mặc định) hoặc `{ "mediaName": "ten-file.jpg", "mediaType": "image" }` (`"video"` cho video). `mediaName` là **tên file nằm trong thư mục media của app** (xem mục 3). |

- Nhập: tab **Songs** → **Import** → chọn file `.json`.
- File mẫu: `songs.sample.json`.
- Bài thiếu `title` hoặc `lyrics`, sai kiểu (ví dụ `"type": "bible"`), hoặc quá lớn (tên > 300 ký tự, lời > 100.000 ký tự) sẽ bị bỏ qua; app báo số bài đã nhập, số bài trùng và số mục lỗi. Một file tối đa 5.000 bài và 20 MB.
- Cũng nhận file dạng `{ "songs": [ ... ] }` hoặc một bài đơn lẻ `{ "title": ..., "lyrics": ... }`.
- Có thể **xuất** thư viện hiện có ra đúng định dạng này bằng nút **Export** (cạnh nút Import) để làm bản sao lưu hoặc chuyển sang máy khác.

---

## 2. Kinh Thánh (file XML)

Định dạng **Zefania XMLBIBLE**. Cấu trúc:

```xml
<XMLBIBLE biblename="Tên bản dịch">
  <BIBLEBOOK bnumber="1" bname="Sáng-thế Ký">
    <CHAPTER cnumber="1">
      <VERS vnumber="1">Nội dung câu 1</VERS>
      <VERS vnumber="2">Nội dung câu 2</VERS>
    </CHAPTER>
  </BIBLEBOOK>
</XMLBIBLE>
```

- `bnumber` = số thứ tự sách theo thứ tự chuẩn: 1 = Sáng thế ký … 39 = Ma-la-chi, 40 = Ma-thi-ơ … 66 = Khải huyền. App tự gán tên sách theo `bnumber`.
- Mỗi sách có các `CHAPTER` (`cnumber`), mỗi chương có các `VERS` (`vnumber`).
- Lưu file bằng mã hóa **UTF-8**. Tên file nên là tên bản dịch (không trùng tên bản đã nhập).
- Nhập: tab **Bible** → **Import**, hoặc **Cài đặt → quản lý bản dịch Kinh Thánh**.
- App kiểm tra file trước khi nhận: phải có đủ sách → chương → câu đúng như trên; nếu không, app **từ chối**, báo lý do cụ thể và không lưu file. Giới hạn 60 MB mỗi file; trùng tên file với bản đã nhập thì bị từ chối (đổi tên file hoặc xóa bản cũ trước).
- File mẫu: `bible.sample.xml`.

---

## 3. Ảnh / video nền (media)
- Định dạng nhận: `jpg`, `jpeg`, `png` (ảnh); `mp4`, `mov`, `m4v`, `webm` (video).
- Nhập: menu **File → Import Media** (hoặc lệnh "Nhập Media"), có thể chọn nhiều file cùng lúc.
- File được chép vào thư mục media của app (Cài đặt → Dữ liệu cho biết đường dẫn). **Tên file** là thứ bài hát dùng để tham chiếu trong `background.mediaName`, nên đặt tên file ngắn gọn, không trùng nhau (file cùng tên sẽ bị ghi đè).

---

## 4. Lấy lại các file mẫu
**Cài đặt → Dữ liệu → "Tải file mẫu định dạng"** để chép các file mẫu và hướng dẫn này ra một thư mục tùy chọn.
