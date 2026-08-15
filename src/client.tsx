import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createAttachmentApi } from './client/api.ts'
import { createAttachmentDraftStore, type SentAttachmentReceipt } from './client/store.ts'
import { FileAttachButton } from './client/FileAttachButton.tsx'
import { FileAttachmentDock } from './client/FileAttachmentDock.tsx'
import { TurnAttachmentReceipt } from './client/TurnAttachmentReceipt.tsx'
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

interface TurnTailProps {
  sessionId: string
  matched: { turn: number }
  drafts: ReturnType<typeof createAttachmentDraftStore>
}

/** 回合尾回执:挂载时认领本会话的发送公告,渲染沉静单行。 */
function TurnTailEntry(props: TurnTailProps): React.ReactElement | null {
  const [receipt, setReceipt] = useState<SentAttachmentReceipt | null>(null)

  useEffect(() => {
    const claimed = props.drafts.claimTail(props.sessionId, props.matched.turn)
    if (claimed !== undefined) setReceipt(claimed)
  }, [props.drafts, props.sessionId, props.matched.turn])

  if (receipt === null) return null
  return <TurnAttachmentReceipt receipt={receipt} />
}

export function apply(ctx: ClientContext): void {
  const drafts = createAttachmentDraftStore(createAttachmentApi())
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-file-attach', order: 90, label: '添加文件' }, props => <AttachmentInput {...props as InputZoneProps} drafts={drafts} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-file-attachments', order: 90, label: '文件附件' }, props => <AttachmentDock {...props as InputZoneProps} drafts={drafts} />))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', select: (owner: { turn: { turn: number } }) => drafts.tailSelect(owner.turn.turn) }, props => <TurnTailEntry {...props as TurnTailProps} drafts={drafts} />))
}

export default { inject, apply }
