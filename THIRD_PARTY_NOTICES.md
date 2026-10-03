# Thông báo về phần mềm và nội dung của bên thứ ba

Presentation For Church có dùng các thành phần sau. Văn bản giấy phép đầy đủ nằm trong thư mục `licenses/` đi kèm ứng dụng.
Phần mềm **không kèm** nội dung Kinh Thánh, bài hát hay ảnh/video nền: người dùng tự nhập (xem `templates/import/HUONG-DAN-NHAP-DU-LIEU.md`) và tự chịu trách nhiệm về quyền sử dụng nội dung đó.

## Phông chữ

| Phông | Giấy phép | Nguồn | Văn bản giấy phép |
|---|---|---|---|
| **CMG Sans** (mọi biến thể trong `fonts/cmg-sans/` và `comm/setlist/fonts/`) | SIL Open Font License 1.1; thiết kế từ Montserrat (OFL) kết hợp ký tự chọn lọc từ Open Sans (Apache-2.0) | Church Motion Graphics, https://www.churchmotiongraphics.com/cmg-sans/ ("Free For Everyone To Download", "Use However You Want"). Dòng bản quyền nhúng trong file font: "Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)" | `licenses/fonts/OFL-CMGSans-Montserrat.txt`, `licenses/fonts/Apache-2.0.txt` |
| Inter | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-Inter.txt` |
| Open Sans | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-OpenSans.txt` |
| Roboto | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-Roboto.txt` |
| Lato | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-Lato.txt` |
| Montserrat | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-CMGSans-Montserrat.txt` (cùng giấy phép) |
| Oswald | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-Oswald.txt` |
| Raleway | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-Raleway.txt` |
| Lobster | SIL OFL 1.1 | Google Fonts | `licenses/fonts/OFL-Lobster.txt` |
| Material Symbols Outlined | Apache License 2.0 (theo thông báo của Google Fonts) | Google Fonts | `licenses/fonts/Apache-2.0.txt` |

Các phông Google được đóng gói không sửa đổi (file `.woff2` lấy từ Google Fonts, chỉ giữ tập ký tự Latin, Latin mở rộng và tiếng Việt). Phông OFL không được bán riêng lẻ; chúng chỉ đi kèm phần mềm này.

## Thành phần của Electron
Ứng dụng chạy trên Electron (MIT) và Chromium; giấy phép của chúng nằm trong `LICENSE` và `LICENSES.chromium.html` trong thư mục cài đặt.

## Thư viện npm đóng gói trong ứng dụng (production, 26 gói)

| Gói | Phiên bản | Giấy phép | Nguồn |
|---|---|---|---|
| @xmldom/xmldom | 0.8.15 | MIT | git://github.com/xmldom/xmldom |
| argparse | 1.0.10 | Python-2.0 | nodeca/argparse |
| base64-js | 1.5.1 | MIT | git://github.com/beatgammit/base64-js |
| bluebird | 3.4.7 | MIT | git://github.com/petkaantonov/bluebird |
| core-util-is | 1.0.2 | MIT | git://github.com/isaacs/core-util-is |
| dingbat-to-unicode | 1.0.1 | BSD-2-Clause | https://github.com/mwilliamson/dingbat-to-unicode |
| duck | 0.1.12 | BSD | https://github.com/mwilliamson/duck.js |
| immediate | 3.0.6 | MIT | git://github.com/calvinmetcalf/immediate |
| inherits | 2.0.4 | ISC | git://github.com/isaacs/inherits |
| isarray | 1.0.0 | MIT | git://github.com/juliangruber/isarray |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) | https://github.com/Stuk/jszip |
| lie | 3.3.0 | MIT | https://github.com/calvinmetcalf/lie |
| lop | 0.4.2 | BSD-2-Clause | https://github.com/mwilliamson/lop |
| mammoth | 1.12.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| option | 0.2.4 | BSD-2-Clause | https://github.com/mwilliamson/node-options |
| pako | 1.0.11 | (MIT AND Zlib) | nodeca/pako |
| path-is-absolute | 1.0.1 | MIT | sindresorhus/path-is-absolute |
| process-nextick-args | 2.0.1 | MIT | https://github.com/calvinmetcalf/process-nextick-args |
| readable-stream | 2.3.8 | MIT | git://github.com/nodejs/readable-stream |
| safe-buffer | 5.1.2 | MIT | git://github.com/feross/safe-buffer |
| setimmediate | 1.0.5 | MIT | YuzuJS/setImmediate |
| sprintf-js | 1.0.3 | BSD-3-Clause | https://github.com/alexei/sprintf.js |
| string_decoder | 1.1.1 | MIT | git://github.com/nodejs/string_decoder |
| underscore | 1.13.8 | MIT | git://github.com/jashkenas/underscore |
| util-deprecate | 1.0.2 | MIT | git://github.com/TooTallNate/util-deprecate |
| xmlbuilder | 10.1.1 | MIT | git://github.com/oozcitak/xmlbuilder-js |

Ghi chú: `jszip` được cấp theo "MIT OR GPL-3.0-or-later"; ứng dụng sử dụng theo giấy phép MIT.
