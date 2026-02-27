@echo off
echo ========================================
echo DockJock Setup
echo ========================================
echo.

REM Ask for port
set /p PORT="Enter port number for the app (default 8080): "
if "%PORT%"=="" set PORT=8080

REM Ask for OpenAI API Key
set /p OPENAI_KEY="Enter your OpenAI API key: "

REM Ask for OpenAI Model
set /p OPENAI_MODEL="Enter OpenAI model name (default gpt-4o-mini): "
if "%OPENAI_MODEL%"=="" set OPENAI_MODEL=gpt-4o-mini

REM Ask for admin password
set /p ADMIN_PASSWORD="Enter admin password (default Jay1234): "
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=Jay1234

REM Create .env file
echo Creating .env file...
(
echo PORT=%PORT%
echo OPENAI_API_KEY=%OPENAI_KEY%
echo OPENAI_MODEL=%OPENAI_MODEL%
echo ADMIN_PASSWORD=%ADMIN_PASSWORD%
echo DATABASE_URL=sqlite:///./dockjock.db
) > .env

echo.
echo ========================================
echo Configuration saved to .env
echo ========================================
echo Port: %PORT%
echo OpenAI Model: %OPENAI_MODEL%
echo Admin Password: %ADMIN_PASSWORD%
echo ========================================
echo.
echo Building Docker containers...
docker-compose up --build -d

echo.
echo ========================================
echo Adding local DNS entry for dockjock...
echo ========================================
echo.

REM Check if running as admin
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Adding 127.0.0.1 dockjock to hosts file...
    findstr /C:"127.0.0.1 dockjock" %WINDIR%\System32\drivers\etc\hosts >nul
    if %errorLevel% NEQ 0 (
        echo 127.0.0.1 dockjock >> %WINDIR%\System32\drivers\etc\hosts
        echo DNS entry added successfully!
    ) else (
        echo DNS entry already exists.
    )
) else (
    echo WARNING: Not running as administrator.
    echo To add DNS entry, run this script as administrator.
    echo Or manually add this line to C:\Windows\System32\drivers\etc\hosts:
    echo 127.0.0.1 dockjock
)

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo Access the app at:
echo   - http://localhost:%PORT%
echo   - http://dockjock:%PORT% (if DNS entry was added)
echo.
echo If using custom port, access at: http://dockjock:%PORT%
echo ========================================
pause
