@echo off
setlocal EnableDelayedExpansion
rem ============================================================
rem  EFI Prospection - mise a jour en un double-clic
rem  - recupere les mises a jour (git pull, 4 essais en cas de coupure reseau)
rem  - npm install seulement si les dependances ont change
rem  - redeploie les fonctions IA seulement si elles ont change
rem  - reconstruit l'extension
rem  - signale les fichiers SQL a executer dans Supabase
rem  Aucune cle n'est lue ni affichee par ce script.
rem ============================================================
cd /d "%~dp0"
title EFI Prospection - mise a jour

for /f %%i in ('git rev-parse HEAD') do set "OLD=%%i"

set /a TRY=0
:pull
echo.
echo  [1/4] Recuperation des mises a jour...
git pull
if !errorlevel!==0 goto pulled
set /a TRY+=1
if !TRY! GEQ 4 (
  echo.
  echo  Impossible de joindre GitHub apres 4 essais. Verifiez votre connexion internet puis relancez.
  pause
  exit /b 1
)
echo  Coupure reseau, nouvel essai dans 5 secondes...
timeout /t 5 /nobreak >nul
goto pull

:pulled
for /f %%i in ('git rev-parse HEAD') do set "NEW=%%i"
if "!OLD!"=="!NEW!" (
  echo  Deja a jour.
)

echo.
echo  [2/4] Dependances...
git diff --quiet !OLD! !NEW! -- package-lock.json package.json apps/web/package.json apps/extension/package.json packages/shared/package.json
if !errorlevel!==1 (
  echo  Les dependances ont change : installation...
  call npm install
  set "RESTART=1"
) else (
  echo  Rien a installer.
)

echo.
echo  [3/4] Fonctions IA (Supabase)...
git diff --quiet !OLD! !NEW! -- supabase/functions
if !errorlevel!==1 (
  echo  Les fonctions IA ont change : deploiement...
  call npx supabase functions deploy --use-api --yes
  if !errorlevel! neq 0 (
    echo  Le deploiement a echoue : envoyez une capture de cette fenetre a Claude.
  )
) else (
  echo  Rien a deployer.
)

echo.
echo  [4/4] Reconstruction de l'extension...
call npm run build:ext
if !errorlevel! neq 0 (
  echo  La reconstruction a echoue : envoyez une capture de cette fenetre a Claude.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   Mise a jour terminee.
echo  ============================================================
set "SQL="
for /f "delims=" %%f in ('git diff --name-only --diff-filter=A !OLD! !NEW! -- supabase/migrations') do (
  set "SQL=1"
  echo   A FAIRE dans Supabase ^(SQL Editor, New query, coller, Run^) : %%f
)
if defined SQL echo   Faites-le AVANT d'utiliser l'outil.
echo.
echo   Ensuite dans Chrome :
echo    1. chrome://extensions  puis cliquez sur la fleche ronde de "EFI Prospection"
echo    2. Fermez puis rouvrez le panneau de l'extension
echo    3. Rechargez le tableau de bord avec Ctrl + F5
if defined RESTART (
  echo    4. Les dependances ont change : lancez Arreter-EFI.bat puis Demarrer-EFI.bat
)
echo.
pause
