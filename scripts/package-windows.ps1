#requires -Version 5.1
<#
.SYNOPSIS
  scripts/package-windows.ps1 — 打包 Windows 发行 zip + SHA256SUMS.txt。

.DESCRIPTION
  在 Windows 维护机（已 npm/pnpm install）上运行，产出：
    dist/dsh-file-attachments-<version>-windows.zip   （源码 + 脚本 + 教程 + 构建产物）
    dist/SHA256SUMS.txt                               （zip 的 SHA-256 校验和）

  打包内容 = 仓库根目录去掉 node_modules / .git / dist / .github 与 *.partial 临时文件。
  若 lib/ 缺失且未指定 -SkipBuild，会先执行 npm run build 生成 lib/index.js + lib/client.js。

.PARAMETER Version
  版本号（写入 zip 文件名），默认从 package.json 读取。

.PARAMETER OutputDir
  输出目录，默认 dist。

.PARAMETER SkipBuild
  跳过构建（lib/ 已存在或想打纯源码包时用）。

.EXAMPLE
  .\scripts\package-windows.ps1
  .\scripts\package-windows.ps1 -Version 0.3.0 -SkipBuild
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$OutputDir = 'dist',
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Pkg = Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
  $Version = $Pkg.version
}
$DistDir = Join-Path $RepoRoot $OutputDir
$PackageName = "dsh-file-attachments-$Version-windows"
$StageDir = Join-Path ([System.IO.Path]::GetTempPath()) $PackageName
$ZipPath = Join-Path $DistDir "$PackageName.zip"
$SumsPath = Join-Path $DistDir 'SHA256SUMS.txt'

function Write-Step([string]$Message) { Write-Host "[package-windows] $Message" }

# ---- 1. 构建产物（可选） ----
if (-not $SkipBuild -and -not (Test-Path (Join-Path $RepoRoot 'lib/index.js'))) {
  Write-Step '构建产物缺失，执行 npm run build…'
  $Node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $Node) { throw '未检测到 node，无法构建。请先安装 Node 20+，或加 -SkipBuild 打纯源码包。' }
  Push-Location $RepoRoot
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build 失败（exit $LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
}

# ---- 2. 准备暂存目录 ----
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

# ---- 3. 复制源文件（robocopy 排除 node_modules/.git/dist/.github 与临时文件） ----
Write-Step '复制源文件…'
# robocopy 退出码 0-7 均为成功；8+ 才是失败。
& robocopy $RepoRoot $StageDir /E /XD node_modules .git dist .github /XF *.partial /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy 复制失败（exit $LASTEXITCODE）" }

# ---- 4. 压缩 zip ----
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Write-Step '压缩 zip…'
$items = Get-ChildItem -Path $StageDir -Force
Compress-Archive -Path $items.FullName -DestinationPath $ZipPath -CompressionLevel Optimal

# ---- 5. 生成 SHA256SUMS.txt ----
Write-Step '生成 SHA256SUMS.txt…'
$hash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $PackageName.zip" | Set-Content -Path $SumsPath -Encoding ASCII

# ---- 6. 清理暂存 ----
Remove-Item $StageDir -Recurse -Force

Write-Host ''
Write-Step '打包完成：'
Write-Host "  $ZipPath"
Write-Host "  $SumsPath"
Write-Host '  校验：certutil -hashfile <zip> SHA256'
