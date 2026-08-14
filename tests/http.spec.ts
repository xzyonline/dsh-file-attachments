import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentStore } from '../src/store.ts'
import { dispatchAttachmentHttp } from '../src/http.ts'

const roots: string[] = []

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-http-'))
  roots.push(root)
  const store = new AttachmentStore(root)
  return { store }
}

async function call(store: AttachmentStore, headers: Record<string, string>, body: Buffer) {
  const req = Readable.from([body]) as Readable & { method: string; url: string; headers: Record<string, string> }
  req.method = 'POST'
  req.url = '/api/dsh-file-attachments/v1/files'
  req.headers = headers
  let statusCode = 200
  let output = ''
  const res = { setHeader() {}, end(value: string) { output = value }, get statusCode() { return statusCode }, set statusCode(value: number) { statusCode = value } } as never
  await dispatchAttachmentHttp(req as never, res, store, { expectedOrigin: 'http://127.0.0.1:0' })
  return { statusCode, body: JSON.parse(output) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('attachment HTTP routes', () => {
  it('accepts one same-origin raw upload and returns verified metadata', async () => {
    const { store } = await setup()
    const response = await call(store, { origin: 'http://127.0.0.1:0', 'x-dsh-session-id': 'session-a', 'x-dsh-batch-id': 'batch-a', 'x-dsh-file-name': encodeURIComponent('app.config'), 'content-type': 'application/octet-stream' }, Buffer.from('[server]\npassword=x'))
    expect(response.statusCode).toBe(201)
    expect(response.body.metadata.detected.kind).toBe('config-ini')
  })

  it('rejects a cross-origin browser upload', async () => {
    const { store } = await setup()
    const response = await call(store, { origin: 'https://evil.test', 'x-dsh-session-id': 'session-a', 'x-dsh-batch-id': 'batch-a', 'x-dsh-file-name': 'a.config' }, Buffer.from('x=1'))
    expect(response.statusCode).toBe(403)
    expect(response.body.error.code).toBe('ATTACHMENT_FORBIDDEN')
  })

  it('rejects an oversize declared body before reading it', async () => {
    const { store } = await setup()
    const response = await call(store, { origin: 'http://127.0.0.1:0', 'x-dsh-session-id': 'session-a', 'x-dsh-batch-id': 'batch-a', 'x-dsh-file-name': 'a.config', 'content-length': String(25 * 1024 * 1024 + 1) }, Buffer.alloc(0))
    expect(response.statusCode).toBe(413)
    expect(response.body.error.code).toBe('FILE_TOO_LARGE')
  })
})
