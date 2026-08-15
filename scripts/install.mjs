/**
 * dsh-file-attachments 一键部署(跨平台:macOS / Windows / Linux)
 *
 * 归因:符号链接失败时回退 Windows 目录联接(junction)、以及"链接前校验目标是否已是正确包"的
 * 策略,参考 @linxin666/dsh-client-ui-skin-center(dsh-web-ui,zhu1090093659,Apache-2.0)的
 * ensureSymlink 实现;补丁幂等写入/备份为插件社区通行做法。其余为本项目原创。
 *
 * 用法:
 *   node scripts/install.mjs                 # 默认 profile=web
 *   node scripts/install.mjs --profile web   # 指定 profile
 *   node scripts/install.mjs --uninstall     # 卸载(等价于 scripts/uninstall.mjs)
 *
 * 行为(全程幂等,可重复执行):
 *   1. 构建产物缺失时自动构建(lib/index.js + lib/client.js);
 *   2. 把插件包链接进 <DSH_HOME>/profiles/<profile>/node_modules/@dsh-external/dsh-file-attachments
 *      (macOS/Linux 符号链接;Windows 优先符号链接,无权限时回退目录联接 junction);
 *   3. 把插件行写入 <DSH_HOME>/cordis.patch.yml(已存在则跳过,写入前备份 .bak);
 *   4. 打印验证与生效步骤。
 */
import { access, cp, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = '@dsh-external/dsh-file-attachments'
const PATCH_ROW_ID = 'dsh-file-attachments'

const args = process.argv.slice(2)
const uninstall = args.includes('--uninstall')
const profileFlag = args.indexOf('--profile')
const profile = profileFlag >= 0 && args[profileFlag + 1] ? args[profileFlag + 1] : 'web'
const harnessHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')

const patchPath = join(harnessHome, 'cordis.patch.yml')
const packageLink = join(harnessHome, 'profiles', profile, 'node_modules', ...PACKAGE_NAME.split('/'))

function log(message) { console.log(`[dsh-file-attachments] ${message}`) }
function fail(message) { console.error(`[dsh-file-attachments] 错误: ${message}`); process.exitCode = 1; return false }

/** 构建产物缺失时用本地依赖自动构建(无 node_modules 时给出安装指引)。 */
async function ensureBuilt() {
  if (existsSync(join(pluginRoot, 'lib', 'index.js')) && existsSync(join(pluginRoot, 'lib', 'client.js'))) return true
  log('构建产物缺失,尝试自动构建…')
  let tsdownEntry
  try {
    tsdownEntry = join(dirname(require.resolve('tsdown/package.json')), 'dist', 'run.mjs')
  } catch {
    return fail('未找到 node_modules。请先在插件目录执行 npm install(或 pnpm install),再运行本脚本。')
  }
  try {
    execFileSync(process.execPath, [tsdownEntry], { cwd: pluginRoot, stdio: 'inherit' })
    execFileSync(process.execPath, [join(pluginRoot, 'scripts', 'build-client.mjs')], { cwd: pluginRoot, stdio: 'inherit' })
  } catch (error) {
    return fail(`构建失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  return true
}

/** 建立 profile 链接:符号链接优先,Windows 无权限时回退目录联接。 */
async function ensureLink() {
  await mkdir(dirname(packageLink), { recursive: true })
  const target = pluginRoot
  try {
    const existing = await lstat(packageLink).catch(() => undefined)
    if (existing) {
      const isLink = existing.isSymbolicLink()
      let current = undefined
      if (isLink) { try { current = await readlink(packageLink) } catch {} }
      if (isLink && resolve(dirname(packageLink), current ?? '') === target) return true
      if (isLink || existing.isDirectory()) {
        await rm(packageLink, { recursive: true, force: true })
      }
    }
  } catch (error) {
    return fail(`清理旧链接失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await symlink(target, packageLink, 'dir')
    log(`已链接: ${packageLink} -> ${target}`)
  } catch (error) {
    if (process.platform !== 'win32') return fail(`创建符号链接失败: ${error instanceof Error ? error.message : String(error)}`)
    try {
      await symlink(target, packageLink, 'junction')
      log(`已链接(目录联接): ${packageLink} -> ${target}`)
    } catch (junctionError) {
      return fail(`创建目录联接失败(可用管理员权限或开发者模式重试): ${junctionError instanceof Error ? junctionError.message : String(junctionError)}`)
    }
  }
  return true
}

/** 幂等写入 cordis.patch.yml 插件行(写入前备份)。 */
async function patchRow(remove) {
  let before = ''
  try { before = await readFile(patchPath, 'utf8') } catch { before = '' }
  const block = `\n- insert:\n    - id: ${PATCH_ROW_ID}\n      name: ${JSON.stringify(PACKAGE_NAME)}\n      config:\n        root: ${JSON.stringify(join(harnessHome, 'file-attachments'))}\n`
  let next
  if (remove) {
    const escaped = PATCH_ROW_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^[ \\t]*-[ \\t]*insert:[ \\t]*\\n(?:[ \\t]*-[ \\t]*id:[^\\n]*\\n)*[ \\t]*-[ \\t]*id:[ \\t]*${escaped}[ \\t]*\\n(?:[ \\t]*name:[^\\n]*\\n)?(?:[ \\t]*config:[^\\n]*\\n(?:[ \\t]+[^\\n]*\\n)*)?`, 'm')
    if (!re.test(before)) { log('补丁中没有插件行,无需移除。'); return true }
    next = before.replace(re, '')
  } else {
    if (before.includes(`id: ${PATCH_ROW_ID}`)) { log('补丁中已存在插件行,跳过写入。'); return true }
    next = `${before.replace(/\s+$/, '')}${block}\n`
  }
  try { await cp(patchPath, `${patchPath}.bak`) } catch {}
  try {
    await mkdir(dirname(patchPath), { recursive: true })
    await writeFile(patchPath, next, 'utf8')
    log(`${remove ? '已移除' : '已写入'}插件行: ${patchPath}${remove ? '' : '(备份 .bak)'}`)
    return true
  } catch (error) {
    return fail(`写入补丁失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const ok = uninstall
  ? await patchRow(true)
  : await ensureBuilt() && await ensureLink() && await patchRow(false)

if (!ok) process.exit(1)

if (uninstall) {
  log('卸载完成。重启 dsh web 后生效(守护会自动拉起)。')
} else {
  console.log('\n完成。接下来:')
  console.log('  1. 重启 dsh web(守护 10 秒内自动拉起;macOS 亦可双击 ~/Applications/DSH.app);')
  console.log('  2. 浏览器硬刷新 Cmd+Shift+R(Windows: Ctrl+Shift+R);')
  console.log('  3. 验证:输入框出现「添加文件」按钮,发送附件后气泡下方出现回执。')
  console.log('卸载: node scripts/install.mjs --uninstall')
}
