const http = require('http');
const fs = require('fs');
const path = require('path');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  let filePath = path.join(__dirname, reqPath);

  // reqPath có thể chứa "../" -> path.join() sẽ thoát ra ngoài __dirname;
  // chặn truy cập file ngoài thư mục website/ trước khi đọc.
  if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  // Thư mục (vd /v2 hoặc /v2/) -> tự tìm index.html bên trong, khớp hành vi
  // "/" -> "/index.html" ở trên. Thiếu bước này, fs.createReadStream() bên
  // dưới ném EISDIR trên 1 đường dẫn thư mục và làm SẬP CẢ TIẾN TRÌNH server
  // (unhandled 'error' event trên ReadStream, không có gì catch) — đã tái
  // hiện thật khi mở /v2/.
  let dirStat;
  try { dirStat = fs.statSync(filePath); } catch (e) { dirStat = null; }
  if (dirStat && dirStat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Đây là dev server xem trước lúc đang chỉnh sửa liên tục — không có
  // Cache-Control nghĩa là trình duyệt tự quyết định có cache hay không
  // (thường CÓ, theo heuristic), nên sửa file xong reload vẫn thấy bản cũ.
  // Luôn bắt trình duyệt lấy lại từ server, không hỏi gì thêm.
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  const stream = fs.createReadStream(filePath);
  // Bất kỳ lỗi đọc nào khác (quyền truy cập, file bị xoá giữa chừng...) cũng
  // không được để lọt thành unhandled 'error' — chỉ nên hỏng 1 request, không
  // sập cả server đang phục vụ mọi người khác.
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  });
  stream.pipe(res);
});

const PORT = 3333;
server.listen(PORT, () => {
  console.log(`Landing page live at http://localhost:${PORT}`);
});
