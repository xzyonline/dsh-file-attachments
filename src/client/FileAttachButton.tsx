import React, { useEffect } from 'react'

// Lucide paperclip（ISC 许可，24 网格细线描边）——与 DeepSeek 网页版同款线稿风格。
const PAPERCLIP_PATH = 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'

// 壳 UI 兼容（2026-08-16 定版）：纯回形针图标、浅灰、无独立底色（融入输入框），
// hover 仅浅灰微底——对齐 chat.deepseek.com 网页版附件按钮形态。
const ATTACH_STYLE_CSS = '.dsh-fa-attach:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14))}.dsh-fa-attach:active{transform:scale(0.96)}.dsh-fa-attach:disabled{opacity:0.5;cursor:default}'

const attachButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  width: '28px',
  height: '28px',
  padding: '4px',
  borderRadius: '8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
  cursor: 'pointer',
  boxSizing: 'border-box',
  transition: 'background-color 0.12s ease',
}

/**
 * 样式注入独立子组件：useEffect 内注册、卸载时移除（Cordis/React 可逆性），
 * 不污染 FileAttachButton 自身函数体（其保持无 hook，便于被直接构造元素树）。
 */
function AttachStyle(): null {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('dsh-fa-attach-style') !== null) return
    const tag = document.createElement('style')
    tag.id = 'dsh-fa-attach-style'
    tag.textContent = ATTACH_STYLE_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, [])
  return null
}

export function FileAttachButton(props: { onFiles: (files: File[]) => unknown; disabled?: boolean }): React.ReactElement {
  return <>
    <button type="button" className="dsh-fa-attach" aria-label="添加文件" title="添加文件" disabled={props.disabled} style={attachButtonStyle} onClick={event => (event.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.click()}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={PAPERCLIP_PATH} />
      </svg>
    </button>
    <input hidden type="file" multiple onChange={event => props.onFiles([...event.currentTarget.files ?? []].filter(file => !file.type.startsWith('image/')))} />
    <AttachStyle />
  </>
}
