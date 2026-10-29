@echo off
setlocal
title TGPL - Ket noi Quick Tunnel voi GitHub Pages
cd /d "%~dp0"
echo Dang kich hoat backend Quick Tunnel va cap nhat API cho GitHub Pages...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0KichHoatQuickTunnel_GitHub.ps1"
set "RUN_EXIT=%ERRORLEVEL%"
echo.
if not "%RUN_EXIT%"=="0" (
  echo KICH HOAT THAT BAI. Xem thong bao va log cloudflared trong thu muc TEMP.
) else (
  echo Quick Tunnel da ket thuc.
)
pause
endlocal & exit /b %RUN_EXIT%
