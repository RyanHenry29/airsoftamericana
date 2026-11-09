@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sincronizar relogio do Windows

rem Precisa ser executado como Administrador.
net session >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Este script precisa ser executado como Administrador.
    echo        Clique com o botao direito no arquivo e escolha
    echo        "Executar como administrador".
    echo.
    pause
    exit /b 1
)

echo ============================================================
echo   Sincronizando relogio do Windows
echo ============================================================
echo.

echo Hora atual antes:
powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'"
echo.

echo [..] Configurando servidores NTP...
w32tm /config /manualpeerlist:"pool.ntp.org time.windows.com a.st1.ntp.br" /syncfromflags:manual /reliable:yes /update >nul 2>nul

echo [..] Reiniciando servico de horario (w32time)...
net stop w32time >nul 2>nul
net start w32time >nul 2>nul
if errorlevel 1 (
    echo [AVISO] Nao foi possivel reiniciar w32time. Tentando ressincronizar mesmo assim...
)

echo [..] Forcando sincronizacao...
w32tm /resync /force
if errorlevel 1 (
    echo.
    echo [ERRO] A sincronizacao falhou. Verifique sua conexao com a internet
    echo        e se o servico "Horario do Windows" nao esta desativado.
    echo.
    pause
    exit /b 1
)

echo.
echo Hora atual depois:
powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'"
echo.
echo [OK] Relogio sincronizado.
echo.
pause
exit /b 0
