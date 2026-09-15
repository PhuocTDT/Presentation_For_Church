@echo off
REM Chạy Named Tunnel cố định cho Kênh Band — thay cho Quick Tunnel (URL đổi
REM mỗi lần chạy). Domain cố định: https://blessing.worship-official.link
REM Yêu cầu: đã "cloudflared tunnel login" + tạo tunnel một lần trên máy này
REM (xem docs/data-contracts.md, mục Kênh Band -> Named Tunnel, hoặc dùng
REM wizard "Thiết lập domain riêng tự động" trong sidebar).
REM Cấu hình đọc từ %USERPROFILE%\.cloudflared\config.yml (mặc định của cloudflared)
REM — tên tunnel bên dưới phải khớp cfg.tunnelName trong band-comm.json.
cloudflared tunnel run blessing-church
