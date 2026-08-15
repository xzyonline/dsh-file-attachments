import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { AttachmentError } from './errors.ts'
import { detectFile } from './detect.ts'
import { redactSensitiveText } from './redact.ts'
import { LIMITS } from './shared/contracts.ts'

export type ArchiveRunner = (
  file: string,
  args: readonly string[],
  options: { signal: AbortSignal; timeoutMs: number; maxStdout: number; maxStderr: number },
) => Promise<{ stdout: Buffer; stderr: Buffer; code: number }>

/** macOS/Linux 优先用系统 tar(版本稳定的 bsdtar);Windows 10+ 自带 C:\Windows\System32\tar.exe(bsdtar),从 PATH 解析。 */
export function resolveTarBinary(): string {
  if (existsSync('/usr/bin/tar')) return '/usr/bin/tar'
  return 'tar'
}

export interface ArchiveEntry {
  path: string
}

export interface ArchivePage {
  entries: ArchiveEntry[]
  nextCursor?: number
}

export interface ArchiveHandle {
  path: string
  declaredMime?: string
}

export function normalizeArchivePath(value: string): string {
  const posix = value.replaceAll('\\', '/')
  if (posix === '' || posix === '.' || posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)) rejected()
  const normalized = posixPathNormalize(posix)
  if (normalized === '..' || normalized.startsWith('../')) rejected()
  return normalized
}

/**
 * Decode bsdtar's octal escaping of non-ASCII bytes (`\351\223\276...` →
 * UTF-8). bsdtar escapes high bytes when listing to a pipe, and the raw
 * backslashes would otherwise be mistaken for Windows path separators by
 * {@link normalizeArchivePath}, turning `\351\223...` into an "absolute
 * path" and rejecting every archive that contains CJK file names.
 */
export function decodeTarEscapes(value: string): string {
  if (!value.includes('\\')) return value
  const bytes: number[] = []
  const encoder = new TextEncoder()
  let index = 0
  while (index < value.length) {
    const match = /^\\([0-7]{3})/.exec(value.slice(index))
    if (match !== null) {
      bytes.push(parseInt(match[1]!, 8))
      index += 4
    } else {
      bytes.push(...encoder.encode(value[index]!))
      index += 1
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
}

export async function listArchive(path: string, request: { cursor?: number; limit?: number; prefix?: string } = {}, signal: AbortSignal, runner: ArchiveRunner = runArchiveCommand): Promise<ArchivePage> {
  const result = await runner(resolveTarBinary(), ['-tf', path], { signal, timeoutMs: LIMITS.archiveTimeoutMs, maxStdout: LIMITS.readBytes, maxStderr: LIMITS.readBytes })
  if (result.code !== 0) throw new AttachmentError('CORRUPT_FILE', result.stderr.toString() || '无法读取归档目录')
  const seen = new Set<string>()
  const entries: ArchiveEntry[] = []
  for (const line of result.stdout.toString('utf8').split(/\r?\n/).filter(Boolean)) {
    if (entries.length >= LIMITS.archiveEntries) break
    let normalized: string
    try {
      normalized = normalizeArchivePath(decodeTarEscapes(line))
    } catch {
      // One hostile entry must not hide the whole listing: skip it, stay observable.
      console.warn('[dsh-file-attachments] skipping unsafe archive entry:', line)
      continue
    }
    if (seen.has(normalized) || (request.prefix && !normalized.startsWith(normalizeArchivePath(request.prefix)))) continue
    seen.add(normalized)
    entries.push({ path: normalized })
  }
  const cursor = Math.max(0, request.cursor ?? 0)
  const limit = Math.max(1, Math.min(request.limit ?? 100, LIMITS.archiveEntries))
  const page = entries.slice(cursor, cursor + limit)
  return { entries: page, nextCursor: cursor + page.length < entries.length ? cursor + page.length : undefined }
}

export async function readArchiveEntry(handle: ArchiveHandle, entryPath: string, signal: AbortSignal, runner: ArchiveRunner = runArchiveCommand): Promise<{ kind: 'archive-entry'; text: string; range: Record<string, string | number>; hasMore: boolean; redacted: number; truncated: boolean }> {
  const normalized = normalizeArchivePath(entryPath)
  const listing = await runner(resolveTarBinary(), ['-tvf', handle.path], { signal, timeoutMs: LIMITS.archiveTimeoutMs, maxStdout: LIMITS.readBytes, maxStderr: LIMITS.readBytes })
  if (listing.code !== 0 || !isRegularEntry(decodeTarEscapes(listing.stdout.toString('utf8')), normalized)) throw new AttachmentError('ARCHIVE_PATH_REJECTED', '归档条目不是普通文件或不存在')
  const extracted = await runner(resolveTarBinary(), ['-xOf', handle.path, '--', normalized], { signal, timeoutMs: LIMITS.archiveTimeoutMs, maxStdout: LIMITS.fileBytes, maxStderr: LIMITS.readBytes })
  if (extracted.code !== 0) throw new AttachmentError('CORRUPT_FILE', extracted.stderr.toString('utf8') || '无法提取归档条目')
  const detected = await detectFile({ name: normalized, declaredMime: handle.declaredMime ?? '', bytes: extracted.stdout })
  if (!detected.readable && detected.family !== 'text') throw new AttachmentError('UNSUPPORTED_FILE_TYPE', `归档条目 ${detected.kind} 暂不支持读取`)
  const redacted = redactSensitiveText(new TextDecoder().decode(extracted.stdout))
  return { kind: 'archive-entry', text: redacted.text, range: { path: normalized }, hasMore: false, redacted: redacted.redacted, truncated: false }
}

function isRegularEntry(output: string, name: string): boolean {
  return output.split(/\r?\n/).some(line => line.trim().endsWith(name) && line.trim().startsWith('-'))
}

function rejected(): never {
  throw new AttachmentError('ARCHIVE_PATH_REJECTED', '归档路径不安全')
}

function posixPathNormalize(value: string): string {
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) rejected()
      parts.pop()
    }
    else parts.push(part)
  }
  return parts.join('/') || '.'
}

async function runArchiveCommand(file: string, args: readonly string[], options: { signal: AbortSignal; timeoutMs: number; maxStdout: number; maxStderr: number }): Promise<{ stdout: Buffer; stderr: Buffer; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { shell: false, detached: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const timer = setTimeout(() => finish(new AttachmentError('PARSER_TIMEOUT', '归档操作超时')), options.timeoutMs)
    const abort = () => finish(options.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    const finish = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
      child.kill('SIGTERM')
      if (error) reject(error)
    }
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > options.maxStdout) finish(new AttachmentError('PARSER_OUTPUT_LIMIT', '归档输出超过上限'))
      else stdout.push(Buffer.from(chunk))
    })
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.byteLength
      if (stderrBytes <= options.maxStderr) stderr.push(Buffer.from(chunk))
    })
    child.on('error', error => finish(error))
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code: code ?? 1 })
    })
    options.signal.addEventListener('abort', abort, { once: true })
  })
}
