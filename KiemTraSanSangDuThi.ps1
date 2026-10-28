$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = "D:\DuAnTGPL\backend"
$publicSite = "https://nguyenduong0991.github.io/hoinghitaphuandongnai/"
$localConfigPath = Join-Path $projectRoot "assets\js\config.js"
$localConfig = Get-Content -Raw -LiteralPath $localConfigPath
$passed = 0
$failed = 0

function Pass([string]$Message) { Write-Host "[DAT] $Message" -ForegroundColor Green; $script:passed++ }
function Fail([string]$Message) { Write-Host "[CHUA DAT] $Message" -ForegroundColor Red; $script:failed++ }
function Test-TcpPort([string]$HostName, [int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $task = $client.ConnectAsync($HostName, $Port); return $task.Wait(2000) -and $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
function Get-Json([string]$Url) {
    return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 8 -Headers @{ "Cache-Control" = "no-cache" }
}
function Check-ApiServices([string]$BaseUrl, [string]$Label) {
    $health = Get-Json "$BaseUrl/api/health"
    if ($health.success -ne $true) { throw "${Label}: /api/health không báo success." }
    $services = Get-Json "$BaseUrl/api/health/services"
    if ($services.services.backend.ready -ne $true) { throw "${Label}: backend chưa sẵn sàng." }
    if ($services.services.ollama.ready -ne $true) { throw "${Label}: Ollama/model trả lời chưa sẵn sàng." }
    if ($services.services.ollama.model -ne "qwen3:4b-instruct") { throw "${Label}: model đang dùng không phải qwen3:4b-instruct." }
    return $services
}

Write-Host "=== KIỂM TRA SẴN SÀNG TRƯỚC KHI MỞ QUICK TUNNEL ===" -ForegroundColor Cyan
Write-Host "Không hiển thị hoặc đọc mật khẩu, token hay khóa bí mật."

# Frontend local
try {
    $front = Invoke-WebRequest -Uri "http://127.0.0.1:8080/" -TimeoutSec 5
    if ($front.StatusCode -ne 200) { throw "Frontend trả HTTP $($front.StatusCode)." }
    $servedConfig = (Invoke-WebRequest -Uri "http://127.0.0.1:8080/assets/js/config.js?preflight=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 5).Content
    $normalizeLines = { param($Text) ([string]$Text -replace "`r`n?", "`n").Trim() }
    if ((&$normalizeLines $servedConfig) -ne (&$normalizeLines $localConfig)) { throw "Frontend trên cổng 8080 không phục vụ config.js của thư mục dự án hiện tại." }
    Pass "Frontend local hoạt động tại cổng 8080."
} catch { Fail "Frontend local: $($_.Exception.Message)" }

# Backend service identity and freshness
try {
    if (-not (Test-TcpPort "127.0.0.1" 3001)) { throw "Không có dịch vụ lắng nghe cổng 3001." }
    $listener = Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object -First 1
    $backendProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $backendProcess -or $backendProcess.CommandLine -notmatch "src[\\/]server\.js") {
        throw "Tiến trình cổng 3001 không xác minh được là backend Node chạy src/server.js."
    }
    $parentCommand = ""
    $parentId = [int]$backendProcess.ParentProcessId
    for ($i = 0; $i -lt 4 -and $parentId -gt 0; $i++) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
        if (-not $parent) { break }
        $parentCommand += " $($parent.CommandLine)"
        $parentId = [int]$parent.ParentProcessId
    }
    if (($backendProcess.CommandLine + $parentCommand) -notmatch [regex]::Escape($backendRoot)) {
        throw "Không xác minh được backend đang chạy từ $backendRoot."
    }
    $started = (Get-Process -Id $listener.OwningProcess).StartTime
    $latestSource = Get-ChildItem "$backendRoot\src" -Recurse -File -Filter "*.js" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestSource -and $started -lt $latestSource.LastWriteTime) {
        throw "Backend khởi động trước lần sửa mã mới nhất ($($latestSource.Name)); hãy khởi động lại backend rồi chạy kiểm tra lại."
    }
    Pass "Backend cổng 3001 đúng tiến trình/thư mục và đã nạp mã mới nhất trên đĩa."
} catch { Fail "Backend: $($_.Exception.Message)" }

# PostgreSQL
if (Test-TcpPort "127.0.0.1" 5432) { Pass "PostgreSQL đang lắng nghe cổng 5432." }
else { Fail "Không kết nối được PostgreSQL tại cổng 5432." }

