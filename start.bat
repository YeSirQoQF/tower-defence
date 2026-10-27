@echo off
cd /d "%~dp0"
echo Starting local server on http://127.0.0.1:8080 ...
echo Keep this window open while playing. Close it to stop the server.
start "Tower Defense Server" /min python -m http.server 8080
timeout /t 2 >nul
start "" "http://127.0.0.1:8080/"
