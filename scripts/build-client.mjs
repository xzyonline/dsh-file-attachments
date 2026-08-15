import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib', '.client-build')
const tsdown = join(root, 'node_modules', '.bin', 'tsdown')
const clientPath = join(buildDir, 'client.cjs')
const outputPath = join(root, 'lib', 'client.js')

await mkdir(join(root, 'lib'), { recursive: true })
await run(tsdown, ['--config', join(root, 'tsdown.client.config.ts')], { cwd: root })

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