# Local API and model readiness
$localServices = $null
try {
    $localServices = Check-ApiServices "http://127.0.0.1:3001" "API local"
    Pass "API local health đạt; backend báo model qwen3:4b-instruct sẵn sàng."
} catch { Fail "API/Ollama local: $($_.Exception.Message)" }

# GitHub source and deployed public frontend
$tunnelDefault = ""
$configuredMatch = [regex]::Match($localConfig, "https://[A-Za-z0-9-]+\.trycloudflare\.com/api")
if ($configuredMatch.Success) { $tunnelDefault = $configuredMatch.Value -replace "/api$", "" }
$inputTunnel = Read-Host "Nhập URL gốc Quick Tunnel (Enter để dùng URL trong config.js: $tunnelDefault)"
$tunnel = if ([string]::IsNullOrWhiteSpace($inputTunnel)) { $tunnelDefault } else { $inputTunnel.Trim().TrimEnd("/") -replace "/api$", "" }

try {
    if (-not $tunnel -or $tunnel -notmatch "^https://[A-Za-z0-9.-]+\.trycloudflare\.com$") {
        throw "URL tunnel không hợp lệ; cần dạng https://<tên>.trycloudflare.com."
    }
    $configuredOrigin = if ($configuredMatch.Success) { $configuredMatch.Value -replace "/api$", "" } else { "" }
    if ($configuredOrigin -ne $tunnel) { throw "Tunnel nhập vào khác URL trong assets/js/config.js. Hãy cập nhật frontend, đồng bộ GitHub Pages rồi kiểm tra lại." }

    $gitStatus = & git -C $projectRoot status --porcelain -- . ":!KiemTraSanSangDuThi.bat" ":!KiemTraSanSangDuThi.ps1"
    if ($LASTEXITCODE -ne 0) { throw "Không kiểm tra được trạng thái Git." }
    if ($gitStatus) { throw "Còn thay đổi chưa commit trong frontend; hãy commit và push trước khi trình diễn." }
    $localCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
    $remoteLine = & git -C $projectRoot ls-remote origin refs/heads/main
    if ($LASTEXITCODE -ne 0 -or -not $remoteLine) { throw "Không kiểm tra được nhánh main trên GitHub." }
    $remoteCommit = ($remoteLine -split "\s+")[0]
    if ($localCommit -ne $remoteCommit) { throw "Frontend local chưa khớp origin/main. Local $($localCommit.Substring(0,7)); GitHub $($remoteCommit.Substring(0,7))." }
    Pass "Frontend sạch và commit local khớp origin/main ($($localCommit.Substring(0,7)))."

    $siteConfigUrl = $publicSite + "assets/js/config.js?preflight=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $siteConfig = (Invoke-WebRequest -Uri $siteConfigUrl -TimeoutSec 10 -Headers @{ "Cache-Control" = "no-cache" }).Content
    if ((&$normalizeLines $siteConfig) -ne (&$normalizeLines $localConfig)) { throw "config.js của GitHub Pages khác frontend local; hãy đợi đồng bộ trang rồi kiểm tra lại." }
    if (-not $siteConfig.Contains($tunnel)) { throw "Frontend GitHub Pages chưa trỏ API đến tunnel hiện tại; có thể trang chưa cập nhật hoặc cache chưa hết." }
    $site = Invoke-WebRequest -Uri ($publicSite + "?preflight=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -TimeoutSec 10 -Headers @{ "Cache-Control" = "no-cache" }
    if ($site.StatusCode -ne 200) { throw "Frontend công khai trả HTTP $($site.StatusCode)." }
    Pass "Frontend GitHub Pages hoạt động và cấu hình API trỏ đúng tunnel."

    $publicServices = Check-ApiServices $tunnel "API qua Quick Tunnel"
    if ($localServices -and $publicServices.services.ollama.model -ne $localServices.services.ollama.model) {
        throw "Model qua tunnel khác model API local."
    }
    Pass "API qua Quick Tunnel trả health đạt và cùng báo model như backend local."
} catch { Fail "Đồng bộ/public tunnel: $($_.Exception.Message)" }

Write-Host "`nKết quả: $passed đạt, $failed chưa đạt." -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }
Write-Host "Lưu ý: backend hiện ở thư mục riêng ngoài kho Git frontend; file này xác minh tiến trình và độ mới theo thời gian sửa mã, chưa thể đối chiếu backend với một commit Git chung." -ForegroundColor Yellow
exit 0
