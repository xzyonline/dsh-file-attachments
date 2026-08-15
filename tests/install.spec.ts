import { execFile } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('install-local', () => {
  it('backs up once, appends one row, preserves comments and stays idempotent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const patchPath = join(home, 'cordis.patch.yml')
    const before = '# keep this comment\n- id: existing\n  token: fake-secret\n'
    await writeFile(patchPath, before)
    const script = join(process.cwd(), 'scripts', 'install-local.mjs')
    const env = { ...process.env, DSH_HOME: home }
    const libDir = join(process.cwd(), 'lib')
    const requiredEntries = ['index.js', 'client.js']
    const existingEntries = new Set<string>()
    let libDirExisted = true
    try { await stat(libDir) } catch { libDirExisted = false }
    await mkdir(libDir, { recursive: true })
    for (const entry of requiredEntries) {
      try {
        await stat(join(libDir, entry))
        existingEntries.add(entry)
      } catch {
        await writeFile(join(libDir, entry), '')
      }
    }

    try {
      const first = await run(process.execPath, [script], { env })
      const after = await readFile(patchPath, 'utf8')
      expect(after.startsWith(before)).toBe(true)
      expect((after.match(/id: dsh-file-attachments/g) ?? [])).toHaveLength(1)
      expect(after).toContain('name: "@dsh-external/dsh-file-attachments"')
      expect(after).not.toContain(`name: ${JSON.stringify(process.cwd())}`)
      expect(after).not.toContain(`name: ${JSON.stringify(join(process.cwd(), 'lib', 'index.js'))}`)
      const packageLink = join(home, 'profiles', 'web', 'node_modules', '@dsh-external', 'dsh-file-attachments')
      const link = await lstat(packageLink)
      expect(link.isSymbolicLink()).toBe(true)
      expect(first.stdout).not.toContain('fake-secret')
      expect((await stat(`${patchPath}.bak`)).isFile()).toBe(true)

      const hash = after
      const second = await run(process.execPath, [script], { env })
      expect(second.stdout).toContain('already installed')
      expect(await readFile(patchPath, 'utf8')).toBe(hash)
    } finally {
      await Promise.all(requiredEntries.filter(entry => !existingEntries.has(entry)).map(entry => rm(join(libDir, entry), { force: true })))
      if (!libDirExisted) await rm(libDir, { recursive: true, force: true })
    }
  })

  it('migrates a legacy absolute plugin entry without duplicating the row', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const patchPath = join(home, 'cordis.patch.yml')
    const legacy = join(process.cwd(), 'lib', 'index.js')
    await writeFile(patchPath, `# keep this comment\n- insert:\n    - id: dsh-file-attachments\n      name: ${JSON.stringify(legacy)}\n      config:\n        root: ${JSON.stringify(join(home, 'file-attachments'))}\n`)
    const script = join(process.cwd(), 'scripts', 'install-local.mjs')
    const env = { ...process.env, DSH_HOME: home }
    const result = await run(process.execPath, [script], { env })
    const after = await readFile(patchPath, 'utf8')
    expect(after).toContain('name: "@dsh-external/dsh-file-attachments"')
    expect(after).not.toContain(`name: ${JSON.stringify(legacy)}`)
    expect((after.match(/id: dsh-file-attachments/g) ?? [])).toHaveLength(1)
    expect(result.stdout).toContain('migrated')
    expect((await stat(`${patchPath}.bak`)).isFile()).toBe(true)
  })
})
