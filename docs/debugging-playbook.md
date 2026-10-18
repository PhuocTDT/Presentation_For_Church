# Debugging Playbook

## 1. Xác định lỗi ở đâu

- Main process: lỗi file I/O, IPC, protocol, menu, tạo cửa sổ
- Renderer: lỗi UI, state, render lại, sự kiện DOM
- Live window: lỗi scale, background, text overlay, crossfade
- Data layer: lỗi JSON, migration, cache, import

## 2. Thu hẹp phạm vi

- Reproduce bằng bước ngắn nhất có thể
- Ghi lại file, action, và window gây lỗi
- Kiểm tra console/log ở đúng process
- Xem dữ liệu đầu vào có hợp lệ không

## 3. Checklist theo loại lỗi

### Nếu lỗi dữ liệu

- Mở file trong `userData`
- Kiểm tra JSON có hỏng không
- Kiểm tra item có qua `migrateItem()` chưa
- Kiểm tra backup `.backup.*`

### Nếu lỗi IPC

- Kiểm tra tên method ở renderer
- Kiểm tra `preload.js` đã expose chưa
- Kiểm tra `ipcMain.handle(...)` có đúng tên không
- Kiểm tra payload có đúng shape không

### Nếu lỗi live window

- Kiểm tra đã mở live window chưa
- Kiểm tra có màn hình phụ không
- Kiểm tra `app-media://` có trỏ đúng file không
- Kiểm tra scale/canvas và style text

### Nếu "mở được popup Edit nhưng bấm vào ô không có con trỏ / không gõ được"

- Bấm **Ctrl+Alt+D** ngay lúc đang lỗi. Dòng "Trang có focus bàn phím" = `false` là lỗi mất focus (Electron/Windows): cửa sổ được chọn, `webContents.isFocused()` báo `true` nhưng trong trang `document.hasFocus()` = `false`, nên `webContents.focus()` không có tác dụng.
- Cơ chế chữa: `ensurePageFocus()` trong `main.js` hỏi lại trang sau mỗi bước và leo thang (1) `focus()` → (2) `blurWebView()`+`focusOnWebView()` → (3) `blur()`+`focus()`. Chạy khi cửa sổ chính nhận focus, khi cửa sổ Live lỡ nhận focus, sau hộp thoại, và khi bấm chuột lúc trang mất focus (IPC `refocus-page`). Báo cáo Ctrl+Alt+D ghi "lần cuối: chữa được ở mức N"; log main có dòng `[Focus] …`.
- Nếu báo cáo ghi "CHƯA chữa được" hoặc focus = `true` mà vẫn không gõ được: lỗi khác (lớp phủ che ô — xem dòng "Lớp phủ toàn màn hình", bộ gõ tiếng Việt…), gửi kèm báo cáo.

### Nếu lỗi media

- Kiểm tra file có nằm trong `userData/media`
- Kiểm tra extension có được hỗ trợ
- Kiểm tra tên file, ký tự đặc biệt và khoảng trắng
- Kiểm tra protocol custom có phục vụ file không

## 4. Sau khi sửa

- Chạy lại đúng luồng đã hỏng
- Kiểm tra log cho cả main và renderer
- Kiểm tra không sinh lỗi mới
- Nếu lỗi liên quan contract, cập nhật docs
