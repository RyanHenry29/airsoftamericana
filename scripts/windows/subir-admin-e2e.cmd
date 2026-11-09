@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

rem Raiz do repositorio (scripts/windows/ -> raiz)
cd /d "%~dp0\..\.."

call :kill_port 3001
ping -n 2 127.0.0.1 >nul 2>&1

set "ADMIN_PORT=3001"
cd /d "%~dp0\..\..\apps\admin"
start /B npm run dev > C:\temp\admin-manual.log 2>&1
cd /d "%~dp0\..\.."

echo Aguardando login do Admin (ate 90s)...
set /a tentativas=0
:loop_admin
curl.exe -s -o C:\temp\admin_body.txt -w "%%{http_code}" http://127.0.0.1:3001/login > C:\temp\admin_status.txt 2>nul
set /p admin_status=<C:\temp\admin_status.txt
if not "%admin_status%"=="200" (
    set /a tentativas+=1
    if !tentativas! GEQ 90 (
        echo ADMIN_NAO_RESPONDEU
        type C:\temp\admin-manual.log
        exit /b 1
    )
    ping -n 2 -w 1000 127.0.0.1 >nul 2>&1
    goto :loop_admin
)
echo ADMIN_OK
echo Status: %admin_status%
exit /b 0

rem Encerra somente o PID que ESCUTA na porta %1 (nunca mata node de outros projetos)
:kill_port
set "KP_PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano -p TCP ^| findstr /R /C:":%KP_PORT% .*LISTENING" /C:":%KP_PORT% .*OUVINDO"') do (
    set "KP_PID=%%P"
    if not "!KP_SEEN_%%P!"=="1" (
        set "KP_SEEN_%%P=1"
        echo   Encerrando processo antigo na porta %KP_PORT% (PID !KP_PID!)...
        taskkill /F /PID !KP_PID! >nul 2>nul
    )
)
exit /b 0
