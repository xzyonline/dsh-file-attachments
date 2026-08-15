import React, { useEffect, useState } from 'react'
import type { SentAttachmentReceipt } from './store.ts'

/**
 * 归因:本组件的用户消息渲染(正文拼接 contentParts、/skill 与 @subagent 引用高亮 projectText、
 * 图片块/附加数据块的分类逻辑)复刻自 DeepSeek Harness 官方客户端包
 * `@deepseek-ai/dsh-client-ui-conversation` 的 UserMessageNodeView(同仓库 MIT 许可),
 * 仅为在其气泡下方附加附件回执而重新实现;其余部分为本项目原创。
 */

/** 用户消息内容块(与官方 contentParts 的最小契约一致)。 */
interface UserContentBlock { type?: string; text?: string; attachment?: unknown; [key: string]: unknown }

export interface UserNodeOwnerProps {
  node: { data: { content?: readonly UserContentBlock[]; time?: number }; location?: { kind?: string; turn?: { turn?: number } } }
  loadImage?: (attachment: unknown) => Promise<string>
  t?: (key: string, params?: Record<string, unknown>) => string
  sessionId: string
  useSession?: (selector: (snapshot: unknown) => unknown) => unknown
  drafts: { sent(sessionId: string): SentAttachmentReceipt | undefined }
}

const normalize = (value: string): string => value.replaceAll('\u200b', '').trim()

/** Agent 读取附件的工具名集合:命中即视为「模型已处理文件」。 */
const READ_TOOLS = new Set(['read_attachment', 'attachment_info', 'list_archive'])

type ReadSignal = 'none' | 'reading' | 'read'

/**
 * 观察本回合对本次附件的真实读取信号:
 * - runningCalls 中命中 → 正在读取(reading);
 * - assistant-step 节点的 tool-call 块命中 → 已读取(read)。
 * 返回字符串保持 selector 引用稳定。
 */
function useAgentReadSignal(useSession: ((selector: (snapshot: unknown) => unknown) => unknown) | undefined, turn: number | undefined, fileIds: readonly string[]): ReadSignal {
  const signal = typeof useSession === 'function'
    ? useSession((snapshot) => {
      if (turn === undefined || fileIds.length === 0) return 'none'
      const ids = new Set(fileIds)
      const mentions = (raw: unknown): boolean => typeof raw === 'string' && [...ids].some(id => raw.includes(id))
      const snapshotAny = snapshot as { runningCalls?: readonly unknown[]; chat?: { nodes?: { values(): readonly unknown[] } } }
      for (const call of snapshotAny.runningCalls ?? []) {
        const candidate = call as { turn?: number; name?: string; argsRaw?: string }
        if (candidate.turn !== turn) continue
        if (READ_TOOLS.has(candidate.name ?? '') && mentions(candidate.argsRaw)) return 'reading'
      }
      const nodes = snapshotAny.chat?.nodes
      if (nodes !== undefined && typeof nodes.values === 'function') {
        for (const chatNode of nodes.values()) {
          const candidate = chatNode as { kind?: string; location?: { kind?: string; turn?: { turn?: number } }; data?: { blocks?: readonly unknown[] } }
          if (candidate.kind !== 'assistant-step') continue
          const locTurn = candidate.location?.kind === 'step' || candidate.location?.kind === 'turn'
            ? candidate.location?.turn?.turn
            : undefined
          if (locTurn !== turn) continue
          for (const block of candidate.data?.blocks ?? []) {
            const toolBlock = block as { kind?: string; name?: string; argsRaw?: string }
            if (toolBlock.kind === 'tool-call' && READ_TOOLS.has(toolBlock.name ?? '') && mentions(toolBlock.argsRaw)) return 'read'
          }
        }
      }
      return 'none'
    })
    : 'none'
  return signal as ReadSignal
}

function projectText(text: string): React.ReactNode[] {
  const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(re)) {
    const tokenStart = match.index + (match[1]?.length ?? 0)
    const label = match[2] ?? ''
    if (tokenStart > cursor) parts.push(<span key={`t${cursor}`}>{text.slice(cursor, tokenStart)}</span>)
    parts.push(<span key={`c${tokenStart}`} data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'} style={chipStyle}>{label}</span>)
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return [<span key="t0">{text}</span>]
  if (cursor < text.length) parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>)
  return parts
}

