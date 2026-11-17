; Pigmento's installer additions: an "Open with" entry for common image formats (for the current
; user only), without changing which app opens them by default. Removed again on uninstall. And a
; question before installing over a Pigmento that's already there.

!include "LogicLib.nsh"
!include "WordFunc.nsh"

; The one-click installer would quietly install over an existing Pigmento. Ask first: update, reinstall
; the same version, or go back to an older one (No cancels and changes nothing). Silent installs (/S)
; don't ask. Settings, brushes, shapes and palettes in %APPDATA%\Pigmento are always kept.
!macro customInit
  ${IfNot} ${Silent}
    ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    StrCpy $R3 "$\r$\n$\r$\nYour settings, brushes, shapes and palettes are kept."
    ${If} $R0 != ""
      ${VersionCompare} "$R0" "${VERSION}" $R2
      ${If} $R2 == 0
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Pigmento ${VERSION} is already installed.$\r$\n$\r$\nReinstall it?$R3" IDYES pigmentoGoOn
      ${ElseIf} $R2 == 2
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Pigmento $R0 is installed.$\r$\n$\r$\nUpdate it to version ${VERSION}?$R3" IDYES pigmentoGoOn
      ${Else}
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "A newer Pigmento ($R0) is installed.$\r$\n$\r$\nReplace it with the older version ${VERSION}?$R3" IDYES pigmentoGoOn
      ${EndIf}
      Quit
    ${ElseIf} $R1 != ""
    ${AndIf} ${FileExists} "$R1\${APP_EXECUTABLE_FILENAME}"
      ; Installed, but its version wasn't recorded.
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Pigmento is already installed.$\r$\n$\r$\nReinstall it with version ${VERSION}?$R3" IDYES pigmentoGoOn
      Quit
    ${EndIf}
    pigmentoGoOn:
  ${EndIf}
!macroend

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
  ; .pigm is Pigmento's own format, so its registration goes too (the builder only removes the type).
  DeleteRegKey HKCU "Software\Classes\.pigm"
  DeleteRegKey HKCU "Software\Classes\Pigmento.Project"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
