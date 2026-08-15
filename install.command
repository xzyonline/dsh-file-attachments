#!/bin/bash
# dsh-file-attachments 双击安装(macOS Finder 双击进入终端;Linux 亦可直接执行)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js,请先安装 Node 20+ :"
  echo "  brew install node      或     https://nodejs.org/"
  [ -z "${CI:-}" ] && read -r -p "按回车退出..."
  exit 1
fi

if [ -z "${DSH_FA_NO_NPM:-}" ]; then
  echo "[1/3] 安装依赖(首次约 1-3 分钟)..."
  npm install || { echo "[错误] 依赖安装失败,请检查网络后重试。"; [ -z "${CI:-}" ] && read -r -p "按回车退出..."; exit 1; }
fi

echo "[2/3] 部署插件(自动构建 + 链接 + 写补丁)..."
node scripts/install.mjs "$@" || { echo "[错误] 部署失败,请查看上方提示。"; [ -z "${CI:-}" ] && read -r -p "按回车退出..."; exit 1; }

echo
echo "[3/3] 完成! 请重启 dsh web,然后在浏览器按 Cmd+Shift+R 硬刷新。"
echo "验证:输入框出现「添加文件」按钮即成功。详细文档见 docs/DEPLOY.md"
if [ -z "${CI:-}" ]; then read -r -p "按回车关闭窗口..."; fi
exit 0
