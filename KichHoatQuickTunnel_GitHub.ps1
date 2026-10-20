$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$apiConfigPath = Join-Path $projectRoot "assets\js\config.js"
$apiConfigRelative = "assets/js/config.js"
$githubOrigin = "https://nguyenduong0991.github.io"
$githubPage = "$githubOrigin/hoinghitaphuandongnai/"
$repoUrl = "https://github.com/nguyenduong0991/hoinghitaphuandongnai.git"
$stdoutPath = Join-Path $env:TEMP "tgpl-cloudflared-$PID-out.log"
$stderrPath = Join-Path $env:TEMP "tgpl-cloudflared-$PID-err.log"
$tunnelProcess = $null

function Stop-Tunnel {
    if ($script:tunnelProcess -and -not $script:tunnelProcess.HasExited) {
        Stop-Process -Id $script:tunnelProcess.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Quick Tunnel da dung." -ForegroundColor Yellow
    }
    Remove-Item -LiteralPath $script:stdoutPath,$script:stderrPath -Force -ErrorAction SilentlyContinue
}

try {
    $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    $cloudflaredPath = if ($cloudflared) { $cloudflared.Source } else { $null }
    if (-not $cloudflaredPath) {
        $candidates = @(
            (Join-Path $projectRoot "cloudflared.exe"),
            (Join-Path $env:USERPROFILE "Downloads\cloudflared.exe"),
            (Join-Path $env:USERPROFILE "Downloads\cloudflared-windows-amd64.exe"),
            (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"),
            (Join-Path $env:LOCALAPPDATA "Programs\cloudflared\cloudflared.exe"),
            (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\cloudflared.exe")
        )
        $cloudflaredPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $cloudflaredPath) {
        throw "Khong tim thay cloudflared.exe. Hay dat cloudflared.exe cung thu muc du an hoac cai Cloudflare Tunnel roi chay lai file nay."
    }

    foreach ($url in @("http://127.0.0.1:3001/api/health", "http://127.0.0.1:8080/")) {
        try { $null = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing }
        catch { throw "Dich vu chua san sang tai $url. Hay chay KhoiDongDuAnTGPL.bat va doi backend/giao dien khoi dong xong." }
    }

    $branch = (& git -C $projectRoot branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne "main") { throw "Du an khong o nhanh main. Khong cap nhat GitHub de tranh day nham nhanh." }
    $remote = (& git -C $projectRoot remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $remote -ne $repoUrl) { throw "Git remote origin khong phai repository GitHub cua du an." }
    $configStatus = & git -C $projectRoot status --porcelain -- $apiConfigRelative
    if ($LASTEXITCODE -ne 0) { throw "Khong kiem tra duoc trang thai config.js." }
    if ($configStatus) { throw "assets/js/config.js dang co thay doi chua dong bo. Hay luu/hoan tac thay doi file nay truoc khi kich hoat tunnel." }
    $aheadBehind = (& git -C $projectRoot rev-list --left-right --count origin/main...HEAD).Trim() -split '\s+'
    if ($LASTEXITCODE -ne 0 -or $aheadBehind.Count -ne 2 -or $aheadBehind[1] -ne "0") {
        throw "Nhanh main dang co commit chua dong bo len GitHub. Hay dong bo truoc de file tunnel khong day kem commit khac."
    }

    Write-Host "Dang mo Quick Tunnel den backend localhost:3001..." -ForegroundColor Cyan
    $tunnelProcess = Start-Process -FilePath $cloudflaredPath `
        -ArgumentList @("tunnel", "--url", "http://127.0.0.1:3001", "--no-autoupdate") `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $tunnelUrl = $null
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
        if ($tunnelProcess.HasExited) { throw "cloudflared da dung som. Hay xem thong bao loi ben duoi." }
        foreach ($logPath in @($stdoutPath, $stderrPath)) {
            if (Test-Path -LiteralPath $logPath) {
                $logText = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
                if (-not [string]::IsNullOrWhiteSpace($logText)) {
                    $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com', 'IgnoreCase')
                    if ($match.Success) { $tunnelUrl = $match.Value.TrimEnd('.') }
                }
            }
        }
        if (-not $tunnelUrl) { Start-Sleep -Seconds 1 }
    }
    if (-not $tunnelUrl) {
        foreach ($logPath in @($stdoutPath, $stderrPath)) {
            if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 15 }
        }
        throw "Chua nhan duoc dia chi trycloudflare.com sau 60 giay."
    }

    $apiUrl = "$tunnelUrl/api"
    $healthReady = $false
    $healthDeadline = (Get-Date).AddSeconds(60)
    $lastHealthError = ""
    while ((Get-Date) -lt $healthDeadline -and -not $healthReady) {
        if ($tunnelProcess.HasExited) { throw "Quick Tunnel da dung truoc khi API san sang." }
        try {
            $null = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 8
            $healthReady = $true
        } catch {
            $lastHealthError = $_.Exception.Message
            Start-Sleep -Seconds 2
        }
    }
    if (-not $healthReady) { throw "Quick Tunnel da mo nhung API chua truy cap duoc sau 60 giay: $lastHealthError" }
    $preflight = Invoke-WebRequest -Uri "$apiUrl/health" -Method Options -TimeoutSec 15 -UseBasicParsing -Headers @{
        Origin = $githubOrigin
        "Access-Control-Request-Method" = "GET"
        "Access-Control-Request-Headers" = "content-type"
    }
    if ($preflight.Headers["Access-Control-Allow-Origin"] -ne $githubOrigin) {
        throw "Backend chua cho phep ket noi tu $githubOrigin. Kiem tra ALLOWED_ORIGINS trong backend/.env.demo."
    }

    $configText = [IO.File]::ReadAllText($apiConfigPath)
    $endpointPattern = 'https://[a-z0-9-]+\.trycloudflare\.com/api'
    $endpointMatches = [regex]::Matches($configText, $endpointPattern, 'IgnoreCase')
    if ($endpointMatches.Count -ne 1) { throw "Khong tim thay duy nhat mot cau hinh Quick Tunnel trong assets/js/config.js." }
    $updatedConfig = [regex]::Replace($configText, $endpointPattern, $apiUrl, 'IgnoreCase')
    [IO.File]::WriteAllText($apiConfigPath, $updatedConfig, [Text.UTF8Encoding]::new($false))

    & git -C $projectRoot add -- $apiConfigRelative
    if ($LASTEXITCODE -ne 0) { throw "Khong the chuan bi cap nhat dia chi API." }
    & git -C $projectRoot commit -m "Update temporary Quick Tunnel API endpoint" -- $apiConfigRelative
    if ($LASTEXITCODE -ne 0) { throw "Khong tao duoc commit cap nhat API. Quick Tunnel van dang mo: $tunnelUrl" }
    & git -C $projectRoot push origin main
    if ($LASTEXITCODE -ne 0) { throw "Khong day duoc cau hinh len GitHub. Quick Tunnel van dang mo: $tunnelUrl. Kiem tra dang nhap GitHub/Git Credential Manager roi chay lai." }

    Write-Host "Quick Tunnel API: $apiUrl" -ForegroundColor Green
    Write-Host "Da cap nhat rieng assets/js/config.js len GitHub; cac file dang sua khac khong bi commit." -ForegroundColor Green
    Write-Host "Dang cho GitHub Pages cap nhat cau hinh..." -ForegroundColor Cyan
    $published = $false
    $deployDeadline = (Get-Date).AddSeconds(120)
    $configProbe = "${githubPage}assets/js/config.js?quick-tunnel=$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
    while ((Get-Date) -lt $deployDeadline -and -not $published) {
        try {
            $remoteConfig = (Invoke-WebRequest -Uri $configProbe -TimeoutSec 10 -UseBasicParsing).Content
            if ($remoteConfig.Contains($apiUrl)) { $published = $true }
        } catch { }
        if (-not $published) { Start-Sleep -Seconds 5 }
    }
    if ($published) {
        Write-Host "GitHub Pages da nhan API moi. Mo trang cong khai tai: $githubPage" -ForegroundColor Green
    } else {
        Write-Host "GitHub Pages chua cap nhat xong. Cho Actions hoan tat, sau do tai lai trang bang Ctrl+F5: $githubPage" -ForegroundColor Yellow
    }
    Start-Process $githubPage
    Write-Host "Giu cua so nay mo de duy tri tunnel. Nhan Ctrl+C de dung Quick Tunnel." -ForegroundColor Yellow
    while (-not $tunnelProcess.HasExited) { Start-Sleep -Seconds 2 }
    throw "Quick Tunnel da ket thuc."
}
catch {
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        Write-Host "Tunnel se dung khi file nay dong. Kiem tra loi tren truoc khi thu lai." -ForegroundColor Yellow
    }
}
finally {
    Stop-Tunnel
}
