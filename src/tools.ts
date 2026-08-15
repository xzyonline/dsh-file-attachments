import { defineTool, type ToolDefinition as DshToolDefinition } from '@deepseek-ai/dsh-tools'
import { authorizeAttachmentRead } from './session-auth.ts'
import { runParsedInWorker } from './parse-host.ts'
import { AttachmentError } from './errors.ts'
import type { AttachmentStore } from './store.ts'

const ATTACHMENT_ID = { type: 'string' as const, description: 'Opaque attachment id returned by attachment_info' }
const REQUIRED_ATTACHMENT_ID = { ...ATTACHMENT_ID, required: true as const }
const OBJECT_OUTPUT = {
  schema: { type: 'object' as const, additionalProperties: true as const },
  render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

export interface ToolContext {
  sessionQuery: { readSession(sessionId: string): Promise<{ events: readonly unknown[] }> }
  tools: { register(definition: ToolDefinition): () => void }
}

export type ToolDefinition = DshToolDefinition

export function createAttachmentToolDefinitions(ctx: ToolContext, store: AttachmentStore): ToolDefinition[] {
  const execute = async (name: string, args: Record<string, unknown>, exec: { agent: { id: string }; signal: AbortSignal }) => {
    const id = String(args.attachment_id ?? '') as never
    const fileName = String(args.file_name ?? '')
    if (name === 'attachment_info' && !id && !fileName) {
      const attachments = await store.listLatestBySession(exec.agent.id)
      for (const metadata of attachments) await authorizeAttachmentRead(ctx.sessionQuery, store, exec.agent.id, metadata, exec.signal)
      return toLosslessJson({ attachments })
    }
    const metadata = id ? await store.get(id) : name === 'attachment_info' && fileName ? await store.findLatestByName(exec.agent.id, fileName) : undefined
    if (!metadata) throw new AttachmentError('ATTACHMENT_FORBIDDEN', '附件不存在或不可访问')
    await authorizeAttachmentRead(ctx.sessionQuery, store, exec.agent.id, metadata, exec.signal)
    if (name === 'attachment_info') return toLosslessJson(metadata)
    const handle = await store.open(id)
    if (name === 'list_archive') return toLosslessJson(await runParsedInWorker({ op: 'list', path: handle.path, request: { cursor: Number(args.cursor ?? 0), limit: Number(args.limit ?? 100), prefix: args.prefix ? String(args.prefix) : undefined } }, exec.signal))
    return toLosslessJson(await runParsedInWorker({ op: 'read', path: handle.path, detectedFamily: handle.metadata.detected.family, detectedKind: handle.metadata.detected.kind, request: { offset: Number(args.offset ?? 0), page: args.page ? Number(args.page) : undefined, pageEnd: args.page_end ? Number(args.page_end) : undefined, paragraphOffset: args.paragraph_offset ? Number(args.paragraph_offset) : undefined, paragraphLimit: args.paragraph_limit ? Number(args.paragraph_limit) : undefined, sheet: args.sheet ? String(args.sheet) : undefined, range: args.range ? String(args.range) : undefined, archivePath: args.archive_path ? String(args.archive_path) : undefined } }, exec.signal))
  }
  return [
    defineTool({ name: 'attachment_info', description: 'List current-session attachments without arguments, or resolve one by file name or opaque id, then return verified metadata and read capability. Call this first whenever the user may have uploaded files, even without an explicit file mention.', parameters: { attachment_id: ATTACHMENT_ID, file_name: { type: 'string', description: 'Optional exact attachment file name when the user identifies one' } }, output: OBJECT_OUTPUT, execute: async (args, exec) => await execute('attachment_info', args, exec as never) as never }),
    defineTool({ name: 'read_attachment', description: 'Read a bounded page/range from one authorized attachment or one named archive entry.', parameters: { attachment_id: REQUIRED_ATTACHMENT_ID, offset: { type: 'number', description: 'Text byte offset, default 0' }, page: { type: 'number', description: '1-based PDF/PPTX page' }, page_end: { type: 'number', description: 'Inclusive page end, at most 10 pages' }, paragraph_offset: { type: 'number', description: '0-based DOCX paragraph offset' }, paragraph_limit: { type: 'number', description: 'DOCX paragraph count, max 2000' }, sheet: { type: 'string', description: 'Exact XLSX worksheet name' }, range: { type: 'string', description: 'Validated A1 range, e.g. A1:D50' }, archive_path: { type: 'string', description: 'Exact safe internal path' } }, output: OBJECT_OUTPUT, execute: async (args, exec) => await execute('read_attachment', args, exec as never) as never }),
    defineTool({ name: 'list_archive', description: 'List a bounded page of ZIP, 7z, RAR, or EPUB entries without extracting them.', parameters: { attachment_id: REQUIRED_ATTACHMENT_ID, cursor: { type: 'number', description: '0-based entry cursor, default 0' }, limit: { type: 'number', description: 'Entries to return, 1..200, default 100' }, prefix: { type: 'string', description: 'Optional safe internal path prefix' } }, output: OBJECT_OUTPUT, execute: async (args, exec) => await execute('list_archive', args, exec as never) as never }),
  ]
}

function toLosslessJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : toLosslessJson(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toLosslessJson(item)]))
  }
  return value
}

export function registerAttachmentTools(ctx: ToolContext, store: AttachmentStore): () => void {
  const disposers = createAttachmentToolDefinitions(ctx, store).map(definition => ctx.tools.register(definition))
  return () => disposers.reverse().forEach(dispose => dispose())
}
