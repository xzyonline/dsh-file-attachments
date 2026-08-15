import { describe, expect, it } from 'vitest'
import { ATTACHMENT_PROMPT, apply, inject, name } from '../src/index.ts'

describe('plugin composition', () => {
  it('exports the DSH plugin identity and required injections', () => {
    expect(name).toBe('dsh-file-attachments')
    expect(inject).toEqual(['tools', 'systemPrompt', 'webServer', 'sessionQuery'])
    expect(ATTACHMENT_PROMPT).toContain('attachment_info')
    expect(ATTACHMENT_PROMPT).toContain('current-session')
    expect(ATTACHMENT_PROMPT).toMatch(/no visible file marker/i)
    expect(ATTACHMENT_PROMPT).toMatch(/combine the file content with the user/i)
  })

  it('installs effects without mutating the context directly', () => {
    const effects: string[] = []
    const ctx = {
      effect(factory: () => () => void, label: string) { effects.push(label); factory() },
      on: () => () => void 0,
      webServer: { register: () => () => void 0, host: '127.0.0.1', port: 0 },
      tools: { register: () => () => void 0 },
      systemPrompt: { section: () => () => void 0 },
      sessionQuery: {},
    }
    apply(ctx as never, { root: '/tmp/dsh-file-attachments-test' })
    expect(effects).toEqual(['file-attachments.http', 'file-attachments.tools', 'file-attachments.prompt', 'file-attachments.mark'])
  })
})
