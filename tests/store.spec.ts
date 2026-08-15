import { Readable } from 'node:stream'
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AttachmentStore } from '../src/store.ts'
import { installInlineParseFactory } from './helpers/inline-parse.ts'

beforeAll(() => installInlineParseFactory())

const roots: string[] = []

async function testStore() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-attachments-'))
  roots.push(root)
  return new AttachmentStore(root, () => 1_700_000_000_000)
}

function upload(sessionId: string, batchId: string, name: string, text: string) {
  return {
    sessionId,
    batchId,
    name,
    declaredMime: 'text/plain',
    source: Readable.from([Buffer.from(text)]),
    signal: new AbortController().signal,
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('AttachmentStore', () => {
  it('deduplicates bytes while keeping separate session-bound metadata', async () => {
    const store = await testStore()
    const a = await store.put(upload('session-a', 'batch-a', 'a.config', 'x=1'))
    const b = await store.put(upload('session-b', 'batch-b', 'b.config', 'x=1'))

    expect(a.sha256).toBe(b.sha256)
    expect(a.id).not.toBe(b.id)
    expect(await readdir(join(store.root, 'blobs', 'sha256', a.sha256.slice(0, 2)))).toHaveLength(1)
    expect((await store.get(a.id))?.ownerSessionId).toBe('session-a')
  })

  it('enforces ten files per session batch before accepting the next reference', async () => {
    const store = await testStore()
    for (let index = 0; index < 10; index++) await store.put(upload('session-a', 'batch-a', `${index}.txt`, 'x'))

    await expect(store.put(upload('session-a', 'batch-a', 'overflow.txt', 'x')))
      .rejects.toMatchObject({ code: 'MESSAGE_FILES_TOO_LARGE' })
  })

  it('reopens metadata and returns a safe blob path without trusting stored paths', async () => {
    const store = await testStore()
    const metadata = await store.put(upload('session-a', 'batch-a', '../report.txt', 'hello'))
    const reopened = new AttachmentStore(store.root)
    const result = await reopened.open(metadata.id)

    expect(result.metadata.safeName).toBe('report.txt')
    expect(result.path).toBe(join(store.root, 'blobs', 'sha256', metadata.sha256.slice(0, 2), metadata.sha256))
    expect((await readFile(result.path)).toString()).toBe('hello')
    await expect(reopened.get('att_../../escape' as never)).resolves.toBeUndefined()
  })

  it('keeps identical batch IDs isolated by session and writes private metadata', async () => {
    const store = await testStore()
    const first = await store.put(upload('session-a', 'same-batch', 'a.txt', 'a'))
    const second = await store.put(upload('session-b', 'same-batch', 'b.txt', 'b'))

    expect(await store.listBatch('session-a', 'same-batch')).toHaveLength(1)
    expect(await store.listBatch('session-b', 'same-batch')).toHaveLength(1)
    expect((await stat(join(store.root, 'refs', `${first.id}.json`))).mode & 0o777).toBe(0o600)
    expect((await stat(join(store.root, 'refs', `${second.id}.json`))).mode & 0o777).toBe(0o600)
  })

  it('removes a draft reference but keeps the immutable blob available to a duplicate reference', async () => {
    const store = await testStore()
    const first = await store.put(upload('session-a', 'batch-a', 'a.txt', 'same'))
    const second = await store.put(upload('session-a', 'batch-a', 'b.txt', 'same'))

    await store.removeDraft('session-a', first.id)

    await expect(store.get(first.id)).resolves.toBeUndefined()
    await expect(store.open(second.id)).resolves.toMatchObject({ metadata: { id: second.id } })
    await expect(stat(join(store.root, 'blobs', 'sha256', second.sha256.slice(0, 2), second.sha256))).resolves.toBeTruthy()
  })

  it('finds the newest same-name attachment only inside the calling session', async () => {
    let now = 1
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachments-'))
    roots.push(root)
    const store = new AttachmentStore(root, () => now++)
    await store.put(upload('session-a', 'batch-a', 'report.md', 'old'))
    const newest = await store.put(upload('session-a', 'batch-b', 'report.md', 'new'))
    await store.put(upload('session-b', 'batch-c', 'report.md', 'foreign'))

    await expect(store.findLatestByName('session-a', 'report.md')).resolves.toMatchObject({ id: newest.id })
    await expect(store.findLatestByName('session-c', 'report.md')).resolves.toBeUndefined()
  })

  it('lists current-session attachments newest first for invisible composer context', async () => {
    let now = 1
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachments-'))
    roots.push(root)
    const store = new AttachmentStore(root, () => now++)
    const first = await store.put(upload('session-a', 'batch-a', 'first.md', 'one'))
    const second = await store.put(upload('session-a', 'batch-a', 'second.md', 'two'))
    await store.put(upload('session-b', 'batch-b', 'foreign.md', 'no'))

    await expect(store.listLatestBySession('session-a')).resolves.toEqual([second, first])
  })

  it('heals legacy refs by computing the real storage path on read', async () => {
    const store = await testStore()
    const metadata = await store.put(upload('session-a', 'batch-a', 'legacy.txt', 'old'))
    const refPath = join(store.root, 'refs', `${metadata.id}.json`)
    const onDisk = JSON.parse(await readFile(refPath, 'utf8')) as Record<string, unknown>
    delete onDisk.storagePath
    await writeFile(refPath, JSON.stringify(onDisk))

    const reopened = await store.get(metadata.id)
    expect(reopened?.storagePath).toBe(join(store.root, 'blobs', 'sha256', metadata.sha256.slice(0, 2), metadata.sha256))
  })
})
