# Chuẩn Dữ Liệu

## Item cơ bản

Item được lưu trong library thường có dạng:

```json
{
  "id": 1234567890,
  "title": "Amazing Grace",
  "lyrics": "Line 1\nLine 2\n\nLine 3",
  "type": "song",
  "style": {
    "fontSize": "80px",
    "fontFamily": "CMG Sans",
    "color": "#ffffff",
    "textAlign": "center",
    "verticalAlign": "middle",
    "textBox": {
      "left": 48,
      "width": 864
    }
  },
  "background": null
}
```

## Quy ước migrate

- `fontColor` là field legacy, phải được chuyển sang `color`
- `fontSize` có thể từng là number hoặc chuỗi `pt`; dữ liệu mới nên là chuỗi `px`
- `migrateItem()` phải giữ tương thích ngược
- `validateItem()` phải chặn item thiếu `id`, `title`, `lyrics`

## Settings

Settings hiện lưu trong `settings.json`. Các field quan trọng gồm:

- `theme`
- `gpuAcceleration`
- `fontFamilySong`
- `fontFamilyBible`
- `fontSize`
- `color`
- `fontWeight`
- `textAlign`
- `verticalAlign`
- `textStrokeWidth`
- `textStrokeColor`
- `textMargin` (`top`, `right`, `bottom`, `left`)
- `textPadding` (`top`, `right`, `bottom`, `left`)
- `autoFitText` (`true`/`false`); tự động giảm cỡ chữ khi lyric/câu Kinh Thánh dài để không tràn khung chiếu
- `mediaPath`
- `allowSingleDisplayLiveWindow` (`true`/`false`); cho phép mở `Screen Live` khi không có màn hình phụ và hiển thị đè lên monitor trong app
- `liveWindowBounds` (`x`, `y`, `width`, `height`) hoặc `null`; dùng để ghi nhớ vị trí cửa sổ Live khi chỉ có một màn hình
- `shortcuts`
- `defaultShortcutRows`:
  - mỗi row gồm `key1`, `key2`, `key3`, `action`
- `customShortcuts`:
  - danh sách động, mỗi row gồm `key1`, `key2`, `key3`, `action`

## Media

Media object thường có:

- `name`
- `path`
- `type` = `image` hoặc `video`

Media thật nằm trong `userData/media` hoặc folder được cấu hình bởi `mediaPath`.

## Bulk replace

- Công cụ tìm kiếm và thay thế hàng loạt trong Settings áp dụng trực tiếp lên `songs.json` và các file XML trong `app.getPath('userData')/bible-versions`
- Chế độ `Preview` chỉ đếm số match và số item/file bị ảnh hưởng, không ghi dữ liệu
- Khi áp dụng cho Bible XML, cache theo version phải bị xóa để app parse lại nội dung mới

## Bible cache

- File cache được tạo theo từng XML nguồn
- Không nên coi cache là nguồn dữ liệu duy nhất
- Khi XML đổi, cache phải được rebuild
- XML bundled mặc định nằm trong `data/` của app package
- XML do người dùng import được lưu trong `app.getPath('userData')/bible-versions`
- Metadata quản lý tên hiển thị và trạng thái ẩn của version được lưu trong `app.getPath('userData')/bible-versions.json`
- Khi load danh sách version, userData phải được ưu tiên hơn bundled defaults
- `displayName` của version có thể khác tên file XML; rename chỉ đổi metadata, không đổi file vật lý
- Xóa version `user` sẽ xóa file XML và cache liên quan; xóa version `bundled` sẽ được thực hiện bằng cách ẩn version đó khỏi UI qua metadata

## Schedule

- Schedule item có thể lưu `style` override riêng cho buổi trình chiếu mà không ghi đè style của item gốc trong library
- Khi người dùng áp `Style Template`, app có thể lưu thêm `sourceStyle`, `appliedTemplateId`, `appliedTemplateName` vào schedule item để quay lại `Style mặc định` nhanh và giữ được style đã chọn khi save/open `.bcsch`

- File schedule dùng đuôi `.bcsch`
- Nội dung là JSON
- Save/Open đi qua native dialog

## Style templates và custom fonts

- `Style Templates` được lưu trong `app.getPath('userData')/style-templates.json`
- Mỗi template lưu `id`, `name`, `scope`, và `style`
- `style.boxStyle` hỗ trợ box nền cho chữ với `enabled`, `backgroundColor`, `backgroundOpacity`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius`
- Font custom được lưu trong `app.getPath('userData')/custom-fonts/` và metadata nằm trong `app.getPath('userData')/custom-fonts.json`
- V1 chỉ hỗ trợ upload font `.ttf` và `.otf`
