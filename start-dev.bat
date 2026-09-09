@echo off
title Doggo App - Dev Server
cd /d "%~dp0"
echo ==========================================
echo    Doggo App - Demarrage rapide
echo ==========================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Une erreur est survenue lors de l'execution du script.
    pause
)
