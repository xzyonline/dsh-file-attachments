# Windows 安装指南（dsh-chat-files · 文件直读）

本指南面向 Windows 10/11 用户，覆盖一键安装、手动安装、与 macOS 的能力对照、以及常见问题排查。**插件所有能力（文本编码识别、zip 条目名解码、各类文档读取、脱敏、归档列表/提取）在 Windows 上与 macOS 完全一致**，差异仅在于系统命令与路径。

---

## 0. 前置条件

| 工具 | 最低版本 | 用途 | 官方文档 |
|---|---|---|---|
| Node.js | 20+ | 运行安装/构建脚本、解析 Worker | <https://nodejs.org/> |
| npm 或 pnpm | 随 Node / 任意新版 | 安装插件依赖 | <https://pnpm.io/installation> |
| PowerShell | 5.1+（Win10/11 自带） | 运行 `install.ps1` | <https://learn.microsoft.com/powershell/> |
| Git for Windows | 任意新版（可选） | `git clone` 安装、老系统补 tar | <https://git-scm.com/download/win> |
| bsdtar（tar.exe） | Windows 10 1803+ 自带 | 归档（zip/rar/7z）列表与提取 | <https://learn.microsoft.com/windows/win32/7zip/> 或 <https://www.libarchive.org/> |

> 数据目录：插件遵循 DSH 官方规则——`DSH_HOME` 非空则用它，否则用 `%USERPROFILE%\.dsh`（即 `C:\Users\<用户名>\.dsh`）。插件的 `homedir()/.dsh` 代码跨平台天然对齐，**无需任何路径配置**。插件安装在 `~\.dsh\plugins`，web profile 记录在 `~\.dsh\profiles\web`。

---

## 1. 一键安装

### 方式 A：双击 `install.bat`（最简单）

1. 解压发行包到任意目录；
2. 双击 `install.bat`（首次若被 SmartScreen 拦，右键 →「以管理员身份运行」或「更多信息 → 仍要运行」）；
3. 脚本自动：检测 Node → `npm install` → 构建 + 链接 + 写 `cordis.patch.yml`；
4. 看到「完成」后重启 dsh web，浏览器 `Ctrl+Shift+R` 硬刷新，输入框出现「添加文件」按钮即成功。

### 方式 B：PowerShell `install.ps1`（推荐，参数化）

```powershell
# 在插件目录内（发行包解压目录或源码目录）执行
.\install.ps1                          # 安装到 web profile，数据目录 %USERPROFILE%\.dsh
.\install.ps1 -Profile desktop         # 指定 profile
.\install.ps1 -Home D:\dsh             # 自定义数据目录（等价 DSH_HOME）
.\install.ps1 -Source https://github.com/xzyonline/dsh-chat-files.git  # git clone 安装
.\install.ps1 -Source D:\src\dsh-file-attachments                            # 本地目录安装
.\install.ps1 -Smoke                   # 部署后额外跑冒烟测试（需 web 已运行）
.\install.ps1 -Uninstall               # 卸载
```

参数说明：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-Profile` | `web` | 用于写入 `dsh.profile.bundles` 的 profile 名 |
| `-Home` | `%USERPROFILE%\.dsh`（或 `DSH_HOME`） | DSH 数据目录 |
| `-Source` | 本脚本所在目录 | 空=当前目录；`http(s)://`、`git@`、`ssh://` 开头=git clone；其余=本地目录 |
| `-SkipBuild` | `$false` | 跳过依赖安装（预构建包或已装依赖） |
| `-Smoke` | `$false` | 部署后运行 `scripts/smoke.mjs` |
| `-NoPrompt` | `$false` | 不等待回车，直接退出（CI 用） |
| `-Uninstall` | `$false` | 卸载模式 |

`install.ps1` 与 `install.bat` 底层都调用跨平台的 `scripts/install.mjs`，全程**幂等**，重复执行安全。

---

## 2. 手动安装对照

不想用一键脚本时，等价命令如下：

```powershell
# 1. 安装依赖
npm install        # 或 pnpm install

# 2. 构建 + 链接 + 写 cordis.patch.yml（幂等）
$env:DSH_HOME = "$env:USERPROFILE\.dsh"   # 自定义数据目录才需要设置
node scripts\install.mjs

# 3. （可选）写入 profile 的 dsh.profile.bundles
# 手动编辑 %USERPROFILE%\.dsh\profiles\web\package.json，
# 在 "dsh" → "profile" → "bundles" 数组里加入 "@dsh-external/dsh-file-attachments"。

# 4. 验证
node --check lib\index.js
node scripts\smoke.mjs http://127.0.0.1:3080   # 需 web 运行中
```

| 步骤 | 一键脚本 | 手动命令 |
|---|---|---|
| 安装依赖 | `install.bat` / `install.ps1` | `npm install` |
| 部署（构建/链接/补丁） | 同上 | `node scripts\install.mjs` |
| 写 dsh.profile.bundles | `install.ps1` 自动 | 手动编辑 package.json |
| 卸载 | `install.ps1 -Uninstall` | `node scripts\install.mjs --uninstall` |

