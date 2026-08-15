import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('built client bundle', () => {
  it('uses the DSH module-loader registration contract', async () => {
    const bundle = await readFile(join(process.cwd(), 'lib', 'client.js'), 'utf8')
    expect(bundle).toMatch(/^window\.\__ModuleLoader__\.load\(\{/) 
    expect(bundle).toContain('id: "@dsh-external/dsh-file-attachments"')
    expect(bundle).toContain('factory: (require) =>')
  })

  it('wires both drop and paste document interceptors (no dead code)', async () => {
    const bundle = await readFile(join(process.cwd(), 'lib', 'client.js'), 'utf8')
    expect(bundle).toContain('installFileDrop')
    expect(bundle).toContain('installFilePaste')
    expect(bundle).toContain('classifyClipboardItems')
  })

  it('wires the in-turn tail receipt and keeps the legacy receipt out', async () => {
    const bundle = await readFile(join(process.cwd(), 'lib', 'client.js'), 'utf8')
    expect(bundle).toContain('conversation.chat.turnTail')
    expect(bundle).toContain('claimTail')
    expect(bundle).toContain('turn-attachment-receipt')
    expect(bundle).not.toContain('sent-attachment-receipt')
  })
})
