import { describe, expect, it } from 'vitest'
import { redactSensitiveText } from '../src/redact.ts'

describe('redactSensitiveText', () => {
  it.each([
    ['password = hunter2', 'password = [REDACTED]'],
    ['API_KEY: sk-real', 'API_KEY: [REDACTED]'],
    ['Authorization: Bearer abc', 'Authorization: [REDACTED]'],
    ['"client_secret": "value"', '"client_secret": "[REDACTED]"'],
    ['set-cookie: sid=abc; Secure', 'set-cookie: [REDACTED]'],
  ])('redacts %s', (source, expected) => {
    expect(redactSensitiveText(source).text).toBe(expected)
  })

  it('does not redact words that only occur in values or comments', () => {
    const source = 'description = "reset password screen"\n# token rotation docs'

    expect(redactSensitiveText(source)).toEqual({ text: source, redacted: 0 })
  })

  it('preserves indentation and value quotes while redacting each matching line', () => {
    const source = '  token: \'abc\'\nCOOKIE=value\npublic=true'

    expect(redactSensitiveText(source)).toEqual({
      text: '  token: \'[REDACTED]\'\nCOOKIE=[REDACTED]\npublic=true',
      redacted: 2,
    })
  })

  it('redacts PEM private-key bodies without changing the delimiters', () => {
    const source = '-----BEGIN PRIVATE KEY-----\nbase64-secret\n-----END PRIVATE KEY-----'

    expect(redactSensitiveText(source)).toEqual({
      text: '-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----',
      redacted: 1,
    })
  })
})
