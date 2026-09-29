@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-GPT-Observatory.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo GPT Observatory installation failed with exit code %EXITCODE%.
  if not "%GPT_OBSERVATORY_NONINTERACTIVE%"=="1" pause
)
exit /b %EXITCODE%
