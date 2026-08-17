import { describe, expect, it } from 'vitest'
import { sanitizeFilename } from '../src/shared/utils.ts'

describe('sanitizeFilename', () => {
  it('replaces Windows reserved characters with underscores', () => {
    expect(sanitizeFilename('report<1>:final?.txt')).toBe('report_1__final_.txt')
    expect(sanitizeFilename('a"b|c*d.txt')).toBe('a_b_c_d.txt')
  })

  it('prefixes Windows reserved device names with an underscore', () => {
    expect(sanitizeFilename('CON')).toBe('_CON')
    expect(sanitizeFilename('con.txt')).toBe('_con.txt')
    expect(sanitizeFilename('COM1.log')).toBe('_COM1.log')
    expect(sanitizeFilename('LPT9')).toBe('_LPT9')
  })

  it('keeps ordinary names unchanged', () => {
    expect(sanitizeFilename('report.txt')).toBe('report.txt')
    expect(sanitizeFilename('照片.png')).toBe('照片.png')
    expect(sanitizeFilename('report.final.draft.txt')).toBe('report.final.draft.txt')
  })

  it('strips path components and takes the basename', () => {
    expect(sanitizeFilename('C:\\Users\\a\\b.txt')).toBe('b.txt')
    expect(sanitizeFilename('../a/b.txt')).toBe('b.txt')
  })
})
