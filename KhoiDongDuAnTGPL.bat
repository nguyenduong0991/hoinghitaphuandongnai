@echo off
set "DATABASE_URL="
set "DOTENV_CONFIG_PATH="
set "HOST=127.0.0.1"
set "TGPL_LAN_MODE=0"
start "TGPL Backend 3001" cmd /k "cd /d D:\DuAnTGPL\backend && set PORT=3001&& npm start"
start "TGPL Giao dien 8080" cmd /k "cd /d D:\DuAnTGPL\hoinghitaphuandongnai && set PORT=8080&& npm start"
timeout /t 6 /nobreak >nul
start "" "http://localhost:8080/login.html"
