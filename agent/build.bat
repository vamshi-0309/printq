@echo off
REM PrintQ Agent - local Windows build.
REM
REM Produces agent\dist\PrintQAgent.exe, the same way CI does. To build the
REM full installer as well you also need Inno Setup 6 and:
REM
REM   "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" ..\installer\PrintQAgent.iss
REM
REM Releases are normally built by .github/workflows/agent-release.yml rather
REM than here; this exists for trying a change without pushing a tag.
REM
REM Prerequisites:  pip install -r requirements.txt pyinstaller

setlocal

echo.
echo === PrintQ Agent build ===
echo.

echo [1/3] Running agent tests...
python -m unittest discover -p "test_*.py"
if errorlevel 1 (
    echo.
    echo Tests failed. Not building.
    exit /b 1
)

echo.
echo [2/3] Generating icon and version resource...
python build_support.py
if errorlevel 1 exit /b 1

echo.
echo [3/3] Building executable...
pyinstaller --noconfirm --clean printq_agent.spec
if errorlevel 1 (
    echo.
    echo Build failed.
    exit /b 1
)

echo.
echo Done: dist\PrintQAgent.exe
echo.
endlocal
