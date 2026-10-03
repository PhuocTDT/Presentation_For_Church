// Cổng kiểm tra TRƯỚC KHI đăng website/privacy.html: không được còn ô điền {{...}}.
//   node scripts/check-privacy-page.js [email]
// Có tham số email: thay {{CONTACT_EMAIL}} bằng email đó (ghi vào file) rồi kiểm tra.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'website', 'privacy.html');
let html = fs.readFileSync(file, 'utf8');
const email = process.argv[2];
if (email) {
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) { console.error('Email không hợp lệ:', email); process.exit(2); }
  html = html.split('{{CONTACT_EMAIL}}').join(email);
  fs.writeFileSync(file, html);
  console.log('Đã điền email liên hệ:', email);
}
const left = html.match(/\{\{[A-Z_]+\}\}/g) || [];
if (left.length) { console.error('CHƯA ĐĂNG ĐƯỢC: còn ' + left.length + ' ô chưa điền: ' + [...new Set(left)].join(', ')); process.exit(1); }
console.log('OK: không còn ô điền; trang sẵn sàng để đăng.');
