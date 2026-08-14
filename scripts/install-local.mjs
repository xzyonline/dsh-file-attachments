import { access, copyFile, appendFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const patchPath = join(home, 'cordis.patch.yml')
const backupPath = `${patchPath}.bak`
const pluginEntry = join(pluginRoot, 'lib', 'index.js')
const clientEntry = join(pluginRoot, 'lib', 'client.js')

await access(pluginEntry)
await access(clientEntry)
const before = await readFile(patchPath, 'utf8')
if (before.includes('id: dsh-file-attachments')) {
  console.log(`already installed: ${patchPath}`)
  process.exit(0)
}
try { await access(backupPath) } catch { await copyFile(patchPath, backupPath) }
const block = `\n- insert:\n    - id: dsh-file-attachments\n      name: ${JSON.stringify(pluginEntry)}\n      config:\n        root: ${JSON.stringify(join(home, 'file-attachments'))}\n`
await appendFile(patchPath, block)
console.log(`installed: ${pluginEntry}`)
console.log(`patch: ${patchPath}`)
