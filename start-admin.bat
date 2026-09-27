@echo off
chcp 65001 >nul
title 拾光笔记 · 本地后台
cd /d "%~dp0"

echo.
echo   ==================================================
echo     拾 光 笔 记  ·  本 地 后 台
echo   ==================================================
echo.
echo   正在启动服务，就绪后会自动弹出应用窗口……
echo.
echo   [ 关闭本窗口 = 退出后台 ]
echo   ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] 没有找到 Node.js，请先到 https://nodejs.org 安装
  echo.
  pause
  exit /b 1
)

node tools\launch.js

echo.
echo   服务已停止，可以关闭本窗口了。
pause >nul
