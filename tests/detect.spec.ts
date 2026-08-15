import { zipSync } from 'fflate'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectFile, detectFileFromPath } from '../src/detect.ts'

const text = (name: string, source: string) =>
  detectFile({ name, declaredMime: '', bytes: Buffer.from(source) })

const utf16be = (source: string) => {
  const littleEndian = Buffer.from(source, 'utf16le')
  for (let index = 0; index < littleEndian.length; index += 2) {
    const next = littleEndian[index]
    littleEndian[index] = littleEndian[index + 1]!
    littleEndian[index + 1] = next!
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), littleEndian])
}

const officeArchive = (partName: string, contentType: string) => zipSync({
  '[Content_Types].xml': Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${partName}" ContentType="${contentType}"/></Types>`),
  [partName]: Buffer.from('<document/>'),
})

const unsupportedOfficePayload = () => {
  const archive = Buffer.from(zipSync({
    '[Content_Types].xml': Buffer.from('<Types/>'),
    'word/document.xml': Buffer.from('not inspected during detection'),
  }))
  const name = Buffer.from('word/document.xml')
  const nameOffset = archive.indexOf(name)
  const localOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), nameOffset)
  const centralOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), nameOffset)
  archive.writeUInt16LE(99, localOffset + 8)
  archive.writeUInt16LE(99, centralOffset + 10)
  archive.writeUInt32LE(3 * 1024 * 1024, localOffset + 22)
  archive.writeUInt32LE(3 * 1024 * 1024, centralOffset + 24)
  return archive
}

