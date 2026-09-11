@echo off
REM PrintQ Agent — PyInstaller build script
REM Run this from the agent/ directory on a Windows machine with Python 3.10+.
REM
REM Prerequisites:
REM   pip install pyinstaller pywin32 requests pystray Pillow python-dotenv

echo Building PrintQ Agent...

pyinstaller ^
    --onefile ^
    --windowed ^
    --name PrintQAgent ^
    --add-data "config.py;." ^
    --add-data "pairing.py;." ^
    --add-data "tray.py;." ^
    --hidden-import pystray._win32 ^
    --hidden-import win32print ^
    printq_agent.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful! Output: dist\PrintQAgent.exe
    echo.
) else (
    echo.
    echo Build failed. Check the output above for errors.
    echo.
)

pause
