$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$webuiExe = Join-Path $projectRoot '.open-webui-venv\Scripts\open-webui.exe'
$dataDir = Join-Path $projectRoot '.open-webui-data'
$secretFile = Join-Path $dataDir 'webui_secret_key.txt'

if (-not (Test-Path -LiteralPath $webuiExe)) {
    throw 'Open WebUI is not installed in the local environment.'
}
$existing = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host 'Open WebUI is already available at http://127.0.0.1:3002'
    exit 0
}
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $secretFile)) {
    $secretBytes = [byte[]]::new(32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($secretBytes)
    $rng.Dispose()
    [System.IO.File]::WriteAllText($secretFile, [Convert]::ToBase64String($secretBytes))
}

$env:DATA_DIR = $dataDir
$env:WEBUI_SECRET_KEY = (Get-Content -LiteralPath $secretFile -Raw).Trim()
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
$env:RAG_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
$env:RAG_EMBEDDING_ENGINE = 'ollama'
$env:RAG_EMBEDDING_MODEL = 'bge-m3:latest'
Set-Location -LiteralPath $projectRoot
& $webuiExe serve --host 127.0.0.1 --port 3002
exit $LASTEXITCODE
