# Starts the whole store on this machine: the API (back) and the storefront (front),
# each in its own window so both logs are visible side by side, then opens the browser.
# Local demo data only. Close the two windows to stop everything.
#
#   Double-click run-local.cmd, or:  powershell -ExecutionPolicy Bypass -File .\run-local.ps1

$root = $PSScriptRoot
$jdk = "$env:USERPROFILE\.lupin-tools\jdk21"

foreach ($port in 8080, 5173) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $port is already in use. The store may already be running: http://localhost:5173" -ForegroundColor Yellow
        Write-Host "Close the window that is using it (or restart the computer) and run this again."
        return
    }
}
if (-not (Test-Path "$jdk\bin\java.exe")) {
    Write-Host "Java was not found in $jdk. Install JDK 21 there or set JAVA_HOME before starting the back end." -ForegroundColor Red
    return
}
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Host "Installing the storefront's packages (first run only)..."
    Push-Location "$root\frontend"; npm install; Pop-Location
}

$back = "`$host.UI.RawUI.WindowTitle = 'LUPIN back (API :8080)'; `$env:JAVA_HOME = '$jdk'; `$env:PATH = '$jdk\bin;' + `$env:PATH; " +
        "Set-Location '$root\backend'; .\mvnw.cmd -B -ntp spring-boot:test-run '-Dspring-boot.run.main-class=store.lupinwear.LocalDevServer'"
$front = "`$host.UI.RawUI.WindowTitle = 'LUPIN front (storefront :5173)'; Set-Location '$root\frontend'; npm run dev"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $back
Start-Process powershell -ArgumentList "-NoExit", "-Command", $front

Write-Host "Starting the back end (this takes about a minute the first time)..."
$ready = $false
foreach ($i in 1..80) {
    try {
        Invoke-WebRequest -UseBasicParsing "http://localhost:8080/actuator/health" -TimeoutSec 3 | Out-Null
        $ready = $true
        break
    } catch { Start-Sleep 3 }
}
if (-not $ready) {
    Write-Host "The back end did not start. Look at the 'LUPIN back' window for the error." -ForegroundColor Red
    Write-Host "If it stopped uncleanly last time, delete the folder backend\.localdb (demo data only) and try again."
    return
}

Write-Host ""
Write-Host "Ready." -ForegroundColor Green
Write-Host "  Store:            http://localhost:5173"
Write-Host "  Store in Arabic:  http://localhost:5173/ar"
Write-Host "  Staff dashboard:  http://localhost:5173/admin"
Write-Host "    email:    owner@lupin.local"
Write-Host "    password: in the file backend\.local-owner-password"
Start-Process "http://localhost:5173"
