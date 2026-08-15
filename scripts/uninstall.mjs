/** 卸载入口:等价于 `node scripts/install.mjs --uninstall`。 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const result = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'install.mjs'), '--uninstall'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
