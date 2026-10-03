// Cấu hình build MSIX/AppX cho Microsoft Store (docs/microsoft-store-readiness.md, mục A3).
// Build:  npm run build:store   (identity đọc từ build/store-identity.json; biến STORE_* nếu có sẽ ghi đè)
// 3 giá trị lấy từ Partner Center → Product identity sau khi giữ tên app.
// Gói MSIX không cần ký ở đây: Microsoft ký lại khi duyệt. Muốn cài thử cục bộ thì
// phải tự ký bằng chứng chỉ có Subject trùng STORE_PUBLISHER (xem checklist G3).
const fs = require('fs');
const path = require('path');
// Identity lấy từ build/store-identity.json (giá trị Partner Center cấp); biến môi trường STORE_* nếu có sẽ ghi đè.
let fileId = {};
try { fileId = JSON.parse(fs.readFileSync(path.join(__dirname, 'build', 'store-identity.json'), 'utf8')); } catch (e) { /* dùng env */ }
const identity = {
  name: process.env.STORE_IDENTITY_NAME || fileId.identityName,
  publisher: process.env.STORE_PUBLISHER || fileId.publisher,
  displayName: process.env.STORE_PUBLISHER_DISPLAY_NAME || fileId.publisherDisplayName
};
const missing = Object.entries({ identityName: identity.name, publisher: identity.publisher, publisherDisplayName: identity.displayName })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  throw new Error('Thiếu giá trị identity từ Partner Center (Product identity): ' + missing.join(', ') + '. Điền build/store-identity.json hoặc đặt biến STORE_IDENTITY_NAME / STORE_PUBLISHER / STORE_PUBLISHER_DISPLAY_NAME.');
}

module.exports = {
  appId: 'com.church.presentation',
  productName: 'Presentation For Church',
  directories: { output: 'dist-store' },
  files: [
    'main.js',
    'preload.js',
    'index.html',
    'live.html',
    'src/**/*',
    'comm/**/*',
    'fonts/**/*',
    'THIRD_PARTY_NOTICES.md',
    'licenses/**/*', // văn bản giấy phép phông (OFL/Apache) đi kèm theo yêu cầu giấy phép
    'templates/**/*', // file mẫu + hướng dẫn nhập dữ liệu (không có nội dung bản quyền)
    'package.json'
  ],
  // Electron fuses (B-16): khóa các đường lạm dụng binary đã đóng gói. Cùng giá trị với package.json.
  electronFuses: {
    runAsNode: false, // chặn ELECTRON_RUN_AS_NODE biến app thành Node shell
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true, // sửa app.asar thì app không chạy
    onlyLoadAppFromAsar: true
    // KHÔNG tắt grantFileProtocolExtraPrivileges: app nạp giao diện từ file:// nên tắt fuse này làm bản đóng gói không mở được index.html (ERR_FILE_NOT_FOUND).
  },
  fileAssociations: [
    { ext: 'bcsch', name: 'Worship Schedule', description: 'Presentation For Church schedule', role: 'Editor', icon: 'icon.ico' }
  ],
  win: {
    target: 'appx',
    icon: 'icon.ico',
    // Cố ý KHÔNG đóng gói: cloudflared (code chết), data/ (Kinh Thánh, bài hát), media/ — người dùng tự nhập theo
    // templates/import/HUONG-DAN-NHAP-DU-LIEU.md (quyết định chủ dự án 2026-10-03, xem docs/drafts/content-license-inventory.md).
  },
  appx: {
    identityName: identity.name,
    publisher: identity.publisher,
    publisherDisplayName: identity.displayName,
    applicationId: 'PresentationForChurch',
    displayName: 'Presentation For Church',
    languages: ['vi-VN', 'en-US'],
    backgroundColor: 'transparent'
  }
};
