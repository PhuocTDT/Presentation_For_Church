!macro customInit
  ; Chỉ đóng đúng tiến trình của app. KHÔNG kill "electron.exe": lệnh đó giết cả
  ; các ứng dụng Electron khác của người dùng (VS Code, Discord, ...).
  nsExec::Exec 'taskkill /F /IM "Presentation For Church.exe" /T'
!macroend
