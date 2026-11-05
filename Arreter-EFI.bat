@echo off
setlocal
rem ============================================================
rem  EFI Prospection - arret du tableau de bord (port 3000)
rem  L'envoi automatique de l'extension continue tant que Chrome est ouvert.
rem ============================================================
title EFI Prospection - arret
rem Stops the process listening on port 3000 (PowerShell: works whatever the Windows language)
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { taskkill /PID $_.OwningProcess /T /F | Out-Null }; exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo  Tableau de bord arrete.
) else (
  echo  Le tableau de bord ne tournait pas.
)
timeout /t 3 /nobreak >nul
