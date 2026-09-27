@echo off
chcp 65001 >nul
title 拾光笔记 · 本地后台
cd /d "%~dp0"

echo.
echo   ==================================================
echo     拾 光 笔 记  ·  本 地 后 台
echo   ==================================================
echo.

rem ---------------------------------------------------------------
rem 首次运行时，顺手在桌面放一个带图标的启动图标。
rem
rem 为什么要借 PowerShell：Windows 的快捷方式（.lnk）是个 COM 对象，
rem 命令行里没有别的办法能生成它。已存在就整段跳过，不会重复创建，
rem 也不会覆盖你后来手动改过的图标。
rem
rem 桌面路径由 PowerShell 自己取（[Environment]::GetFolderPath），
rem 而不是拼 %USERPROFILE%\Desktop —— 装了 OneDrive 的机器上，
rem 桌面常被重定向到 OneDrive 目录里，硬拼出来的路径是错的。
rem
rem 这段失败也无妨：顶多桌面上少个图标，后台照常启动。
rem ---------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$p = Join-Path ([Environment]::GetFolderPath('Desktop')) '拾光笔记 写作后台.lnk'; if (-not (Test-Path $p)) { $w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut($p); $s.TargetPath = '%~dp0start-admin.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0assets\app\icon.ico,0'; $s.Description = '拾光笔记 本地写作后台'; $s.Save() }" >nul 2>&1

echo   正在启动服务，就绪后会自动弹出应用窗口……
echo.
echo   [ 关闭本窗口 = 退出后台 ]
echo   ==================================================
echo.

rem ADMIN_APP=1 告诉服务：这是双击启动的，就绪后把后台窗口弹出来。
rem 用 node 而不是 npm run dev —— dev 带 --watch，改一个文件就重启一次，
rem 那样每重启一回都会再弹一个窗口出来。
set ADMIN_APP=1
node server.js

echo.
echo   服务已停止，可以关闭本窗口了。
pause >nul
