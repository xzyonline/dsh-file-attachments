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
} {
  const sessions = new Map<string, SessionState>()
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
  }
}

function newBatchId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
