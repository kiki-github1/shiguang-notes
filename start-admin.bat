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

rem ---------------------------------------------------------------------------
rem NOTE: comments in this file are English on purpose.
rem cmd splits Chinese `rem` comments on the punctuation and then tries to run
rem the tail as a command -- a screenful of "is not recognized" while the
rem script keeps going. `echo` handles Chinese fine, `rem` does not.
rem ---------------------------------------------------------------------------

rem launch-hidden.vbs passes down the node.exe it located. Explorer can cache a
rem stale PATH after Node.js is installed, so prefer the absolute path we were
rem handed and only fall back to PATH.
set "NODE_BIN=node"
if defined SHIGUANG_NODE set "NODE_BIN=%SHIGUANG_NODE%"

"%NODE_BIN%" tools\launch.js

rem Nothing between the command above and this check -- echo would reset errorlevel.
if errorlevel 1 (
  echo.
  echo   --------------------------------------------------
  echo   [!] 后台没有正常启动，上面几行就是原因。
  echo.
  echo   若出现「不是内部或外部命令」，说明这台电脑没找到 Node.js：
  echo     打开 https://nodejs.org 下载 LTS 版安装，装完再双击图标即可。
  echo.
  echo   若是端口被占用，把占用该端口的程序关掉再试。
  echo   --------------------------------------------------
  echo.
  pause >nul
)
