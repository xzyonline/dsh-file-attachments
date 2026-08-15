import { removeAttachmentMarker } from '../shared/marker.ts'
import type { AttachmentMetadata } from '../shared/contracts.ts'
import type { AttachmentApi } from './api.ts'

export const ATTACHMENT_DRAFT_SENTINEL = '\u200b'

export interface SentAttachmentReceipt { draft: string; files: AttachmentMetadata[] }
interface SessionState { batchId: string; files: AttachmentMetadata[]; lastDraft: string; pending: boolean; sent?: SentAttachmentReceipt; listeners: Set<() => void> }

export function createAttachmentDraftStore(api: AttachmentApi, storage: Storage | undefined = globalThis.localStorage): {
  batchId(sessionId: string): string
  files(sessionId: string): AttachmentMetadata[]
  sent(sessionId: string): SentAttachmentReceipt | undefined
  subscribe(sessionId: string, listener: () => void): () => void
  observeDraft(sessionId: string, draft: string): void
  upload(sessionId: string, draft: string, file: File): Promise<{ metadata: AttachmentMetadata; draft: string }>
  remove(sessionId: string, id: string, draft: string): Promise<string>
  removeMarker(draft: string, id: string): string
  /** 回合尾链的纯路由选择器:只有存在待展示回执时才匹配,认领后锁定在认领回合。 */
  tailSelect(turn: number): unknown
  /** 回合尾组件挂载时认领回执:会话不符返回 undefined(不消耗公告)。 */
  claimTail(sessionId: string, turn: number): SentAttachmentReceipt | undefined
} {
  const sessions = new Map<string, SessionState>()
  let turnAnnouncement: { sessionId: string; receipt: SentAttachmentReceipt } | null = null
  let turnAnnouncementTurn: number | null = null
  const clearAnnouncement = (): void => {
    turnAnnouncement = null
    turnAnnouncementTurn = null
  }
  const state = (sessionId: string): SessionState => {
    const found = sessions.get(sessionId)
    if (found) return found
    const stored = storage?.getItem(`dsh-file-attachments:${sessionId}`)
    const next = { batchId: stored ? JSON.parse(stored).batchId : newBatchId(), files: [], lastDraft: '', pending: false, sent: undefined, listeners: new Set<() => void>() }
    sessions.set(sessionId, next)
    return next
  }
  const notify = (sessionId: string) => { for (const listener of state(sessionId).listeners) listener() }
  const persist = (sessionId: string, value: SessionState) => storage?.setItem(`dsh-file-attachments:${sessionId}`, JSON.stringify({ batchId: value.batchId }))
  return {
    batchId(sessionId) { return state(sessionId).batchId },
    files(sessionId) { return [...state(sessionId).files] },
    sent(sessionId) {
      const receipt = state(sessionId).sent
      return receipt ? { draft: receipt.draft, files: [...receipt.files] } : undefined
    },
    subscribe(sessionId, listener) {
      const listeners = state(sessionId).listeners
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    observeDraft(sessionId, draft) {
      const value = state(sessionId)
      if (draft === '' && (value.pending || value.lastDraft !== '')) {
        value.sent = value.files.length > 0 ? { draft: value.lastDraft, files: [...value.files] } : undefined
        turnAnnouncement = value.files.length > 0 ? { sessionId, receipt: { draft: value.lastDraft, files: [...value.files] } } : null
        turnAnnouncementTurn = null
        value.batchId = newBatchId()
        value.pending = false
        value.files = []
        persist(sessionId, value)
        notify(sessionId)
      }
      value.lastDraft = draft
    },
    async upload(sessionId, draft, file) {
      if (file.type.startsWith('image/')) throw new Error('UNSUPPORTED_FILE_TYPE: 图片请使用原有图片按钮或粘贴')
      if (file.size > 25 * 1024 * 1024) throw new Error('FILE_TOO_LARGE: 文件超过 25 MB')
      const value = state(sessionId)
      value.sent = undefined
      clearAnnouncement()
      const metadata = await api.uploadFile({ sessionId, batchId: value.batchId, file, signal: new AbortController().signal })
      value.files.push(metadata)
      value.pending = true
      value.lastDraft = draft
      notify(sessionId)
      return { metadata, draft: draft.trim() ? draft : ATTACHMENT_DRAFT_SENTINEL }
    },
    async remove(sessionId, id, draft) {
      await api.deleteFile(sessionId, id)
      const value = state(sessionId)
      const removed = value.files.find(file => file.id === id)
      value.files = value.files.filter(file => file.id !== id)
      if (value.files.length === 0) value.pending = false
      notify(sessionId)
      const nextDraft = removeAttachmentMarker(draft, id, removed?.safeName)
      return nextDraft === ATTACHMENT_DRAFT_SENTINEL ? '' : nextDraft
    },
    removeMarker: removeAttachmentMarker,
    tailSelect(turn: number): unknown {
      if (turnAnnouncement === null) return null
      if (turnAnnouncementTurn !== null && turnAnnouncementTurn !== turn) return null
      return { turn }
    },
    claimTail(sessionId: string, turn: number): SentAttachmentReceipt | undefined {
      if (turnAnnouncement === null || turnAnnouncement.sessionId !== sessionId) return undefined
      turnAnnouncementTurn = turn
      return { draft: turnAnnouncement.receipt.draft, files: [...turnAnnouncement.receipt.files] }
    },
  }
}

function newBatchId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
