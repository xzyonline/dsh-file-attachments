import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { readDoc, readEpub, readOdf, readRtf, readXls } from '../src/parsers/legacy-office.ts'

const roots: string[] = []

async function writeFixture(bytes: Uint8Array, name = 'fixture.bin'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-legacy-'))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, bytes)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const sig = new AbortController().signal

describe('legacy office readers', () => {
  it('reads .doc text from a real Word 97-2003 file', async () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'legacy-sample.doc')
    const result = await readDoc(fixture, {}, sig)
    expect(result.kind).toBe('doc')
    expect(result.text).toContain('合成测试文档')
    expect(result.text).toContain('SYNTHETIC-DOC-END')
  })

  it('reads .xls via SheetJS with sheet listing and content', async () => {
    const { createRequire } = await import('node:module')
    const XLSX = createRequire(import.meta.url)('@keep-lts/xlsx') as typeof import('@keep-lts/xlsx')
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['名称', '数量'], ['网关', 3]])
    XLSX.utils.book_append_sheet(workbook, sheet, '清单')
    const path = await writeFixture(XLSX.write(workbook, { bookType: 'biff8', type: 'buffer' }) as Uint8Array, 'fixture.xls')
    const listing = await readXls(path, {}, sig)
    expect(listing.text).toContain('清单')
    const content = await readXls(path, { sheet: '清单', range: 'A1:B2' }, sig)
    expect(content.text).toContain('名称\t数量')
    expect(content.text).toContain('网关\t3')
  })

  it('decodes RTF control words into plain text', async () => {
    const path = await writeFixture(new TextEncoder().encode('{\\rtf1\\ansi \\u26816\\u20462\\u26041\\u26696 \\b \\u37325\\u28857 \\b0\\par \\u31532\\u20108\\u34892}'), 'fixture.rtf')
    const result = await readRtf(path, {}, sig)
    expect(result.kind).toBe('rtf')
    expect(result.text).toContain('检修方案')
    expect(result.text).toContain('第二行')
    expect(result.text).toContain('重点')
  })

  it('reads .odt paragraphs', async () => {
    const zip = zipSync({
      'mimetype': new TextEncoder().encode('application/vnd.oasis.opendocument.text'),
      'content.xml': new TextEncoder().encode('<office:document xmlns:office="x" xmlns:text="x"><office:body><office:text><text:p>第一段</text:p><text:p>第二段</text:p></office:text></office:body></office:document>'),
    })
    const path = await writeFixture(zip, 'fixture.odt')
    const result = await readOdf(path, {}, 'odt', sig)
    expect(result.kind).toBe('odt')
    expect(result.text).toContain('第一段')
    expect(result.text).toContain('第二段')
  })

  it('reads .ods rows as tab-separated cells', async () => {
    const zip = zipSync({
      'mimetype': new TextEncoder().encode('application/vnd.oasis.opendocument.spreadsheet'),
      'content.xml': new TextEncoder().encode('<table:table xmlns:table="x" xmlns:text="x"><table:table-row><table:table-cell><text:p>名称</text:p></table:table-cell><table:table-cell><text:p>数量</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>网关</text:p></table:table-cell><table:table-cell><text:p>3</text:p></table:table-cell></table:table-row></table:table>'),
    })
    const path = await writeFixture(zip, 'fixture.ods')
    const result = await readOdf(path, {}, 'ods', sig)
    expect(result.kind).toBe('ods')
    expect(result.text).toContain('名称\t数量')
    expect(result.text).toContain('网关\t3')
  })

  it('reads .epub chapters following the spine', async () => {
    const zip = zipSync({
      'mimetype': new TextEncoder().encode('application/epub+zip'),
      'META-INF/container.xml': new TextEncoder().encode('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
      'OEBPS/content.opf': new TextEncoder().encode('<package><manifest><item id="c1" href="ch1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>'),
      'OEBPS/ch1.xhtml': new TextEncoder().encode('<html><head><title>第一章</title></head><body><p>第一章正文内容</p></body></html>'),
    })
    const path = await writeFixture(zip, 'fixture.epub')
    const result = await readEpub(path, {}, sig)
    expect(result.kind).toBe('epub')
    expect(result.text).toContain('第一章正文内容')
  })
})
