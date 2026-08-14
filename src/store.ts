import { createHash, randomUUID } from 'node:crypto'
import { open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { detectFileFromPath } from './detect.ts'
import { AttachmentError } from './errors.ts'
import { LIMITS, type AttachmentId, type AttachmentMetadata } from './shared/contracts.ts'

const ID_PATTERN = /^att_[A-Za-z0-9_-]{6,80}$/

export interface PutAttachmentInput {
  sessionId: string
  batchId: string
  name: string
  declaredMime: string
  source: AsyncIterable<Uint8Array>
  signal: AbortSignal
}

interface BatchIndex {
  ids: AttachmentId[]
}

export class AttachmentStore {
  constructor(readonly root: string, private readonly now = Date.now) {}

  async put(input: PutAttachmentInput): Promise<AttachmentMetadata> {
    await this.ensureDirectories()
    const existing = await this.listBatch(input.sessionId, input.batchId)
    if (existing.length >= LIMITS.messageFiles) throw new AttachmentError('MESSAGE_FILES_TOO_LARGE', '单个批次最多 10 个文件')

    const tempPath = join(this.root, 'tmp', `${randomUUID()}.partial`)
    const handle = await open(tempPath, 'wx', 0o600)
    const hash = createHash('sha256')
    let bytes = 0
    try {
      for await (const chunk of input.source) {
        throwIfAborted(input.signal)
        const buffer = Buffer.from(chunk)
        bytes += buffer.byteLength
        if (bytes > LIMITS.archiveBytes) throw new AttachmentError('FILE_TOO_LARGE', '文件超过 100 MB')
        if (existing.reduce((sum, item) => sum + item.bytes, 0) + bytes > LIMITS.messageBytes) {
          throw new AttachmentError('MESSAGE_FILES_TOO_LARGE', '单个批次总计不超过 50 MB')
        }
        hash.update(buffer)
        await handle.write(buffer)
      }
      await handle.sync()
      await handle.close()

      const detected = await detectFileFromPath({ name: input.name, declaredMime: input.declaredMime, path: tempPath, signal: input.signal })
      if (detected.family !== 'archive' && bytes > LIMITS.fileBytes) throw new AttachmentError('FILE_TOO_LARGE', '普通文件超过 25 MB')
      const sha256 = hash.digest('hex')
      const blobPath = this.blobPath(sha256)
      await mkdir(join(this.root, 'blobs', 'sha256', sha256.slice(0, 2)), { recursive: true, mode: 0o700 })
      try {
        await stat(blobPath)
        await rm(tempPath, { force: true })
      } catch {
        await rename(tempPath, blobPath)
      }

      const metadata: AttachmentMetadata = {
        id: `att_${randomUUID().replaceAll('-', '')}` as AttachmentId,
        ownerSessionId: input.sessionId,
        batchId: input.batchId,
        safeName: sanitizeFilename(input.name),
        declaredMime: input.declaredMime,
        detected,
        bytes,
        sha256,
        createdAt: this.now(),
      }
      await writeJsonAtomic(join(this.root, 'refs', `${metadata.id}.json`), metadata)
      await this.writeBatch(input.sessionId, input.batchId, [...existing.map(item => item.id), metadata.id])
      return metadata
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(tempPath, { force: true })
      throw error
    }
  }

  async get(id: AttachmentId): Promise<AttachmentMetadata | undefined> {
    if (!ID_PATTERN.test(id)) return undefined
    let raw: string
    try {
      raw = await readFile(join(this.root, 'refs', `${id}.json`), 'utf8')
    } catch {
      return undefined
    }
    try {
      const metadata = JSON.parse(raw) as AttachmentMetadata
      if (metadata.id !== id || !ID_PATTERN.test(metadata.id) || typeof metadata.ownerSessionId !== 'string' || typeof metadata.batchId !== 'string') return undefined
      if (!/^[a-f0-9]{64}$/.test(metadata.sha256) || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0) return undefined
      if (this.blobPath(metadata.sha256) !== join(this.root, 'blobs', 'sha256', metadata.sha256.slice(0, 2), metadata.sha256)) return undefined
      return metadata
    } catch {
      return undefined
    }
  }

  async open(id: AttachmentId): Promise<{ metadata: AttachmentMetadata; path: string }> {
    const metadata = await this.get(id)
    if (!metadata) throw new AttachmentError('CORRUPT_FILE', '附件元数据不可用')
    const path = this.blobPath(metadata.sha256)
    try {
      await stat(path)
    } catch (cause) {
      throw new AttachmentError('CORRUPT_FILE', '附件内容不可用', undefined, cause)
    }
    return { metadata, path }
  }

  async removeDraft(sessionId: string, id: AttachmentId): Promise<void> {
    const metadata = await this.get(id)
    if (!metadata) return
    if (metadata.ownerSessionId !== sessionId) throw new AttachmentError('ATTACHMENT_FORBIDDEN', '附件不属于当前会话')
    await rm(join(this.root, 'refs', `${id}.json`), { force: true })
    const remaining = (await this.listBatch(sessionId, metadata.batchId)).filter(item => item.id !== id).map(item => item.id)
    await this.writeBatch(sessionId, metadata.batchId, remaining)
  }

  async listBatch(sessionId: string, batchId: string): Promise<AttachmentMetadata[]> {
    let index: BatchIndex
    try {
      index = JSON.parse(await readFile(this.batchPath(sessionId, batchId), 'utf8')) as BatchIndex
    } catch {
      return []
    }
    if (!Array.isArray(index.ids)) return []
    const result: AttachmentMetadata[] = []
    for (const id of index.ids) {
      const metadata = await this.get(id)
      if (metadata?.ownerSessionId === sessionId && metadata.batchId === batchId) result.push(metadata)
    }
    return result
  }

  private blobPath(sha256: string): string {
    return join(this.root, 'blobs', 'sha256', sha256.slice(0, 2), sha256)
  }

  private batchPath(sessionId: string, batchId: string): string {
    return join(this.root, 'batches', digest(sessionId), `${digest(batchId)}.json`)
  }

  private async writeBatch(sessionId: string, batchId: string, ids: AttachmentId[]): Promise<void> {
    await writeJsonAtomic(this.batchPath(sessionId, batchId), { ids })
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(join(this.root, 'blobs', 'sha256'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'refs'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'batches'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'tmp'), { recursive: true, mode: 0o700 }),
    ])
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sanitizeFilename(name: string): string {
  const withoutControls = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  const base = basename(withoutControls.replace(/\\/g, '/')).replace(/[\\/]/g, '_')
  if (!base) return 'unnamed'
  let result = ''
  const encoder = new TextEncoder()
  for (const character of base) {
    if (encoder.encode(result + character).byteLength > 255) break
    result += character
  }
  return result || 'unnamed'
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.partial`
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
    await handle.close()
    await rename(temp, path)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temp, { force: true })
    throw error
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
