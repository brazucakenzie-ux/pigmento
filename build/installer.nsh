; Pigmento's installer additions: an "Open with" entry for common image formats (for the current
; user only), without changing which app opens them by default. Removed again on uninstall.

!macro PigmentoOpenWith EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Pigmento.Image" ""
!macroend

!macro PigmentoRemoveOpenWith EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Pigmento.Image"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\Pigmento.Image" "" "Image"
  WriteRegStr HKCU "Software\Classes\Pigmento.Image" "FriendlyTypeName" "Image"
  WriteRegStr HKCU "Software\Classes\Pigmento.Image\DefaultIcon" "" "$INSTDIR\Pigmento.exe,0"
  WriteRegStr HKCU "Software\Classes\Pigmento.Image\shell\open\command" "" '"$INSTDIR\Pigmento.exe" "%1"'
  ; Listed as an app that can open images (shows in "Open with" with its name and icon).
  WriteRegStr HKCU "Software\Classes\Applications\Pigmento.exe" "FriendlyAppName" "Pigmento"
  WriteRegStr HKCU "Software\Classes\Applications\Pigmento.exe\shell\open\command" "" '"$INSTDIR\Pigmento.exe" "%1"'
  !insertmacro PigmentoOpenWith "png"
  !insertmacro PigmentoOpenWith "jpg"
  !insertmacro PigmentoOpenWith "jpeg"
  !insertmacro PigmentoOpenWith "bmp"
  !insertmacro PigmentoOpenWith "gif"
  !insertmacro PigmentoOpenWith "webp"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  !insertmacro PigmentoRemoveOpenWith "png"
  !insertmacro PigmentoRemoveOpenWith "jpg"
  !insertmacro PigmentoRemoveOpenWith "jpeg"
  !insertmacro PigmentoRemoveOpenWith "bmp"
  !insertmacro PigmentoRemoveOpenWith "gif"
  !insertmacro PigmentoRemoveOpenWith "webp"
  DeleteRegKey HKCU "Software\Classes\Pigmento.Image"
  DeleteRegKey HKCU "Software\Classes\Applications\Pigmento.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
