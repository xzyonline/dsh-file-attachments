import type { IncomingMessage, ServerResponse } from 'node:http'
import { AttachmentError } from './errors.ts'
import { authorizeAttachmentRead, type SessionQueryLike } from './session-auth.ts'
import { AttachmentStore } from './store.ts'
import { LIMITS } from './shared/contracts.ts'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const BASE = '/api/dsh-file-attachments/v1/files'

export interface AttachmentHttpOptions {
  expectedOrigin: string
  authorize?: (sessionId: string, metadata: Awaited<ReturnType<AttachmentStore['get']>>, signal: AbortSignal) => Promise<void>
}

export async function dispatchAttachmentHttp(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, options: AttachmentHttpOptions): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const suffix = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null
    if (suffix === null || (suffix !== '' && !/^\/att_[A-Za-z0-9_-]{6,80}$/.test(suffix))) return respond(res, 404, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '资源不存在' } })
    if (req.method === 'POST' && suffix === '') return await upload(req, res, store, options)
    if (req.method === 'GET' && suffix) return await readMetadata(req, res, store, suffix.slice(1), options)
    if (req.method === 'DELETE' && suffix) return await deleteDraft(req, res, store, suffix.slice(1))
    return respond(res, 405, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '不支持的请求方法' } })
  } catch (error) {
    return respondError(res, error)
  }
}

export function registerAttachmentRoutes(ctx: { webServer: { host: string; port: number; register(config: unknown): () => void }; sessionQuery: SessionQueryLike }, store: AttachmentStore): () => void {
  return ctx.webServer.register({ kind: 'prefix', path: BASE, handler: (req: IncomingMessage, res: ServerResponse) => dispatchAttachmentHttp(req, res, store, {
    expectedOrigin: `http://${ctx.webServer.host}:${ctx.webServer.port}`,
    authorize: async (sessionId, metadata, signal) => {
      if (!metadata) throw new AttachmentError('ATTACHMENT_FORBIDDEN', '附件不存在或不可访问')
      await authorizeAttachmentRead(ctx.sessionQuery, store, sessionId, metadata, signal)
    },
  }) })
}

async function upload(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, options: AttachmentHttpOptions): Promise<void> {
  if (header(req, 'origin') !== options.expectedOrigin) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '来源不受信任' } })
  const sessionId = header(req, 'x-dsh-session-id')
  const batchId = header(req, 'x-dsh-batch-id')
  const fileNameHeader = header(req, 'x-dsh-file-name')
  if (!sessionId || !batchId || !ID.test(sessionId) || !ID.test(batchId) || !fileNameHeader) return respond(res, 400, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '上传参数无效' } })
  if (Number(header(req, 'content-length') ?? 0) > LIMITS.fileBytes) return respond(res, 413, { ok: false, error: { code: 'FILE_TOO_LARGE', message: '文件超过 25 MB' } })
  let name: string
  try { name = decodeURIComponent(fileNameHeader) } catch { return respond(res, 400, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '文件名无效' } }) }
  const controller = new AbortController()
  req.on('aborted', () => controller.abort(new Error('upload aborted')))
  const metadata = await store.put({ sessionId, batchId, name, declaredMime: header(req, 'content-type') ?? '', source: body(req), signal: controller.signal })
  return respond(res, 201, { ok: true, metadata })
}

async function* body(req: IncomingMessage): AsyncIterable<Uint8Array> {
  for await (const chunk of req) yield Buffer.from(chunk as Uint8Array)
}

async function readMetadata(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, id: string, options: AttachmentHttpOptions): Promise<void> {
  const metadata = await store.get(id as never)
  if (!metadata) return respond(res, 404, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '资源不存在' } })
  const sessionId = header(req, 'x-dsh-session-id')
  if (!sessionId) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '附件不属于当前会话' } })
  if (options.authorize) await options.authorize(sessionId, metadata, new AbortController().signal)
  return respond(res, 200, { ok: true, metadata })
}

async function deleteDraft(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, id: string): Promise<void> {
  const sessionId = header(req, 'x-dsh-session-id')
  if (!sessionId) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '缺少会话' } })
  await store.removeDraft(sessionId, id as never)
  return respond(res, 200, { ok: true })
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function respondError(res: ServerResponse, error: unknown): void {
  if (error instanceof AttachmentError) return respond(res, error.code === 'FILE_TOO_LARGE' || error.code === 'MESSAGE_FILES_TOO_LARGE' ? 413 : error.code === 'ATTACHMENT_FORBIDDEN' ? 403 : 400, { ok: false, error: { code: error.code, message: error.message, details: error.details } })
  return respond(res, 500, { ok: false, error: { code: 'CORRUPT_FILE', message: '附件处理失败' } })
}
