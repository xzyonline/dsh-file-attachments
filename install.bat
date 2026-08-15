@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title dsh-file-attachments 安装

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js,请先安装 Node 20 或更高版本:
  echo   https://nodejs.org/
  echo 安装完成后重新双击本文件。
  start "" https://nodejs.org/
  if not defined CI pause
  exit /b 1
)

if not defined DSH_FA_NO_NPM (
  echo [1/3] 安装依赖(首次约 1-3 分钟)...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败,请检查网络后重试。
    if not defined CI pause
    exit /b 1
  )
)

echo [2/3] 部署插件(自动构建 + 链接 + 写补丁)...
node scripts\install.mjs %*
if errorlevel 1 (
  echo [错误] 部署失败,请查看上方提示。
  if not defined CI pause
  exit /b 1
)

echo.
echo [3/3] 完成! 请重启 dsh web,然后在浏览器按 Ctrl+Shift+R 硬刷新。
echo 验证:输入框出现「添加文件」按钮即成功。详细文档见 docs\DEPLOY.md
if not defined CI pause
