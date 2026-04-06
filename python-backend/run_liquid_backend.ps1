$port = 8001
$connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($connection) {
    Stop-Process -Id $connection.OwningProcess -Force
    Start-Sleep -Milliseconds 500
}

$env:LIQUID_EDUTWIN_PORT = "$port"
if (-not $env:LM_STUDIO_BASE_URL) {
    $env:LM_STUDIO_BASE_URL = "http://192.168.9.162:1234"
}
if (-not $env:LIQUID_MODEL) {
    $env:LIQUID_MODEL = "auto"
}

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $pythonCmd) {
    Write-Error "Python is not available in PATH. Install Python or add it to PATH."
    exit 1
}

& $pythonCmd.Source liquid_main.py
