import React from 'react'

export function FileAttachButton(props: { onFiles: (files: File[]) => unknown; disabled?: boolean }): React.ReactElement {
  return <>
    <button type="button" aria-label="添加文件" disabled={props.disabled} onClick={event => (event.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.click()}>添加文件</button>
    <input hidden type="file" multiple onChange={event => props.onFiles([...event.currentTarget.files ?? []].filter(file => !file.type.startsWith('image/')))} />
  </>
}
