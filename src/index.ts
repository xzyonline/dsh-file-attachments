import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerAttachmentRoutes } from './http.ts'
import { registerAttachmentTools } from './tools.ts'
import { AttachmentStore } from './store.ts'

export const name = 'dsh-file-attachments'
export const inject = ['tools', 'systemPrompt', 'webServer', 'sessionQuery'] as const
export const ATTACHMENT_PROMPT = 'Recognize <dsh-file ref="..."/> markers. Call attachment_info before choosing a reader, use bounded page/range/cursor calls, list archives before extracting a named path, never execute attachments, and use view_image for images.'

export interface PluginContext {
  effect(factory: () => () => void, label: string): void
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
  ctx.effect(() => ctx.systemPrompt.section({ name: 'tool:dsh-file-attachments', order: 117, text: ATTACHMENT_PROMPT }), 'file-attachments.prompt')
}

export default { name, inject, apply }
