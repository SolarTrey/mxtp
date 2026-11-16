; Themed installer for mxtp: the welcome and finish pages use the same theme you've set in the app
; (Light, Evening Purple / Amber / Both, or Midnight). A fresh install uses the app's default look.
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var ThemeKey
Var ThemeHay
Var ThemeNeedle
Var ThemeFound

; ThemeFound = 1 when ThemeNeedle appears anywhere in ThemeHay
Function themeHas
  Push $0
  Push $1
  Push $2
  StrCpy $ThemeFound 0
  StrLen $1 $ThemeNeedle
  StrCpy $0 0
  loop:
    StrCpy $2 $ThemeHay $1 $0
    StrCmp $2 "" done
    StrCmp $2 $ThemeNeedle 0 +3
      StrCpy $ThemeFound 1
      Goto done
    IntOp $0 $0 + 1
    Goto loop
  done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro themeCheck NEEDLE VALUE
  StrCpy $ThemeNeedle '${NEEDLE}'
  Call themeHas
  ${If} $ThemeFound == 1
    StrCpy ${VALUE}
  ${EndIf}
!macroend

; read the theme from the app's settings file
Function themeRead
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $ThemeKey "midnight"
  StrCpy $3 "both"
  ReadEnvStr $0 APPDATA
  ClearErrors
  FileOpen $1 "$0\mxtp\settings.json" r
  IfErrors done
  readloop:
    ClearErrors
    FileRead $1 $2
    IfErrors close
    StrCpy $ThemeHay $2
    !insertmacro themeCheck '"rdio": "light"' '$ThemeKey "light"'
    !insertmacro themeCheck '"rdio": "evening"' '$ThemeKey "evening"'
    !insertmacro themeCheck '"rdio": "midnight"' '$ThemeKey "midnight"'
    !insertmacro themeCheck '"eveningTone": "purple"' '$3 "purple"'
    !insertmacro themeCheck '"eveningTone": "amber"' '$3 "amber"'
    !insertmacro themeCheck '"eveningTone": "both"' '$3 "both"'
    Goto readloop
  close:
  FileClose $1
  done:
  ${If} $ThemeKey == "evening"
    StrCpy $ThemeKey "evening-$3"
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; before the welcome page draws, swap in the picture for that theme (the finish page reuses it)
Function themeWelcomePre
  ${If} $ThemeKey == "light"
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\sidebar-light.bmp"
  ${ElseIf} $ThemeKey == "evening-purple"
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\sidebar-evening-purple.bmp"
  ${ElseIf} $ThemeKey == "evening-amber"
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\sidebar-evening-amber.bmp"
  ${ElseIf} $ThemeKey == "evening-both"
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\sidebar-evening-both.bmp"
  ${Else}
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\sidebar-midnight.bmp"
  ${EndIf}
FunctionEnd
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call themeRead
  !endif
!macroend

!macro customWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_PRE themeWelcomePre
  !define MUI_WELCOMEPAGE_TITLE "Welcome to mxtp"
  !define MUI_WELCOMEPAGE_TEXT "mxtp is a player for the music on your own drives, in the spirit of Rdio.$\r$\n$\r$\nIf mxtp is already installed, this updates it and keeps your music, settings and playlists.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend
