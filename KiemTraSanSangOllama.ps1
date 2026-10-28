$ErrorActionPreference = "Stop"
$baseUrl = if ($env:OLLAMA_URL) { $env:OLLAMA_URL.TrimEnd("/") } else { "http://127.0.0.1:11434" }
$model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "qwen3:4b-instruct" }

try {
    $tags = Invoke-RestMethod -Uri "$baseUrl/api/tags" -TimeoutSec 5
} catch {
    $ollama = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollama) {
        Write-Error "Khong tim thay dich vu Ollama va khong tim thay lenh ollama."
        exit 1
    }
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "ollama serve" -WindowStyle Hidden
    $tags = $null
    for ($i = 0; $i -lt 30 -and -not $tags; $i++) {
        Start-Sleep -Seconds 2
        try { $tags = Invoke-RestMethod -Uri "$baseUrl/api/tags" -TimeoutSec 3 } catch {}
    }
    if (-not $tags) {
        Write-Error "Ollama khong san sang tren cong 11434."
        exit 1
    }
}

$installed = @($tags.models | ForEach-Object { [string]$_.name })
$hasModel = $installed | Where-Object { $_ -eq $model -or $_ -eq "${model}:latest" } | Select-Object -First 1
if (-not $hasModel) {
    Write-Error "Chua cai dung model $model. Model thay the khong duoc tu dong chon."
    exit 1
}

$body = @{
    model = $model
    messages = @(@{ role = "user"; content = "Reply with OK only." })
    stream = $false
    think = $false
    keep_alive = "30m"
    options = @{ temperature = 0; num_ctx = 512; num_predict = 1 }
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/chat" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180
    if (-not $response.message) { throw "Ollama khong tra ve phan hoi model." }
    Write-Output "Ollama san sang; da nap $model va giu model trong bo nho 30 phut."
} catch {
    Write-Error "Khong nap duoc ${model}: $($_.Exception.Message)"
    exit 1
}
