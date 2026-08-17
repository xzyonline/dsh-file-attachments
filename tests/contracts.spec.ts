import { describe, expect, it } from 'vitest'
import { removeAttachmentMarker } from '../src/shared/marker.ts'
import { ID_PATTERN } from '../src/shared/contracts.ts'
import { AttachmentError } from '../src/errors.ts'

describe('attachment marker', () => {
  it('removes exactly the requested marker and normalizes excess whitespace', () => {
    expect(removeAttachmentMarker('a\n<dsh-file ref="att_a"/>\n<dsh-file ref="att_b"/>', 'att_a'))
      .toBe('a\n<dsh-file ref="att_b"/>')
  })

  it('keeps only the visible filename in the plain-text DSH user bubble', () => {
    const draft = '附件：report.md'
    expect(removeAttachmentMarker(`请分析\n${draft}`, 'att_abcdef', 'report.md')).toBe('请分析')
  })
})

describe('attachment id pattern', () => {
  it('accepts the canonical att_ + 32 hex form', () => {
    expect(new RegExp(`^${ID_PATTERN}$`).test('att_' + 'a'.repeat(32))).toBe(true)
    expect(new RegExp(`^${ID_PATTERN}$`).test('att_' + '0f'.repeat(16))).toBe(true)
  })

  it('rejects non-canonical forms', () => {
    expect(new RegExp(`^${ID_PATTERN}$`).test('att_abc')).toBe(false)
    expect(new RegExp(`^${ID_PATTERN}$`).test('att_../../escape')).toBe(false)
    expect(new RegExp(`^${ID_PATTERN}$`).test('att_' + 'G'.repeat(32))).toBe(false)
  })
})

it('keeps stable error codes separate from display messages', () => {
  const error = new AttachmentError('FILE_TOO_LARGE', '文件超过 25 MB')
  expect(error.code).toBe('FILE_TOO_LARGE')
  expect(error.message).toContain('25 MB')
})
