import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { AttachmentError } from '../errors.ts'
import { LIMITS } from '../shared/contracts.ts'
import { parseCellRange, stripXml } from './ooxml.ts'
import { inspectZipBytes } from '../detect.ts'
import type { ReadAttachmentRequest, ReadAttachmentResult } from '../worker-protocol.ts'

const nodeRequire = createRequire(import.meta.url)

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function pageText(kind: ReadAttachmentResult['kind'], text: string, request: Pick<ReadAttachmentRequest, 'paragraphOffset' | 'paragraphLimit'>): ReadAttachmentResult {
  const lines = text.split(/\r?\n/)
  const start = Math.max(0, request.paragraphOffset ?? 0)
  const selected = lines.slice(start, start + Math.min(request.paragraphLimit ?? LIMITS.readLines, LIMITS.readLines))
  return {
    kind,
    text: selected.join('\n'),
    range: { paragraphOffset: start, paragraphLimit: selected.length },
    hasMore: start + selected.length < lines.length,
    next: start + selected.length < lines.length ? { paragraphOffset: start + selected.length } : undefined,
    redacted: 0,
    truncated: false,
  }
}

// ---------- .doc / .wps（Word 97-2003 兼容文本） ----------
export async function readDoc(path: string, request: Pick<ReadAttachmentRequest, 'paragraphOffset' | 'paragraphLimit'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  throwIfAborted(signal)
  let body: string
  try {
    const WordExtractor = nodeRequire('word-extractor') as new () => { extract(filePath: string): Promise<{ getBody(): string }> }
    const document = await new WordExtractor().extract(path)
    body = document.getBody()
  } catch (cause) {
    throw new AttachmentError('CORRUPT_FILE', '无法解析 Word 旧版文档（.doc/.wps）', undefined, cause)
  }
  return pageText('doc', body, request)
}

// ---------- .xls（BIFF8 旧版 Excel） ----------
export async function readXls(path: string, request: Pick<ReadAttachmentRequest, 'sheet' | 'range'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  throwIfAborted(signal)
  const XLSX = nodeRequire('@keep-lts/xlsx') as typeof import('@keep-lts/xlsx')
  let workbook: import('@keep-lts/xlsx').WorkBook
  try {
    workbook = XLSX.readFile(path, { type: 'file', cellText: true, cellFormula: false, cellDates: false, cellNF: false, sheetRows: LIMITS.readLines })
  } catch (cause) {
    throw new AttachmentError('CORRUPT_FILE', '无法解析 Excel 旧版文档（.xls）', undefined, cause)
  }
  const names = workbook.SheetNames
  if (!request.sheet) return { kind: 'xls', text: names.join('\n'), range: { sheets: names.length }, hasMore: false, redacted: 0, truncated: false }
  const index = names.indexOf(request.sheet)
  if (index < 0) throw new AttachmentError('CORRUPT_FILE', '工作表不存在')
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[names[index]!]!, { header: 1, raw: false, defval: '' }) as unknown[][]
  const bounds = parseCellRange(request.range)
  const lines: string[] = []
  rows.slice(0, LIMITS.readLines).forEach((row, rowIndex) => {
    if (bounds && (rowIndex + 1 < bounds.r1 || rowIndex + 1 > bounds.r2)) return
    const cells: string[] = []
    row.forEach((cell, columnIndex) => {
      if (bounds && (columnIndex + 1 < bounds.c1 || columnIndex + 1 > bounds.c2)) return
      const value = cell === null || cell === undefined ? '' : String(cell).replace(/\r?\n/g, ' ')
      if (value !== '') cells.push(value)
    })
    if (cells.length > 0) lines.push(cells.join('\t'))
  })
  return { kind: 'xls', text: lines.join('\n'), range: { sheet: request.sheet, range: request.range ?? 'all' }, hasMore: false, redacted: 0, truncated: false }
}

// ---------- .rtf ----------
export async function readRtf(path: string, request: Pick<ReadAttachmentRequest, 'paragraphOffset' | 'paragraphLimit'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  throwIfAborted(signal)
  const bytes = await readFile(path)
  return pageText('rtf', decodeRtf(bytes), request)
}

