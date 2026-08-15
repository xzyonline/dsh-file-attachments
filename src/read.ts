import { AttachmentError } from './errors.ts'
import { LIMITS } from './shared/contracts.ts'
import { redactSensitiveText } from './redact.ts'
import { readArchiveEntry } from './archive.ts'
import { readDocx, readPptx, readXlsx } from './parsers/ooxml.ts'
import { readPdf } from './parsers/pdf.ts'
import { readTextPage } from './parsers/text.ts'
import { readDoc, readEpub, readOdf, readRtf, readXls } from './parsers/legacy-office.ts'
import type { ReadAttachmentRequest, ReadAttachmentResult } from './worker-protocol.ts'

export interface StoredAttachmentHandle {
  path: string
  metadata: { detected: { family: string; kind: string } }
}

export async function readAttachment(handle: StoredAttachmentHandle, request: ReadAttachmentRequest, signal: AbortSignal): Promise<ReadAttachmentResult> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.parserTimeoutMs)])
  const result = await dispatchRead(handle, request, signal)
  // 统一出口脱敏:文本/归档条目路径已在内部脱敏(redacted > 0 时跳过);
  // docx/xlsx/pptx/pdf 等此前硬编码 redacted: 0,在这里兜底。
  if (result.redacted > 0) return result
  const redacted = redactSensitiveText(result.text)
  return { ...result, text: redacted.text, redacted: redacted.redacted }
}

async function dispatchRead(handle: StoredAttachmentHandle, request: ReadAttachmentRequest, signal: AbortSignal): Promise<ReadAttachmentResult> {
  switch (handle.metadata.detected.kind) {
    case 'pdf': return readPdf(handle.path, request, signal)
    case 'docx': return readDocx(handle.path, request, signal)
    case 'xlsx': return readXlsx(handle.path, request, signal)
    case 'pptx': return readPptx(handle.path, request, signal)
    case 'doc': return readDoc(handle.path, request, signal)
    case 'xls': return readXls(handle.path, request, signal)
    case 'rtf': return readRtf(handle.path, request, signal)
    case 'odt':
    case 'ods':
    case 'odp': return readOdf(handle.path, request, handle.metadata.detected.kind as 'odt' | 'ods' | 'odp', signal)
    case 'epub': return readEpub(handle.path, request, signal)
  }
  if (handle.metadata.detected.family === 'archive' && request.archivePath) return readArchiveEntry(handle, request.archivePath, signal)
  if (handle.metadata.detected.family === 'text') {
    const page = await readTextPage(handle.path, request, signal)
    return {
      kind: 'text',
      text: page.text,
      range: page.range,
      hasMore: page.hasMore,
      next: page.next,
      redacted: page.redacted,
      truncated: page.truncated,
    }
  }
  throw new AttachmentError('UNSUPPORTED_FILE_TYPE', `已识别 ${handle.metadata.detected.kind}，但当前读取器尚不支持其内容`)
}
