# dsh-chat-files

DeepSeek Harness 会话文件附件插件。文件拖入、粘贴或选择进对话后，模型在下一步经会话授权的受限工具读取。支持 PDF、Office 文档、压缩包与纯文本；含 GB18030/GBK 中文编码、敏感信息自动脱敏与压缩炸弹防护。macOS 与 Windows 一键安装。

[English](README.md) · 中文

[![CI](https://github.com/xzyonline/dsh-chat-files/actions/workflows/ci.yml/badge.svg)](https://github.com/xzyonline/dsh-chat-files/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/xzyonline/dsh-chat-files)](https://github.com/xzyonline/dsh-chat-files/releases)

---

## 功能

| 能力 | 摘要 |
|---|---|
| **文件接入** | 窗口任意位置拖入、粘贴、或「添加文件」按钮 |
| **自动告知** | 每次步骤前向模型公告尚未告知的文件及其类型 |
| **类型卡片** | 输入框卡片按检测类别显示图标与颜色 |
| **送达回执** | 用户气泡下 `Agent received → Agent reading… → Agent read` |
| **读取器** | PDF、DOCX、XLSX、PPTX、旧版 `.doc`/`.xls`、RTF、ODF、EPUB、ZIP/7z/RAR、HTML/XML/SVG、Markdown、纯文本 |
| **模型工具** | `attachment_info` / `read_attachment` / `list_archive`，有界分页 |
| **脱敏** | 凭据键、PEM 块、YAML 标量在到达模型前逐行脱敏 |

### 文件接入

将文件拖到窗口任意位置、粘贴、或使用「添加文件」按钮。位图图片继续走 DSH 原生图片通道，其余文件进入本插件；「释放以附加」浮层替代原生「仅支持图片」拦截提示。

### 自动告知

消息线缆不携带可见的文件标记，纯文本模型可能忽略上传。每次进入步骤前，插件以 `plugin` 来源追加一行公告，列出所有尚未告知的文件及其检测类型，模型据此调用 `attachment_info` → `read_attachment` / `list_archive`，并把文件内容与用户的话结合。公告经官方 `agent/pre-step` 瀑布注入（请求推导前的串行链），由官方 UI 渲染为注入行。

### 类型卡片

输入框卡片按检测类别（文本 / 文档 / 表格 / 演示 / 压缩包 / …）显示不同图标与颜色。

### 送达回执

用户气泡下方一行状态如实报告事件：`Agent received → Agent reading… → Agent read`；最终阶段仅在模型真正调用读取工具后出现。

### 读取器

文本/配置/源码、Markdown、HTML/XML/SVG（识别为文本读取）、PDF、DOCX、XLSX（sheet 级与 A1 区域读取）、PPTX、旧版 `.doc`/`.xls`、RTF、ODF、EPUB，以及 ZIP/7z/RAR/EPUB 列表与单条目安全提取（支持中文条目名）。

### 模型工具

`attachment_info`、`read_attachment`、`list_archive` — 分页/区域/游标/段落有界读取，压缩包先列目录后提取。

### 脱敏

凭据键、私钥 PEM 块、YAML 块标量在字节进入模型前逐行脱敏（`aws_secret_access_key`、`apiKey`、`set-cookie` 均覆盖；`public_key`、`monkey` 不误伤）。

## 架构

```
输入框 拖入 / 粘贴 / 按钮（客户端）
   │  全窗口接管，仅普通文件——图片保持原生通道
   ▼
POST /api/dsh-file-attachments/v1/files   （Origin + 会话存在性校验，失败即拒）
   ▼
内容寻址存储（sha256 blob，原子 rename 发布，不可变）
   ├─ 类型检测（魔数 + ZIP 元数据，worker 隔离）
   ├─ refs + 批次索引（持久元数据，路径注入校验）
   └─ 读取路径：会话归属校验 → worker 有界解析 → 脱敏
   ▼
模型侧视图：
   ├─ agent/pre-step 公告行（plugin 来源，带类型标记）
   └─ attachment_info / read_attachment / list_archive 工具
```

## 安装

### 一键安装

```sh
# macOS / Linux（仓库根目录）
node scripts/install.mjs
# 或双击 install.command（Windows：install.bat）
```

安装器构建 host 与 client 产物，将包符号链接进共享 profile 目录（`$DSH_HOME/profiles/node_modules`，web、CLI、headless 各 profile 均可解析），并向 `$DSH_HOME/cordis.patch.yml` 追加一行（先写备份）。安装幂等，可安全重跑。卸载：`node scripts/install.mjs --uninstall`，或 `uninstall.bat` / `uninstall.command`。

预构建包：从 [Releases](https://github.com/xzyonline/dsh-chat-files/releases) 下载 `dsh-file-attachments-<version>.zip`，对照 `SHA256SUMS.txt` 校验后解压双击安装器。无需 git、构建步骤或包管理器。

**Windows 用户**：完整教程见 [docs/WINDOWS-INSTALL.zh.md](./docs/WINDOWS-INSTALL.zh.md)（前置条件、`install.ps1`、手动步骤、macOS 对照表、FAQ）。要求 [Node.js](https://nodejs.org/) ≥ 20、[PowerShell](https://learn.microsoft.com/powershell/) 5.1+；压缩包能力依赖系统自带 `tar.exe`（Windows 10 1803+，[bsdtar](https://www.libarchive.org/)）或 [Git for Windows](https://git-scm.com/download/win)；依赖经 `npm` 或 [pnpm](https://pnpm.io/installation) 安装。

### 按端部署

| 端 | 步骤 | 效果 |
|---|---|---|
| **Web（`dsh web`）** | 运行安装器 → 重启 `dsh web` → 硬刷新（Cmd+Shift+R / Ctrl+Shift+R） | 添加文件按钮、全窗口拖入、类型卡片、送达回执、自动告知 |
| **CLI / headless** | 无需额外操作——host 半经共享 profile 挂载 | `attachment_info` / `read_attachment` / `list_archive` 工具；API 上传的附件可读，公告在相同官方事件上触发 |

配置：存储根默认 `$DSH_HOME/file-attachments`；可在 `cordis.patch.yml` 插件行的 `config.root` 覆盖。

## 安全模型

- **会话归属** — 每次读取校验 `ownerSessionId` 与会话存续（`sessionQuery.readSession`，失败即拒，10 s TTL 缓存）。
- **来源校验** — 上传要求可信 `Origin`（完全一致，或同端口回环等价 `127.0.0.1`/`localhost`/`[::1]`）；跨站读取与删除被拒，无 Origin 的本地客户端放行。
- **解析隔离** — 每次解析在 worker 线程运行，`maxOldGenerationSizeMb: 512` 内存上限 + 硬超时终止挂死解析器（`word-extractor`/`xlsx` 无法以其他方式中止）。
- **压缩包安全** — 路径归一化与白名单；提取仅写 stdout（无 zip-slip 面）；列表时跳过恶意条目、提取时拒绝；解压输出上限 256 MB。

## 引用

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Node.js](https://nodejs.org) · [pnpm](https://pnpm.io)
- [PowerShell](https://learn.microsoft.com/powershell) · [libarchive bsdtar](https://www.libarchive.org/)
- [pdfjs-dist](https://github.com/mozilla/pdf.js) · [fflate](https://github.com/101arrowz/fflate) · [file-type](https://github.com/sindresorhus/file-type)

安全策略：`SECURITY.md`。第三方声明：`THIRD_PARTY_NOTICES.md`。
