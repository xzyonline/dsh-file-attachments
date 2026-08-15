import { execFile } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('install (cross-platform)', () => {
  it('backs up once, appends one row, preserves comments and stays idempotent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const patchPath = join(home, 'cordis.patch.yml')
    const before = '# keep this comment\n- id: existing\n  token: fake-secret\n'
    await writeFile(patchPath, before)
    const script = join(process.cwd(), 'scripts', 'install.mjs')
    const env = { ...process.env, DSH_HOME: home }

    const first = await run(process.execPath, [script], { env })
    const after = await readFile(patchPath, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect((after.match(/id: dsh-file-attachments/g) ?? [])).toHaveLength(1)
    expect(after).toContain('name: "@dsh-external/dsh-file-attachments"')
    expect(after).toContain(`root: ${JSON.stringify(join(home, 'file-attachments'))}`)
    expect(first.stdout).not.toContain('fake-secret')
    expect((await stat(`${patchPath}.bak`)).isFile()).toBe(true)

    // Windows 目录联接在 Node 中同样报告为符号链接;无权限时安装器自动回退联接
    const packageLink = join(home, 'profiles', 'web', 'node_modules', '@dsh-external', 'dsh-file-attachments')
    const link = await lstat(packageLink)
    expect(link.isSymbolicLink()).toBe(true)

    const hash = after
    const second = await run(process.execPath, [script], { env })
    expect(second.stdout).toContain('跳过写入')
    expect(await readFile(patchPath, 'utf8')).toBe(hash)
  })

  it('removes only the plugin row on --uninstall', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const patchPath = join(home, 'cordis.patch.yml')
    const before = '# keep this comment\n- id: existing\n  token: fake-secret\n'
    await writeFile(patchPath, before)
    const script = join(process.cwd(), 'scripts', 'install.mjs')
    const env = { ...process.env, DSH_HOME: home }

    await run(process.execPath, [script], { env })
    const installed = await readFile(patchPath, 'utf8')
    expect((installed.match(/id: dsh-file-attachments/g) ?? [])).toHaveLength(1)

    await run(process.execPath, [script, '--uninstall'], { env })
    const removed = await readFile(patchPath, 'utf8')
    expect((removed.match(/id: dsh-file-attachments/g) ?? [])).toHaveLength(0)
    expect(removed).toContain('id: existing')
    expect(removed).toContain('fake-secret')
    await rm(join(home, 'profiles', 'web', 'node_modules', '@dsh-external'), { recursive: true, force: true })
  })
})
