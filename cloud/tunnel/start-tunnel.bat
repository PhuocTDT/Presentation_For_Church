@echo off
REM Chạy Named Tunnel cố định cho Kênh Band — thay cho Quick Tunnel (URL đổi
REM mỗi lần chạy). Domain cố định: https://blessing.worship-official.link
REM Yêu cầu: đã "cloudflared tunnel login" + "cloudflared tunnel create blessing-band"
REM một lần trên máy này (xem docs/data-contracts.md, mục Kênh Band -> Named Tunnel).
REM Cấu hình đọc từ %USERPROFILE%\.cloudflared\config.yml (mặc định của cloudflared).
cloudflared tunnel run blessing-band