---

## 3. Windows 与 macOS 能力对照

所有解析能力都在隔离 Worker 线程内由纯 JS 实现，**与操作系统无关**，仅归档读取依赖系统 `tar`（Windows 10 1803+ 自带 bsdtar，ZIP 另有纯 JS 回退）。

| 能力 | macOS | Windows | 说明 |
|---|---|---|---|
| UTF-8 / UTF-16LE / UTF-16BE 文本 | ✅ | ✅ | BOM + fatal 检测 |
| GB18030 / GBK 文本 | ✅ | ✅ | 含四字节序列、字节级启发式防误判 |
| zip 条目名 UTF-8（bit11）/ GBK / CP437 | ✅ | ✅ | 按通用位标志解码，中文文件名 zip 不误判损坏 |
| 文件 magic bytes 检测（pdf/docx/xlsx/pptx/epub/zip/7z/rar…） | ✅ | ✅ | 纯 JS，跨平台一致 |
| 归档列表 / 单条目提取 | ✅ `bsdtar` | ✅ `tar.exe`（1803+） | ZIP 无 tar 时自动回退纯 JS 中央目录 |
| PDF / DOCX / XLSX / PPTX / doc / xls / RTF / ODF / EPUB 读取 | ✅ | ✅ | 同上，跨平台一致 |
| 敏感信息脱敏（密钥/PEM/PGP/连接串） | ✅ | ✅ | 同上 |
| 附件存储（sha256 内容寻址 + 原子发布） | ✅ | ✅ | 同上 |
| 目录链接 | 符号链接 | 符号链接，无权限回退 junction | 唯一平台差异点 |

---

## 4. 生效与验证

1. **重启 dsh web**：关闭命令行窗口，重新运行 `dsh web`；
2. **浏览器硬刷新**：`Ctrl+Shift+R`；
3. **验证**：输入框左侧出现**「添加文件」**按钮；拖一个 PDF/xlsx 出现带类型图标的卡片；发送后气泡下方出现 `✓ Agent 已收到`。

完整链路冒烟（web 运行中）：

```powershell
node scripts\smoke.mjs http://127.0.0.1:3080
```

应依次 `PASS`：路由可达 → 上传/类型检测 → 跨会话拒绝 → 草稿删除。

---

## 5. 常见问题（FAQ）

| 现象 | 原因与处理 |
|---|---|
| 运行 `install.ps1` 报「禁止运行脚本」 | PowerShell 执行策略限制。处理：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`，或 `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
| 双击 `install.bat` 中文乱码 | 脚本已 `chcp 65001` 切 UTF-8；若仍乱码，控制台标题栏右键 → 属性 → 字体选「新宋体/Consolas」，或改系统区域设置「Beta：使用 Unicode UTF-8」 |
| `npm install` 报路径过长 | 开启长路径：`reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f`（需管理员，重启生效） |
| 归档读取报「未找到 tar 命令」 | Windows 10 1803+ 自带 `tar.exe`；老/精简版系统安装 [Git for Windows](https://git-scm.com/download/win)（自带 bsdtar）或重启终端让 PATH 生效 |
| 杀毒软件报毒/拦截 `node`、`tar` 子进程 | 插件会 `spawn` 系统 `tar` 与 `node` 解析归档，属正常行为；在 Defender/第三方杀软加白名单即可，非病毒 |
| 输入框没有「添加文件」 | web 没重启或浏览器没硬刷新；重做第 4 节 |
| 想彻底卸载 | `.\install.ps1 -Uninstall`（只移除插件行与链接，历史附件保留在 `%USERPROFILE%\.dsh\file-attachments`） |
| 想从源码重新构建 | `npm run build && npm test && npm run typecheck`（`lib/` 不入库，`install.mjs` 会自动构建） |

---

## 附录 A：Windows 实机验证清单

> 本指南及 `install.ps1` / `package-windows.ps1` 在 macOS 上完成静态校验（语法与逻辑走查），未在 Windows 实机运行。发布前请按下列清单在 Windows 10/11 实机验证：

- [ ] 双击 `install.bat` 能识别 Node、完成 `npm install` 并部署；
- [ ] `.\install.ps1`（PowerShell 5.1）能通过执行策略、参数化安装/卸载；
- [ ] 中文路径（含空格与中文）下安装无乱码、无路径错乱；
- [ ] 归档（zip/7z/rar）列表与提取正常；在**无 tar 的机器**上 zip 列表走纯 JS 回退；
- [ ] 上传中文名文件（GBK/CP437 编码的 zip 条目名）能正确识别类型；
- [ ] 脱敏、文档读取、回执、模型工具调用与 macOS 行为一致；
- [ ] `.\scripts\package-windows.ps1` 产出 zip 与 `SHA256SUMS.txt`，`certutil -hashfile <zip> SHA256` 校验一致。
