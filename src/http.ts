import type { IncomingMessage, ServerResponse } from 'node:http'
import { AttachmentError } from './errors.ts'
import { authorizeAttachmentRead, sessionExists, type SessionQueryLike } from './session-auth.ts'
import { AttachmentStore } from './store.ts'
import { ID_PATTERN, LIMITS, type AttachmentErrorCode } from './shared/contracts.ts'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const ATTACHMENT_PATH = new RegExp(`^/${ID_PATTERN}$`)
const BASE = '/api/dsh-file-attachments/v1/files'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export interface AttachmentHttpOptions {
  expectedOrigin: string
  authorize?: (sessionId: string, metadata: Awaited<ReturnType<AttachmentStore['get']>>, signal: AbortSignal) => Promise<void>
  verifySession?: (sessionId: string) => Promise<boolean>
}

export async function dispatchAttachmentHttp(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, options: AttachmentHttpOptions): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const suffix = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null
    if (suffix === null || (suffix !== '' && !ATTACHMENT_PATH.test(suffix))) return respond(res, 404, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '资源不存在' } })
    if (req.method === 'POST' && suffix === '') return await upload(req, res, store, options)
    if (req.method === 'GET' && suffix) return await readMetadata(req, res, store, suffix.slice(1), options)
    if (req.method === 'DELETE' && suffix) return await deleteDraft(req, res, store, suffix.slice(1), options)
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
      await authorizeAttachmentRead(ctx.sessionQuery, sessionId, metadata, signal)
    },
    verifySession: (sessionId) => sessionExists(ctx.sessionQuery, sessionId),
  }) })
}

async function upload(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, options: AttachmentHttpOptions): Promise<void> {
  const origin = header(req, 'origin')
  if (origin === undefined || !trustedOrigin(origin, options)) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '来源不受信任' } })
  const sessionId = header(req, 'x-dsh-session-id')
  const batchId = header(req, 'x-dsh-batch-id')
  const fileNameHeader = header(req, 'x-dsh-file-name')
  if (!sessionId || !batchId || !ID.test(sessionId) || !ID.test(batchId) || !fileNameHeader) return respond(res, 400, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '上传参数无效' } })
  if (options.verifySession && !(await options.verifySession(sessionId))) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '会话不存在或不可访问' } })
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
  if (untrustedOrigin(req, options)) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '来源不受信任' } })
  const metadata = await store.get(id as never)
  if (!metadata) return respond(res, 404, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '资源不存在' } })
  const sessionId = header(req, 'x-dsh-session-id')
  if (!sessionId) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '附件不属于当前会话' } })
  if (options.authorize) await options.authorize(sessionId, metadata, new AbortController().signal)
  return respond(res, 200, { ok: true, metadata })
}

async function deleteDraft(req: IncomingMessage, res: ServerResponse, store: AttachmentStore, id: string, options: AttachmentHttpOptions): Promise<void> {
  if (untrustedOrigin(req, options)) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '来源不受信任' } })
  const sessionId = header(req, 'x-dsh-session-id')
  if (!sessionId) return respond(res, 403, { ok: false, error: { code: 'ATTACHMENT_FORBIDDEN', message: '缺少会话' } })
  await store.removeDraft(sessionId, id as never)
  return respond(res, 200, { ok: true })
}

/** 浏览器跨站请求必带 Origin；带 Origin 且与可信来源不符即拒。缺 Origin 的非浏览器客户端(如本地 curl)仍放行。 */
function untrustedOrigin(req: IncomingMessage, options: AttachmentHttpOptions): boolean {
  const origin = header(req, 'origin')
  return origin !== undefined && !trustedOrigin(origin, options)
}

/**
 * 可信来源判定：与宿主完全一致，或同为回环地址且端口一致
 * （127.0.0.1 / localhost / [::1] 等价——同属本机，非放宽）。
 */
function trustedOrigin(origin: string, options: AttachmentHttpOptions): boolean {
  if (origin === options.expectedOrigin) return true
  try {
    const expected = new URL(options.expectedOrigin)
    const incoming = new URL(origin)
    if (LOOPBACK_HOSTS.has(expected.hostname) && LOOPBACK_HOSTS.has(incoming.hostname) && expected.port === incoming.port) return true
  } catch {
    return false
  }
  return false
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
  if (error instanceof AttachmentError) return respond(res, statusForCode(error.code), { ok: false, error: { code: error.code, message: error.message, details: error.details } })
  return respond(res, 500, { ok: false, error: { code: 'CORRUPT_FILE', message: '附件处理失败' } })
}

function statusForCode(code: AttachmentErrorCode): number {
  switch (code) {
    case 'FILE_TOO_LARGE':
    case 'MESSAGE_FILES_TOO_LARGE': return 413
    case 'PARSER_TIMEOUT': return 504
    case 'ATTACHMENT_FORBIDDEN': return 403
    default: return 400
  }
}
