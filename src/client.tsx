import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createAttachmentApi } from './client/api.ts'
import { createAttachmentDraftStore } from './client/store.ts'
import { FileAttachButton } from './client/FileAttachButton.tsx'
import { FileAttachmentDock } from './client/FileAttachmentDock.tsx'
import { UserMessageWithReceipt, type UserNodeOwnerProps } from './client/UserMessageWithReceipt.tsx'
import { installFileDrop } from './client/drop.ts'
import { installFilePaste } from './client/paste.ts'

export const inject = ['slots'] as const

export interface ClientContext { slots: { inject(name: string, factory: () => unknown): void; register(definition: unknown, render: (props: any) => React.ReactElement): () => void } }

interface InputZoneProps {
  sessionId: string
  input: { draft: string }
  inputActions: { setDraft(text: string): void }
  disabled?: boolean
}

function AttachmentInput(props: InputZoneProps & { drafts: ReturnType<typeof createAttachmentDraftStore> }): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  const draftRef = useRef(props.input.draft)
  const inputActionsRef = useRef(props.inputActions)
  inputActionsRef.current = props.inputActions

  useEffect(() => {
    draftRef.current = props.input.draft
    props.drafts.observeDraft(props.sessionId, props.input.draft)
  }, [props.drafts, props.sessionId, props.input.draft])

  const uploadFiles = useCallback(async (files: File[]) => {
    setError(null)
    let draft = draftRef.current
    try {
      for (const file of files) {
        const result = await props.drafts.upload(props.sessionId, draft, file)
        draft = result.draft
        draftRef.current = draft
        inputActionsRef.current.setDraft(draft)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [props.drafts, props.sessionId])

  // 文档级拖放 / 粘贴：generic 文件走附件上传，图片放行给输入框原生的图片链路
  useEffect(() => {
    const offDrop = installFileDrop(document, uploadFiles)
    const offPaste = installFilePaste(document, uploadFiles)
    return () => {
      offDrop()
      offPaste()
    }
  }, [uploadFiles])

  return <span>
    <FileAttachButton disabled={props.disabled} onFiles={uploadFiles} />
    {error && <span role="alert">{error}</span>}
  </span>
}

function AttachmentDock(props: InputZoneProps & { drafts: ReturnType<typeof createAttachmentDraftStore> }): React.ReactElement {
  const [files, setFiles] = useState(() => props.drafts.files(props.sessionId))
  const [error, setError] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)

  useEffect(() => {
    setFiles(props.drafts.files(props.sessionId))
    return props.drafts.subscribe(props.sessionId, () => {
      setFiles(props.drafts.files(props.sessionId))
    })
  }, [props.drafts, props.sessionId])

  useEffect(() => {
    if (armedId === null) return
    const timer = setTimeout(() => setArmedId(null), 4000)
    return () => clearTimeout(timer)
  }, [armedId])

  const remove = async (id: string) => {
    setError(null)
    setArmedId(null)
    try {
      const draft = await props.drafts.remove(props.sessionId, id, props.input.draft)
      props.inputActions.setDraft(draft)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <>
    <FileAttachmentDock files={files} armedId={armedId} onArm={setArmedId} onRemove={remove} />
    {error && <div role="alert">{error}</div>}
  </>
}

export function apply(ctx: ClientContext): void {
  const drafts = createAttachmentDraftStore(createAttachmentApi())
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-file-attach', order: 90, label: '添加文件' }, props => <AttachmentInput {...props as InputZoneProps} drafts={drafts} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-file-attachments', order: 90, label: '文件附件' }, props => <AttachmentDock {...props as InputZoneProps} drafts={drafts} />))
  // 接管 user 消息节点:在携带附件的那条用户气泡下方渲染沉静回执(官方惯例)
  // keyed 槽位同 key 同 priority 会抛错;胜者为 priority 最小者,官方条目为 0,故用 -1 影子接管
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'user', priority: -1, label: '用户消息(带附件回执)' }, props => <UserMessageWithReceipt {...props as UserNodeOwnerProps} drafts={drafts} />))
}

export default { inject, apply }
