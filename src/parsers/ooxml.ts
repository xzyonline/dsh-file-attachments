import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { AttachmentError } from '../errors.ts'
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
    const rows = [...sheet.matchAll(/<row[\s\S]*?<\/row>/g)].slice(0, LIMITS.readLines).map(row => [...row[0]!.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => stripXml(cell[1]!.replace(/<[^>]+>/g, ''))).join('\t'))
    return { kind: 'xlsx', text: rows.join('\n'), range: { sheet: request.sheet, range: request.range ?? 'all' }, hasMore: false, redacted: 0, truncated: false }
  } finally { parts.close() }
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

function stripXml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').trim()
}
