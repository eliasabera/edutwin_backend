$connection = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($connection) {
    Stop-Process -Id $connection.OwningProcess -Force
    Start-Sleep -Milliseconds 500
}

& "C:/Program Files/Python312/python.exe" main.py