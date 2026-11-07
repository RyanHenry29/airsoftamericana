@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Airsoft Americana - Iniciando sistema

rem Executa sempre a partir da pasta onde este arquivo esta salvo.
cd /d "%~dp0"

set "API_PORT=4000"
set "STORE_PORT=3000"
set "ADMIN_PORT=3001"

echo ============================================================
echo   AIRSOFT AMERICANA - Sistema completo
echo ============================================================
echo   Loja .... http://localhost:%STORE_PORT%
echo   Admin ... http://localhost:%ADMIN_PORT%
echo   API ..... http://localhost:%API_PORT%
echo ============================================================
echo.

rem ------------------------------------------------------------
rem 1) Node.js instalado?
rem ------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao foi encontrado no PATH.
    echo        Instale o Node.js 22 ou superior: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%V in ('node -v') do set "NODE_VERSION=%%V"
echo [OK] Node.js %NODE_VERSION% encontrado.

rem ------------------------------------------------------------
rem 2) Dependencias instaladas?
rem ------------------------------------------------------------
set "NEED_INSTALL="
if not exist "node_modules\next" set "NEED_INSTALL=1"
if not exist "node_modules\tsx"  set "NEED_INSTALL=1"

if defined NEED_INSTALL (
    echo [..] Instalando dependencias com npm install. Aguarde...
    call npm install
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar as dependencias.
        echo        Verifique sua conexao e tente novamente.
        pause
        exit /b 1
    )
    echo [OK] Dependencias instaladas.
)

rem ------------------------------------------------------------
rem 3) Portas livres?
rem ------------------------------------------------------------
set /a PORTS_BUSY=0

call :port_free %API_PORT%
if errorlevel 1 (
    echo [AVISO] A porta %API_PORT% da API ja esta em uso.
    set /a PORTS_BUSY+=1
)
call :port_free %STORE_PORT%
if errorlevel 1 (
    echo [AVISO] A porta %STORE_PORT% da loja ja esta em uso.
    set /a PORTS_BUSY+=1
)
call :port_free %ADMIN_PORT%
if errorlevel 1 (
    echo [AVISO] A porta %ADMIN_PORT% do admin ja esta em uso.
    set /a PORTS_BUSY+=1
)

rem Tudo no ar: apenas abre as paginas.
if "%PORTS_BUSY%"=="3" goto :already_running
rem Apenas parte no ar: evita conflito.
if not "%PORTS_BUSY%"=="0" goto :port_busy

rem ------------------------------------------------------------
rem 4) Inicia os tres servicos
rem ------------------------------------------------------------
echo.
echo [..] Iniciando a API na porta %API_PORT%...
start "Airsoft API - %API_PORT%" cmd /k "npm run dev:api"

call :wait_port %API_PORT% 90
if errorlevel 1 (
    echo [AVISO] A API ainda nao respondeu. Confira a janela "Airsoft API - %API_PORT%".
) else (
    echo [OK] API respondendo em http://localhost:%API_PORT%
)

echo [..] Iniciando a loja na porta %STORE_PORT%...
start "Airsoft Loja - %STORE_PORT%" cmd /k "set NEXT_TELEMETRY_DISABLED=1 && npm run dev:store"

echo [..] Iniciando o painel admin na porta %ADMIN_PORT%...
start "Airsoft Admin - %ADMIN_PORT%" cmd /k "set NEXT_TELEMETRY_DISABLED=1 && npm run dev:admin"

echo.
echo [..] Aguardando a loja e o admin ficarem prontos...
call :wait_port %STORE_PORT% 120
call :wait_port %ADMIN_PORT% 120

start "" "http://localhost:%STORE_PORT%"
start "" "http://localhost:%ADMIN_PORT%"

echo.
echo ============================================================
echo   SISTEMA INICIADO
echo ============================================================
echo   Loja ..... http://localhost:%STORE_PORT%
echo   Admin .... http://localhost:%ADMIN_PORT%
echo   API ...... http://localhost:%API_PORT%
echo.
echo   Login do admin:
echo     E-mail: admin@airsoftamericana.com.br
echo     Senha:  Admin123!
echo.
echo   Para encerrar o sistema, feche as 3 janelas abertas
echo   ou pressione CTRL+C dentro de cada uma delas.
echo ============================================================
echo.
echo Pressione qualquer tecla para fechar esta janela.
pause >nul
exit /b 0

:already_running
echo.
echo [OK] O sistema ja esta em execucao.
echo      Loja:  http://localhost:%STORE_PORT%
echo      Admin: http://localhost:%ADMIN_PORT%
echo      API:   http://localhost:%API_PORT%
echo.
echo      Para reiniciar, feche as janelas abertas e execute
echo      este arquivo novamente.
echo.
start "" "http://localhost:%STORE_PORT%"
start "" "http://localhost:%ADMIN_PORT%"
echo Pressione qualquer tecla para fechar esta janela.
pause >nul
exit /b 0

:port_busy
echo.
echo [ERRO] Parte do sistema ja esta em execucao, mas nao tudo.
echo        Portas necessarias: API %API_PORT% / Loja %STORE_PORT% / Admin %ADMIN_PORT%.
echo        Feche todas as janelas antigas do sistema e tente novamente.
echo.
pause
exit /b 1

rem ------------------------------------------------------------
rem Sub-rotinas
rem ------------------------------------------------------------

rem Retorna 0 se a porta estiver livre, 1 se estiver em uso.
:port_free
netstat -ano -p TCP | findstr /R /C:":%~1 .*LISTENING" >nul 2>nul
if errorlevel 1 exit /b 0
exit /b 1

rem Espera a porta abrir. Uso: call :wait_port PORTA SEGUNDOS
:wait_port
set "WP_PORT=%~1"
set "WP_MAX=%~2"
set /a WP_COUNT=0
:wait_port_loop
call :port_free %WP_PORT%
if errorlevel 1 exit /b 0
set /a WP_COUNT+=1
if %WP_COUNT% GEQ %WP_MAX% exit /b 1
ping -n 2 -w 1000 127.0.0.1 >nul 2>nul
goto wait_port_loop
