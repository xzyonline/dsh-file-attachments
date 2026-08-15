import React from 'react'
import { describe, expect, it } from 'vitest'
import { FileAttachButton } from '../src/client/FileAttachButton.tsx'
import { FileAttachmentDock } from '../src/client/FileAttachmentDock.tsx'
import { TurnAttachmentReceipt } from '../src/client/TurnAttachmentReceipt.tsx'
import { classifyDrop } from '../src/client/drop.ts'
import { classifyClipboardItems } from '../src/client/paste.ts'
import type { AttachmentMetadata } from '../src/shared/contracts.ts'

function file(name: string, type: string): File { return new File(['x'], name, { type }) }

const attachment = (overrides: Partial<AttachmentMetadata> = {}): AttachmentMetadata => ({
  id: 'att_abcdef', ownerSessionId: 'session-a', batchId: 'batch-a', safeName: 'dsp修改日志端口.wps',
  declaredMime: 'application/octet-stream', detected: {
    family: 'binary', kind: 'cfb', mime: 'application/x-cfb', confidence: 'high', readable: false, mismatch: true, risks: ['type-mismatch'],
  }, bytes: 42_050, sha256: 'a'.repeat(64), createdAt: 1, ...overrides,
})

describe('attachment client UI', () => {
  it('exposes an accessible file button and forwards selected non-images', () => {
    const selected: File[] = []
    const fragment = FileAttachButton({ onFiles: files => selected.push(...files) })
    const children = fragment.props.children as React.ReactElement[]
    expect(children[0]!.props['aria-label']).toBe('添加文件')
    children[1]!.props.onChange({ currentTarget: { files: [file('a.txt', 'text/plain')] } })
    expect(selected[0]?.name).toBe('a.txt')
  })

  it('leaves images for the native handler in mixed drops', () => {
    const outcome = classifyDrop([file('app.config', 'text/plain'), file('screen.png', 'image/png')])
    expect(outcome.generic.map(item => item.name)).toEqual(['app.config'])
    expect(outcome.nativeImages.map(item => item.name)).toEqual(['screen.png'])
  })

  it('takes generic pasted files without consuming native images', () => {
    const imageGetAsFile = () => { throw new Error('getAsFile must not be called on native images') }
    const outcome = classifyClipboardItems([
      { kind: 'file', type: 'text/plain', getAsFile: () => file('app.config', 'text/plain') },
      { kind: 'file', type: 'image/png', getAsFile: imageGetAsFile },
      { kind: 'string', type: 'text/plain', getAsFile: () => file('ghost.txt', 'text/plain') },
    ])
    expect(outcome.generic.map(item => item.name)).toEqual(['app.config'])
    expect(outcome.nativeImages).toBe(1)
  })

  it('leaves pure image and text pastes for the built-in handler', () => {
    expect(classifyClipboardItems([{ kind: 'file', type: 'image/webp', getAsFile: () => file('s.webp', 'image/webp') }])).toEqual({ generic: [], nativeImages: 1 })
    expect(classifyClipboardItems([])).toEqual({ generic: [], nativeImages: 0 })
  })

  it('differentiates icons by detected type instead of a uniform glyph', () => {
    const spread = attachment({ detected: { ...attachment().detected, family: 'document' as const, kind: 'xlsx' } })
    const pdf = attachment({ detected: { ...attachment().detected, family: 'document' as const, kind: 'pdf' } })
    const arch = attachment({ detected: { ...attachment().detected, family: 'archive' as const, kind: 'zip' } })
    const chipIcon = (m: AttachmentMetadata) => {
      const element = FileAttachmentDock({ files: [m], onRemove: () => undefined })
      const chip = React.Children.toArray(element.props.children)[0] as React.ReactElement
      return (chip.props.children as React.ReactElement[])[0]!.props.children
    }
    expect(chipIcon(spread)).toBe('📊')
    expect(chipIcon(pdf)).toBe('📕')
    expect(chipIcon(arch)).toBe('🗜️')
    expect(chipIcon(spread)).not.toBe(chipIcon(pdf))
  })

  it('survives legacy refs without detected metadata', () => {
    const legacy = attachment()
    delete (legacy as { detected?: unknown }).detected
    const element = FileAttachmentDock({ files: [legacy], onRemove: () => undefined })
    expect(JSON.stringify(element)).toContain('❓')
    expect(JSON.stringify(element)).toContain('dsp修改日志端口.wps')
  })

  it('separates human-readable file details from mismatch status', () => {
    const element = FileAttachmentDock({ files: [attachment()], onRemove: () => undefined })
    const dockText = JSON.stringify(element)

    expect(dockText).toContain('dsp修改日志端口.wps')
    expect(dockText).toContain('复合文档')
    expect(dockText).toContain('格式需确认')
    expect(dockText).not.toContain('cfbTYPE_MISMATCH')
    expect(dockText).not.toContain('TYPE_MISMATCH')
  })

  it('centers attachment chips inside the composer width instead of growing across the page', () => {
    const element = FileAttachmentDock({ files: [attachment()], onRemove: () => undefined })
    const chip = React.Children.toArray(element.props.children)[0] as React.ReactElement

    expect(element.props.style).toMatchObject({ margin: '0 auto' })
    expect(String(element.props.style.width)).toContain('--dsh-composer-side-clearance')
    expect(chip.props.style).toMatchObject({ flex: '0 1 320px', maxWidth: '100%' })
  })

  it('renders the quiet in-turn receipt with the sent file names', () => {
    const element = TurnAttachmentReceipt({ receipt: { draft: '解释这个文件', files: [attachment(), attachment({ id: 'att_other', safeName: 'a.xlsx' })] } })
    const text = JSON.stringify(element)
    expect(element.props['data-testid']).toBe('turn-attachment-receipt')
    expect(text).toContain('已发送给 Agent')
    expect(text).toContain('dsp修改日志端口.wps')
    expect(text).toContain('a.xlsx')
  })
})
