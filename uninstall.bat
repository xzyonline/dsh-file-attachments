@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title dsh-file-attachments 卸载

echo 卸载插件(移除补丁行;历史文件保留)...
node scripts\install.mjs --uninstall %*
if errorlevel 1 (
  echo [错误] 卸载失败,请查看上方提示。
  if not defined CI pause
  exit /b 1
)
echo.
echo 完成! 重启 dsh web 后生效。
if not defined CI pause
