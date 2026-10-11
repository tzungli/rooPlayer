@echo off
title rooPlayer Audiophile Media Hub
chcp 65001 > nul
cd /d "%~dp0"
echo ==============================================
echo   正在啟動 rooPlayer 音響級數位串流播放器...
echo ==============================================
npm start
pause
