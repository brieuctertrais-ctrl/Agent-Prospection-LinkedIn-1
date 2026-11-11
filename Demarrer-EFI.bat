@echo off
setlocal
rem ============================================================
rem  EFI Prospection - demarrage en un double-clic
rem  1. demarre le tableau de bord (sauf s'il tourne deja)
rem  2. attend qu'il reponde
rem  3. ouvre Chrome sur l'Autopilote et sur LinkedIn
rem ============================================================
cd /d "%~dp0"
title EFI Prospection - demarrage

rem Port 3000 already listening? (PowerShell: works whatever the Windows language)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto ready

rem Fresh start: clear the dashboard's build cache (avoids "__webpack_modules__[moduleId] is not a function"
rem after an update). Only the cache is removed; it is rebuilt automatically, no data is touched.
if exist "apps\web\.next" rmdir /s /q "apps\web\.next"

echo.
echo  Demarrage du tableau de bord EFI Prospection...
echo  Une fenetre "EFI Prospection - tableau de bord" va s'ouvrir en bas de l'ecran :
echo  NE LA FERMEZ PAS tant que vous utilisez l'outil.
echo.
start "EFI Prospection - tableau de bord (ne pas fermer)" /min cmd /k "npm run dev:web"

set /a N=0
:wait
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:3000/login
if %errorlevel%==0 goto ready
set /a N+=1
if %N% LSS 45 goto wait
echo.
echo  Le tableau de bord met du temps a demarrer.
echo  Regardez la fenetre "EFI Prospection - tableau de bord" pour voir s'il y a une erreur.
pause
exit /b 1

:ready
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" "http://localhost:3000/autopilot" "https://www.linkedin.com/feed/"
) else (
  start "" "http://localhost:3000/autopilot"
)
echo  EFI Prospection est pret. Cette fenetre va se fermer.
timeout /t 3 /nobreak >nul
exit /b 0
