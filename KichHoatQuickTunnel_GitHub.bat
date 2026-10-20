@echo off
setlocal
title TGPL - Ket noi Quick Tunnel voi GitHub Pages
cd /d "%~dp0"
echo Dang kich hoat backend Quick Tunnel va cap nhat API cho GitHub Pages...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0KichHoatQuickTunnel_GitHub.ps1"
echo.
pause
endlocal
