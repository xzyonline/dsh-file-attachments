export interface ParserRequest {
  kind: string
  path: string
  [key: string]: unknown
}

export interface ParserResponse {
  [key: string]: unknown
}

export interface ReadAttachmentRequest {
  offset?: number
  page?: number
  pageEnd?: number
  paragraphOffset?: number
  paragraphLimit?: number
  sheet?: string
  range?: string
  archivePath?: string
}

export interface ReadAttachmentResult {
  kind: 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'archive-entry'
  text: string
  range: Record<string, string | number>
  hasMore: boolean
  next?: Record<string, string | number>
  redacted: number
  truncated: boolean
}
