@echo off
title Khoi dong du an TGPL - Mang noi bo LAN
set "DATABASE_URL="
set "DOTENV_CONFIG_PATH="
set "HOST=0.0.0.0"
set "TGPL_LAN_MODE=1"
start "TGPL Backend LAN 3001" cmd /k "cd /d D:\DuAnTGPL\backend && set PORT=3001&& npm start"
start "TGPL Giao dien LAN 8080" cmd /k "cd /d D:\DuAnTGPL\hoinghitaphuandongnai && set PORT=8080&& npm start"
echo.
echo Da khoi dong che do LAN. Tren cac may khac, mo http://DIA-CHI-IP-LAPTOP:8080/login.html
ipconfig | findstr /R /C:"IPv4 Address"
pause
