import { describe, expect, it } from 'vitest'
import type { AttachmentMetadata } from '../src/shared/contracts.ts'
import { ATTACHMENT_DRAFT_SENTINEL, createAttachmentDraftStore } from '../src/client/store.ts'

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
  it('keeps the composer draft clean while the dock owns attachment presentation', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const result = await store.upload('session-a', '解释这个文件', file('app.config', 'x=1'))
    expect(result.draft).toBe('解释这个文件')
  })

  it('clears pending attachment chips and rotates the batch after send', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const before = store.batchId('session-a')
    const uploaded = await store.upload('session-a', '', file('app.config', 'x=1'))
    expect(store.files('session-a')).toHaveLength(1)
    expect(uploaded.draft).toBe(ATTACHMENT_DRAFT_SENTINEL)
    store.observeDraft('session-a', '')
    expect(store.files('session-a')).toHaveLength(0)
    expect(store.batchId('session-a')).not.toBe(before)
  })

  it('keeps a sent attachment receipt for the message history renderer', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const uploaded = await store.upload('session-a', '', file('app.config', 'x=1'))
    store.observeDraft('session-a', uploaded.draft)
    store.observeDraft('session-a', '')
    expect(store.sent('session-a')).toEqual({ draft: uploaded.draft, files: [uploaded.metadata] })
  })

  it('routes the turn-tail announcement to the claiming turn only', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const uploaded = await store.upload('session-a', '', file('app.config', 'x=1'))
    store.observeDraft('session-a', uploaded.draft)
    store.observeDraft('session-a', '')

    expect(store.tailSelect(1)).toEqual({ turn: 1 })
    expect(store.tailSelect(2)).toEqual({ turn: 2 })
    expect(store.claimTail('session-b', 2)).toBeUndefined()
    expect(store.tailSelect(3)).toEqual({ turn: 3 })
    expect(store.claimTail('session-a', 3)).toEqual({ draft: uploaded.draft, files: [uploaded.metadata] })
    expect(store.tailSelect(4)).toBeNull()
    expect(store.tailSelect(3)).toEqual({ turn: 3 })
  })

  it('clears the turn-tail announcement when a new upload starts', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const uploaded = await store.upload('session-a', '', file('app.config', 'x=1'))
    store.observeDraft('session-a', uploaded.draft)
    store.observeDraft('session-a', '')
    expect(store.tailSelect(1)).not.toBeNull()
    await store.upload('session-a', '', file('b.txt', 'b'))
    expect(store.tailSelect(1)).toBeNull()
  })

  it('removes the invisible composer sentinel with the last attachment', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    const uploaded = await store.upload('session-a', '', file('app.config', 'x=1'))
    await expect(store.remove('session-a', uploaded.metadata.id, uploaded.draft)).resolves.toBe('')
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

  it('notifies subscribed docks when a file is added or removed', async () => {
    const store = createAttachmentDraftStore(fakeApi())
    let updates = 0
    const unsubscribe = store.subscribe('session-a', () => { updates += 1 })
    const uploaded = await store.upload('session-a', '', file('a.txt', 'a'))
    await store.remove('session-a', uploaded.metadata.id, uploaded.draft)
    unsubscribe()
    expect(updates).toBe(2)
  })
})
