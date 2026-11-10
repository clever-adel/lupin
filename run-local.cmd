@echo off
rem Double-click to start the store locally (back end + storefront). See run-local.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local.ps1"
pause
