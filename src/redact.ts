export interface RedactionResult {
  text: string
  redacted: number
}

const SECRET_KEY = /^(password|passwd|pwd|secret|token|api_key|apikey|authorization|cookie|set-cookie|private_key|client_secret)$/i
const PEM_BEGIN = /^([ \t]*-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----)[ \t]*$/
const PEM_END = /^[ \t]*-----END (?:[A-Z ]+ )?PRIVATE KEY-----[ \t]*$/

export function redactSensitiveText(text: string): RedactionResult {
  let redacted = 0
  let privateKey = false
  const lines = text.split(/\r?\n/).map(line => {
    if (PEM_BEGIN.test(line)) {
      privateKey = true
      return line
    }
    if (privateKey && PEM_END.test(line)) {
      privateKey = false
      return line
    }
    const next = privateKey && line.trim() ? `${line.match(/^\s*/)?.[0] ?? ''}[REDACTED]` : redactLine(line)
    if (next !== line) redacted++
    return next
  })
  return { text: lines.join('\n'), redacted }
}

function redactLine(line: string): string {
  const json = redactJsonValues(line)
  if (json !== line) return json

  const match = line.match(/^(\s*)((?:"[^"]+"|'[^']+'|[A-Za-z][A-Za-z0-9_-]*))(\s*)([:=])(\s*)(.*)$/)
  if (!match) return line
  const [, indentation, originalKey, keyWhitespace, separator, valueWhitespace, value] = match
  const key = originalKey!.replace(/^['"]|['"]$/g, '')
  if (!SECRET_KEY.test(key)) return line

  const [secretValue, comment] = splitTrailingComment(value!, separator!)
  const quote = secretValue.match(/^\s*(["'])/)
  const replacement = quote ? `${quote[1]}[REDACTED]${quote[1]}` : '[REDACTED]'
  return `${indentation}${originalKey}${keyWhitespace}${separator}${valueWhitespace}${replacement}${comment}`
}

function redactJsonValues(line: string): string {
  return line.replace(/"((?:\\.|[^"\\])*)"(\s*:\s*)("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=\s*[,}\]])/g, (match, rawKey: string, separator: string, _value: string) => {
    if (!SECRET_KEY.test(rawKey)) return match
    return `"${rawKey}"${separator}"[REDACTED]"`
  })
}

function splitTrailingComment(value: string, separator: string): [string, string] {
  const comment = value.match(separator === '=' ? /^(.*?)(\s+(?:#|;).*)$/ : /^(.*?)(\s+#.*)$/)
  return comment ? [comment[1]!, comment[2]!] : [value, '']
}
