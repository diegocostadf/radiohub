; RadioHub Windows installer (NSIS). GPL-3.0-or-later.
; Built on Linux with makensis:  makensis -DARCH=x64 -DVERSION=0.3.0 -DSRC=<dir> -DOUT=<file> installer.nsi
; Installs per user (no admin) in %LOCALAPPDATA%\Programs\RadioHub, so updates never need elevation.

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!define APPNAME "RadioHub"
!define PUBLISHER "Diego Costa"
!define URL "https://radiohub.diegocosta.digital"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RadioHub"

Name "${APPNAME} ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\RadioHub"
InstallDirRegKey HKCU "Software\RadioHub" "InstallDir"
BrandingText "${APPNAME} ${VERSION} · ${PUBLISHER}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "Instalador do RadioHub"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© 2026 ${PUBLISHER} · GPL v3"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o RadioHub ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "O RadioHub programa o seu rádio com os drivers do CHIRP e um assistente de IA.$\r$\n$\r$\nDesenvolvido por Diego Costa · radiohub.diegocosta.digital$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_FINISHPAGE_RUN "$INSTDIR\RadioHub.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o RadioHub"
!define MUI_FINISHPAGE_LINK "Site do RadioHub e apoio via Pix"
!define MUI_FINISHPAGE_LINK_LOCATION "${URL}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "RadioHub" SecMain
  ; close a running copy (update flow) so files can be replaced
  nsExec::Exec 'taskkill /IM RadioHub.exe /T'
  Sleep 1200
  nsExec::Exec 'taskkill /IM RadioHub.exe /T /F'
  Sleep 400
  RMDir /r "$INSTDIR\resources"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar RadioHub.exe"
  CreateDirectory "$SMPROGRAMS\RadioHub"
  CreateShortcut "$SMPROGRAMS\RadioHub\RadioHub.lnk" "$INSTDIR\RadioHub.exe"
  CreateShortcut "$SMPROGRAMS\RadioHub\Desinstalar RadioHub.lnk" "$INSTDIR\Desinstalar RadioHub.exe"
  CreateShortcut "$DESKTOP\RadioHub.lnk" "$INSTDIR\RadioHub.exe"
  WriteRegStr HKCU "Software\RadioHub" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "${URL}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\RadioHub.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Desinstalar RadioHub.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM RadioHub.exe /T /F'
  Sleep 400
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\RadioHub.lnk"
  RMDir /r "$SMPROGRAMS\RadioHub"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\RadioHub"
  ; backups, logs and settings in the user profile are kept on purpose
SectionEnd
