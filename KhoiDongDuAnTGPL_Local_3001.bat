@echo off
setlocal
title Khoi dong du an TGPL - Backend 3001 va giao dien 8080

set "DATABASE_URL="
set "DOTENV_CONFIG_PATH="
set "HOST=127.0.0.1"
set "TGPL_LAN_MODE=0"
set "PORT=3001"
set "OLLAMA_URL=http://127.0.0.1:11434"
set "OLLAMA_MODEL=qwen3:4b-instruct"

echo Kiem tra backend cu tren cong 3001...
powershell -NoProfile -Command "try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 3; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
    echo Backend 3001 dang chay. De tranh dung nham backend cu, hay dong cua so backend dang mo roi chay lai file nay.
    pause
    exit /b 1
)

echo Kiem tra model Ollama va lam nong model truoc khi khoi dong...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0KiemTraSanSangOllama.ps1"
if errorlevel 1 (
    echo Ollama hoac model khong san sang. Khong khoi dong ung dung de tranh chatbot tra loi khi chua co model.
    pause
    exit /b 1
)

echo Khoi dong backend khong chay migration...
start "TGPL Backend 3001" /min cmd /k "cd /d D:\DuAnTGPL\backend && set PORT=3001&& npm start"

set "BACKEND_READY="
for /L %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2; exit 0 } catch { exit 1 }"
    if not errorlevel 1 set "BACKEND_READY=1"
    if defined BACKEND_READY goto backend_ready
    timeout /t 2 /nobreak >nul
)
echo Backend chua san sang tren cong 3001. Hay xem cua so backend de biet loi khoi dong.
pause
exit /b 1

:backend_ready
echo Backend da san sang. Kiem tra giao dien 8080...
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -TimeoutSec 3; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    start "TGPL Giao dien 8080" /min cmd /k "cd /d D:\DuAnTGPL\hoinghitaphuandongnai && set PORT=8080&& npm start"
    timeout /t 3 /nobreak >nul
)

start "" "http://localhost:8080/login.html"
echo Hoan tat. Model Qwen da duoc nap; backend duoc khoi dong ma khong chay lai migration.
endlocal
