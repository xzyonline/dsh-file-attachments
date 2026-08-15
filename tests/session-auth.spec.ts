import { describe, expect, it } from 'vitest'
import { authorizeAttachmentRead, type SessionQueryLike } from '../src/session-auth.ts'
import type { AttachmentMetadata } from '../src/shared/contracts.ts'

const signal = new AbortController().signal

function fakeMeta(overrides: Partial<AttachmentMetadata> = {}): AttachmentMetadata {
  return {
    id: 'att_abcdef',
    ownerSessionId: 'session-a',
    batchId: 'batch-a',
    safeName: 'note.txt',
    declaredMime: 'text/plain',
    detected: {
      family: 'text', kind: 'text', mime: 'text/plain', encoding: 'utf-8', confidence: 'medium', readable: true, mismatch: false, risks: [],
    },
    bytes: 4,
    sha256: 'a'.repeat(64),
    createdAt: 1,
    ...overrides,
  }
}

function sessionQuery(events: readonly unknown[]): SessionQueryLike {
  return { readSession: async () => ({ events }) }
}

const store = {
  get: async (id: string) => id === 'att_abcdef' ? fakeMeta() : undefined,
} as never

describe('authorizeAttachmentRead', () => {
  it('authorizes an attachment by immutable session ownership without leaking an id into user text', async () => {
    const metadata = fakeMeta()
    await expect(authorizeAttachmentRead(sessionQuery([{ type: 'user', text: '请读附件：note.txt' }]), store, 'session-a', metadata, signal))
      .resolves.toBeUndefined()
  })

  it('rejects a copied marker from another session', async () => {
    const metadata = fakeMeta({ ownerSessionId: 'session-a' })
    await expect(authorizeAttachmentRead(sessionQuery([{ type: 'user', text: '<dsh-file ref="att_abcdef"/>' }]), store, 'session-b', metadata, signal))
      .rejects.toMatchObject({ code: 'ATTACHMENT_FORBIDDEN' })
  })

  it('rejects reads when the calling session no longer exists', async () => {
    const metadata = fakeMeta({ ownerSessionId: 'ghost-session' })
    const missing: SessionQueryLike = { readSession: async () => { throw new Error('no such session') } }
    await expect(authorizeAttachmentRead(missing, store, 'ghost-session', metadata, signal))
      .rejects.toMatchObject({ code: 'ATTACHMENT_FORBIDDEN' })
  })

})
