import { encodeAttachmentMarker, removeAttachmentMarker } from '../shared/marker.ts'
import type { AttachmentMetadata } from '../shared/contracts.ts'
import type { AttachmentApi } from './api.ts'

interface SessionState { batchId: string; files: AttachmentMetadata[]; lastDraft: string }

export function createAttachmentDraftStore(api: AttachmentApi, storage: Storage | undefined = globalThis.localStorage): {
  batchId(sessionId: string): string
  files(sessionId: string): AttachmentMetadata[]
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
    const next = { batchId: stored ? JSON.parse(stored).batchId : newBatchId(), files: [], lastDraft: '' }
    sessions.set(sessionId, next)
    return next
  }
  const persist = (sessionId: string, value: SessionState) => storage?.setItem(`dsh-file-attachments:${sessionId}`, JSON.stringify({ batchId: value.batchId }))
  return {
    batchId(sessionId) { return state(sessionId).batchId },
    files(sessionId) { return [...state(sessionId).files] },
    observeDraft(sessionId, draft) {
      const value = state(sessionId)
      if (value.lastDraft !== '' && draft === '') { value.batchId = newBatchId(); persist(sessionId, value) }
      value.lastDraft = draft
    },
    async upload(sessionId, draft, file) {
      if (file.type.startsWith('image/')) throw new Error('UNSUPPORTED_FILE_TYPE: 图片请使用原有图片按钮或粘贴')
      if (file.size > 25 * 1024 * 1024) throw new Error('FILE_TOO_LARGE: 文件超过 25 MB')
      const value = state(sessionId)
      const metadata = await api.uploadFile({ sessionId, batchId: value.batchId, file, signal: new AbortController().signal })
      value.files.push(metadata)
      const marker = encodeAttachmentMarker(metadata.id)
      value.lastDraft = draft.trim() ? `${draft.trim()}\n${marker}` : marker
      return { metadata, draft: value.lastDraft }
    },
    async remove(sessionId, id, draft) {
      await api.deleteFile(sessionId, id)
      const value = state(sessionId)
      value.files = value.files.filter(file => file.id !== id)
      return removeAttachmentMarker(draft, id)
    },
    removeMarker: removeAttachmentMarker,
  }
}

function newBatchId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
