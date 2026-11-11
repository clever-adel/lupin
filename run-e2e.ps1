# Runs every browser test against a throwaway copy of the store:
# its own fresh demo database (backend/.e2e-db), API on :8090, storefront on :5183.
# The everyday local store on :8080 / :5173 can stay open; it is not touched.
#
#   powershell -ExecutionPolicy Bypass -File .\run-e2e.ps1            (all tests)
#   powershell -ExecutionPolicy Bypass -File .\run-e2e.ps1 admin      (only files matching "admin")

param([string]$Filter = "")

$root = $PSScriptRoot
$jdk = "$env:USERPROFILE\.lupin-tools\jdk21"
if (Test-Path "$jdk\bin\java.exe") { $env:JAVA_HOME = $jdk; $env:PATH = "$jdk\bin;$env:PATH" }

foreach ($port in 8090, 5183) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $port is in use. Another test run may still be going; close it first." -ForegroundColor Yellow
        exit 1
    }
}
Remove-Item -Recurse -Force "$root\backend\.e2e-db" -ErrorAction SilentlyContinue

$env:LUPIN_LOCAL_DB = ".e2e-db"
$env:PORT = "8090"
New-Item -ItemType Directory -Force "$root\backend\target" | Out-Null
$api = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory "$root\backend" -FilePath "$root\backend\mvnw.cmd" `
    -ArgumentList "-B", "-ntp", "spring-boot:test-run", "-Dspring-boot.run.main-class=store.lupinwear.LocalDevServer" `
    -RedirectStandardOutput "$root\backend\target\e2e-api.log" -RedirectStandardError "$root\backend\target\e2e-api.err.log"
$env:PORT = $null
$env:CLOUDFLARE_ENV = "e2e"
$web = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory "$root\frontend" -FilePath "$root\frontend\node_modules\.bin\react-router.cmd" `
    -ArgumentList "dev", "--port", "5183", "--strictPort" `
    -RedirectStandardOutput "$root\frontend\test-results-e2e-web.log" -RedirectStandardError "$root\frontend\test-results-e2e-web.err.log"

function Stop-Tree($process) {
    if ($process -and -not $process.HasExited) { & taskkill /PID $process.Id /T /F 2>$null | Out-Null }
}

try {
    $ready = $false
    foreach ($i in 1..80) {
        try {
            Invoke-WebRequest -UseBasicParsing "http://localhost:8090/actuator/health" -TimeoutSec 3 | Out-Null
            Invoke-WebRequest -UseBasicParsing "http://localhost:5183/robots.txt" -TimeoutSec 10 | Out-Null
            $ready = $true
            break
        } catch { Start-Sleep 3 }
    }
    if (-not $ready) {
        Write-Host "The test stack did not start. See backend\target\e2e-api.log and frontend\test-results-e2e-web.log" -ForegroundColor Red
        exit 1
    }
    Set-Location "$root\frontend"
    $env:E2E_BASE_URL = "http://localhost:5183"
    if ($Filter) { npx playwright test $Filter } else { npx playwright test }
    $code = $LASTEXITCODE
} finally {
    Stop-Tree $web
    Stop-Tree $api
    # The embedded PostgreSQL outlives its parent when the tree is killed; stop the one that serves the test database.
    Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -match '\.e2e-db' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Set-Location $root
}
exit $code
