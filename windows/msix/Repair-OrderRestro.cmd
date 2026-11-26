@echo off
rem Double-click to rebuild OrderRestro's program files (data is kept). See Repair-OrderRestro.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-OrderRestro.ps1"
