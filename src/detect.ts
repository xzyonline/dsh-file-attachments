import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import { fileTypeFromBuffer, type FileTypeResult } from 'file-type'
import { Unzip, UnzipInflate } from 'fflate'
import { LIMITS, type DetectedFileType } from './shared/contracts.ts'

const HEAD_BYTES = 4_100
const ZIP_METADATA_BYTES = 2 * 1024 * 1024
const ZIP_CHUNK_BYTES = LIMITS.readBytes

export interface DetectInput {
  name: string
  declaredMime: string
  bytes: Uint8Array
}

export interface DetectPathInput {
  name: string
  declaredMime: string
  path: string
  signal: AbortSignal
}

type Candidate = Omit<DetectedFileType, 'mismatch' | 'risks'>

const textCandidate = (
  kind: string,
  mime = 'text/plain',
  encoding: Candidate['encoding'] = 'utf-8',
): Candidate => ({ family: 'text', kind, mime, encoding, confidence: 'medium', readable: true })

const documentCandidate = (kind: string, mime: string): Candidate => ({
  family: 'document', kind, mime, confidence: 'high', readable: true,
})

const archiveCandidate = (kind: string, mime: string): Candidate => ({
  family: 'archive', kind, mime, confidence: 'high', readable: false,
})

const binaryCandidate = (kind: string, mime = 'application/octet-stream'): Candidate => ({
  family: 'binary', kind, mime, confidence: kind === 'unknown-binary' ? 'low' : 'high', readable: false,
})

const imageCandidate = (kind: string, mime: string): Candidate => ({
  family: 'image', kind, mime, confidence: 'high', readable: false,
})

export async function detectFile(input: DetectInput): Promise<DetectedFileType> {
  const safeName = sanitizeFilename(input.name)
  const head = input.bytes.subarray(0, HEAD_BYTES)
  const binary = looksTextBom(head) ? undefined : await magicFrom(head)
  const container = binary?.ext === 'zip' ? detectZipContainer(input.bytes) : undefined
  if (container) return finalize(container, safeName, input.declaredMime)
  if (binary && !isTextMagic(binary)) return finalize(fromMagic(binary), safeName, input.declaredMime)

  const decoded = decodeTextCandidate(head)
  if (!decoded) return head.byteLength === 0 ? unknownInput(safeName, input.declaredMime) : unknownBinary(safeName, input.declaredMime)
  return finalize(classifyText(safeName, decoded.text, decoded.encoding), safeName, input.declaredMime)
}

export async function detectFileFromPath(input: DetectPathInput): Promise<DetectedFileType> {
  throwIfAborted(input.signal)
  const safeName = sanitizeFilename(input.name)
  const head = await readHead(input.path, input.signal)
  const binary = looksTextBom(head) ? undefined : await magicFrom(head)
  if (binary?.ext === 'zip') {
    const container = await detectZipContainerFromPath(input.path, input.signal)
    if (container) return finalize(container, safeName, input.declaredMime)
  }
  if (binary && !isTextMagic(binary)) return finalize(fromMagic(binary), safeName, input.declaredMime)

  const decoded = decodeTextCandidate(head)
  if (!decoded) return head.byteLength === 0 ? unknownInput(safeName, input.declaredMime) : unknownBinary(safeName, input.declaredMime)
  return finalize(classifyText(safeName, decoded.text, decoded.encoding), safeName, input.declaredMime)
}

function sanitizeFilename(name: string): string {
  const withoutControls = name.replace(/[\u0000-\u001f\u007f]/g, '')
  const base = basename(withoutControls.replace(/\\/g, '/')).replace(/[\\/]/g, '_')
  if (!base) return 'unnamed'

  const encoder = new TextEncoder()
  let output = ''
  for (const character of base) {
    if (encoder.encode(output + character).byteLength > 255) break
    output += character
  }
  return output || 'unnamed'
}

async function magicFrom(bytes: Uint8Array): Promise<FileTypeResult | undefined> {
  const signature = signatureType(bytes)
  if (signature) return signature
  try {
    return await fileTypeFromBuffer(bytes)
  } catch {
    return undefined
  }
}

function signatureType(bytes: Uint8Array): FileTypeResult | undefined {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' }
  if (hasBytes(bytes, [0x7f, 0x45, 0x4c, 0x46])) return { ext: 'elf', mime: 'application/x-elf' }
  return undefined
}

function hasBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value)
}

function looksTextBom(bytes: Uint8Array): boolean {
  return (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    || (bytes[0] === 0xff && bytes[1] === 0xfe)
    || (bytes[0] === 0xfe && bytes[1] === 0xff)
}

function fromMagic(file: FileTypeResult): Candidate {
  switch (file.ext) {
    case 'xml': return textCandidate('config-xml', file.mime)
    case 'pdf': return documentCandidate('pdf', file.mime)
    case 'epub': return documentCandidate('epub', file.mime)
    case 'docx': return documentCandidate('docx', file.mime)
    case 'xlsx': return documentCandidate('xlsx', file.mime)
    case 'pptx': return documentCandidate('pptx', file.mime)
    case 'zip': return archiveCandidate('zip', file.mime)
    case '7z': return archiveCandidate('7z', file.mime)
    case 'rar': return archiveCandidate('rar', file.mime)
    case 'png': return imageCandidate('png', file.mime)
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp': return imageCandidate(file.ext, file.mime)
    case 'elf':
    case 'exe':
    case 'msi': return binaryCandidate('executable', file.mime)
    default: return binaryCandidate(file.ext, file.mime)
  }
}

function isTextMagic(file: FileTypeResult): boolean {
  return file.ext === 'json' || file.ext === 'xml' || file.mime.startsWith('text/')
}

function decodeTextCandidate(bytes: Uint8Array): { text: string; encoding: NonNullable<Candidate['encoding']> } | undefined {
  if (bytes.byteLength === 0) return undefined

  const bom = bytes.subarray(0, 3)
  if (bom[0] === 0xef && bom[1] === 0xbb && bom[2] === 0xbf) {
    return decode(bytes.subarray(3), 'utf-8')
  }
  if (bom[0] === 0xff && bom[1] === 0xfe) return decode(bytes.subarray(2), 'utf-16le')
  if (bom[0] === 0xfe && bom[1] === 0xff) return decode(swapUtf16Pairs(bytes.subarray(2)), 'utf-16be')
  return decode(bytes, 'utf-8')
}

function decode(bytes: Uint8Array, encoding: NonNullable<Candidate['encoding']>) {
  let text: string
  try {
    text = new TextDecoder(encoding === 'utf-16be' ? 'utf-16le' : encoding, { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder(encoding === 'utf-16be' ? 'utf-16le' : encoding).decode(bytes)
    if (hasTooManyReplacements(text)) return undefined
  }
  if (!text || containsTooManyControls(text)) return undefined
  return { text, encoding }
}

function swapUtf16Pairs(bytes: Uint8Array): Uint8Array {
  const swapped = new Uint8Array(bytes.length)
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    swapped[index] = bytes[index + 1]!
    swapped[index + 1] = bytes[index]!
  }
  return swapped
}

function containsTooManyControls(text: string): boolean {
  let controls = 0
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (code === 0x7f || (code >= 0x80 && code <= 0x9f) || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) controls++
  }
  return controls / text.length > 0.01
}

function hasTooManyReplacements(text: string): boolean {
  let replacements = 0
  for (const character of text) if (character === '\ufffd') replacements++
  return replacements / text.length > 0.01
}

function classifyText(name: string, text: string, encoding: NonNullable<Candidate['encoding']>): Candidate {
  const trimmed = text.trimStart()
  let kind: string | undefined
  let mime = 'text/plain'

  if (/^#!\s*(?:\/usr\/bin\/env\s+)?(?:\/(?:usr\/)?bin\/)?(?:bash|zsh|sh|dash|fish)\b/.test(trimmed)) kind = 'shell'
  else if (/^FROM\s+\S+/mi.test(text)) kind = 'dockerfile'
  else if (/^\s*<\?xml\b/i.test(text) || /^\s*<\w+[\s>]/.test(text)) kind = /<plist\b/i.test(text) ? 'plist' : 'config-xml'
  else if (looksJson(trimmed)) kind = 'config-json'
  else if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(text)) kind = 'sql'
  else if (/^#{1,6}\s+\S/m.test(text) || /(?:^|\n)```/.test(text)) kind = 'markdown'
  else if (/^\s*[\w.-]+:\s+\S/m.test(text)) kind = 'config-yaml'
  else if (/^\s*\[[^\]\n]+\]\s*\n[\s\S]*?^\s*[\w.-]+\s+=\s+\S/m.test(text)) kind = 'config-toml'
  else if (/^\s*\[[^\]\n]+\]\s*\n[\s\S]*?^\s*[\w.-]+\s*=\s*\S/m.test(text)) kind = 'config-ini'
  else if (looksDelimited(text, '\t')) kind = 'tsv'
  else if (looksDelimited(text, ',')) kind = 'csv'

  if (!kind) kind = specialNameKind(name) ?? extensionKind(name) ?? (extname(name).toLowerCase() === '.config' ? 'config-text' : 'text')
  if (kind === 'config-json') mime = 'application/json'
  else if (kind === 'config-yaml') mime = 'application/yaml'
  else if (kind === 'config-xml' || kind === 'plist') mime = 'application/xml'
  else if (kind === 'markdown') mime = 'text/markdown'
  else if (kind === 'csv') mime = 'text/csv'
  else if (kind === 'tsv') mime = 'text/tab-separated-values'
  else if (kind === 'sql') mime = 'application/sql'
  return textCandidate(kind, mime, encoding)
}

