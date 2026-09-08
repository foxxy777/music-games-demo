@echo off
rem V17 实时波形二选一 —— 本地启动（需已安装 Python）
cd /d %~dp0
start "" cmd /c "timeout /t 1 >nul & start http://localhost:8177/"
python -m http.server 8177
