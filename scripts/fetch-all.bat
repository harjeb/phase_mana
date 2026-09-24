@echo off
setlocal
rem One-shot data download for phase-mana on Windows.
rem Delegates to scripts\fetch-all.sh through Git Bash, forwarding every flag.
rem Examples:
rem   scripts\fetch-all.bat
rem   scripts\fetch-all.bat --skip-pools --skip-scryfall
rem   scripts\fetch-all.bat --help
rem
rem Requirement: Git for Windows (provides bash). https://git-scm.com/download/win

set "SCRIPT_DIR=%~dp0"
set "BASH="

rem 1) bash already on PATH?
for %%I in (bash.exe) do if not defined BASH set "BASH=%%~$PATH:I"

rem 2) fall back to the usual Git for Windows install locations
if not defined BASH for %%P in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LocalAppData%\Programs\Git\bin\bash.exe"
) do if not defined BASH if exist %%P set "BASH=%%~P"

if not defined BASH (
  echo [fetch-all] Git Bash not found.
  echo [fetch-all] Install Git for Windows: https://git-scm.com/download/win
  echo [fetch-all] ...or run scripts\fetch-all.sh from any bash shell.
  exit /b 1
)

echo [fetch-all] Using bash: %BASH%
"%BASH%" "%SCRIPT_DIR%fetch-all.sh" %*
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo [fetch-all] FAILED with exit code %RC%.
  exit /b %RC%
)

echo [fetch-all] All downloads finished.
exit /b 0
