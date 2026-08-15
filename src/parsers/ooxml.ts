import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { AttachmentError } from '../errors.ts'
import { inspectZipBytes } from '../detect.ts'
import { LIMITS } from '../shared/contracts.ts'
import type { ReadAttachmentRequest, ReadAttachmentResult } from '../worker-protocol.ts'

export interface ZipParts {
  readText(path: string, maxBytes?: number): Promise<string | undefined>
  list(prefix: string): readonly string[]
  close(): void
}

export async function openOoxml(path: string, signal: AbortSignal): Promise<ZipParts> {
  if (signal.aborted) throw signal.reason
  const bytes = await readFile(path)
  const metadata = inspectZipBytes(bytes)
  if (!metadata) throw new AttachmentError('CORRUPT_FILE', 'Office 文档压缩包损坏')
  const decompressed = metadata.entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
  if (decompressed > LIMITS.decompressedBytes) throw new AttachmentError('FILE_TOO_LARGE', '文档解压后超过 256 MB')
  let archive: Record<string, Uint8Array>
  try { archive = unzipSync(bytes) } catch (cause) { throw new AttachmentError('CORRUPT_FILE', 'Office 文档压缩包损坏', undefined, cause) }
  const names = Object.keys(archive)
  if (names.some(name => name.startsWith('/') || name.split('/').includes('..'))) throw new AttachmentError('ARCHIVE_PATH_REJECTED', 'Office 文档包含不安全路径')
  return {
    async readText(name, maxBytes = 8 * 1024 * 1024) {
      const entry = archive[name]
      if (!entry || entry.byteLength > maxBytes) return undefined
      return new TextDecoder('utf-8', { fatal: false }).decode(entry)
    },
    list(prefix) { return names.filter(name => name.startsWith(prefix)) },
    close() { archive = {} },
  }
}

export async function readDocx(path: string, request: Pick<ReadAttachmentRequest, 'paragraphOffset' | 'paragraphLimit'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  const parts = await openOoxml(path, signal)
  try {
    const source = await parts.readText('word/document.xml')
    if (source === undefined) throw new AttachmentError('CORRUPT_FILE', 'DOCX 缺少正文')
    const tables = [...source.matchAll(/<w:tbl[\s\S]*?<\/w:tbl>/g)].map(match => [...match[0]!.matchAll(/<w:tc[\s\S]*?<\/w:tc>/g)].map(cell => stripXml(cell[0]!)).join(' | '))
    const paragraphs = [...source.replace(/<w:tbl[\s\S]*?<\/w:tbl>/g, '').matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map(match => [...match[0]!.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => stripXml(item[1]!)).join(''))
    const values = [...paragraphs, ...tables]
    const start = Math.max(0, request.paragraphOffset ?? 0)
    const selected = values.slice(start, start + Math.min(request.paragraphLimit ?? LIMITS.readLines, LIMITS.readLines))
    return { kind: 'docx', text: selected.join('\n'), range: { paragraphOffset: start, paragraphLimit: selected.length }, hasMore: start + selected.length < values.length, next: start + selected.length < values.length ? { paragraphOffset: start + selected.length } : undefined, redacted: 0, truncated: false }
  } finally { parts.close() }
}

export async function readXlsx(path: string, request: Pick<ReadAttachmentRequest, 'sheet' | 'range'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  const parts = await openOoxml(path, signal)
  try {
    const workbook = await parts.readText('xl/workbook.xml')
    const names = workbook ? [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*>/g)].map(match => match[1]!) : []
    if (!request.sheet) return { kind: 'xlsx', text: names.join('\n'), range: { sheets: names.length }, hasMore: false, redacted: 0, truncated: false }
    const index = names.indexOf(request.sheet)
    if (index < 0) throw new AttachmentError('CORRUPT_FILE', '工作表不存在')
    const sheet = await parts.readText(`xl/worksheets/sheet${index + 1}.xml`)
    if (!sheet) throw new AttachmentError('CORRUPT_FILE', '工作表内容缺失')
    const shared = parseSharedStrings(await parts.readText('xl/sharedStrings.xml'))
    const bounds = parseCellRange(request.range)
    const rows: string[] = []
    let runningRow = 0
    let processed = 0
    for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (processed >= LIMITS.readLines) break
      processed += 1
      const openTag = rowMatch[0]!.slice(0, rowMatch[0]!.indexOf('>'))
      const rowNumberMatch = /\br="(\d+)"/.exec(openTag)
      const rowNumber = rowNumberMatch ? Number(rowNumberMatch[1]) : runningRow + 1
      runningRow = rowNumber
      if (bounds && (rowNumber < bounds.r1 || rowNumber > bounds.r2)) continue
      const cells: string[] = []
      for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const cellAttrs = cellMatch[1]!
        const cellInner = cellMatch[2]!
        if (bounds) {
          const cellRef = /\br="([A-Za-z]+)\d+"/.exec(cellAttrs)
          if (cellRef) {
            const column = columnToNumber(cellRef[1]!)
            if (column < bounds.c1 || column > bounds.c2) continue
          }
        }
        const typeMatch = /\bt="([^"]+)"/.exec(cellAttrs)
        const cellType = typeMatch ? typeMatch[1] : undefined
        let value = ''
        if (cellType === 'inlineStr') {
          const inline = /<is>([\s\S]*?)<\/is>/.exec(cellInner)
          value = stripXml(inline ? inline[1]! : cellInner)
        } else {
          const valueMatch = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellInner)
          if (valueMatch) {
            const raw = stripXml(valueMatch[1]!)
            if (cellType === 's') {
              const stringIndex = Number(raw)
              value = Number.isInteger(stringIndex) && stringIndex >= 0 && stringIndex < shared.length ? shared[stringIndex]! : raw
            } else {
              value = raw
            }
          }
        }
        if (value !== '') cells.push(value)
      }
      if (cells.length > 0) rows.push(cells.join('\t'))
    }
    return { kind: 'xlsx', text: rows.join('\n'), range: { sheet: request.sheet, range: request.range ?? 'all' }, hasMore: false, redacted: 0, truncated: false }
  } finally { parts.close() }
}

