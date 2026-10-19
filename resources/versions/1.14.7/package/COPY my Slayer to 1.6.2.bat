@echo off
rem Copies your Slayer between Dauntless 1.6.2 and 1.14.7 (a copy: the other save is only read). Close both games first.
cd /d "%~dp0"
set "NODE="
for /f "usebackq delims=" %%n in (`powershell -NoProfile -Command "try { (Get-Content config.json -Raw | ConvertFrom-Json).Node } catch { }"`) do set "NODE=%%n"
if not defined NODE set "NODE=node"
if not exist "%NODE%" set "NODE=node"
"%NODE%" tools\slayer-copy.js to-162 --dry
if errorlevel 1 goto end
echo.
choice /c YN /m "Copy now"
if errorlevel 2 goto end
"%NODE%" tools\slayer-copy.js to-162
:end
echo.
pause
