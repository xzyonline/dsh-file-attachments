#!/bin/bash
# dsh-file-attachments 双击卸载(macOS Finder 双击进入终端)
cd "$(dirname "$0")" || exit 1

echo "卸载插件(移除补丁行;历史文件保留)..."
node scripts/install.mjs --uninstall || { echo "[错误] 卸载失败,请查看上方提示。"; read -r -p "按回车退出..."; exit 1; }

echo
echo "完成! 重启 dsh web 后生效。"
read -r -p "按回车关闭窗口..."
