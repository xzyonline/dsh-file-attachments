#requires -Version 5.1
<#
.SYNOPSIS
  dsh-file-attachments 一键安装 / 卸载（Windows PowerShell 5.1+）。

.DESCRIPTION
  等价于双击 install.bat 的 PowerShell 增强版，新增：
    - 参数化：-Profile / -Home / -Source
    - 严格模式与 fail-fast（$ErrorActionPreference = 'Stop'）
    - node / pnpm / npm 检测与清晰报错
    - 支持 git clone 安装或本地目录安装
    - 部署（cordis.patch.yml + 目录链接）委托给跨平台 scripts/install.mjs
    - 补充写入 profile 的 package.json dsh.profile.bundles（幂等）
    - 验证：node --check 语法校验 + 可选冒烟测试
    - 全程幂等，可安全重复执行

.PARAMETER Profile
  DSH profile 名（用于 dsh.profile.bundles），默认 web。

.PARAMETER Home
  DSH 数据目录（等价 DSH_HOME），默认 $env:DSH_HOME 或 %USERPROFILE%\.dsh。

.PARAMETER Source
  安装来源：空 = 本脚本所在目录；http(s)/git@/ssh 开头的字符串 = git clone；
  其余按本地目录处理。

.PARAMETER SkipBuild
  跳过依赖安装（预构建包或已装过依赖时用）。

.PARAMETER Smoke
  部署后运行 scripts/smoke.mjs 冒烟测试（需要 dsh web 已运行）。

.PARAMETER Uninstall
  卸载模式：移除 cordis.patch.yml 插件行与目录链接。

.EXAMPLE
  .\install.ps1                          # 在插件目录内一键安装到 web profile
  .\install.ps1 -Profile desktop         # 安装到 desktop profile
  .\install.ps1 -Home D:\dsh             # 自定义 DSH 数据目录
  .\install.ps1 -Source https://github.com/xzyonline/dsh-file-attachments.git
  .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Home = '',
  [string]$Source = '',
  [switch]$SkipBuild,
  [switch]$Smoke,
  [switch]$NoPrompt,
  [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---- 常量 ----
$PluginName = '@dsh-external/dsh-file-attachments'
$PatchRowId = 'dsh-file-attachments'
$NodeSite   = 'https://nodejs.org/'
$GitSite    = 'https://git-scm.com/download/win'
$PnPmSite   = 'https://pnpm.io/installation'

# ---- 工具函数 ----
function Write-Step([string]$Message) {
  Write-Host "[dsh-file-attachments] $Message"
}
function Write-Fail([string]$Message) {
  Write-Host "[dsh-file-attachments][错误] $Message" -ForegroundColor Red
}
# 运行原生命令并在非零退出码时抛错（PowerShell 5.1 不会自动对原生命令 fail-fast）。
function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = (Get-Location).Path
  )
  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "命令失败（exit $LASTEXITCODE）：$FilePath $($ArgumentList -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

# ---- 0. 解析 DSH 数据目录 ----
if ([string]::IsNullOrWhiteSpace($Home)) {
  if ($env:DSH_HOME) { $Home = $env:DSH_HOME }
  else { $Home = Join-Path $env:USERPROFILE '.dsh' }
}
# install.mjs 通过 DSH_HOME 环境变量感知数据目录，保持一致。
$env:DSH_HOME = $Home

# ---- 1. 前置检测：node / git / 包管理器 ----
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  Write-Fail "未检测到 Node.js。请从 $NodeSite 安装 Node 20+（安装时勾选 Add to PATH）后重试。"
  Start-Process $NodeSite
  exit 1
}
Write-Step "Node: $($Node.Source)"

$PkgManager = $null
$PkgManagerInstallCmd = $null
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $PkgManager = 'pnpm'
  $PkgManagerInstallCmd = @('install')
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  $PkgManager = 'npm'
  $PkgManagerInstallCmd = @('install')
} else {
  Write-Fail "未检测到 npm/pnpm。请先安装 Node.js（自带 npm），或从 $PnPmSite 安装 pnpm。"
  exit 1
}
Write-Step "包管理器: $PkgManager"

# ---- 2. 解析安装来源目录 ----
$RepoDir = $PSScriptRoot
if ($Source -match '^(https?://|git@|ssh://)') {
  $Git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $Git) {
    Write-Fail "git clone 需要 git。请从 $GitSite 安装 Git for Windows（勾选 Add to PATH）后重试。"
    exit 1
  }
  $RepoDir = Join-Path $env:TEMP 'dsh-file-attachments'
  if (Test-Path $RepoDir) {
    Write-Step "已存在克隆目录，执行 git pull 更新…"
    Invoke-Checked -FilePath $Git.Source -ArgumentList @('-C', $RepoDir, 'pull', '--ff-only')
  } else {
    Write-Step "git clone $Source …"
    Invoke-Checked -FilePath $Git.Source -ArgumentList @('clone', $Source, $RepoDir)
  }
} elseif ($Source -ne '') {
  if (-not (Test-Path $Source)) {
    Write-Fail "安装来源目录不存在：$Source"
    exit 1
  }
  $RepoDir = (Resolve-Path $Source).Path
}
Write-Step "安装目录: $RepoDir"