function looksDelimited(text: string, delimiter: string): boolean {
  const lines = text.split(/\r?\n/).filter(Boolean)
  return lines.length >= 2 && lines[0]!.includes(delimiter) && lines[1]!.includes(delimiter)
}

function looksJson(text: string): boolean {
  const withoutComments = text.replace(/^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)+/, '')
  if (!withoutComments.startsWith('{') && !withoutComments.startsWith('[')) return false
  try {
    JSON.parse(withoutComments)
    return true
  } catch {
    return false
  }
}

function specialNameKind(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === '.env' || lower.startsWith('.env.')) return 'env'
  return undefined
}

function extensionKind(name: string): string | undefined {
  switch (extname(name).toLowerCase()) {
    case '.json':
    case '.jsonc': return 'config-json'
    case '.yaml':
    case '.yml': return 'config-yaml'
    case '.toml': return 'config-toml'
    case '.ini':
    case '.conf': return 'config-ini'
    case '.plist': return 'plist'
    case '.csv': return 'csv'
    case '.tsv': return 'tsv'
    case '.sql': return 'sql'
    case '.md':
    case '.mdx': return 'markdown'
    case '.ts':
    case '.tsx': return 'source-typescript'
    case '.js':
    case '.jsx': return 'source-javascript'
    case '.py': return 'source-python'
    case '.sh':
    case '.zsh':
    case '.bash': return 'shell'
    case '.c':
    case '.h': return 'source-c'
    case '.cpp':
    case '.cc':
    case '.hpp': return 'source-cpp'
    case '.go': return 'source-go'
    case '.rs': return 'source-rust'
    case '.java': return 'source-java'
    default: return undefined
  }
}

function detectZipContainer(bytes: Uint8Array): Candidate | undefined {
  const inspector = createZipInspector()
  try {
    for (let offset = 0; offset < bytes.byteLength && !inspector.stopped(); offset += ZIP_CHUNK_BYTES) {
      inspector.unzip.push(bytes.subarray(offset, offset + ZIP_CHUNK_BYTES), false)
    }
    if (!inspector.stopped()) inspector.unzip.push(new Uint8Array(), true)
  } catch {
    return undefined
  }
  return inspector.result()
}

async function detectZipContainerFromPath(path: string, signal: AbortSignal): Promise<Candidate | undefined> {
  const inspector = createZipInspector()
  const stream = createReadStream(path, { signal })
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal)
      inspector.unzip.push(chunk, false)
      if (inspector.stopped()) {
        stream.destroy()
        break
      }
    }
    if (!inspector.stopped()) inspector.unzip.push(new Uint8Array(), true)
  } catch (error) {
    if (signal.aborted) throw error
    return undefined
  }
  return inspector.result()
}

