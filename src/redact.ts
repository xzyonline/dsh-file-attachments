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
  let output = ''
  let cursor = 0
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== '"') continue
    const keyEnd = jsonStringEnd(line, index)
    if (keyEnd === undefined) return line
    const separatorStart = skipWhitespace(line, keyEnd)
    if (line[separatorStart] !== ':') {
      index = keyEnd - 1
      continue
    }
    const valueStart = skipWhitespace(line, separatorStart + 1)
    const valueEnd = jsonValueEnd(line, valueStart)
    if (valueEnd === undefined) return line
    let key: string
    try {
      key = JSON.parse(line.slice(index, keyEnd)) as string
    } catch {
      return line
    }
    if (SECRET_KEY.test(key)) {
      output += line.slice(cursor, valueStart) + '"[REDACTED]"'
      cursor = valueEnd
      index = valueEnd - 1
    } else {
      index = keyEnd - 1
    }
  }
  return output ? output + line.slice(cursor) : line
}

function splitTrailingComment(value: string, separator: string): [string, string] {
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!
    if (quote) {
      if (character === '\\') index++
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if ((character === '#' || (separator === '=' && character === ';')) && index > 0 && /\s/.test(value[index - 1]!)) return [value.slice(0, index).trimEnd(), value.slice(index - 1)]
  }
  return [value, '']
}

function jsonStringEnd(text: string, start: number): number | undefined {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') {
      index++
      continue
    }
    if (text[index] === '"') return index + 1
  }
  return undefined
}

function jsonValueEnd(text: string, start: number): number | undefined {
  if (text[start] === '"') return jsonStringEnd(text, start)
  if (text[start] === '{' || text[start] === '[') {
    const stack = [text[start]!]
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === '"') {
        const end = jsonStringEnd(text, index)
        if (end === undefined) return undefined
        index = end - 1
      } else if (text[index] === '{' || text[index] === '[') stack.push(text[index]!)
      else if (text[index] === '}' || text[index] === ']') {
        const open = stack.pop()
        if ((text[index] === '}' && open !== '{') || (text[index] === ']' && open !== '[')) return undefined
        if (stack.length === 0) return index + 1
      }
    }
    return undefined
  }
  let index = start
  while (index < text.length && !/[\s,}\]]/.test(text[index]!)) index++
  return index > start ? index : undefined
}

function skipWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length && /\s/.test(text[index]!)) index++
  return index
}