describe('detectFile', () => {
  it.each([
    ['app.config', '<?xml version="1.0"?><configuration/>', 'config-xml'],
    ['app.config', '{"feature":true}', 'config-json'],
    ['app.config', '[server]\nport=8080', 'config-ini'],
    ['app.config', 'feature on\nworkers 4', 'config-text'],
    ['Dockerfile', 'FROM node:22\nRUN npm ci', 'dockerfile'],
    ['no-extension', '#!/bin/zsh\necho ok', 'shell'],
  ])('%s classifies from content', async (name, source, kind) => {
    const result = await text(name, source)

    expect(result.kind).toBe(kind)
    expect(result.family).toBe('text')
    expect(result.readable).toBe(true)
  })

  it('detects a disguised executable and marks the extension mismatch', async () => {
    const result = await detectFile({
      name: 'report.txt',
      declaredMime: 'text/plain',
      bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
    })

    expect(result.family).toBe('binary')
    expect(result.mismatch).toBe(true)
    expect(result.readable).toBe(false)
    expect(result.risks).toContain('type-mismatch')
  })

  it.each([
    ['UTF-8', Buffer.from('hello ✓'), 'utf-8'],
    ['UTF-16LE', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf16le')]), 'utf-16le'],
    ['UTF-16BE', utf16be('hello'), 'utf-16be'],
  ])('decodes %s text', async (_label, bytes, encoding) => {
    const result = await detectFile({ name: 'note.txt', declaredMime: 'text/plain', bytes })

    expect(result).toMatchObject({ family: 'text', kind: 'text', encoding, readable: true })
  })

  it.each([
    ['an invalid UTF-8 leading byte', Buffer.from([0xc3, 0x28])],
    ['a run of invalid UTF-8 continuation bytes', Buffer.from([0x80, 0x81, 0x82])],
    ['DEL-heavy bytes', Buffer.from([0x7f, 0x7f, 0x7f, 0x7f, 0x7f])],
  ])('rejects %s instead of accepting replacement-decoded binary', async (_label, bytes) => {
    const result = await detectFile({ name: 'payload.txt', declaredMime: '', bytes })

    expect(result).toMatchObject({ family: 'binary', kind: 'unknown-binary', readable: false })
  })

  it.each([
    ['empty input', Buffer.alloc(0), 'unknown', 'unknown'],
    ['NUL-heavy input', Buffer.from([0, 1, 0, 2, 0, 3, 0, 4]), 'binary', 'unknown-binary'],
    ['unknown printable input', Buffer.from('unstructured prose'), 'text', 'text'],
  ])('handles %s safely', async (_label, bytes, family, kind) => {
    const result = await detectFile({ name: 'file', declaredMime: '', bytes })

    expect(result).toMatchObject({ family, kind })
  })

  it.each([
    ['image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image', 'png'],
    ['document.pdf', Buffer.from('%PDF-1.7\n'), 'document', 'pdf'],
    ['archive.zip', zipSync({ 'notes.txt': Buffer.from('hello') }), 'archive', 'zip'],
    ['archive.7z', Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 'archive', '7z'],
    ['archive.rar', Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0]), 'archive', 'rar'],
  ])('recognizes binary magic for %s', async (name, bytes, family, kind) => {
    const result = await detectFile({ name, declaredMime: '', bytes })

    expect(result).toMatchObject({ family, kind, readable: family === 'document' })
  })

  it.each([
    ['report.docx', { '[Content_Types].xml': Buffer.from('<Types/>'), 'word/document.xml': Buffer.from('<w:document/>') }, 'docx'],
    ['budget.xlsx', { '[Content_Types].xml': Buffer.from('<Types/>'), 'xl/workbook.xml': Buffer.from('<workbook/>') }, 'xlsx'],
    ['slides.pptx', { '[Content_Types].xml': Buffer.from('<Types/>'), 'ppt/presentation.xml': Buffer.from('<p:presentation/>') }, 'pptx'],
    ['book.epub', { mimetype: Buffer.from('application/epub+zip') }, 'epub'],
  ])('recognizes ZIP container markers for %s', async (name, files, kind) => {
    const result = await detectFile({ name, declaredMime: '', bytes: zipSync(files) })

    expect(result).toMatchObject({ family: 'document', kind, readable: true })
  })

  it.each([
    ['upload.bin', officeArchive('word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'), 'docx'],
    ['upload.bin', officeArchive('xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'), 'xlsx'],
    ['upload.bin', officeArchive('ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'), 'pptx'],
  ])('keeps the subtype when file-type directly identifies real OOXML %s', async (name, bytes, kind) => {
    const result = await detectFile({ name, declaredMime: '', bytes })

    expect(result).toMatchObject({ family: 'document', kind, readable: true })
  })

  it('identifies Office from bounded central-directory metadata without decompressing an unsupported entry', async () => {
    const result = await detectFile({ name: 'upload.zip', declaredMime: 'application/zip', bytes: unsupportedOfficePayload() })

    expect(result).toMatchObject({ family: 'document', kind: 'docx', readable: true, mismatch: true })
  })

  it('refuses a highly compressible oversized EPUB mimetype payload before decompression', async () => {
    const bytes = zipSync({ mimetype: Buffer.alloc(3 * 1024 * 1024, 'a') }, { level: 9 })
    const result = await detectFile({ name: 'bomb.zip', declaredMime: 'application/zip', bytes })

    expect(result).toMatchObject({ family: 'archive', kind: 'zip', readable: false })
  })

  it.each([
    ['.env', 'API_URL=https://example.test', 'env'],
    ['settings.jsonc', '// comment\n{"enabled": true}', 'config-json'],
    ['settings.yaml', 'enabled: true\nitems:\n  - one', 'config-yaml'],
    ['settings.toml', '[server]\nport = 8080', 'config-toml'],
    ['Info.plist', '<?xml version="1.0"?><plist><dict/></plist>', 'plist'],
    ['users.csv', 'name,email\nAda,ada@example.test', 'csv'],
    ['users.tsv', 'name\temail\nAda\tada@example.test', 'tsv'],
    ['query.sql', 'SELECT id FROM users;', 'sql'],
    ['README.md', '# Heading\n\nParagraph', 'markdown'],
    ['index.ts', 'export const answer: number = 42', 'source-typescript'],
    ['main.py', 'def main():\n    return 42', 'source-python'],
  ])('classifies textual formats by content, special name, or extension', async (name, source, kind) => {
    const result = await text(name, source)

    expect(result).toMatchObject({ family: 'text', kind, readable: true })
  })

  it('does not let a text extension upgrade unknown binary', async () => {
    const result = await detectFile({ name: 'payload.ts', declaredMime: 'text/typescript', bytes: Buffer.from([0, 255, 0, 254]) })

    expect(result).toMatchObject({ family: 'binary', kind: 'unknown-binary', readable: false, mismatch: true })
  })

  it('marks declared MIME conflicts without blocking readable content', async () => {
    const result = await detectFile({ name: 'notes.txt', declaredMime: 'application/pdf', bytes: Buffer.from('hello') })

    expect(result).toMatchObject({ family: 'text', kind: 'text', readable: true, mismatch: true })
    expect(result.risks).toContain('type-mismatch')
  })

  it.each([
    ['a DOCX declared as PDF', 'upload.docx', 'application/pdf', officeArchive('word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')],
    ['a PNG declared as JPEG', 'image.png', 'image/jpeg', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a ZIP declared as RAR', 'archive.zip', 'application/vnd.rar', zipSync({ 'notes.txt': Buffer.from('hello') })],
    ['a PDF named as JavaScript despite its correct declared MIME', 'script.js', 'application/pdf', Buffer.from('%PDF-1.7\n')],
    ['a PNG named as TypeScript despite its correct declared MIME', 'source.tsx', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a PNG named as JPEG despite its correct declared MIME', 'photo.jpg', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ])('marks concrete type conflicts for %s', async (_label, name, declaredMime, bytes) => {
    const result = await detectFile({ name, declaredMime, bytes })

    expect(result.mismatch).toBe(true)
    expect(result.risks).toContain('type-mismatch')
  })

  it.each([
    ['source.js', 'text/javascript', Buffer.from('export const answer = 42')],
    ['settings.yaml', 'text/yaml', Buffer.from('enabled: true')],
    ['archive.zip', 'application/x-zip-compressed', zipSync({ 'notes.txt': Buffer.from('hello') })],
  ])('accepts safe kind-specific MIME aliases for %s', async (name, declaredMime, bytes) => {
    const result = await detectFile({ name, declaredMime, bytes })

    expect(result.mismatch).toBe(false)
  })
})

describe('detectFileFromPath', () => {
  it('uses the bounded file head to classify an on-disk text upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-detect-'))
    const path = join(directory, 'fixtures-detect-config.json')
    await writeFile(path, '{"feature":true}')
    try {
      const result = await detectFileFromPath({ name: 'app.config', declaredMime: '', path, signal: new AbortController().signal })
      expect(result).toMatchObject({ family: 'text', kind: 'config-json', readable: true })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reads only ZIP metadata needed to classify an on-disk Office archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-detect-'))
    const path = join(directory, 'upload.zip')
    await writeFile(path, officeArchive('word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'))
    try {
      const result = await detectFileFromPath({ name: 'upload.zip', declaredMime: '', path, signal: new AbortController().signal })
      expect(result).toMatchObject({ family: 'document', kind: 'docx', readable: true })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('markup detection (html / xml / svg / markdown)', () => {
  it('detects html from DOCTYPE and from the .html extension', async () => {
    expect(await text('page.html', '<!DOCTYPE html><html><body>hi</body></html>')).toMatchObject({ family: 'text', kind: 'html', mime: 'text/html', readable: true })
    expect(await text('page.htm', 'plain text without markup')).toMatchObject({ kind: 'html' })
  })

  it('detects svg markup and keeps it readable as text', async () => {
    expect(await text('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toMatchObject({ family: 'text', kind: 'svg', mime: 'image/svg+xml', readable: true })
  })

  it('detects xml by content and by extension', async () => {
    expect(await text('conf.xml', '<?xml version="1.0"?><root><item>1</item></root>')).toMatchObject({ kind: 'config-xml', mime: 'application/xml' })
    expect(await text('data.rss', '<?xml version="1.0"?><rss><channel/></rss>')).toMatchObject({ kind: 'config-xml' })
  })

  it('detects markdown by heading and by extension', async () => {
    expect(await text('notes.md', '# Title\n\nBody')).toMatchObject({ family: 'text', kind: 'markdown', mime: 'text/markdown', readable: true })
  })

  it('flags html content inside a .txt name as a type mismatch', async () => {
    const result = await text('note.txt', '<!DOCTYPE html><html></html>')
    expect(result.kind).toBe('html')
    expect(result.mismatch).toBe(true)
  })
})
