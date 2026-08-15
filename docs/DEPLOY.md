# 部署指南（macOS / Windows / Linux）

## ⭐ 方式一:下载预构建包(推荐,无需 git/构建)

1. 从 [Releases](https://github.com/xzyonline/dsh-file-attachments/releases) 下载 `dsh-file-attachments-0.1.0.zip`,用 `SHA256SUMS.txt` 校验:
   ```sh
   shasum -a 256 dsh-file-attachments-0.1.0.zip   # macOS/Linux
   certutil -hashfile dsh-file-attachments-0.1.0.zip SHA256   # Windows PowerShell
   ```
2. 解压到任意目录;
3. 双击安装:**Windows 双击 `install.bat`;macOS/Linux 双击 `install.command`**;
4. 重启 dsh web → 浏览器硬刷新(macOS `Cmd+Shift+R` / Windows `Ctrl+Shift+R`)→ 输入框出现「添加文件」即成功。

> 预构建包已含 `lib/` 产物,双击脚本会自动跳过构建;卸载双击 `uninstall.bat` / `uninstall.command`。

## 方式二:源码部署

前置:Node.js ≥ 20。克隆源码后:

| 平台 | 双击文件 | 说明 |
|---|---|---|
| Windows | **`install.bat`** | 自动检测 Node(没有则打开 nodejs.org 下载页)、自动 `npm install`、自动部署;出错不闪退,窗口停在错误信息处;卸载双击 `uninstall.bat` |
| macOS | **`install.command`** | Finder 双击后在「终端」里运行(首次若被系统拦,右键 → 打开);同样全自动;卸载双击 `uninstall.command` |
| Linux | `./install.command` | 与 macOS 同脚本,终端里执行或双击由文件管理器打开 |

双击完成后:重启 dsh web → 浏览器硬刷新(macOS `Cmd+Shift+R` / Windows `Ctrl+Shift+R`)→ 输入框出现「添加文件」即成功。

---

## 0. 前置条件

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20(`node -v` 查看) |
| DeepSeek Harness | 已安装并能打开 Web GUI(`dsh web`,默认 http://127.0.0.1:3080) |
| npm 或 pnpm | 用于安装插件依赖(脚本本身不需要) |

## 1. 获取源码

```sh
git clone https://github.com/xzyonline/dsh-file-attachments.git
cd dsh-file-attachments
```

## 2. 安装依赖并一键部署

```sh
npm install                 # 或 pnpm install
node scripts/install.mjs    # 也可 npm run deploy
```

`install.mjs` 内部依次做三件事(全程幂等,重复执行安全):

1. **构建检查**:`lib/index.js` 与 `lib/client.js` 缺失时,自动用本地依赖构建(无需手工 build);
2. **链接包**:把本目录链接进 `<DSH_HOME>/profiles/web/node_modules/@dsh-external/dsh-file-attachments`
   - macOS / Linux:创建**符号链接**(symlink);
   - Windows:优先符号链接;**权限不足时自动回退"目录联接"(junction)**,无需管理员或开发者模式;
   - 若目标位置已有错误内容(普通文件/无关目录),脚本会拒绝覆盖并报错,绝不静默破坏;
3. **写入插件行**:在 `<DSH_HOME>/cordis.patch.yml` 末尾追加一行(已存在则跳过),写入前自动备份 `.bak`。

### 分平台注意点

**macOS**

```sh
brew install node        # 若还没有 Node(或从 nodejs.org 安装)
npm install
node scripts/install.mjs
# 输出「已链接」+「已写入插件行」即成功
```

**Windows(PowerShell)**

```powershell
# 1. Node 20+ 从 https://nodejs.org 安装(勾选 Add to PATH)
# 2. 打开 PowerShell,进入插件目录:
cd D:\path\to\dsh-file-attachments
npm install
node scripts\install.mjs
# 若看到「已链接(目录联接)」—— 这是正常回退,功能与符号链接完全一致
# 若看到「创建目录联接失败」—— 用管理员 PowerShell 重试,或手动执行:
#   New-Item -ItemType Junction -Path "$env:DSH_HOME\profiles\web\node_modules\@dsh-external\dsh-file-attachments" -Target "D:\path\to\dsh-file-attachments"
```

**Linux**

```sh
npm install
node scripts/install.mjs
```

> 默认针对 `web` profile;其他 profile 用 `node scripts/install.mjs --profile <name>`。
> 自定义 harness 目录用环境变量 `DSH_HOME=/path/to/.dsh node scripts/install.mjs`。

## 3. 生效

1. **重启 dsh web**:
   - macOS:直接杀掉 3080 监听进程,守护 10 秒内自动拉起(`lsof -ti :3080 -sTCP:LISTEN | xargs kill`);或双击 `~/Applications/DSH.app`;
   - Windows:关闭并重新运行 `dsh web`;
2. **浏览器硬刷新**:macOS `Cmd+Shift+R`,Windows/Linux `Ctrl+Shift+R`;
3. **验证**:输入框左侧出现**「添加文件」**按钮即安装成功。

## 4. 功能验证(冒烟测试)

web 运行中执行:

```sh
node scripts/smoke.mjs http://127.0.0.1:3080
```

应依次 PASS:路由可达 → 上传/类型检测 → 跨会话拒绝 → 草稿删除。

人工验证完整链路:

1. 拖一个 PDF/xlsx 到输入框(或粘贴/点「添加文件」)→ 出现带类型图标的附件卡片;
2. 输入一句话发送 → 你的消息气泡下方出现 `✓ Agent 已收到 · 文件名`;
3. 让模型读该文件(如说"读一下这个文件")→ 回执升级为 `✓ Agent 已读取 · 文件名`。

## 5. 常见问题

| 现象 | 原因与处理 |
|---|---|
| `未找到 node_modules` | 没执行 `npm install`;先装依赖 |
| 输入框没有「添加文件」 | web 没重启或浏览器没硬刷新;重做第 3 步 |
| Windows 报符号链接权限错误 | 安装器应已自动回退联接;若手动报错,用管理员 PowerShell 或按上文手动建联接 |
| 归档(zip/rar/7z)读取报错 | 归档读取用系统 tar:macOS/Linux 自带;Windows 10(1803)+ 自带 `tar.exe`,无需安装 |
| 想彻底卸载 | `node scripts/install.mjs --uninstall`(只移除插件行与链接,历史文件保留在 `<DSH_HOME>/file-attachments`) |
| 想从源码重新构建 | `npm run build && npm test && npm run typecheck`(产物 `lib/` 不入库,克隆后需构建,install.mjs 会自动做) |

## 6. 升级插件

```sh
cd dsh-file-attachments
git pull
npm install
node scripts/install.mjs    # 幂等;链接已指向本目录,拉新后构建即可
# 重启 web + 硬刷新
```

> 更新皮肤类第三方资产(如演示截图中的 maid-atelier 皮肤)请各自按其仓库指引升级,与本插件无关。