function decodeRtf(bytes: Uint8Array): string {
  const source = new TextDecoder('latin1').decode(bytes)
  let output = ''
  let index = 0
  while (index < source.length) {
    const character = source[index]!
    if (character !== '\\') {
      if (character !== '{' && character !== '}') output += character
      index += 1
      continue
    }
    const control = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(index))
    if (control) {
      index += control[0].length
      const word = control[1]!
      if (word === 'par' || word === 'line') output += '\n'
      else if (word === 'tab') output += '\t'
      else if (word === 'u') {
        let value = Number.parseInt(control[2] ?? '', 10)
        if (!Number.isNaN(value)) {
          if (value < 0) value += 65536
          output += String.fromCharCode(value)
        }
        const skip = /^\\'[0-9a-fA-F]{2}/.exec(source.slice(index))
        if (skip) index += skip[0].length
      }
      continue
    }
    const hex = /^\\'([0-9a-fA-F]{2})/.exec(source.slice(index))
    if (hex) {
      output += String.fromCharCode(Number.parseInt(hex[1]!, 16))
      index += hex[0].length
      continue
    }
    index += 1
    const escaped = source[index]
    if (escaped === '\\' || escaped === '{' || escaped === '}') {
      output += escaped
      index += 1
    }
  }
  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------- .odt / .ods / .odp ----------
export async function readOdf(path: string, request: ReadAttachmentRequest, kind: 'odt' | 'ods' | 'odp', signal: AbortSignal): Promise<ReadAttachmentResult> {
  throwIfAborted(signal)
  const files = await readZipTexts(path)
  const content = files['content.xml']
  if (!content) throw new AttachmentError('CORRUPT_FILE', 'OpenDocument 缺少 content.xml')
  let text: string
  if (kind === 'ods') {
    const rows = [...content.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)].slice(0, LIMITS.readLines).map(row => {
      const cells = [...row[1]!.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)].map(cell => stripXml(cell[1]!).replace(/\s+/g, ' ').trim())
      return cells.join('\t')
    })
    text = rows.join('\n')
  } else {
    text = [...content.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map(paragraph => stripXml(paragraph[1]!).trim()).filter(Boolean).join('\n')
  }
  return pageText(kind, text, request)
}

// ---------- .epub ----------
export async function readEpub(path: string, request: ReadAttachmentRequest, signal: AbortSignal): Promise<ReadAttachmentResult> {
  throwIfAborted(signal)
  const files = await readZipTexts(path)
  const container = files['META-INF/container.xml']
  if (!container) throw new AttachmentError('CORRUPT_FILE', 'EPUB 缺少 container.xml')
  const rootfile = /full-path="([^"]+)"/.exec(container)?.[1]
  const base = rootfile ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : ''
  let chapters: string[] = []
  const opf = rootfile ? files[rootfile] : undefined
  if (opf) {
    const manifest = new Map<string, string>()
    for (const item of opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/?>/g)) manifest.set(item[1]!, item[2]!)
    const spine = /<spine[^>]*>([\s\S]*?)<\/spine>/.exec(opf)?.[1] ?? ''
    for (const ref of spine.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
      const href = manifest.get(ref[1]!)
      if (href && /\.(x?html?|xml)$/i.test(href)) chapters.push(resolveZipPath(base, href))
    }
  }
  if (chapters.length === 0) chapters = Object.keys(files).filter(name => /\.(x?html?|xml)$/i.test(name)).sort()
  const pieces: string[] = []
  for (const chapter of chapters.slice(0, LIMITS.readLines)) {
    const html = files[chapter]
    if (html) pieces.push(stripXml(html))
  }
  return pageText('epub', pieces.join('\n\n'), request)
}

async function readZipTexts(path: string): Promise<Record<string, string>> {
  const bytes = await readFile(path)
  if (bytes.byteLength > LIMITS.archiveBytes) throw new AttachmentError('FILE_TOO_LARGE', '文件超过 100 MB')
  const metadata = inspectZipBytes(bytes)
  if (!metadata) throw new AttachmentError('CORRUPT_FILE', '文档压缩包损坏')
  const decompressed = metadata.entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
  if (decompressed > LIMITS.decompressedBytes) throw new AttachmentError('FILE_TOO_LARGE', '文档解压后超过 256 MB')
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(bytes)
  } catch (cause) {
    throw new AttachmentError('CORRUPT_FILE', '文档压缩包损坏', undefined, cause)
  }
  const result: Record<string, string> = {}
  for (const [name, data] of Object.entries(archive)) {
    if (data.byteLength > LIMITS.fileBytes) continue
    result[name] = new TextDecoder('utf-8', { fatal: false }).decode(data)
  }
  return result
}

function resolveZipPath(base: string, href: string): string {
  const decoded = decodeURIComponent(href.split('#', 1)[0] ?? href)
  const segments: string[] = []
  for (const segment of `${base}${decoded}`.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}
