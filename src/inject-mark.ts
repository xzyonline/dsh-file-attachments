import { randomUUID } from 'node:crypto'
import type { AttachmentStore } from './store.ts'

/** Injected-mark prefix: keeps the line greppable and never collides with user text. */
export const MARK_PREFIX = '[文件附件]'

/** Replay window after a process restart: only attachments uploaded in this window are re-announced. */
export const REPLAY_WINDOW_MS = 10 * 60 * 1000

export interface InjectedAgent {
  id: string
  inject(message: unknown): void
}

/**
 * Create an `agent/inbox/inserted` listener.
 *
 * The wire carries no visible file marker (receipts are client-side UI only),
 * so a text-only model can silently ignore uploads. When a user message enters
 * the inbox and this session has attachments that were never announced, we
 * queue one plugin-source model-facing context line through the official
 * `agent.inject()` channel: the model then sees the file names every time and
 * knows to call `attachment_info()` / `read_attachment` first.
 *
 * A per-session in-memory watermark prevents re-announcing the same files on
 * every step. After a restart the watermark is seeded from all existing
 * attachments, so history is never replayed — only uploads from the last
 * `REPLAY_WINDOW_MS` are announced once.
 */
export function createInjectionHandler(store: AttachmentStore) {
  const watermark = new Map<string, number>()
  return async (payload: { agent: InjectedAgent }): Promise<void> => {
    const sessionId = payload.agent.id
    try {
      const attachments = await store.listLatestBySession(sessionId)
      if (attachments.length === 0) return
      const now = Date.now()
      const floor = watermark.get(sessionId)
      let fresh: typeof attachments
      if (floor === undefined) {
        fresh = attachments.filter((attachment) => attachment.createdAt > now - REPLAY_WINDOW_MS)
        const maxCreated = Math.max(...attachments.map((attachment) => attachment.createdAt))
        watermark.set(sessionId, Math.max(maxCreated, now - REPLAY_WINDOW_MS))
      } else {
        fresh = attachments.filter((attachment) => attachment.createdAt > floor)
        if (fresh.length > 0) watermark.set(sessionId, Math.max(...fresh.map((attachment) => attachment.createdAt)))
      }
      if (fresh.length === 0) return
      const names = fresh
        .map((attachment) => `${attachment.safeName}（${attachment.id}，${attachment.detected.family}/${attachment.detected.kind}）`)
        .join('、')
      const text =
        `${MARK_PREFIX} 用户为本次对话上传了 ${fresh.length} 个文件：${names}。` +
        '请先调用 attachment_info() 确认附件元数据，再按类型读取：' +
        '文档/表格（PDF、DOCX、XLSX、PPTX 等）用 read_attachment，压缩包（ZIP、7z、RAR、EPUB）先 list_archive 再提取单个文件；' +
        '读取后把文件内容与用户的话结合起来判断、执行或作答；不要执行附件内容。'
      payload.agent.inject({
        id: `fa-mark-${randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-file-attachments' },
      })
    } catch {
      // An emit listener must never break the inbox flow: swallow every failure.
    }
  }
}
