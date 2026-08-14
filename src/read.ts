import { AttachmentError } from './errors.ts'
import { readTextPage } from './parsers/text.ts'
import type { ReadAttachmentRequest, ReadAttachmentResult } from './worker-protocol.ts'

export interface StoredAttachmentHandle {
  path: string
  metadata: { detected: { family: string; kind: string } }
}

export async function readAttachment(handle: StoredAttachmentHandle, request: ReadAttachmentRequest, signal: AbortSignal): Promise<ReadAttachmentResult> {
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
