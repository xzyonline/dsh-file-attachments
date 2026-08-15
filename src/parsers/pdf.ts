import { readFile } from 'node:fs/promises'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { AttachmentError } from '../errors.ts'
import { LIMITS } from '../shared/contracts.ts'
import type { ReadAttachmentRequest, ReadAttachmentResult } from '../worker-protocol.ts'

export async function readPdf(path: string, request: Pick<ReadAttachmentRequest, 'page' | 'pageEnd'> = {}, signal: AbortSignal): Promise<ReadAttachmentResult> {
  if (signal.aborted) throw signal.reason
  const data = await readFile(path)
  if (data.includes(Buffer.from('/Encrypt'))) throw new AttachmentError('ENCRYPTED_FILE', 'PDF 受密码保护')
  let document: PDFDocumentProxy | undefined
  let loadingTask: ReturnType<typeof getDocument> | undefined
  try {
    loadingTask = getDocument({ data: new Uint8Array(data), useSystemFonts: false, maxImageSize: 16 * 1024 * 1024 })
    const aborted = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
      signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })
    document = await Promise.race([loadingTask.promise, aborted])
    const first = clamp(request.page ?? 1, 1, document.numPages)
    const last = clamp(request.pageEnd ?? first, first, Math.min(document.numPages, first + 9))
    const pages: string[] = []
    for (let pageNumber = first; pageNumber <= last; pageNumber++) {
      if (signal.aborted) throw signal.reason
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(orderText(content.items))
    }
    const redacted = pages.map(text => text).join('\n')
    const safe = redacted.split(/\r?\n/).slice(0, LIMITS.readLines).join('\n').slice(0, LIMITS.readBytes)
    return {
      kind: 'pdf', text: safe, range: { page: first, pageEnd: last, pages: document.numPages },
      hasMore: last < document.numPages, next: last < document.numPages ? { page: last + 1 } : undefined,
      redacted: 0, truncated: safe.length < redacted.length,
    }
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    if (String((error as { name?: string }).name) === 'PasswordException') throw new AttachmentError('ENCRYPTED_FILE', 'PDF 受密码保护', undefined, error)
    throw new AttachmentError('CORRUPT_FILE', 'PDF 无法解析', undefined, error)
  } finally {
    try { await loadingTask?.destroy() } catch { /* best effort */ }
    await document?.cleanup().catch(() => undefined)
  }
}

function orderText(items: unknown[]): string {
  const positioned = items.map(item => {
    const value = item as { str?: string; transform?: number[] }
    return { text: value.str ?? '', x: value.transform?.[4] ?? 0, y: value.transform?.[5] ?? 0 }
  }).filter(item => item.text)
  positioned.sort((a, b) => Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x)
  let previousY: number | undefined
  return positioned.map(item => {
    const prefix = previousY === undefined || Math.abs(previousY - item.y) <= 2 ? '' : '\n'
    previousY = item.y
    return prefix + item.text
  }).join('')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max)
}
