import { describe, expect, it, vi } from 'vitest'
import { createInjectionHandler, MARK_PREFIX } from '../src/inject-mark.ts'

interface FakeAttachment {
  id: string
  safeName: string
  createdAt: number
  detected: { family: string; kind: string }
}

interface FakeMessage {
  content: { type: string; text?: string }[]
  source?: { kind: string }
}

function fakeAttachment(id: string, createdAt: number): FakeAttachment {
  return { id, safeName: `${id}.txt`, createdAt, detected: { family: 'text', kind: 'plain' } }
}

const ID_A = 'att_' + 'a'.repeat(32)
const ID_B = 'att_' + 'b'.repeat(32)
const ID_C = 'att_' + 'c'.repeat(32)

/** A plain history line (no source or an older source). */
function historyMessage(text: string): FakeMessage {
  return { content: [{ type: 'text', text }] }
}

/** The final plain user message that opens a turn. */
function userTurnMessage(text: string): FakeMessage {
  return { content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** A tool-continuation batch: last message is a tool result, not a plain user message. */
function toolResultMessage(text: string): FakeMessage {
  return { content: [{ type: 'text', text }], source: { kind: 'tool' } }
}

/** A projected history line announcing the given ids (as persisted by a previous step). */
function announceLine(ids: string[]): string {
  return `${MARK_PREFIX} 用户为本次对话上传了文件：${ids.join('、')}。请先调用 attachment_info()`
}

function harness(attachments: () => Promise<FakeAttachment[]>, events: readonly unknown[] = []) {
  const store = { listLatestBySession: vi.fn(attachments) } as never
  const sessionQuery = { readSession: vi.fn(async () => ({ events })) } as never
  const handler = createInjectionHandler(store, sessionQuery)
  return { handler, sessionQuery }
}

async function run(handler: ReturnType<typeof createInjectionHandler>, messages: FakeMessage[]) {
  const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [...messages] }))
  const decision = (await handler({ agent: { id: 'session-1' }, messages }, next)) as { kind: string; messages: unknown[] }
  return { decision, messages: (decision.messages ?? []) as FakeMessage[] }
}

describe('createInjectionHandler (pre-step waterfall)', () => {
  it('appends one announcement line for a plain user turn and never repeats it', async () => {
    const { handler } = harness(async () => [fakeAttachment(ID_A, 1)])
    const first = await run(handler, [historyMessage('old history'), userTurnMessage('user text')])
    expect(first.messages).toHaveLength(3)
    const injected = first.messages[2]!.content[0]!.text!
    expect(injected).toContain(MARK_PREFIX)
    expect(injected).toContain(ID_A)
    expect(injected).toContain('text/plain')
    expect(injected).toContain('attachment_info')
    const source = (first.messages[2]! as unknown as { source: { kind: string; plugin: string } }).source
    expect(source.kind).toBe('plugin')
    expect(source.plugin).toBe('dsh-file-attachments')

    const second = await run(handler, [historyMessage('old history'), userTurnMessage('next turn')])
    expect(second.messages).toHaveLength(2)
  })

  it('announces only files whose ids are missing from the durable log after a restart', async () => {
    // Simulates a process restart: the watermark map is gone, but the durable
    // log carries the previous announcement line containing ID_A.
    const events = [
      {
        type: 'user/message',
        data: { source: { kind: 'plugin', plugin: 'dsh-file-attachments' }, content: [{ type: 'text', text: announceLine([ID_A]) }] },
      },
    ]
    const { handler } = harness(async () => [fakeAttachment(ID_A, 1), fakeAttachment(ID_B, 2)], events)
    const first = await run(handler, [userTurnMessage('user text')])
    expect(first.messages).toHaveLength(2)
    const injected = first.messages[1]!.content[0]!.text!
    expect(injected).toContain(ID_B)
    expect(injected).not.toContain(ID_A)
  })

  it('announces files uploaded before a restart that were never announced, however old', async () => {
    // Bug fix: the old window heuristic silently dropped unannounced files older
    // than 10 minutes after a restart. History has no announcement line here.
    const old = fakeAttachment(ID_C, Date.now() - 60 * 60 * 1000)
    const { handler } = harness(async () => [old])
    const first = await run(handler, [userTurnMessage('user text')])
    expect(first.messages).toHaveLength(2)
    expect(first.messages[1]!.content[0]!.text!).toContain(ID_C)
  })

  it('returns the decision unchanged when the session has no attachments', async () => {
    const { handler } = harness(async () => [])
    const { decision, messages } = await run(handler, [userTurnMessage('user text')])
    expect(messages).toHaveLength(1)
    expect(decision.kind).toBe('enter')
  })

  it('never disturbs tool-continuation batches (last message is a tool result)', async () => {
    const { handler } = harness(async () => [fakeAttachment(ID_A, 1)])
    const { messages } = await run(handler, [historyMessage('old history'), toolResultMessage('tool output')])
    expect(messages).toHaveLength(2)
  })

  it('returns the decision unchanged when the store fails', async () => {
    const { handler } = harness(async () => {
      throw new Error('store down')
    })
    const { decision, messages } = await run(handler, [userTurnMessage('user text')])
    expect(decision.kind).toBe('enter')
    expect(messages).toHaveLength(1)
  })

  it('returns a reject decision untouched', async () => {
    const { handler } = harness(async () => [fakeAttachment(ID_A, 1)])
    const next = vi.fn(async () => ({ kind: 'reject' as const }))
    const decision = (await handler({ agent: { id: 'session-1' }, messages: [] }, next)) as { kind: string }
    expect(decision.kind).toBe('reject')
    expect(next).toHaveBeenCalledOnce()
  })

  it('bundles every unannounced file into one announcement line', async () => {
    const { handler } = harness(async () => [fakeAttachment(ID_A, 1), fakeAttachment(ID_B, 2), fakeAttachment(ID_C, 3)])
    const first = await run(handler, [userTurnMessage('user text')])
    expect(first.messages).toHaveLength(2)
    const injected = first.messages[1]!.content[0]!.text!
    expect(injected).toContain(ID_A)
    expect(injected).toContain(ID_B)
    expect(injected).toContain(ID_C)
    expect(injected).toContain('3 个文件')
  })
})
