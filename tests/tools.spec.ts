import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAttachmentToolDefinitions } from '../src/tools.ts'
import { AttachmentStore } from '../src/store.ts'
import { installInlineParseFactory } from './helpers/inline-parse.ts'

beforeAll(() => installInlineParseFactory())

const sessionQuery = { readSession: async () => ({ events: [] }) }

describe('attachment tools', () => {
  it('registers exactly the three stable tool names and schemas', () => {
    const definitions = createAttachmentToolDefinitions({} as never, {} as never)
    expect(definitions.map(definition => definition.name)).toEqual(['attachment_info', 'read_attachment', 'list_archive'])
    expect((definitions[0]!.parameters as { properties: Record<string, { required?: boolean }> }).properties.attachment_id!.required).toBeUndefined()
    expect((definitions[1]!.parameters as { properties: Record<string, { type: string }> }).properties.archive_path!.type).toBe('string')
    expect(definitions[0]!.parameters).toMatchObject({
      type: 'object',
      properties: { attachment_id: { type: 'string' }, file_name: { type: 'string' } },
    })
    expect((definitions[0]!.parameters as { required?: string[] }).required).toBeUndefined()
    for (const definition of definitions) {
      expect(definition.output?.schema).toMatchObject({ type: 'object' })
      expect(definition.output?.render).toEqual(expect.any(Function))
    }
  })

  it('uses the DSH typed-tool compiler to reject missing required arguments before execution', async () => {
    const definitions = createAttachmentToolDefinitions({} as never, {} as never)
    await expect(definitions[1]!.execute({}, { agent: { id: 'session-a' }, signal: new AbortController().signal } as never))
      .rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })

  it('returns lossless JSON when a text attachment has no continuation page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tools-'))
    try {
      const store = new AttachmentStore(root)
      const metadata = await store.put({
        sessionId: 'session-a',
        batchId: 'batch-a',
        name: 'report.md',
        declaredMime: 'text/markdown',
        source: Readable.from([Buffer.from('# ready\\n')]),
        signal: new AbortController().signal,
      })
      const definitions = createAttachmentToolDefinitions({ sessionQuery } as never, store)
      const result = await definitions[1]!.execute(
        { attachment_id: metadata.id },
        { agent: { id: 'session-a' }, signal: new AbortController().signal } as never,
      ) as Record<string, unknown>

      expect(result).toMatchObject({ kind: 'text', hasMore: false })
      expect(result).not.toHaveProperty('next')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lists current-session attachments when called without a visible filename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tools-'))
    try {
      const store = new AttachmentStore(root)
      const metadata = await store.put({
        sessionId: 'session-a',
        batchId: 'batch-a',
        name: 'report.md',
        declaredMime: 'text/markdown',
        source: Readable.from([Buffer.from('# ready\\n')]),
        signal: new AbortController().signal,
      })
      const definitions = createAttachmentToolDefinitions({ sessionQuery } as never, store)
      const result = await definitions[0]!.execute(
        {},
        { agent: { id: 'session-a' }, signal: new AbortController().signal } as never,
      ) as { attachments: Array<{ id: string }> }

      expect(result.attachments).toMatchObject([{ id: metadata.id }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
