/**
 * 移除草稿文本中的指定附件回执标记。
 * 客户端草稿在发送前会把已选附件渲染成 `<dsh-file ref="..."/>` 标记行，
 * 用户点掉某个附件后需要把它连同可见的「附件：文件名」行一并从草稿里去掉。
 */
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
