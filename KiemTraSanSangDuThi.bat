@echo off
setlocal
title Kiem tra san sang mo Quick Tunnel - DuAnTGPL

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0KiemTraSanSangDuThi.ps1"
set "CHECK_EXIT=%ERRORLEVEL%"
echo.
if not "%CHECK_EXIT%"=="0" (
    echo CHUA SAN SANG. Hay xu ly cac muc KHONG DAT truoc khi mo link cho ban giam khao.
) else (
    echo DA SAN SANG kiem tra truy cap cong khai.
)
echo.
pause
exit /b %CHECK_EXIT%
