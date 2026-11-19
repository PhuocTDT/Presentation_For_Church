# Chuẩn Giao Diện

## Nguyên tắc theo cửa sổ

### `index.html`

- Là cửa sổ operator
- Dùng phong cách hiện đại, dark-ish, dense
- Ưu tiên tốc độ thao tác và mật độ thông tin

### Hộp "Edit Song" (`#song-editor-modal` trong `index.html`)

- Là modal chỉnh sửa bài hát (file `edit-song.html` cũ đã xóa). Thanh công cụ có Text Color và Background Color dùng chung một bảng màu kiểu Office (`src/editor/color-picker.js`: Automatic → Theme → Standard → Custom → More Colors; Custom nằm ngay dưới Standard). Khung xem trước có tiêu đề "Preview · Live Preview", chip nền và nút toàn màn hình; chân hộp có Help & Tips; mỗi thẻ lời có biểu tượng mắt mở panel Text/Background/Animation (`src/editor/seg-panel.js`; phạm vi = vùng chữ đang tô chọn, không tô = cả thẻ). Các nút B/I/U, font, cỡ, màu chữ, màu nền ở thanh công cụ áp cho vùng tô chọn nếu có (chip "Vùng chọn: …" hiện ở cuối thanh công cụ), không thì cho cả bài. Chân hộp có Undo/Redo (Ctrl+Z / Ctrl+Y trong ô lời). Nền gồm 5 kiểu (brush, brush khô, giấy xé, dải bo tròn, marker), mỗi kiểu có màu, độ mờ, đệm, xoay, tỉ lệ, vị trí, lớp trước/sau; có thể xếp nhiều lớp. Kinh Thánh không có các tính năng này. Từ bản thiết kế lại, hộp này dùng phong cách **tối giản hiện đại, cùng ngôn ngữ với hộp Cài đặt** (không còn kiểu Windows cổ điển/Tahoma).
- Toàn bộ phần trình bày nằm trong MỘT khối `<style id="song-editor-redesign">` ở cuối `<head>` của `index.html`, mọi luật có tiền tố `#song-editor-modal`; token màu `--se-*` khớp với `--stg-*` của hộp Cài đặt (accent `#5048e5`, nền `#f6f6f8`, viền `#dcdce6`).
- **Màu phẳng, không gradient.** Thanh tiêu đề nền trắng + viền mảnh; nút OK là nút chính (màu accent đặc), Apply/Cancel phụ.
- Hộp luôn nền sáng (như trước): JS đặt vài màu inline giả định nền sáng (màu nhãn slide `getLabelColor`, `#color-indicator`).
- Tab **Slides** (`setEditorTab`, `renderSlidesView`, các hàm `se*` trong `index.html`) vẽ hình thu nhỏ từ các thẻ ở `#lyrics-editor-container` bằng `applyStyleToElement`; **không ẩn khung Words bằng `display:none`** (xem `.se-pane-hidden`) vì `innerText` của phần tử không render mất dấu xuống dòng → hỏng `getLyricsFromEditor()`.
- Khi sửa: giữ nguyên ID/lớp mà JS dùng; thanh tiêu đề phải là `div` đầu tiên của `.win-modal-container` (tay kéo); `.win-button` và `.toolbar-btn` dùng chung nơi khác nên chỉ override trong phạm vi `#song-editor-modal`.

### `live.html`

- Là màn hình chiếu
- Tối giản, đen, không chrome
- Chữ và background phải đọc được từ xa

## Skin giao diện (cửa sổ operator)

