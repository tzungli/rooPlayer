@echo off
title Roon Media Manager
chcp 65001 > nul
cd /d "%~dp0"
echo ==============================================
echo   正在啟動 Roon 音樂媒體管理器...
echo ==============================================
npm start
pause
