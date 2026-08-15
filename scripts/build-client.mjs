import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib', '.client-build')
// 跨平台运行 tsdown:不依赖 node_modules/.bin 的 shim(Windows 上是 .cmd,execFile 无法直接执行),
// 直接用 node 运行其 CLI 入口。
const tsdownEntry = join(dirname(require.resolve('tsdown/package.json')), 'dist', 'run.mjs')
const clientPath = join(buildDir, 'client.cjs')
const outputPath = join(root, 'lib', 'client.js')

await mkdir(join(root, 'lib'), { recursive: true })
await run(process.execPath, [tsdownEntry, '--config', join(root, 'tsdown.client.config.ts')], { cwd: root })

const cjs = await readFile(clientPath, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-file-attachments",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${cjs.split('\n').map(line => `    ${line}`).join('\n')}
    return module.exports;
  }
});
`

await writeFile(outputPath, wrapped)
await rm(buildDir, { recursive: true, force: true })
