import { describe, expect, it, vi } from 'vitest'
import { createInjectionHandler, MARK_PREFIX, REPLAY_WINDOW_MS } from '../src/inject-mark.ts'

interface FakeAttachment {
  id: string
  safeName: string
  createdAt: number
}

function fakeAttachment(id: string, createdAt: number): FakeAttachment {
  return { id, safeName: `${id}.txt`, createdAt }
}

function harness(attachments: () => Promise<FakeAttachment[]>) {
  const injected: unknown[] = []
  const agent = { id: 'session-1', inject: (message: unknown) => injected.push(message) }
  const store = { listLatestBySession: vi.fn(attachments) } as never
  const handler = createInjectionHandler(store)
  return { handler, injected, agent }
}

describe('createInjectionHandler', () => {
  it('announces fresh attachments once, then stays silent for the same session', async () => {
    const base = Date.now() - 1_000
    const { handler, injected, agent } = harness(async () => [fakeAttachment('att-a', base)])
    await handler({ agent })
    await handler({ agent })
    expect(injected).toHaveLength(1)
    const message = injected[0]! as { content: { text: string }[]; source: { kind: string; plugin: string } }
    expect(message.content[0]!.text).toContain(MARK_PREFIX)
    expect(message.content[0]!.text).toContain('att-a')
    expect(message.source.kind).toBe('plugin')
    expect(message.source.plugin).toBe('dsh-file-attachments')
  })

  it('announces new uploads that arrive after the previous watermark', async () => {
    const base = Date.now() - 1_000
    let list = [fakeAttachment('att-a', base)]
    const { handler, injected, agent } = harness(async () => list)
    await handler({ agent })
    list = [fakeAttachment('att-a', base), fakeAttachment('att-b', base + 500)]
    await handler({ agent })
    expect(injected).toHaveLength(2)
    const second = injected[1]! as { content: { text: string }[] }
    expect(second.content[0]!.text).toContain('att-b')
    expect(second.content[0]!.text).not.toContain('att-a')
  })

  it('never replays history after a restart: only the replay window is announced', async () => {
    const base = Date.now()
    const old = fakeAttachment('att-old', base - 2 * REPLAY_WINDOW_MS)
    const recent = fakeAttachment('att-recent', base - 1_000)
    const { handler, injected, agent } = harness(async () => [recent, old])
    await handler({ agent })
    expect(injected).toHaveLength(1)
    const text = (injected[0]! as { content: { text: string }[] }).content[0]!.text
    expect(text).toContain('att-recent')
    expect(text).not.toContain('att-old')
  })

  it('injects nothing when the session has no attachments', async () => {
    const { handler, injected, agent } = harness(async () => [])
    await handler({ agent })
    expect(injected).toHaveLength(0)
  })

  it('never throws when inject or the store fails (emit listener must be inert)', async () => {
    const { handler, agent } = harness(async () => {
      throw new Error('store down')
    })
    await expect(handler({ agent })).resolves.toBeUndefined()
    const throwing = harness(async () => [fakeAttachment('att-x', Date.now())])
    throwing.agent.inject = () => {
      throw new Error('inject down')
    }
    await expect(throwing.handler({ agent: throwing.agent })).resolves.toBeUndefined()
  })

  it('bundles every same-batch file into one announcement line', async () => {
    const base = Date.now() - 1_000
    const { handler, injected, agent } = harness(async () => [
      fakeAttachment('att-1', base),
      fakeAttachment('att-2', base),
      fakeAttachment('att-3', base),
    ])
    await handler({ agent })
    expect(injected).toHaveLength(1)
    const text = (injected[0]! as { content: { text: string }[] }).content[0]!.text
    expect(text).toContain('att-1')
    expect(text).toContain('att-2')
    expect(text).toContain('att-3')
    expect(text).toContain('3 个文件')
  })
})