function parseSharedStrings(source: string | undefined): string[] {
  if (!source) return []
  return [...source.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => stripXml(match[1]!))
}

interface CellRange { r1: number; c1: number; r2: number; c2: number }

export function parseCellRange(value: string | undefined): CellRange | null {
  if (!value) return null
  const match = /^([A-Za-z]+)(\d*)(?::([A-Za-z]+)(\d*))?$/.exec(value.trim())
  if (!match) return null
  const c1 = columnToNumber(match[1]!.toUpperCase())
  const r1 = match[2] ? Number(match[2]) : 1
  if (!Number.isInteger(r1) || r1 < 1) return null
  if (match[3] === undefined) return match[2] === '' ? { r1: 1, c1, r2: Number.MAX_SAFE_INTEGER, c2: c1 } : { r1, c1, r2: r1, c2: c1 }
  const c2 = columnToNumber(match[3]!.toUpperCase())
  const r2 = match[4] ? Number(match[4]) : Number.MAX_SAFE_INTEGER
  if (!Number.isInteger(r2) || r2 < r1) return null
  return { r1, c1, r2, c2 }
}

export function columnToNumber(column: string): number {
  let number = 0
  for (const character of column) number = number * 26 + (character.charCodeAt(0) - 64)
  return number
}
export async function readPptx(path: string, request: Pick<ReadAttachmentRequest, 'page'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  const parts = await openOoxml(path, signal)
  try {
    const slides = parts.list('ppt/slides/slide').filter(name => /slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]))
    const page = Math.min(Math.max(request.page ?? 1, 1), Math.max(slides.length, 1))
    const slide = await parts.readText(slides[page - 1] ?? '')
    const notes = await parts.readText(`ppt/notesSlides/notesSlide${page}.xml`)
    const text = [...(slide ?? ''), ...(notes ?? '')].length === 0 ? '' : [...(slide?.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? []), ...(notes?.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [])].map(match => stripXml(match[1]!)).join('\n')
    return { kind: 'pptx', text, range: { page, pageEnd: page, pages: slides.length }, hasMore: page < slides.length, next: page < slides.length ? { page: page + 1 } : undefined, redacted: 0, truncated: false }
  } finally { parts.close() }
}

export function stripXml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').trim()
}
