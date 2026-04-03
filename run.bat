@echo off
SETLOCAL
cls
echo ======================================================
echo          SRE STACK - AUTO DETECT (WINDOWS)
echo ======================================================
echo.

:: O próprio .bat já confirma que estamos no Windows.
:: Mas vamos validar o ambiente Docker.

docker ps >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Docker nao detectado. Abra o Docker Desktop.
    pause
    exit /b
)

echo [OK] Windows detectado. Iniciando via Makefile...
echo.

:: Tenta usar o 'make' se estiver instalado, senao vai direto no docker
where make >nul 2>&1
if %errorLevel% equ 0 (
    make up
    timeout /t 10
    make open
) else (
    echo [AVISO] 'make' nao encontrado. Usando docker compose direto...
    docker compose up -d --build
    timeout /t 10
    start http://localhost:5050/message
    start http://localhost:3030/message
    start http://localhost:4444
)

echo.
echo [SUCESSO] Ambiente operando no Windows.
pause
