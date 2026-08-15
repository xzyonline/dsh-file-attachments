import { AttachmentError } from './errors.ts'
import type { AttachmentId, AttachmentMetadata } from './shared/contracts.ts'

export interface SessionQueryLike {
  readSession(sessionId: string): Promise<{ events: readonly unknown[] }>
}

export interface AttachmentStoreLike {
  get(id: AttachmentId): Promise<AttachmentMetadata | undefined>
}

const SESSION_CHECK_TTL_MS = 10_000
const sessionCheckCache = new Map<string, { ok: boolean; at: number }>()

/** 验证会话真实存在(失败关闭)。短 TTL 缓存,避免大会话每次读取都整本重放。 */
async function sessionExists(query: SessionQueryLike, sessionId: string): Promise<boolean> {
  const cached = sessionCheckCache.get(sessionId)
  const now = Date.now()
  if (cached && now - cached.at < SESSION_CHECK_TTL_MS) return cached.ok
  let ok = false
  try {
    await query.readSession(sessionId)
    ok = true
  } catch {
    ok = false
  }
  sessionCheckCache.set(sessionId, { ok, at: now })
  return ok
}

export async function authorizeAttachmentRead(
  query: SessionQueryLike,
  _store: AttachmentStoreLike,
  sessionId: string,
  metadata: AttachmentMetadata,
  signal: AbortSignal,
): Promise<void> {
  if (metadata.ownerSessionId !== sessionId) forbidden()
  throwIfAborted(signal)
  if (!(await sessionExists(query, sessionId))) forbidden()
}

function forbidden(): never {
  throw new AttachmentError('ATTACHMENT_FORBIDDEN', '附件不属于当前会话')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
