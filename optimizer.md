# 🚀 Optimization Roadmap - Presentation Worship

Tài liệu này ghi lại các chiến lược tối ưu hóa hiệu năng để đảm bảo ứng dụng chạy mượt mà khi dữ liệu thư viện (Songs, Bible, Media) tăng trưởng lớn.

---

## 1. Tối ưu Kinh Thánh (Bible) - Trọng tâm số 1
**Vấn đề:** Hiện tại app parse file XML >31,000 câu mỗi lần khởi động, gây tốn RAM và làm chậm UI (lag ~1-2s).

### 💡 Giải pháp 1: Dropdown UI (Sách -> Chương)
- **Cải tiến UI:** Thay vì liệt kê toàn bộ 1,189 chương trong một danh sách dài, sử dụng 2 Dropdown/Select:
  1. Chọn Sách (66 sách).
  2. Chọn Chương (Dựa trên sách đã chọn).
- **On-demand Loading:** Chỉ khi người dùng chọn một Chương cụ thể, ứng dụng mới thực hiện truy vấn dữ liệu các Câu (Verses) của chương đó để hiển thị.
- **Hiệu quả:** Giảm số lượng thẻ HTML (DOM nodes) từ hàng ngàn xuống còn vài chục.

### 💡 Giải pháp 2: Chuyển đổi XML sang JSON (Data Caching)
- **Vấn đề:** `DOMParser` xử lý XML trong Browser rất chậm.
- **Giải pháp:** Chuyển cấu trúc XML sang file `bible_vietnamese.json` có cấu trúc phân cấp (Books -> Chapters -> Verses).
- **Hiệu quả:** Tốc độ `JSON.parse()` nhanh hơn gấp nhiều lần so với parse XML. RAM footprint giảm đáng kể.

---

## 2. Tối ưu Thư viện Bài hát (Song Library)
**Dự kiến:** >400 bài hát.

### 💡 Giải pháp 3: Virtual Scrolling (Cuộn ảo)
- **Vấn đề:** Render 400+ thẻ `<tr>` cùng lúc làm chậm quá trình vẽ giao diện (Paint).
- **Giải pháp:** Chỉ render các bài hát đang hiển thị trong khung nhìn (viewport). Khi người dùng cuộn, các thẻ `<tr>` cũ bị hủy và thẻ mới được tạo ra ngay lập tức.
- **Hiệu quả:** App luôn mượt dù thư viện có 1,000 hay 10,000 bài hát.

---

## 3. Tối ưu Media (Images & Videos)
**Dự kiến:** Hàng trăm file media làm background.

### 💡 Giải pháp 4: Lazy Loading Thumbnails
- **Vấn đề:** Trình duyệt cố gắng tải thumbnail của toàn bộ media cùng lúc khi mở tab.
- **Giải pháp:** Sử dụng `Intersection Observer API`. Chỉ nạp `src` cho thẻ `<img>` hoặc `<video>` khi item đó cuộn vào vùng nhìn thấy.
- **Hiệu quả:** Tiết kiệm Disk I/O và RAM, tránh tình trạng "treo" thumbnail khi có quá nhiều file.

---

## 4. Tối ưu Khởi động (Startup)
**Vấn đề:** Đợi load toàn bộ thư viện mới hiện giao diện.

### 💡 Giải pháp 5: Background Loading & Splash Screen
- **Giải pháp:** Khởi động giao diện khung (Skeleton UI) trước, sau đó dùng `Web Workers` hoặc load dữ liệu bất đồng bộ (`async/await`) ở background.
- **Hiệu quả:** Người dùng cảm thấy app mở lên ngay lập tức (Instant feel).

---

## ✅ Kế hoạch thực hiện (Priority)
1. **Ưu tiên 1:** Triển khai Dropdown UI cho Bible (Ý tưởng từ User).
2. **Ưu tiên 2:** Chuyển đổi Bible XML sang JSON.
3. **Ưu tiên 3:** Lazy load cho Media thumbnails.
4. **Ưu tiên 4:** Virtual Scroll cho Songs (khi số lượng bài hát lớn hơn).