# ---- 3. 卸载分支 ----
if ($Uninstall) {
  Write-Step "卸载模式…"
  Invoke-Checked -FilePath $Node.Source -ArgumentList @('scripts/install.mjs', '--uninstall') -WorkingDirectory $RepoDir
  Write-Step "卸载完成。重启 dsh web 后生效。"
  if (-not $NoPrompt) { Read-Host "按回车退出" | Out-Null }
  exit 0
}

# ---- 4. 安装依赖 ----
if (-not $SkipBuild -and -not $env:DSH_FA_NO_NPM) {
  Write-Step "[1/4] 安装依赖（首次约 1-3 分钟）…"
  Invoke-Checked -FilePath $PkgManager -ArgumentList $PkgManagerInstallCmd -WorkingDirectory $RepoDir
} else {
  Write-Step "[1/4] 跳过依赖安装（SkipBuild/DSH_FA_NO_NPM）"
}

# ---- 5. 部署（构建 + 链接 + 写 cordis.patch.yml，幂等） ----
Write-Step "[2/4] 部署插件（构建 + 链接 + 写补丁）…"
Invoke-Checked -FilePath $Node.Source -ArgumentList @('scripts/install.mjs') -WorkingDirectory $RepoDir

# ---- 6. 写入 profile 的 dsh.profile.bundles（幂等，旧版 DSH 无此文件则跳过） ----
Write-Step "[3/4] 写入 dsh.profile.bundles …"
$BundleScript = @"
const fs = require('node:fs')
const path = require('node:path')
const home = process.env.DSH_HOME
const profile = process.env.DSH_FA_PROFILE || 'web'
const name = '@dsh-external/dsh-file-attachments'
const pkg = path.join(home, 'profiles', profile, 'package.json')
if (!fs.existsSync(pkg)) { console.log('[dsh-file-attachments] 跳过 dsh.profile.bundles（未找到 ' + pkg + '，可能是旧版 DSH）'); process.exit(0) }
const json = JSON.parse(fs.readFileSync(pkg, 'utf8'))
json.dsh = json.dsh || {}
json.dsh.profile = json.dsh.profile || {}
if (!Array.isArray(json.dsh.profile.bundles)) json.dsh.profile.bundles = []
if (json.dsh.profile.bundles.indexOf(name) >= 0) { console.log('[dsh-file-attachments] dsh.profile.bundles 已包含插件'); process.exit(0) }
json.dsh.profile.bundles.push(name)
fs.writeFileSync(pkg, JSON.stringify(json, null, 2) + '\n', 'utf8')
console.log('[dsh-file-attachments] 已写入 dsh.profile.bundles: ' + pkg)
"@
$env:DSH_FA_PROFILE = $Profile
Invoke-Checked -FilePath $Node.Source -ArgumentList @('-e', $BundleScript) -WorkingDirectory $RepoDir

# ---- 7. 验证：node --check 语法校验 + 可选冒烟 ----
Write-Step "[4/4] 验证构建产物…"
foreach ($entry in @('lib/index.js', 'lib/client.js')) {
  $target = Join-Path $RepoDir $entry
  if (Test-Path $target) {
    Invoke-Checked -FilePath $Node.Source -ArgumentList @('--check', $target) -WorkingDirectory $RepoDir
    Write-Step "语法校验通过: $entry"
  } else {
    Write-Fail "缺少构建产物 $entry，请先执行 npm run build。"
    exit 1
  }
}
if ($Smoke) {
  Write-Step "运行冒烟测试（需 dsh web 运行在 http://127.0.0.1:3080）…"
  Invoke-Checked -FilePath $Node.Source -ArgumentList @('scripts/smoke.mjs', 'http://127.0.0.1:3080') -WorkingDirectory $RepoDir
}

# ---- 8. 完成提示 ----
Write-Host ""
Write-Step "完成！后续步骤："
Write-Host "  1. 重启 dsh web（关闭后重新运行 dsh web）。"
Write-Host "  2. 浏览器硬刷新 Ctrl+Shift+R。"
Write-Host "  3. 验证：输入框出现「添加文件」按钮即成功。详细文档见 docs\WINDOWS-INSTALL.zh.md"
Write-Host "卸载：.\install.ps1 -Uninstall"
if (-not $NoPrompt) { Read-Host "按回车退出" | Out-Null }
exit 0
