@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 図面レイアウトツールを起動します...
start "" http://localhost:8791
node _serve.js
