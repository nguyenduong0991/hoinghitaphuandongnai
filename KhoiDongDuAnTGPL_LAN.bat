@echo off
title Khoi dong du an TGPL - Mang noi bo LAN
set "DATABASE_URL="
set "DOTENV_CONFIG_PATH="
set "HOST=0.0.0.0"
set "TGPL_LAN_MODE=1"
set "OLLAMA_URL=http://127.0.0.1:11434"
set "OLLAMA_MODEL=qwen3:4b-instruct"
echo Dang kiem tra Ollama va mo hinh Qwen...
powershell -NoProfile -Command "try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    where ollama >nul 2>&1
    if errorlevel 1 (
        echo Khong tim thay Ollama. Hay cai Ollama truoc khi dung chatbot.
        pause
        exit /b 1
    )
    start "TGPL Ollama AI" /min cmd /k "ollama serve"
)
set "OLLAMA_READY="
for /L %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { $x = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2; if (@($x.models | Where-Object { $_.name -like 'qwen3:4b-instruct*' }).Count -gt 0) { exit 0 } else { exit 2 } } catch { exit 1 }"
    if not errorlevel 1 set "OLLAMA_READY=1"
    if defined OLLAMA_READY goto ollama_ready
    timeout /t 2 /nobreak >nul
)
echo Ollama chua san sang hoac chua co mo hinh qwen3:4b-instruct.
echo Kiem tra bang lenh: ollama list
pause
exit /b 1
:ollama_ready
echo Ollama va mo hinh Qwen da san sang.
start "TGPL Backend LAN 3001" cmd /k "cd /d D:\DuAnTGPL\backend && set PORT=3001&& npm run db:migrate:v22 && set PORT=3001&& npm start"
start "TGPL Giao dien LAN 8080" cmd /k "cd /d D:\DuAnTGPL\hoinghitaphuandongnai && set PORT=8080&& npm start"
echo.
echo Da khoi dong che do LAN. Tren cac may khac, mo http://DIA-CHI-IP-LAPTOP:8080/login.html
ipconfig | findstr /R /C:"IPv4 Address"
pause
