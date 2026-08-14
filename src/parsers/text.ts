import { open, stat } from 'node:fs/promises'
import { redactSensitiveText } from '../redact.ts'
import { LIMITS } from '../shared/contracts.ts'
import type { ReadAttachmentRequest } from '../worker-protocol.ts'

export interface TextPageResult {
  text: string
  lines: number
  hasMore: boolean
  next?: { offset: number }
  redacted: number
  truncated: boolean
  range: { offset: number; bytes: number }
}

export async function readTextPage(path: string, request: Pick<ReadAttachmentRequest, 'offset'> = {}, signal: AbortSignal): Promise<TextPageResult> {
  const offset = Math.max(0, request.offset ?? 0)
  throwIfAborted(signal)
  const fileInfo = await stat(path)
  if (offset >= fileInfo.size) return { text: '', lines: 0, hasMore: false, redacted: 0, truncated: false, range: { offset, bytes: 0 } }

  const handle = await open(path, 'r')
  try {
    const readSize = Math.min(LIMITS.readBytes + 4, fileInfo.size - offset)
    const buffer = Buffer.alloc(readSize)
    const result = await handle.read(buffer, 0, readSize, offset)
    throwIfAborted(signal)
    const bytes = buffer.subarray(0, result.bytesRead)
    const decoded = decodeText(bytes, offset === 0)
    const complete = fitByteLimit(decoded.text.endsWith('\ufffd') ? decoded.text.slice(0, -1) : decoded.text, decoded.encoding)
    const allLines = complete.split(/\r?\n/)
    const lineLimitReached = allLines.length > LIMITS.readLines
    const selectedLines = lineLimitReached ? allLines.slice(0, LIMITS.readLines) : allLines
    const text = selectedLines.join('\n')
    const consumedBytes = byteLength(text, decoded.encoding) + (lineLimitReached ? byteLength(decoded.encoding === 'utf-8' ? '\n' : '\n', decoded.encoding) : 0)
    const nextOffset = Math.min(fileInfo.size, offset + Math.max(consumedBytes, 1))
    const hasMore = lineLimitReached || offset + result.bytesRead < fileInfo.size
    const redacted = redactSensitiveText(text)
    return {
      text: redacted.text,
      lines: selectedLines.length,
      hasMore,
      next: hasMore ? { offset: nextOffset } : undefined,
      redacted: redacted.redacted,
      truncated: hasMore,
      range: { offset, bytes: Math.max(consumedBytes, 0) },
    }
  } finally {
    await handle.close()
  }
}

function decodeText(bytes: Uint8Array, atStart: boolean): { text: string; encoding: 'utf-8' | 'utf-16le' } {
  if (atStart && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (atStart && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2)
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1]!
      swapped[index - 1] = bytes[index]!
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf-16le' }
  }
  if (atStart && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder().decode(bytes.subarray(3)), encoding: 'utf-8' }
  return { text: new TextDecoder().decode(bytes), encoding: 'utf-8' }
}

function byteLength(text: string, encoding: 'utf-8' | 'utf-16le'): number {
  return encoding === 'utf-16le' ? Buffer.byteLength(text, 'utf16le') : Buffer.byteLength(text, 'utf8')
}

function fitByteLimit(text: string, encoding: 'utf-8' | 'utf-16le'): string {
  if (byteLength(text, encoding) <= LIMITS.readBytes) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (byteLength(text.slice(0, middle), encoding) <= LIMITS.readBytes) low = middle
    else high = middle - 1
  }
  return text.slice(0, low)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
