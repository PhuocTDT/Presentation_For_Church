# Presentation For Church

Ứng dụng Electron trình chiếu cho nhà thờ — quản lý bài hát, Kinh Thánh (Tiếng Việt), media, lịch trình thờ phượng, và kênh giao tiếp LAN thời gian thực cho ban nhạc.

## Tính năng

**Trình chiếu**
- Quản lý thư viện bài hát (thêm, sửa, xóa), soạn giao diện kiểu Windows cổ điển (`edit-song.html`)
- Tra cứu Kinh Thánh Tiếng Việt, import thêm bản dịch XML
- Quản lý media (ảnh, video) làm background
- Lịch trình thờ phượng (Schedule) với drag & drop, lưu/mở file `.bcsch`
- Trình chiếu trực tiếp qua cửa sổ Live (HDMI/VGA), Style Templates + custom font
- Tùy chỉnh font, màu sắc, kích thước, khung chữ, tự động fit text khi tràn khung

**Kênh Band (giao tiếp LAN thời gian thực)**

Sidebar `#bandPanel` bên trong `index.html` (menu **Channel** hoặc `Ctrl+Shift+B`), kết nối điện thoại của ban nhạc/trưởng nhóm thờ phượng với máy vận hành, không cần internet:

- Mỗi người tự tạo bộ nút cảnh báo riêng trên điện thoại (không có bộ nút mặc định, không có mức độ ưu tiên) — bấm 1 chạm để báo, ví dụ "guitar nhỏ quá", "mic rè", "đổi bài", "chữ khó đọc vì nền"
- Operator thấy cảnh báo dồn về feed, bấm vào tin nhắn là xác nhận đã tiếp nhận (không cần nút riêng); operator cũng gõ trả lời tự do
- Toast đẩy về điện thoại, tự ẩn sau 2–3s, không có khung chat che màn hình
- Thư viện ảnh hợp âm: điện thoại được cấp quyền "phụ trách ảnh" upload, cả nhóm xem theo yêu cầu (vuốt ngang + dot pager), operator cũng quản lý được từ sidebar
- Soạn setlist ngay trên điện thoại, gửi về operator để nạp vào Schedule; nếu máy vận hành đang tắt, tin nhắn setlist được giữ tạm trên một relay cloud (Cloudflare Worker) rồi đồng bộ lại khi máy mở lên
- Tự khởi động server khi mở app, tự quảng bá `<hostname>.local` qua mDNS tự viết, hiện QR + IP LAN để quét, có công cụ mở Windows Firewall
- Tùy chọn gắn thêm Cloudflare Tunnel để band vào được từ ngoài LAN (4G/mạng khác)

Chi tiết kiến trúc và giao thức: xem `docs/architecture.md`, `docs/data-contracts.md`, `band-comm-plan.md`.

## Git Clone Project
```bash
git clone https://github.com/PhuocTDT/Presentation_For_Church.git
```

## Cài đặt và chạy

```bash
cd Presentation_For_Church
npm install
npm start
```

### Build cài đặt

```bash
npm run build        # build cả Windows + macOS
npm run build:win    # chỉ Windows (nsis + portable)
npm run build:mac    # chỉ macOS (dmg)
```

### Xử lý lỗi thường gặp

**1. Lỗi timeout khi `npm install` (ETIMEDOUT):**
Nếu bạn gặp lỗi mạng khi cài đặt, hãy thử sử dụng registry mirror tại Việt Nam/Châu Á:
```bash
npm install --registry=https://registry.npmmirror.com
```

**2. Lỗi không tìm thấy package.json (ENOENT):**
Hãy chắc chắn bạn đã vào đúng thư mục dự án trước khi chạy lệnh:
```bash
cd Presentation_For_Church
```

## Yêu cầu

- [Node.js](https://nodejs.org/) (v18+)

## Tài liệu chuẩn

Các tài liệu vận hành và quy ước phát triển nằm trong `docs/`:

- `docs/README.md` - trang mục lục
- `docs/architecture.md` - kiến trúc và luồng dữ liệu
- `docs/rules.md` - quy tắc làm việc bắt buộc
- `docs/debugging-playbook.md` - quy trình debug
- `docs/feature-workflow.md` - quy trình thêm tính năng
- `docs/ui-guidelines.md` - chuẩn giao diện
- `docs/data-contracts.md` - chuẩn dữ liệu và migration
- `band-comm-plan.md` - kế hoạch/spec đầy đủ của Kênh Band
- `changelog.md` - lịch sử thay đổi
