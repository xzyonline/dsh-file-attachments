import type { AttachmentId } from './contracts.ts'

const ID = 'att_[A-Za-z0-9_-]{6,80}'
const MARKER = new RegExp(`<dsh-file ref="(${ID})"\\/>`, 'g')

export function encodeAttachmentMarker(id: string): string {
  if (!new RegExp(`^${ID}$`).test(id)) throw new Error('invalid attachment id')
  return `<dsh-file ref="${id}"/>`
}

export function parseAttachmentMarkers(text: string): AttachmentId[] {
  return [...text.matchAll(MARKER)].map(match => match[1] as AttachmentId)
}

export function removeAttachmentMarker(text: string, id: string): string {
  const marker = `<dsh-file ref="${id}"/>`
  return text
    .replaceAll(`\n${marker}`, '')
    .replaceAll(marker, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
