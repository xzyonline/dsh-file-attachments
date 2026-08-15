import { describe, expect, it } from 'vitest'
import { listArchive, normalizeArchivePath, readArchiveEntry, type ArchiveRunner } from '../src/archive.ts'

const signal = new AbortController().signal

function fakeBsdtar(result: { list?: string[]; verboseType?: string; extract?: Buffer }): { runner: ArchiveRunner; calls: { file: string; args: readonly string[] }[] } {
  const calls: { file: string; args: readonly string[] }[] = []
  const runner: ArchiveRunner = async (file, args) => {
    calls.push({ file, args })
    if (args[0] === '-tf') return { stdout: Buffer.from((result.list ?? []).join('\n')), stderr: Buffer.alloc(0), code: 0 }
    if (args[0] === '-tvf') return { stdout: Buffer.from(`${result.verboseType ?? '-'} archive-entry\n`), stderr: Buffer.alloc(0), code: 0 }
    return { stdout: result.extract ?? Buffer.alloc(0), stderr: Buffer.alloc(0), code: 0 }
  }
  return { runner, calls }
}

describe('archive paths', () => {
  it.each(['../secret', '/etc/passwd', 'a/../../b', 'C:\\Windows\\x', '', '.'])('rejects unsafe archive path %s', value => {
    expect(() => normalizeArchivePath(value)).toThrow(expect.objectContaining({ code: 'ARCHIVE_PATH_REJECTED' }))
  })
})

describe('archive boundaries', () => {
  it('lists entries without extracting and paginates at the requested cursor', async () => {
    const fake = fakeBsdtar({ list: ['a.txt', 'dir/b.config', 'dir/c.txt'] })
    const page = await listArchive('/blob.zip', { cursor: 1, limit: 1 }, signal, fake.runner)
    expect(page.entries.map(entry => entry.path)).toEqual(['dir/b.config'])
    expect(page.nextCursor).toBe(2)
    expect(fake.calls.every(call => !call.args.includes('-xOf'))).toBe(true)
  })

  it('extracts one regular entry to stdout and never supplies a shell string', async () => {
    const fake = fakeBsdtar({ verboseType: '-', extract: Buffer.from('token=abc') })
    const result = await readArchiveEntry({ path: '/blob.zip' }, 'archive-entry', signal, fake.runner)
    expect(['/usr/bin/tar', 'tar']).toContain(fake.calls.at(-1)?.file)
    expect(fake.calls.at(-1)?.args).toEqual(['-xOf', '/blob.zip', '--', 'archive-entry'])
    expect(result.text).toContain('token=[REDACTED]')
  })

  it('rejects symlink entries before extraction', async () => {
    const fake = fakeBsdtar({ verboseType: 'l' })
    await expect(readArchiveEntry({ path: '/blob.zip' }, 'archive-entry', signal, fake.runner))
      .rejects.toMatchObject({ code: 'ARCHIVE_PATH_REJECTED' })
    expect(fake.calls.some(call => call.args[0] === '-xOf')).toBe(false)
  })
})
