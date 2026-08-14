import { describe, expect, it } from 'vitest'
import { encodeAttachmentMarker, parseAttachmentMarkers, removeAttachmentMarker } from '../src/shared/marker.ts'
import { AttachmentError } from '../src/errors.ts'

describe('attachment marker', () => {
  it('round-trips one opaque id without serializing a path or filename', () => {
    const marker = encodeAttachmentMarker('att_018f4c')
    expect(marker).toBe('<dsh-file ref="att_018f4c"/>')
    expect(parseAttachmentMarkers(`请分析 ${marker}`)).toEqual(['att_018f4c'])
    expect('att_018f4c').not.toMatch(/[\\/]/)
  })

  it('removes exactly the requested marker and normalizes excess whitespace', () => {
    expect(removeAttachmentMarker('a\n<dsh-file ref="att_a"/>\n<dsh-file ref="att_b"/>', 'att_a'))
      .toBe('a\n<dsh-file ref="att_b"/>')
  })
})

it('keeps stable error codes separate from display messages', () => {
  const error = new AttachmentError('FILE_TOO_LARGE', '文件超过 25 MB')
  expect(error.code).toBe('FILE_TOO_LARGE')
  expect(error.message).toContain('25 MB')
})