- Người dùng chọn trong **Cài đặt → Giao diện** (có khung xem trước; bấm "Lưu thay đổi" mới áp dụng, "Huỷ" thì bỏ). Lưu ở `settings.json` (`uiSkin`, `uiHeader` — xem `docs/data-contracts.md`).
- 8 phong cách: **Cổ điển** (giao diện gốc, mặc định, KHÔNG đặt thuộc tính nào), Mist, Iris, Honey, Sage (sáng, tối giản), Midnight (tối, tối giản), Candy (sáng, nhiều màu), Studio (tối, nhiều màu). 5 kiểu header A Đậm / B Than / C Đặc / D Sáng / E Vạch (mặc định) chỉ áp dụng cho nhóm tối giản.
- Cách làm: `src/css/ui-themes.css`. Skin = `data-ui-skin` (+ `data-ui-hdr`) trên `<html>`; token `--u-*` đặt trên mọi phần tử có `data-ui-skin` nên **khung xem trước dùng đúng token của cửa sổ thật**. Luật ghi đè giao diện thật nằm dưới `html[data-ui-skin]` và dùng `!important` vì giao diện gốc là class Tailwind + style inline.
- Skin tối ép class `dark` của Tailwind (để chữ gốc đọc được); `Cổ điển` giữ nguyên hành vi Dark Mode cũ. Cổ điển chỉ có token trong CSS để vẽ khung xem trước.
- **Thanh menu tùy biến**: khi có skin, `#appMenubar` (trong `index.html`) thay thanh menu gốc của HĐH (`setAppMenubar()` → IPC `app-menu-custom` ẩn thanh gốc); nút dựng từ menu thật (`app-menu-labels`) và mở submenu thật (`app-menu-popup`); Cổ điển trả lại thanh gốc. **Khung Kênh Band** (`#bandPanel`) khi có skin là thẻ nằm dưới thanh menu, tiêu đề = tên phòng, Xóa/Kết nối là icon, có dòng `#bpOnlineLine` (số người online) cố định; nội dung chính bị đẩy bằng `margin-left` (không dùng padding của body).
- Phụ thuộc vào cấu trúc DOM hiện tại; khi đổi markup các phần sau phải kiểm tra lại skin: header là `div` đầu của `section.panel` (và header phụ `.h-8.shrink-0` của Screen Monitor), hàng Schedule `[data-schedule-item]` (đang chọn = class `bg-blue-500`), thẻ slide trong `#preview-slides-container`/`#live-slides-container` (đang phát = style inline `#b3e4ff`), hàng thư viện `tbody tr[data-library-key]` (đang chọn = `row.style.backgroundColor` → serialize thành `rgb(134, 205, 255)`, selector phải khớp dạng `rgb`), `#bandPanel`/`#bandPanelTab`, `body > footer`.
- KHÔNG đổi: màn Live (`live.html` không nạp `ui-themes.css`), hộp Edit Song, hộp Cài đặt (giữ token `--stg-*`), menu hệ điều hành. Màu phẳng, không gradient.
- Test: `test/ui-skin.e2e.mjs`.

## Ngôn ngữ giao diện (Việt / Anh)

- Chọn ở **Cài đặt → Chung → Ngôn ngữ**: đổi thử ngay, "Lưu thay đổi" mới giữ, "Huỷ"/X khôi phục đúng nguyên văn; lưu ở `settings.json` (`language`).
- Văn bản gốc trong `index.html`/JS **vẫn là tiếng Việt**. Khi chọn Anh, `src/i18n/i18n.js` dịch TRỰC TIẾP trên DOM: tra từ điển `src/i18n/en.js` theo nguyên văn tiếng Việt (text node + `title`/`placeholder`/`aria-label`/`alt`), rồi theo dõi DOM (MutationObserver) để dịch cả nội dung do JS dựng động. Đổi về Việt thì khôi phục nguyên văn; ở tiếng Việt bộ máy không chạy gì (chỉ đặt `<html lang>`).
- **Thêm chữ giao diện mới → thêm vào `src/i18n/en.js`** (khóa = nguyên văn tiếng Việt, gom khoảng trắng; chuỗi có tham số dùng `RULES` regex khớp TOÀN CHUỖI; ngoại lệ theo `id` ở `BYID`). `test/i18n.test.mjs` bắt buộc mọi chữ tiếng Việt TĨNH trong `index.html` đều có bản dịch.
- KHÔNG dịch nội dung người dùng: bộ máy bỏ qua `#lyrics-editor-container`, thẻ slide Preview/Live, hàng thư viện, hàng Schedule, tin nhắn band, `.text-layer-box`, `textarea`/`input` (giá trị), và mọi phần tử có `data-no-i18n`.
- Chuỗi JS tự ghép từ nhiều mảnh (vd. "Đã nhập … bài") và tên sách Kinh Thánh KHÔNG nằm trong từ điển → vẫn tiếng Việt. Dùng `I18N.t('chuỗi việt')` khi cần dịch một chuỗi do JS tự dựng mà không đi qua DOM.
- Menu hệ điều hành dịch ở `main.js` (`MENU_EN`/`translateMenuTemplate`), dựng lại khi đổi ngôn ngữ. Không áp dụng cho: màn Live, trang điện thoại `comm/`, website.
- Tên ngôn ngữ trong ô chọn ("Tiếng Việt", "English") luôn hiện bằng chính ngôn ngữ đó.
- Test: `test/i18n.test.mjs` (từ điển/menu), `test/i18n.e2e.mjs` (app thật).

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
