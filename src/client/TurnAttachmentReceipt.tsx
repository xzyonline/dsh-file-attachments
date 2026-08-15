import React from 'react'
import type { SentAttachmentReceipt } from './store.ts'

/** 回合尾的沉静回执:低调单行,不再在输入框上方挂横幅。 */
export function TurnAttachmentReceipt(props: { receipt: SentAttachmentReceipt }): React.ReactElement {
  return <div data-testid="turn-attachment-receipt" role="status" aria-label="已发送给 Agent" style={receiptStyle}>
    <span aria-hidden="true" style={checkStyle}>✓</span>
    <span style={statusStyle}>已发送给 Agent</span>
    <span aria-hidden="true" style={dotStyle}>·</span>
    <span style={namesStyle}>{props.receipt.files.map(file => file.safeName).join('、')}</span>
  </div>
}

const receiptStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6,
  margin: '8px 0 0', fontSize: 12, lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary, rgba(127, 127, 127, .92))',
}

const checkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 15, height: 15, borderRadius: '50%', flex: '0 0 auto', fontSize: 10, lineHeight: 1,
  background: 'var(--dsw-alias-state-success-primary, #3b9b68)', color: '#fff',
}

const statusStyle: React.CSSProperties = { whiteSpace: 'nowrap' }
const dotStyle: React.CSSProperties = { opacity: .6 }
const namesStyle: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }
