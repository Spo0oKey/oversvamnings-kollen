@echo off
rem Startar Kustoversvamnings Kollen lokalt. Anvander "py" (Python-startaren for Windows) i forsta hand.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONHOME=
set PYTHONPATH=
set PYTHONUTF8=1

where py >/dev/null 2>nul
if %errorlevel%==0 (
  py -3 start_server.py
  goto :end
)

where python >/dev/null 2>nul
if %errorlevel%==0 (
  python start_server.py
  goto :end
)

echo Python hittades inte. Installera Python fran https://www.python.org/downloads/ och kor sedan den har filen igen.

:end
pause
