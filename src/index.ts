import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerAttachmentRoutes } from './http.ts'
import { registerAttachmentTools } from './tools.ts'
import { createInjectionHandler } from './inject-mark.ts'
import { AttachmentStore } from './store.ts'

export const name = 'dsh-file-attachments'
export const inject = ['tools', 'systemPrompt', 'webServer', 'sessionQuery'] as const
export const ATTACHMENT_PROMPT = 'When any user message mentions a file, upload, or attachment, asks you to read/recognize/look at/identify something, or is an attachment-only request, call attachment_info() FIRST to list current-session attachments before answering — the message wire may carry no visible file marker, so check proactively whenever file content is plausibly involved. If you are unsure whether files exist, check anyway. After reading, combine the file content with the user\'s words in the conversation to answer. Use the returned attachment id for bounded page/range/cursor calls, list archives before extracting a named path, never execute attachments, and use view_image for images.'

export interface PluginContext {
  effect(factory: () => () => void, label: string): void
  on(event: string, handler: (payload: { agent: { id: string }; step: number }, next: () => Promise<unknown>) => Promise<unknown> | unknown): () => void
  webServer: { host: string; port: number; register(config: unknown): () => void }
  tools: { register(definition: import('./tools.ts').ToolDefinition): () => void }
  systemPrompt: { section(config: { name: string; order: number; text: string }): () => void }
  sessionQuery: { readSession(sessionId: string): Promise<{ events: readonly unknown[] }> }
}

export interface Config { root?: string }

export function apply(ctx: PluginContext, config: Config = {}): void {
  const store = new AttachmentStore(config.root ?? join(homedir(), '.dsh', 'file-attachments'))
  ctx.effect(() => registerAttachmentRoutes(ctx, store), 'file-attachments.http')
  ctx.effect(() => registerAttachmentTools(ctx, store), 'file-attachments.tools')
  ctx.effect(() => ctx.systemPrompt.section({ name: 'tool:dsh-file-attachments', order: 70, text: ATTACHMENT_PROMPT }), 'file-attachments.prompt')
  ctx.effect(() => ctx.on('agent/pre-step', createInjectionHandler(store) as never), 'file-attachments.mark')
}

export default { name, inject, apply }
