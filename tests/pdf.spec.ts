import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encryptedPdfFixture, makeMinimalPdf } from './fixtures.ts'
import { readPdf } from '../src/parsers/pdf.ts'

const roots: string[] = []

async function writeFixture(bytes: Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pdf-'))
  roots.push(root)
  const path = join(root, 'fixture.pdf')
  await writeFile(path, bytes)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('readPdf', () => {
  it('reads only the requested PDF page and reports continuation', async () => {
    const result = await readPdf(await writeFixture(makeMinimalPdf(['page one', 'page two'])), { page: 2 }, new AbortController().signal)

    expect(result.kind).toBe('pdf')
    expect(result.text).toContain('page two')
    expect(result.text).not.toContain('page one')
    expect(result.range).toEqual({ page: 2, pageEnd: 2, pages: 2 })
  })

  it('returns ENCRYPTED_FILE for password-protected PDFs', async () => {
    await expect(readPdf(await writeFixture(encryptedPdfFixture()), { page: 1 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ENCRYPTED_FILE' })
  })
})
