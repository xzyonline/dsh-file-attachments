import { open, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import { fileTypeFromBuffer, type FileTypeResult } from 'file-type'
import { inflateSync } from 'fflate'
import { createRequire } from 'node:module'
import { LIMITS, type DetectedFileType } from './shared/contracts.ts'

const HEAD_BYTES = 4_100
const ZIP_METADATA_BYTES = 2 * 1024 * 1024
const ZIP_EOCD_BYTES = 65_557
const EPUB_MIMETYPE_BYTES = 128
const ZIP_LOCAL_HEADER_BYTES = 64 * 1024

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

export interface ZipEntry {
  name: string
  compression: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export interface ZipMetadata {
  entries: readonly ZipEntry[]
  archiveBytes: number
}

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
  const container = binary?.ext === 'zip' ? await detectZipContainer(input.bytes) : undefined
  if (container) return finalize(container, safeName, input.declaredMime)
  if (binary?.ext === 'cfb') {
    const legacy = classifyCfbFromBuffer(input.bytes)
    if (legacy) return finalize(legacy, safeName, input.declaredMime)
  }
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
  if (binary?.ext === 'cfb') {
    const legacyBytes = await readCfbBytes(input.path)
    const legacy = legacyBytes ? classifyCfbFromBuffer(legacyBytes) : undefined
    if (legacy) return finalize(legacy, safeName, input.declaredMime)
  }
  if (binary && !isTextMagic(binary)) return finalize(fromMagic(binary), safeName, input.declaredMime)

  const decoded = decodeTextCandidate(head)
  if (!decoded) return head.byteLength === 0 ? unknownInput(safeName, input.declaredMime) : unknownBinary(safeName, input.declaredMime)
  return finalize(classifyText(safeName, decoded.text, decoded.encoding), safeName, input.declaredMime)
}

function sanitizeFilename(name: string): string {
  const withoutControls = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
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

async function readCfbBytes(path: string): Promise<Uint8Array | undefined> {
  try {
    const info = await stat(path)
    if (info.size > LIMITS.fileBytes) return undefined
    return await readFile(path)
  } catch {
    return undefined
  }
}

function classifyCfbFromBuffer(bytes: Uint8Array): Candidate | undefined {
  let file: { FileIndex?: { name: string }[] }
  try {
    const CFB = createRequire(import.meta.url)('cfb') as typeof import('cfb')
    file = CFB.read(bytes, { type: 'buffer' })
  } catch {
    return undefined
  }
  const names = (file.FileIndex ?? []).map(entry => entry.name.toLowerCase())
  if (names.some(name => name.includes('worddocument'))) return documentCandidate('doc', 'application/msword')
  if (names.some(name => name.includes('workbook') || name === 'book')) return documentCandidate('xls', 'application/vnd.ms-excel')
  if (names.some(name => name.includes('powerpoint document'))) return binaryCandidate('ppt', 'application/vnd.ms-powerpoint')
  return undefined
}

function fromMagic(file: FileTypeResult): Candidate {
  switch (file.ext) {
    case 'xml': return textCandidate('config-xml', file.mime)
    case 'pdf': return documentCandidate('pdf', file.mime)
    case 'epub': return documentCandidate('epub', file.mime)
    case 'docx': return documentCandidate('docx', file.mime)
    case 'xlsx': return documentCandidate('xlsx', file.mime)
    case 'pptx': return documentCandidate('pptx', file.mime)
    case 'rtf': return documentCandidate('rtf', 'application/rtf')
    case 'zip': return archiveCandidate('zip', file.mime)
    case '7z': return archiveCandidate('7z', file.mime)
    case 'rar': return archiveCandidate('rar', file.mime)
    case 'png': return imageCandidate('png', file.mime)
    case 'jpg':
    case 'jpeg':
      return imageCandidate('jpeg', file.mime)
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
  const utf8 = decode(bytes, 'utf-8')
  if (utf8) return utf8
  // dsh-files merge (2026-08-17): GB18030/GBK 兜底——中文 GBK 文件 UTF-8 fatal 失败后的合法文本候选。
  // 可打印率 > 0.9 防随机/压缩字节被 GB18030 宽松映射误判为文本。
  return decodeGb18030(bytes)
}

function decodeGb18030(bytes: Uint8Array): { text: string; encoding: NonNullable<Candidate['encoding']> } | undefined {
  let text: string
  try {
    text = new TextDecoder('gb18030', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  let printable = 0
  for (const character of text) {
    const code = character.codePointAt(0)!
    // 换行/回车/制表是文本正常内容,计入可打印;其余控制字符不计。
    if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f)) printable++
  }
  if (printable / Math.max(text.length, 1) < 0.9) return undefined
  if (containsTooManyControls(text)) return undefined
  return { text, encoding: 'gb18030' }
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
  else if (/^\s*<!doctype\s+html\b/i.test(text) || /^\s*<html\b/i.test(text)) kind = 'html'
  else if (/^\s*<svg\b/i.test(text)) kind = 'svg'
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
  else if (kind === 'html') mime = 'text/html'
  else if (kind === 'svg') mime = 'image/svg+xml'
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
    case '.html':
    case '.htm': return 'html'
    case '.xml':
    case '.xsd':
    case '.rss': return 'config-xml'
    case '.svg': return 'svg'
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

async function detectZipContainer(bytes: Uint8Array): Promise<Candidate | undefined> {
  const metadata = inspectZipBytes(bytes)
  if (!metadata) return undefined
  return classifyZip(metadata, entry => readZipEntryBytes(bytes, entry))
}

async function detectZipContainerFromPath(path: string, signal: AbortSignal): Promise<Candidate | undefined> {
  const metadata = await inspectZipPath(path, signal)
  if (!metadata) return undefined
  return classifyZip(metadata, entry => readZipEntryFromPath(path, entry, signal))
}

async function classifyZip(metadata: ZipMetadata, readEntry: (entry: ZipEntry) => Uint8Array | undefined | Promise<Uint8Array | undefined>): Promise<Candidate | undefined> {
  const names = new Set(metadata.entries.map(entry => entry.name))
  if (names.has('[Content_Types].xml') && names.has('word/document.xml')) return documentCandidate('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  if (names.has('[Content_Types].xml') && names.has('xl/workbook.xml')) return documentCandidate('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  if (names.has('[Content_Types].xml') && names.has('ppt/presentation.xml')) return documentCandidate('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')

  const mimetype = metadata.entries.find(entry => entry.name === 'mimetype')
  if (!mimetype || mimetype.compressedSize > EPUB_MIMETYPE_BYTES || mimetype.uncompressedSize > EPUB_MIMETYPE_BYTES) return undefined
  const payload = await readEntry(mimetype)
  if (!payload) return undefined
  const text = decodeZipEntry(mimetype, payload)
  if (text === 'application/epub+zip') return documentCandidate('epub', 'application/epub+zip')
  if (text === 'application/vnd.oasis.opendocument.text') return documentCandidate('odt', text)
  if (text === 'application/vnd.oasis.opendocument.spreadsheet') return documentCandidate('ods', text)
  if (text === 'application/vnd.oasis.opendocument.presentation') return documentCandidate('odp', text)
  return undefined
}

export function inspectZipBytes(bytes: Uint8Array): ZipMetadata | undefined {
  if (bytes.byteLength > LIMITS.archiveBytes) return undefined
  const tailStart = Math.max(0, bytes.byteLength - ZIP_EOCD_BYTES)
  const directory = findCentralDirectory(bytes.subarray(tailStart), bytes.byteLength)
  if (!directory || directory.offset + directory.size > bytes.byteLength) return undefined
  return parseCentralDirectory(bytes.subarray(directory.offset, directory.offset + directory.size), directory.entries, bytes.byteLength)
}

async function inspectZipPath(path: string, signal: AbortSignal): Promise<ZipMetadata | undefined> {
  throwIfAborted(signal)
  const fileInfo = await stat(path)
  if (fileInfo.size > LIMITS.archiveBytes || fileInfo.size < 22) return undefined
  const handle = await open(path, 'r')
  try {
    const tailBytes = Math.min(fileInfo.size, ZIP_EOCD_BYTES)
    const tail = await readExactly(handle, tailBytes, fileInfo.size - tailBytes, signal)
    const directory = tail && findCentralDirectory(tail, fileInfo.size)
    if (!directory || directory.offset + directory.size > fileInfo.size) return undefined
    const central = await readExactly(handle, directory.size, directory.offset, signal)
    return central ? parseCentralDirectory(central, directory.entries, fileInfo.size) : undefined
  } finally {
    await handle.close()
  }
}

function findCentralDirectory(tail: Uint8Array, archiveBytes: number): { entries: number; size: number; offset: number } | undefined {
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (readU32(tail, offset) !== 0x06054b50) continue
    const commentLength = readU16(tail, offset + 20)
    if (offset + 22 + commentLength !== tail.byteLength) continue
    const disk = readU16(tail, offset + 4)
    const directoryDisk = readU16(tail, offset + 6)
    const entries = readU16(tail, offset + 10)
    const size = readU32(tail, offset + 12)
    const directoryOffset = readU32(tail, offset + 16)
    if (disk !== 0 || directoryDisk !== 0 || entries === 0xffff || size === 0xffffffff || directoryOffset === 0xffffffff) return undefined
    if (entries > LIMITS.archiveEntries || size > ZIP_METADATA_BYTES || directoryOffset + size > archiveBytes) return undefined
    return { entries, size, offset: directoryOffset }
  }
  return undefined
}

function parseCentralDirectory(bytes: Uint8Array, expectedEntries: number, archiveBytes: number): ZipMetadata | undefined {
  try {
    const entries: ZipEntry[] = []
    let offset = 0
    while (offset < bytes.byteLength) {
      if (entries.length >= expectedEntries || readU32(bytes, offset) !== 0x02014b50 || offset + 46 > bytes.byteLength) return undefined
      const compression = readU16(bytes, offset + 10)
      const compressedSize = readU32(bytes, offset + 20)
      const uncompressedSize = readU32(bytes, offset + 24)
      const nameLength = readU16(bytes, offset + 28)
      const extraLength = readU16(bytes, offset + 30)
      const commentLength = readU16(bytes, offset + 32)
      const localOffset = readU32(bytes, offset + 42)
      const entryEnd = offset + 46 + nameLength + extraLength + commentLength
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || entryEnd > bytes.byteLength || localOffset >= archiveBytes) return undefined
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
      entries.push({ name, compression, compressedSize, uncompressedSize, localOffset })
      offset = entryEnd
    }
    return entries.length === expectedEntries ? { entries, archiveBytes } : undefined
  } catch {
    return undefined
  }
}

function readZipEntryBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array | undefined {
  const header = readLocalHeader(bytes, entry)
  return header ? bytes.subarray(header.payloadOffset, header.payloadOffset + entry.compressedSize) : undefined
}

async function readZipEntryFromPath(path: string, entry: ZipEntry, signal: AbortSignal): Promise<Uint8Array | undefined> {
  throwIfAborted(signal)
  const handle = await open(path, 'r')
  try {
    const headerBytes = await readExactly(handle, 30, entry.localOffset, signal)
    if (!headerBytes) return undefined
    const header = readLocalHeader(headerBytes, entry, entry.localOffset)
    if (!header || header.payloadOffset - entry.localOffset > ZIP_LOCAL_HEADER_BYTES) return undefined
    return readExactly(handle, entry.compressedSize, header.payloadOffset, signal)
  } finally {
    await handle.close()
  }
}

function readLocalHeader(bytes: Uint8Array, entry: ZipEntry, baseOffset = 0): { payloadOffset: number } | undefined {
  const offset = entry.localOffset - baseOffset
  if (offset < 0 || offset + 30 > bytes.byteLength || readU32(bytes, offset) !== 0x04034b50) return undefined
  const nameLength = readU16(bytes, offset + 26)
  const extraLength = readU16(bytes, offset + 28)
  const payloadOffset = entry.localOffset + 30 + nameLength + extraLength
  if (payloadOffset + entry.compressedSize > baseOffset + bytes.byteLength && baseOffset === 0) return undefined
  return { payloadOffset }
}

function decodeZipEntry(entry: ZipEntry, payload: Uint8Array): string | undefined {
  try {
    const bytes = entry.compression === 0 ? payload : entry.compression === 8 ? inflateSync(payload) : undefined
    if (!bytes || bytes.byteLength !== entry.uncompressedSize || bytes.byteLength > EPUB_MIMETYPE_BYTES) return undefined
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

async function readExactly(handle: Awaited<ReturnType<typeof open>>, bytes: number, position: number, signal: AbortSignal): Promise<Uint8Array | undefined> {
  if (bytes < 0 || bytes > ZIP_METADATA_BYTES + ZIP_LOCAL_HEADER_BYTES) return undefined
  throwIfAborted(signal)
  const buffer = Buffer.alloc(bytes)
  const result = await handle.read(buffer, 0, bytes, position)
  throwIfAborted(signal)
  return result.bytesRead === bytes ? buffer : undefined
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
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
  const mimeMismatch = declared !== '' && declared !== 'application/octet-stream' && !acceptedMimes(candidate).includes(declared)
  return extensionMismatch || mimeMismatch
}

function knownExtensionType(extension: string): string | undefined {
  const mapping: Record<string, string> = {
    '.txt': 'text', '.json': 'config-json', '.jsonc': 'config-json', '.yaml': 'config-yaml', '.yml': 'config-yaml',
    '.ini': 'config-ini', '.toml': 'config-toml', '.pdf': 'pdf', '.zip': 'zip', '.7z': '7z', '.rar': 'rar',
    '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp', '.xml': 'config-xml',
    '.html': 'html', '.htm': 'html', '.svg': 'svg',
    '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx', '.epub': 'epub', '.doc': 'doc', '.xls': 'xls', '.ppt': 'ppt', '.wps': 'doc', '.rtf': 'rtf', '.odt': 'odt', '.ods': 'ods', '.odp': 'odp', '.ts': 'source-typescript',
    '.tsx': 'source-typescript', '.js': 'source-javascript', '.jsx': 'source-javascript', '.py': 'source-python',
    '.md': 'markdown', '.mdx': 'markdown', '.csv': 'csv', '.tsv': 'tsv', '.sql': 'sql', '.plist': 'plist',
    '.conf': 'config-ini', '.config': 'config-text', '.sh': 'shell', '.zsh': 'shell', '.bash': 'shell',
    '.c': 'source-c', '.h': 'source-c', '.cpp': 'source-cpp', '.cc': 'source-cpp', '.hpp': 'source-cpp',
    '.go': 'source-go', '.rs': 'source-rust', '.java': 'source-java',
  }
  return mapping[extension]
}

function acceptedMimes(candidate: Candidate): readonly string[] {
  const aliases: Record<string, readonly string[]> = {
    zip: ['application/zip', 'application/x-zip-compressed'],
    'config-yaml': ['application/yaml', 'text/yaml', 'application/x-yaml'],
    'source-javascript': ['text/plain', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'],
    'source-typescript': ['text/plain', 'text/typescript', 'application/typescript'],
    shell: ['text/plain', 'application/x-sh'],
    'config-xml': ['application/xml', 'text/xml'],
    plist: ['application/xml', 'application/x-plist'],
    html: ['text/html', 'application/xhtml+xml', 'text/plain'],
    svg: ['image/svg+xml', 'text/plain', 'application/xml', 'text/xml'],
  }
  return aliases[candidate.kind] ?? [candidate.mime.toLowerCase()]
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
