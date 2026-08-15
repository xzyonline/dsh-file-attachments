import { access, appendFile, copyFile, lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const patchPath = join(home, 'cordis.patch.yml')
const backupPath = `${patchPath}.bak`
// The DSH client-module registry resolves `name` as a package specifier and
// reads `<name>/package.json` to discover `dsh.client`. The Web profile has its
// own module root, so expose this local package there before writing the patch.
const packageName = '@dsh-external/dsh-file-attachments'
const packageLink = join(home, 'profiles', 'web', 'node_modules', ...packageName.split('/'))
const clientEntry = join(pluginRoot, 'lib', 'client.js')

await access(join(pluginRoot, 'lib', 'index.js'))
await access(clientEntry)
await mkdir(dirname(packageLink), { recursive: true })
try {
  const existing = await lstat(packageLink)
  if (!existing.isSymbolicLink() || resolve(await realpath(packageLink)) !== pluginRoot) {
    throw new Error(`refusing to replace existing Web profile package path: ${packageLink}`)
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
  await symlink(pluginRoot, packageLink, 'dir')
}
const before = await readFile(patchPath, 'utf8')
const ensureBackup = async () => {
  try { await access(backupPath) } catch { await copyFile(patchPath, backupPath) }
}
const migrated = before.replace(/(^[ \t]*-[ \t]*id:[ \t]*dsh-file-attachments[ \t]*\n^[ \t]*name:[ \t]*)(.*)$/m, (_match, prefix) => `${prefix}${JSON.stringify(packageName)}`)
if (migrated !== before) {
  await ensureBackup()
  await writeFile(patchPath, migrated)
  console.log(`migrated: ${patchPath}`)
  console.log(`package link: ${packageLink}`)
  process.exit(0)
}
if (before.includes('id: dsh-file-attachments')) {
  console.log(`already installed: ${patchPath}`)
  process.exit(0)
}
await ensureBackup()
const block = `\n- insert:\n    - id: dsh-file-attachments\n      name: ${JSON.stringify(packageName)}\n      config:\n        root: ${JSON.stringify(join(home, 'file-attachments'))}\n`
await appendFile(patchPath, block)
console.log(`installed: ${packageName}`)
console.log(`package link: ${packageLink}`)
console.log(`patch: ${patchPath}`)
