import React from 'react'
import type { AttachmentMetadata } from '../shared/contracts.ts'

export function FileAttachmentDock(props: { files: AttachmentMetadata[]; onRemove: (id: string) => void }): React.ReactElement {
  return <div aria-label="文件附件" data-testid="file-attachment-dock">{props.files.map(file => <div key={file.id}>
    <span>{file.safeName}</span><span>{file.detected.kind}</span>{file.detected.mismatch && <span role="alert">TYPE_MISMATCH</span>}
    <button type="button" aria-label={`移除 ${file.safeName}`} onClick={() => props.onRemove(file.id)}>移除</button>
  </div>)}</div>
}
