import type { AttachmentMetadata } from '../shared/contracts.ts'

export interface AttachmentApi {
  uploadFile(input: { sessionId: string; batchId: string; file: File; signal: AbortSignal }): Promise<AttachmentMetadata>
  deleteFile(sessionId: string, id: string): Promise<void>
}

export function createAttachmentApi(fetcher: typeof fetch = fetch): AttachmentApi {
  return {
    async uploadFile(input) {
      const response = await fetcher('/api/dsh-file-attachments/v1/files', { method: 'POST', headers: { 'content-type': input.file.type || 'application/octet-stream', 'x-dsh-session-id': input.sessionId, 'x-dsh-batch-id': input.batchId, 'x-dsh-file-name': encodeURIComponent(input.file.name) }, body: input.file, signal: input.signal })
      return decodeResponse<AttachmentMetadata>(response, 'metadata')
    },
    async deleteFile(sessionId, id) {
      const response = await fetcher(`/api/dsh-file-attachments/v1/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-dsh-session-id': sessionId } })
      await decodeResponse(response)
    },
  }
}

async function decodeResponse<T>(response: Response, key?: string): Promise<T> {
  const body = await response.json() as { ok?: boolean; [key: string]: unknown }
  if (!response.ok || body.ok === false) {
    const error = body.error as { code?: string; message?: string } | undefined
    throw new Error(`${error?.code ?? 'ATTACHMENT_FORBIDDEN'}: ${error?.message ?? '附件请求失败'}`)
  }
  return (key ? body[key] : body) as T
}
