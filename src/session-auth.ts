import { AttachmentError } from './errors.ts'
import { LIMITS, type AttachmentId, type AttachmentMetadata } from './shared/contracts.ts'
import { encodeAttachmentMarker, parseAttachmentMarkers } from './shared/marker.ts'

export interface SessionQueryLike {
  readSession(sessionId: string): Promise<{ events: readonly unknown[] }>
}

export interface AttachmentStoreLike {
  get(id: AttachmentId): Promise<AttachmentMetadata | undefined>
}

export async function authorizeAttachmentRead(
  query: SessionQueryLike,
  store: AttachmentStoreLike,
  sessionId: string,
  metadata: AttachmentMetadata,
  signal: AbortSignal,
): Promise<void> {
  if (metadata.ownerSessionId !== sessionId) forbidden()
  throwIfAborted(signal)
  const snapshot = await query.readSession(sessionId)
  throwIfAborted(signal)
  const needle = encodeAttachmentMarker(metadata.id)
  const containing = snapshot.events.map(extractEventText).find(text => text.includes(needle))
  if (containing === undefined) forbidden()

  const referenced = await Promise.all(parseAttachmentMarkers(containing).map(id => store.get(id)))
  if (referenced.some(item => item === undefined)) forbidden()
  const attachments = referenced as AttachmentMetadata[]
  if (attachments.some(item => item.ownerSessionId !== sessionId)) forbidden()
  if (attachments.length > LIMITS.messageFiles || attachments.reduce((sum, item) => sum + item.bytes, 0) > LIMITS.messageBytes) {
    throw new AttachmentError('MESSAGE_FILES_TOO_LARGE', '单条消息最多 10 个文件且总计不超过 50 MB')
  }
}

function extractEventText(event: unknown): string {
  if (typeof event === 'string') return event
  if (!event || typeof event !== 'object') return ''
  const record = event as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) return record.content.map(item => extractEventText(item)).join('')
  if (record.message) return extractEventText(record.message)
  return ''
}

function forbidden(): never {
  throw new AttachmentError('ATTACHMENT_FORBIDDEN', '附件不属于当前会话或未在会话日志中引用')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
