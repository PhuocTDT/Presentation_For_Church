!macro customInit
  nsExec::Exec 'taskkill /F /IM "Presentation For Church.exe" /T'
  nsExec::Exec 'taskkill /F /IM "electron.exe" /T'
!macroend