function MessageImageTile({ attachment, loadImage }: { attachment: unknown; loadImage: (attachment: unknown) => Promise<string> }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    loadImage(attachment).then(
      value => { if (live) setSrc(value) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [attachment, loadImage])

  if (failed) return <span style={{ ...tileStyle, fontSize: 11 }}>图片加载失败</span>
  if (src === null) return <span style={{ ...tileStyle, fontSize: 11 }}>…</span>
  return <a href={src} target="_blank" rel="noreferrer" style={{ display: 'block' }}><img src={src} alt="" style={tileStyle} /></a>
}

/**
 * 用户消息气泡 + 附件发送回执(官方惯例:回执贴在该消息气泡下方)。
 * 本组件接管 conversation.chat.node 的 user 渲染:复刻正文/引用高亮/图片/时间/复制,
 * 并按「发送文本匹配」把回执精确挂在携带附件的那条消息上。
 */
export function UserMessageWithReceipt(props: UserNodeOwnerProps): React.ReactElement {
  const content = props.node.data.content ?? []
  const texts: string[] = []
  const images: { attachment: unknown }[] = []
  const rest: UserContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
    else if (block.type === 'image' && block.attachment !== undefined) images.push({ attachment: block.attachment })
    else rest.push(block)
  }
  const text = texts.join('')

  const receipt = props.drafts.sent(props.sessionId)
  const receiptMatches = receipt !== undefined && normalize(receipt.draft) === normalize(text)
  const showBubble = text !== '' || rest.length > 0

  const turnNumber = props.node.location?.kind === 'turn' || props.node.location?.kind === 'step'
    ? props.node.location.turn?.turn
    : undefined
  const fileIds = receiptMatches ? receipt!.files.map(file => file.id) : []
  const readSignal = useAgentReadSignal(props.useSession, turnNumber, fileIds)
  const receiptLabel = readSignal === 'read' ? 'Agent 已读取' : readSignal === 'reading' ? 'Agent 正在读取…' : 'Agent 已收到'

  return <div style={rowStyle}>
    <div style={stackStyle}>
      {images.length > 0 && props.loadImage !== undefined && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
        {images.map((image, index) => <MessageImageTile key={`${String((image.attachment as { attachmentId?: string } | undefined)?.attachmentId ?? 'img')}:${index}`} attachment={image.attachment} loadImage={props.loadImage!} />)}
      </div>}
      {showBubble && <div style={bubbleStyle}>
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{projectText(text)}</span>
        {rest.map((block, index) => <span key={`rest-${index}`} style={{ display: 'block', fontSize: 12, opacity: .7 }}>〔附加数据〕</span>)}
      </div>}
      {receiptMatches && <div data-testid="user-bubble-receipt" data-read-signal={readSignal} style={receiptStyle}>
        <span aria-hidden="true" style={checkBadgeStyle}>✓</span>
        <span style={readSignal === 'read' ? { ...receiptLabelStyle, color: 'var(--dsw-alias-state-success-primary, #3b9b68)', fontWeight: 600 } : receiptLabelStyle}>{receiptLabel}</span>
        <span aria-hidden="true" style={receiptDotStyle}>·</span>
        <span style={receiptNamesStyle}>{receipt!.files.map(file => file.safeName).join('、')}</span>
      </div>}
    </div>
    <div style={actionsStyle}>
      {props.node.data.time !== undefined && <span style={{ fontSize: 12, opacity: .7 }}>{new Date(props.node.data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      <CopyButton text={text} />
    </div>
  </div>
}

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const onCopy = (): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    })
  }

  return <button type="button" onClick={onCopy} style={copyButtonStyle} aria-label="复制消息">{copied ? '已复制' : '复制'}</button>
}

const rowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, margin: '0 0 12px',
}

const stackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: '78%' }

const bubbleStyle: React.CSSProperties = {
  boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .2))',
  borderRadius: 16, borderBottomRightRadius: 4, padding: '10px 14px',
  fontSize: 14, lineHeight: 1.55, color: 'var(--dsw-alias-label-primary, inherit)',
}

const chipStyle: React.CSSProperties = {
  display: 'inline-block', margin: '0 2px', padding: '0 6px', borderRadius: 6,
  background: 'var(--dsw-alias-state-business-tertiary, rgba(72, 132, 255, .18))',
  color: 'var(--dsw-alias-state-business-primary, #5b8ff9)', fontSize: 13,
}

const receiptStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5,
  alignSelf: 'flex-end', maxWidth: '100%', marginTop: 2,
  padding: '3px 10px', borderRadius: 10,
  // 透明小气泡:极淡底 + 极细边线,无模糊,颜色随主题 token 走
  background: 'var(--dsw-specific-tip, rgba(127, 127, 127, .045))',
  border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .10))',
  fontSize: 11.5, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary, rgba(38, 48, 66, .75))',
}

const checkBadgeStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 12, height: 12, borderRadius: '50%', flex: '0 0 auto',
  background: 'var(--dsw-alias-state-success-primary, #3b9b68)', color: '#fff',
  fontSize: 8, lineHeight: 1, fontWeight: 700,
}

const receiptLabelStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-secondary, rgba(38, 48, 66, .75))', fontWeight: 500, whiteSpace: 'nowrap',
}

const receiptDotStyle: React.CSSProperties = { opacity: .55 }

const receiptNamesStyle: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
}

const actionsStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, opacity: .85,
}

const copyButtonStyle: React.CSSProperties = {
  border: 0, background: 'transparent', cursor: 'pointer', fontSize: 12, padding: '2px 4px',
  color: 'var(--dsw-alias-label-tertiary, rgba(127, 127, 127, .92))',
}

const tileStyle: React.CSSProperties = {
  display: 'block', width: 64, height: 64, objectFit: 'cover', borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .2))',
  background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .08))',
}
