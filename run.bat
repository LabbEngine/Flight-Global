@echo off
rem FocusAir launcher for Windows -- double-click this file to start the app.
rem It finds Python 3 for you, whether it is installed as "py" or "python".
cd /d "%~dp0"

where py >nul 2>nul && ( py run.py & goto :EOF )
where python >nul 2>nul && ( python run.py & goto :EOF )

echo FocusAir needs Python 3, which isn't installed on this PC yet.
echo.
echo Install it from https://www.python.org/downloads/
echo During setup, tick "Add Python to PATH", then double-click this file again.
echo.
pause
