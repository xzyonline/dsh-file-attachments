import type { AttachmentId } from './contracts.ts'

const ID = 'att_[A-Za-z0-9_-]{6,80}'
const MARKER = new RegExp(`<dsh-file ref="(${ID})"\\/>`, 'g')

export function encodeAttachmentMarker(id: string): string {
  if (!new RegExp(`^${ID}$`).test(id)) throw new Error('invalid attachment id')
  return `<dsh-file ref="${id}"/>`
}

export function encodeAttachmentDraft(safeName: string, _id?: string): string {
  const name = safeName.replace(/[\r\n]+/g, ' ').trim() || '未命名文件'
  return `附件：${name}`
}

export function parseAttachmentMarkers(text: string): AttachmentId[] {
  return [...text.matchAll(MARKER)].map(match => match[1] as AttachmentId)
}

export function removeAttachmentMarker(text: string, id: string, safeName?: string): string {
  const marker = `<dsh-file ref="${id}"/>`
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const draftBlock = new RegExp(`(?:^|\\n)附件：[^\\n]*\\n<!--\\s*${escapedMarker}\\s*-->`, 'g')
  const visibleLine = safeName ? new RegExp(`(?:^|\\n)${`附件：${safeName.replace(/[\r\n]+/g, ' ').trim() || '未命名文件'}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\n|$)`) : null
  return text.replace(draftBlock, '')
    .replace(visibleLine ?? /$^/, '')
    .replaceAll(`\n${marker}`, '')
    .replaceAll(marker, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
