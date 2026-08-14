import React from 'react'
import { createAttachmentApi } from './client/api.ts'
import { createAttachmentDraftStore } from './client/store.ts'
import { FileAttachButton } from './client/FileAttachButton.tsx'
import { FileAttachmentDock } from './client/FileAttachmentDock.tsx'

export const inject = ['slots'] as const

export interface ClientContext { slots: { inject(name: string, factory: () => unknown): void; register(definition: unknown, render: (props: any) => React.ReactElement): () => void } }

export function apply(ctx: ClientContext): void {
  const drafts = createAttachmentDraftStore(createAttachmentApi())
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-file-attach', order: 90, label: '添加文件' }, props => <FileAttachButton {...props} onFiles={props.onFiles ?? (() => undefined)} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-file-attachments', order: 90, label: '文件附件' }, props => <FileAttachmentDock files={drafts.files(props.sessionId)} onRemove={id => void drafts.remove(props.sessionId, id, props.input?.draft ?? '')} />))
}

export default { inject, apply }
