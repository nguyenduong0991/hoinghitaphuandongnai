@echo off
start "TGPL Backend" cmd /k "cd /d D:\DuAnTGPL\backend && set DOTENV_CONFIG_PATH=.env.demo && npm start"
start "TGPL Giao dien" cmd /k "cd /d D:\DuAnTGPL\hoinghitaphuandongnai && npm start"
timeout /t 6 /nobreak >nul
start "" "http://localhost:8080/login.html"