function createZipInspector() {
  let metadataBytes = 0
  let entries = 0
  let hasContentTypes = false
  let hasWord = false
  let hasExcel = false
  let hasPowerPoint = false
  let epub = false
  let stopped = false
  const decoder = new TextDecoder()
  const result = (): Candidate | undefined => {
    if (hasContentTypes && hasWord) return documentCandidate('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    if (hasContentTypes && hasExcel) return documentCandidate('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    if (hasContentTypes && hasPowerPoint) return documentCandidate('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    if (epub) return documentCandidate('epub', 'application/epub+zip')
    return undefined
  }
  const stopWhenResolved = () => {
    if (result()) stopped = true
  }
  const unzip = new Unzip(file => {
    file.ondata = () => undefined
    entries++
    metadataBytes += Buffer.byteLength(file.name)
    if (entries > LIMITS.archiveEntries || metadataBytes > ZIP_METADATA_BYTES) {
      stopped = true
      file.start()
      return
    }
    hasContentTypes ||= file.name === '[Content_Types].xml'
    hasWord ||= file.name.startsWith('word/')
    hasExcel ||= file.name.startsWith('xl/')
    hasPowerPoint ||= file.name.startsWith('ppt/')
    if (file.name !== 'mimetype') {
      file.start()
      stopWhenResolved()
      return
    }

    let content = ''
    const remaining = ZIP_METADATA_BYTES - metadataBytes
    file.ondata = (error, chunk, final) => {
      if (error || chunk.byteLength > ZIP_METADATA_BYTES - metadataBytes) {
        stopped = true
        file.terminate()
        return
      }
      metadataBytes += chunk.byteLength
      content += decoder.decode(chunk, { stream: !final })
      if (final && content === 'application/epub+zip') {
        epub = true
        stopWhenResolved()
      }
    }
    if (file.originalSize !== undefined && file.originalSize > remaining) {
      stopped = true
      file.ondata = () => file.terminate()
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  return {
    unzip,
    result,
    stopped: () => stopped,
  }
}

function finalize(candidate: Candidate, safeName: string, declaredMime: string): DetectedFileType {
  const mismatch = hasMismatch(candidate, safeName, declaredMime)
  return { ...candidate, mismatch, risks: mismatch ? ['type-mismatch'] : [] }
}

function unknownBinary(safeName: string, declaredMime: string): DetectedFileType {
  return finalize(binaryCandidate('unknown-binary'), safeName, declaredMime)
}

function unknownInput(safeName: string, declaredMime: string): DetectedFileType {
  return finalize({ family: 'unknown', kind: 'unknown', mime: 'application/octet-stream', confidence: 'low', readable: false }, safeName, declaredMime)
}

function hasMismatch(candidate: Candidate, safeName: string, declaredMime: string): boolean {
  const declared = declaredMime.trim().toLowerCase().split(';', 1)[0]!
  const nameExtension = extname(safeName).toLowerCase()
  const extensionType = knownExtensionType(nameExtension)
  const extensionMismatch = extensionType !== undefined && extensionType !== candidate.kind
  const mimeMismatch = declared !== '' && declared !== 'application/octet-stream' && declared !== candidate.mime.toLowerCase()
  return extensionMismatch || mimeMismatch
}

function knownExtensionType(extension: string): string | undefined {
  const mapping: Record<string, string> = {
    '.txt': 'text', '.json': 'config-json', '.jsonc': 'config-json', '.yaml': 'config-yaml', '.yml': 'config-yaml',
    '.ini': 'config-ini', '.toml': 'config-toml', '.pdf': 'pdf', '.zip': 'zip', '.7z': '7z', '.rar': 'rar',
    '.png': 'png', '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx', '.epub': 'epub', '.ts': 'source-typescript',
    '.tsx': 'source-typescript', '.js': 'source-javascript', '.jsx': 'source-javascript', '.py': 'source-python',
    '.md': 'markdown', '.mdx': 'markdown', '.csv': 'csv', '.tsv': 'tsv', '.sql': 'sql', '.plist': 'plist',
    '.conf': 'config-ini', '.config': 'config-text', '.sh': 'shell', '.zsh': 'shell', '.bash': 'shell',
    '.c': 'source-c', '.h': 'source-c', '.cpp': 'source-cpp', '.cc': 'source-cpp', '.hpp': 'source-cpp',
    '.go': 'source-go', '.rs': 'source-rust', '.java': 'source-java',
  }
  return mapping[extension]
}

async function readHead(path: string, signal: AbortSignal): Promise<Uint8Array> {
  const stream = createReadStream(path, { start: 0, end: HEAD_BYTES - 1, signal })
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) {
    throwIfAborted(signal)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
