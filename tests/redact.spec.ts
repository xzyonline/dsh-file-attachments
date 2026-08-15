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

  it('redacts compound secret key names (aws_secret_access_key style) and camelCase apiKey', () => {
    expect(redactSensitiveText('aws_secret_access_key: AKIA123EXAMPLE\n{"apiKey": "sk-abc"}').text)
      .toBe('aws_secret_access_key: [REDACTED]\n{"apiKey": "[REDACTED]"}')
  })

  it('does not redact non-secret names like public_key or monkey', () => {
    const source = 'public_key: ssh-rsa AAAA\nmonkey: banana\nkeyboard: layout'
    expect(redactSensitiveText(source).text).toBe(source)
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

  it('redacts sensitive fields inside minified JSON without breaking its punctuation', () => {
    const source = '{"client_secret":"value","enabled":true,"token":123}'
    const result = redactSensitiveText(source)

    expect(result).toEqual({ text: '{"client_secret":"[REDACTED]","enabled":true,"token":"[REDACTED]"}', redacted: 1 })
    expect(JSON.parse(result.text)).toEqual({ client_secret: '[REDACTED]', enabled: true, token: '[REDACTED]' })
  })

  it('preserves trailing commas and configuration comments while replacing only secret values', () => {
    const source = '{"client_secret":"value",}\ntoken: abc # rotate me\npassword=abc ; keep this comment'

    expect(redactSensitiveText(source)).toEqual({
      text: '{"client_secret":"[REDACTED]",}\ntoken: [REDACTED] # rotate me\npassword=[REDACTED] ; keep this comment',
      redacted: 3,
    })
  })

  it('redacts escaped JSON keys and replaces object and array values as complete JSON values', () => {
    const source = '{"client\\u005fsecret":{"nested":"value"},"token":["one","two"],"ok":true}'
    const result = redactSensitiveText(source)

    expect(result).toEqual({ text: '{"client\\u005fsecret":"[REDACTED]","token":"[REDACTED]","ok":true}', redacted: 1 })
    expect(JSON.parse(result.text)).toEqual({ client_secret: '[REDACTED]', token: '[REDACTED]', ok: true })
  })

  it('keeps comment markers within quoted values from leaking or corrupting configuration redaction', () => {
    const source = 'token="abc # still-secret; still-secret" # retained comment\npassword=\'abc ; still-secret # still-secret\' ; retained comment'

    expect(redactSensitiveText(source)).toEqual({
      text: 'token="[REDACTED]" # retained comment\npassword=\'[REDACTED]\' ; retained comment',
      redacted: 2,
    })
  })

  it('redacts multiline JSON object values without corrupting the surrounding document', () => {
    const source = '{\n  "password": {\n    "nested": "LEAK"\n  },\n  "enabled": true\n}'

    expect(redactSensitiveText(source)).toEqual({
      text: '{\n  "password": "[REDACTED]",\n  "enabled": true\n}',
      redacted: 1,
    })
  })

  it('redacts YAML block scalar continuations under a sensitive key', () => {
    const source = 'password: |\n  LEAK\n  still-secret\nenabled: true'

    expect(redactSensitiveText(source)).toEqual({
      text: 'password: [REDACTED]\n  [REDACTED]\n  [REDACTED]\nenabled: true',
      redacted: 3,
    })
  })
})
