@echo off
setlocal EnableExtensions
title Building mxtp
cd /d "%~dp0"

echo.
echo  ==============================
echo    Building mxtp for Windows
echo  ==============================
echo.

rem ---------- 1. Make sure Node.js is available ----------
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js isn't installed yet. Installing it now with winget...
  echo  ^(Windows may ask for permission - click Yes.^)
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Couldn't install Node.js automatically.
  echo  Please install the LTS version from https://nodejs.org then run build.bat again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo  Using Node.js %%v
echo.

rem ---------- 2. Download what the app needs ----------
echo  [1/2] Downloading app components (first time takes a few minutes)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

rem ---------- 3. Build ----------
echo.
echo  [2/2] Building mxtp.exe and the installer...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win
if errorlevel 1 (
  echo.
  echo  Retrying with a simpler build...
  call npx electron-builder --win -c.win.signAndEditExecutable=false
  if errorlevel 1 goto :fail
)

rem ---------- 4. Collect the results ----------
if not exist out mkdir out
copy /y "dist\mxtp.exe" "out\mxtp.exe" >nul 2>nul
copy /y "dist\mxtp-Setup.exe" "out\mxtp-Setup.exe" >nul 2>nul

rem ---------- Tidy up: the build tools and temporary files take ~700 MB; the app in "out" doesn't need them ----------
echo.
echo  Cleaning up build files...
if exist dist rmdir /s /q dist
if exist node_modules rmdir /s /q node_modules

echo.
echo  ==============================
echo    Done!
echo  ==============================
echo   out\mxtp.exe        - runs straight away, no install needed
echo   out\mxtp-Setup.exe  - installs it with Start menu + desktop shortcuts
echo.
echo  Windows may show "Windows protected your PC" the first time:
echo  click "More info" then "Run anyway".
echo.
start "" "%~dp0out"
pause
exit /b 0

:fail
echo.
echo  Something went wrong while building. Scroll up to see the error,
echo  or copy it into the chat with Claude.
echo.
pause
exit /b 1
