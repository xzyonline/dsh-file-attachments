import { describe, expect, it } from 'vitest'
import type { AttachmentMetadata } from '../src/shared/contracts.ts'
import { createAttachmentDraftStore } from '../src/client/store.ts'

function metadata(id = 'att_abcdef' as const): AttachmentMetadata {
  return { id, ownerSessionId: 'session-a', batchId: 'batch-a', safeName: 'app.config', declaredMime: 'text/plain', detected: { family: 'text', kind: 'config-ini', mime: 'text/plain', encoding: 'utf-8', confidence: 'medium', readable: true, mismatch: false, risks: [] }, bytes: 3, sha256: 'a'.repeat(64), createdAt: 1 }
}

function fakeApi(result = metadata()) {
  return { uploadFile: async () => result, deleteFile: async () => undefined }
}

function file(name: string, text: string): File {
  return new File([text], name, { type: 'text/plain' })
}

describe('attachment draft store', () => {
  it('appends one marker without losing the user draft', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const result = await store.upload('session-a', '解释这个文件', file('app.config', 'x=1'))
    expect(result.draft).toBe('解释这个文件\n<dsh-file ref="att_abcdef"/>')
  })

  it('rotates batch id only after a nonempty attachment draft commits to empty', () => {
    const store = createAttachmentDraftStore(fakeApi())
    const before = store.batchId('session-a')
    store.observeDraft('session-a', '<dsh-file ref="att_abcdef"/>')
    store.observeDraft('session-a', '')
    expect(store.batchId('session-a')).not.toBe(before)
  })

  it('keeps sessions isolated and removes only the requested marker', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    await store.upload('session-a', 'a', file('a.txt', 'a'))
    await store.upload('session-b', 'b', file('b.txt', 'b'))
    const draft = 'a\n<dsh-file ref="att_abcdef"/>\n<dsh-file ref="att_other"/>'
    expect(store.removeMarker(draft, 'att_abcdef')).toBe('a\n<dsh-file ref="att_other"/>')
    expect(store.files('session-a')).toHaveLength(1)
    expect(store.files('session-b')).toHaveLength(1)
  })
})
