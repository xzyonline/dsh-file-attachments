import { authorizeAttachmentRead } from './session-auth.ts'
import { listArchive } from './archive.ts'
import { readAttachment } from './read.ts'
import { AttachmentError } from './errors.ts'
import type { AttachmentStore } from './store.ts'

const ATTACHMENT_ID = { type: 'string' as const, required: true, description: 'Opaque id from a <dsh-file ref="..."/> marker in this session' }

export interface ToolContext {
  sessionQuery: { readSession(sessionId: string): Promise<{ events: readonly unknown[] }> }
  tools: { register(definition: ToolDefinition): () => void }
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, { type: 'string' | 'number'; required?: boolean; description: string }>
  execute(args: Record<string, unknown>, exec: { agent: { id: string }; signal: AbortSignal }): Promise<unknown>
}

export function createAttachmentToolDefinitions(ctx: ToolContext, store: AttachmentStore): ToolDefinition[] {
  const execute = async (name: string, args: Record<string, unknown>, exec: { agent: { id: string }; signal: AbortSignal }) => {
    const id = String(args.attachment_id ?? '') as never
    const metadata = await store.get(id)
    if (!metadata) throw new AttachmentError('ATTACHMENT_FORBIDDEN', '附件不存在或不可访问')
    await authorizeAttachmentRead(ctx.sessionQuery, store, exec.agent.id, metadata, exec.signal)
    if (name === 'attachment_info') return metadata
    const handle = await store.open(id)
    if (name === 'list_archive') return listArchive(handle.path, { cursor: Number(args.cursor ?? 0), limit: Number(args.limit ?? 100), prefix: args.prefix ? String(args.prefix) : undefined }, exec.signal)
    return readAttachment(handle, { offset: Number(args.offset ?? 0), page: args.page ? Number(args.page) : undefined, pageEnd: args.page_end ? Number(args.page_end) : undefined, paragraphOffset: args.paragraph_offset ? Number(args.paragraph_offset) : undefined, paragraphLimit: args.paragraph_limit ? Number(args.paragraph_limit) : undefined, sheet: args.sheet ? String(args.sheet) : undefined, range: args.range ? String(args.range) : undefined, archivePath: args.archive_path ? String(args.archive_path) : undefined }, exec.signal)
  }
  return [
    { name: 'attachment_info', description: 'Return verified metadata and read capability for one file attachment.', parameters: { attachment_id: ATTACHMENT_ID }, execute: (args, exec) => execute('attachment_info', args, exec) },
    { name: 'read_attachment', description: 'Read a bounded page/range from one authorized attachment or one named archive entry.', parameters: { attachment_id: ATTACHMENT_ID, offset: { type: 'number', description: 'Text byte offset, default 0' }, page: { type: 'number', description: '1-based PDF/PPTX page' }, page_end: { type: 'number', description: 'Inclusive page end, at most 10 pages' }, paragraph_offset: { type: 'number', description: '0-based DOCX paragraph offset' }, paragraph_limit: { type: 'number', description: 'DOCX paragraph count, max 2000' }, sheet: { type: 'string', description: 'Exact XLSX worksheet name' }, range: { type: 'string', description: 'Validated A1 range, e.g. A1:D50' }, archive_path: { type: 'string', description: 'Exact safe internal path' } }, execute: (args, exec) => execute('read_attachment', args, exec) },
    { name: 'list_archive', description: 'List a bounded page of ZIP, 7z, RAR, or EPUB entries without extracting them.', parameters: { attachment_id: ATTACHMENT_ID, cursor: { type: 'number', description: '0-based entry cursor, default 0' }, limit: { type: 'number', description: 'Entries to return, 1..200, default 100' }, prefix: { type: 'string', description: 'Optional safe internal path prefix' } }, execute: (args, exec) => execute('list_archive', args, exec) },
  ]
}

export function registerAttachmentTools(ctx: ToolContext, store: AttachmentStore): () => void {
  const disposers = createAttachmentToolDefinitions(ctx, store).map(definition => ctx.tools.register(definition))
  return () => disposers.reverse().forEach(dispose => dispose())
}
