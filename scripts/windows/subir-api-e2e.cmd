@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

rem Raiz do repositorio (scripts/windows/ -> raiz)
cd /d "%~dp0\..\.."

call :kill_port 4000
ping -n 2 127.0.0.1 >nul 2>&1

set "PGLITE_DIR=%CD%\data-e2e"
set "DATABASE_URL="
rem E2E isolado: bypass de rate limit de login (authRateLimit.ts exige
rem NODE_ENV=test + E2E_READY=1) - necessario para scripts\windows\rodar-e2e.cmd.
set "NODE_ENV=test"
set "E2E_READY=1"
set "JWT_SECRET=test-secret-do-not-use-in-production"
set "GATEWAY_SECRETS_KEY="
set "API_PORT=4000"
set "API_HOST=127.0.0.1"

cd apps/api
start /B npx tsx src/cli.ts > C:\temp\api-manual.log 2>&1
cd ..

echo Aguardando healthz da API (ate 90s)...
set /a tentativas=0
:loop_api
curl.exe -s -f http://127.0.0.1:4000/healthz > C:\temp\api-health.txt 2>nul
if errorlevel 1 (
    set /a tentativas+=1
    if !tentativas! GEQ 90 (
        echo API_NAO_RESPONDEU
        type C:\temp\api-manual.log
        exit /b 1
    )
    ping -n 2 -w 1000 127.0.0.1 >nul 2>&1
    goto :loop_api
)
echo API_OK
type C:\temp\api-health.txt
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
