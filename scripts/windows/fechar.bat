@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Airsoft Americana - Fechar portas

rem Executa sempre a partir da pasta onde este arquivo esta salvo.
cd /d "%~dp0"

set "API_PORT=4000"
set "STORE_PORT=3000"
set "ADMIN_PORT=3001"

echo ============================================================
echo   AIRSOFT AMERICANA - Fechar portas
echo ============================================================
echo   Alvos: API %API_PORT% / Loja %STORE_PORT% / Admin %ADMIN_PORT%
echo.

call :kill_port %API_PORT% "API"
call :kill_port %STORE_PORT% "Loja"
call :kill_port %ADMIN_PORT% "Admin"

echo.
echo [OK] Concluido. Voce pode rodar abrir.bat quando quiser.
echo.
pause
exit /b 0

:kill_port
set "KP_PORT=%~1"
set "KP_NAME=%~2"
set "KP_FOUND="
for /f "tokens=5" %%P in ('netstat -ano -p TCP ^| findstr /R /C:":%KP_PORT% .*LISTENING" /C:":%KP_PORT% .*OUVINDO"') do (
    set "KP_PID=%%P"
    if not "!KP_SEEN_%%P!"=="1" (
        set "KP_SEEN_%%P=1"
        set "KP_FOUND=1"
        echo   Encerrando %KP_NAME% ^(porta %KP_PORT%, PID !KP_PID!^)...
        taskkill /F /PID !KP_PID! >nul 2>nul
        if errorlevel 1 (
            echo   [AVISO] Nao foi possivel encerrar PID !KP_PID!. Tente como Administrador.
        ) else (
            echo   [OK] PID !KP_PID! encerrado.
        )
    )
)
if not defined KP_FOUND echo   [LIVRE] Porta %KP_PORT% ^(%KP_NAME%^)
exit /b 0
