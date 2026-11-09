@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

rem Raiz do repositorio (scripts/windows/ -> raiz)
cd /d "%~dp0\..\.."
set ROOT=%CD%

echo ============================================================
echo   E2E COMPLETO - Airsoft Americana
echo ============================================================

echo [1/8] Encerrando processos antigos nas portas 4000/3001...
call :kill_port 4000
call :kill_port 3001
if exist "data-e2e\.pglite.lock" del /f /q "data-e2e\.pglite.lock" 2>nul
if exist "data-e2e" rmdir /s /q "data-e2e" 2>nul
ping -n 3 127.0.0.1 >nul 2>&1

echo [2/8] Rodando e2e-seed em banco isolado (recriado do zero)...
set "PGLITE_DIR=%ROOT%\data-e2e"
set "DATABASE_URL="
set "NODE_ENV=development"
set "JWT_SECRET=test-secret-do-not-use-in-production"
set "GATEWAY_SECRETS_KEY="
set "API_PORT=4000"
set "API_HOST=127.0.0.1"
cd /d "%ROOT%\apps\api"
call npx tsx src/cli/e2e-seed.ts > C:\temp\seed.log 2>&1
if errorlevel 1 (
    type C:\temp\seed.log
    goto :erro_seed
)
cd /d "%ROOT%"
echo [OK] Seed concluido.

echo [3/8] Extraindo variaveis de ambiente do seed...
for /f "usebackq delims=" %%E in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-e2e-env.ps1"`) do %%E
if not defined E2E_TOTP_SECRET (
    echo [ERRO] Variaveis E2E nao foram exportadas do seed.
    goto :erro_seed
)
echo [OK] Variaveis E2E exportadas.

echo [4/8] Subindo API na porta 4000 (background)...
set "PGLITE_DIR=%ROOT%\data-e2e"
set "DATABASE_URL="
rem NODE_ENV=test + E2E_READY=1 (exportado no passo 3) ativam o bypass de rate limit
rem desenhado em apps/api/src/middleware/authRateLimit.ts p/ E2E isolado.
rem Com NODE_ENV=development o balde de login (10/min) estoura no meio da suite.
set "NODE_ENV=test"
set "JWT_SECRET=test-secret-do-not-use-in-production"
set "GATEWAY_SECRETS_KEY="
set "API_PORT=4000"
set "API_HOST=127.0.0.1"
cd /d "%ROOT%\apps\api"
start /B npx tsx src/cli.ts > C:\temp\api.log 2>&1
cd /d "%ROOT%"

echo [5/8] Aguardando healthz da API (ate 90s)...
set /a tentativas=0
:loop_api
curl.exe -s -f http://127.0.0.1:4000/healthz > C:\temp\api_check.txt 2>nul
if errorlevel 1 (
    set /a tentativas+=1
    if !tentativas! GEQ 90 (
        echo [ERRO] API nao respondeu ao healthz apos 90s.
        echo Log da API:
        type C:\temp\api.log
        goto :erro_api
    )
    ping -n 2 -w 1000 127.0.0.1 >nul 2>&1
    goto :loop_api
)
echo [OK] API respondendo em http://localhost:4000
type C:\temp\api_check.txt

echo [6/8] Subindo Admin na porta 3001...
set "ADMIN_PORT=3001"
cd /d "%ROOT%\apps\admin"
start /B npm run dev > C:\temp\admin.log 2>&1
cd /d "%ROOT%"

echo [7/8] Aguardando login do Admin (ate 90s)...
set /a tentativas=0
:loop_admin
curl.exe -s -o C:\temp\admin_body.txt -w "%%{http_code}" http://127.0.0.1:3001/login > C:\temp\admin_status.txt 2>nul
set /p admin_status=<C:\temp\admin_status.txt
if not "%admin_status%"=="200" (
    set /a tentativas+=1
    if !tentativas! GEQ 90 (
        echo [ERRO] Admin /login nao respondeu 200 apos 90s. Status: %admin_status%
        echo Log do Admin:
        type C:\temp\admin.log
        goto :erro_admin
    )
    ping -n 2 -w 1000 127.0.0.1 >nul 2>&1
    goto :loop_admin
)
echo [OK] Admin respondendo em http://localhost:3001 (status %admin_status%)

echo [8/8] Executando E2E...
call npx playwright test --reporter=list
set "E2E_EXIT_CODE=%errorlevel%"

echo.
echo ============================================================
echo   E2E_EXIT_CODE=%E2E_EXIT_CODE%
echo ============================================================

echo [LIMPEZA] Encerrando servidores (somente portas 4000/3001)...
call :kill_port 4000
call :kill_port 3001
ping -n 2 127.0.0.1 >nul 2>&1

if %E2E_EXIT_CODE% EQU 0 (
    echo E2E_SUCESSO
    exit /b 0
) else (
    echo E2E_FALHOU
    exit /b 1
)

:erro_seed
echo [ERRO] Falha no e2e-seed.
exit /b 1

:erro_api
echo [ERRO] API nao subiu.
call :kill_port 4000
call :kill_port 3001
exit /b 1

:erro_admin
echo [ERRO] Admin nao subiu.
call :kill_port 4000
call :kill_port 3001
exit /b 1

rem Encerra somente o PID que ESCUTA na porta %1 (nunca mata node de outros projetos)
:kill_port
set "KP_PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano -p TCP ^| findstr /R /C:":%KP_PORT% .*LISTENING" /C:":%KP_PORT% .*OUVINDO"') do (
    set "KP_PID=%%P"
    if not "!KP_SEEN_%%P!"=="1" (
        set "KP_SEEN_%%P=1"
        taskkill /F /PID !KP_PID! >nul 2>nul
    )
)
exit /b 0
