import { AttachmentError } from './errors.ts'
import type { AttachmentMetadata } from './shared/contracts.ts'
import { throwIfAborted } from './shared/utils.ts'

export interface SessionQueryLike {
  readSession(sessionId: string): Promise<{ events: readonly unknown[] }>
}

const SESSION_CHECK_TTL_MS = 10_000
const SESSION_CACHE_MAX_ENTRIES = 1_024
const sessionCheckCache = new Map<string, { ok: boolean; at: number }>()

/** 验证会话真实存在(失败关闭)。短 TTL 缓存,避免大会话每次读取都整本重放。 */
export async function sessionExists(query: SessionQueryLike, sessionId: string): Promise<boolean> {
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
  // 防无界增长：超出上限按插入序淘汰最旧条目。
  while (sessionCheckCache.size > SESSION_CACHE_MAX_ENTRIES) {
    const oldest = sessionCheckCache.keys().next().value
    if (oldest === undefined) break
    sessionCheckCache.delete(oldest)
  }
  return ok
}

export async function authorizeAttachmentRead(
  query: SessionQueryLike,
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
