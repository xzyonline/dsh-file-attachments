import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeDocx, makePptx, makeXlsx } from './fixtures.ts'
import { parseCellRange, readDocx, readPptx, readXlsx } from '../src/parsers/ooxml.ts'

const roots: string[] = []

async function writeFixture(bytes: Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ooxml-'))
  roots.push(root)
  const path = join(root, 'fixture.bin')
  await writeFile(path, bytes)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('OOXML readers', () => {
  it('reads DOCX paragraphs and table text by paragraph window', async () => {
    const path = await writeFixture(makeDocx({ paragraphs: ['one', 'two'], table: [['A', 'B']] }))
    const result = await readDocx(path, { paragraphOffset: 1, paragraphLimit: 2 }, new AbortController().signal)
    expect(result.text).toBe('two\nA | B')
  })

  it('lists XLSX sheets before reading a validated A1 range', async () => {
    const path = await writeFixture(makeXlsx({ Sheet1: [['name', 'score'], ['Ada', 10]] }))
    expect((await readXlsx(path, {}, new AbortController().signal)).text).toContain('Sheet1')
    expect((await readXlsx(path, { sheet: 'Sheet1', range: 'A1:B2' }, new AbortController().signal)).text).toContain('Ada\t10')
  })

  it('treats a bare column reference as the whole column', () => {
    expect(parseCellRange('A')).toEqual({ r1: 1, c1: 1, r2: Number.MAX_SAFE_INTEGER, c2: 1 })
    expect(parseCellRange('A1:B5')).toEqual({ r1: 1, c1: 1, r2: 5, c2: 2 })
    expect(parseCellRange('B2')).toEqual({ r1: 2, c1: 2, r2: 2, c2: 2 })
  })

  it('reads PPTX title, body, and notes from one slide', async () => {
    const path = await writeFixture(makePptx([{ title: 'Title', body: 'Body', notes: 'Note' }]))
    expect((await readPptx(path, { page: 1 }, new AbortController().signal)).text).toContain('Note')
  })
})
