@echo off
echo ========================================
echo DockJock - Add Local DNS Entry
echo ========================================
echo This script requires administrator privileges
echo.

REM Check if running as admin
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo ERROR: This script must be run as Administrator
    echo.
    echo Right-click this file and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

REM Read port from .env file
set PORT=8080
if exist .env (
    for /f "tokens=1,2 delims==" %%a in (.env) do (
        if "%%a"=="PORT" set PORT=%%b
    )
)

echo Adding DNS entry to hosts file...
echo.

REM Check if entry already exists
findstr /C:"127.0.0.1 dockjock" %WINDIR%\System32\drivers\etc\hosts >nul
if %errorLevel% EQU 0 (
    echo DNS entry already exists in hosts file.
    echo.
    echo You can access DockJock at:
    echo   - http://dockjock:%PORT%
    echo   - http://localhost:%PORT%
) else (
    echo 127.0.0.1 dockjock >> %WINDIR%\System32\drivers\etc\hosts
    echo.
    echo ========================================
    echo DNS entry added successfully!
    echo ========================================
    echo.
    echo You can now access DockJock at:
    echo   - http://dockjock:%PORT%
    echo   - http://localhost:%PORT%
)

echo.
pause
