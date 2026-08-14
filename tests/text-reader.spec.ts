import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readTextPage } from '../src/parsers/text.ts'

const roots: string[] = []

async function tempText(text: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-text-'))
  roots.push(root)
  const path = join(root, 'input.txt')
  await writeFile(path, text)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('readTextPage', () => {
  it('stops at 2,000 lines and returns a resumable cursor', async () => {
    const path = await tempText(Array.from({ length: 2_010 }, (_, index) => `line ${index + 1}`).join('\n'))
    const page = await readTextPage(path, { offset: 0 }, new AbortController().signal)

    expect(page.lines).toBe(2_000)
    expect(page.hasMore).toBe(true)
    expect(page.next?.offset).toBeGreaterThan(0)
    expect(page.text).toContain('line 2000')
    expect(page.text).not.toContain('line 2001')
  })

  it('redacts secrets by default and reports the count', async () => {
    const page = await readTextPage(await tempText('user=x\npassword=hunter2\nport=443'), { offset: 0 }, new AbortController().signal)

    expect(page.text).toContain('password=[REDACTED]')
    expect(page.redacted).toBe(1)
  })

  it('uses byte and line bounds without splitting a UTF-8 line', async () => {
    const long = `${'中'.repeat(256 * 1024)}\nnext`
    const page = await readTextPage(await tempText(long), { offset: 0 }, new AbortController().signal)

    expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(256 * 1024)
    expect(page.truncated).toBe(true)
    expect(page.hasMore).toBe(true)
  })

  it('decodes UTF-16LE text from its BOM', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('password=x\n', 'utf16le')])
    const root = await mkdtemp(join(tmpdir(), 'dsh-text-'))
    roots.push(root)
    const path = join(root, 'utf16.txt')
    await writeFile(path, bytes)

    const page = await readTextPage(path, { offset: 0 }, new AbortController().signal)

    expect(page.text).toContain('password=[REDACTED]')
  })
})
