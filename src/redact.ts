export interface RedactionResult {
  text: string
  redacted: number
}

const SECRET_KEY = /(^|[_-])(password|passwd|pwd|secret|token|apikey|api[-_]?key|auth[-_]?token|authorization|cookie|private[-_]?key|client[-_]?secret|credential|access[-_]?key|stripe[-_]?key|openai[-_]?key|database[-_]?url|password[-_]?hash)($|[_-])/i
const SECRET_KEY_CAMEL = /^(password|passwd|pwd|secret|token|apiKey|authToken|authorization|cookie|privateKey|clientSecret|credential|accessKey|passwordHash)$/
const PEM_BEGIN = /^([ \t]*-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----)[ \t]*$/
const PEM_END = /^[ \t]*-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----[ \t]*$/

export function redactSensitiveText(text: string): RedactionResult {
  const firstNonWhitespace = text.match(/\S/)?.[0]
  const structuredText = firstNonWhitespace === '{' || firstNonWhitespace === '[' ? redactJsonValues(text) : text
  let redacted = structuredText === text ? 0 : 1
  let blockIndent: number | undefined
  let privateKey = false
  const lines = structuredText.split(/\r?\n/).map(line => {
    if (PEM_BEGIN.test(line)) {
      privateKey = true
      return line
    }
    if (privateKey && PEM_END.test(line)) {
      privateKey = false
      return line
    }
    const indentation = line.match(/^\s*/)?.[0].length ?? 0
    if (blockIndent !== undefined) {
      if (line.trim() === '') return line
      if (indentation > blockIndent) {
        redacted++
        return `${line.slice(0, indentation)}[REDACTED]`
      }
      blockIndent = undefined
    }
    const next = privateKey && line.trim() ? `${line.match(/^\s*/)?.[0] ?? ''}[REDACTED]` : redactLine(line)
    if (next !== line) redacted++
    if (isSensitiveYamlBlockStart(line)) blockIndent = indentation
    return next
  })
  return { text: lines.join('\n'), redacted }
}

function isSensitiveKey(key: string): boolean {
  return SECRET_KEY.test(key) || SECRET_KEY_CAMEL.test(key)
}

function isSensitiveYamlBlockStart(line: string): boolean {
  const match = line.match(/^(\s*)([A-Za-z][A-Za-z0-9_-]*)\s*:\s*[|>][-+]?\d*\s*(?:#.*)?$/)
  return match !== null && isSensitiveKey(match[2]!)
}

function redactLine(line: string): string {
  const json = redactJsonValues(line)
  if (json !== line) return json
  if (/^\s*"/.test(line) && /"\s*:/.test(line)) return line

  // shell `export KEY=value` / `set KEY=value`：剥掉前缀再按普通键值行处理。
  const exportMatch = line.match(/^(\s*)(export|set)(\s+)/)
  if (exportMatch) {
    const prefix = exportMatch[1]! + exportMatch[2]! + exportMatch[3]!
    const rest = line.slice(prefix.length)
    const redacted = redactLine(rest)
    return redacted === rest ? line : prefix + redacted
  }

  const match = line.match(/^(\s*)((?:"[^"]+"|'[^']+'|[A-Za-z_][A-Za-z0-9_-]*))(\s*)([:=])(\s*)(.*)$/)
  if (!match) return line
  const [, indentation, originalKey, keyWhitespace, separator, valueWhitespace, value] = match
  const key = originalKey!.replace(/^['"]|['"]$/g, '')
  if (!isSensitiveKey(key)) return line

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
    if (isSensitiveKey(key)) {
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
