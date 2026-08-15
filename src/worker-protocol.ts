export interface ParserRequest {
  /** 解析操作:读附件 / 列归档 / 检测文件类型。旧协议用 kind,保留兼容。 */
  op?: 'read' | 'list' | 'detect'
  kind?: string
  path: string
  name?: string
  declaredMime?: string
  detectedFamily?: string
  detectedKind?: string
  request?: Record<string, unknown>
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
  kind: 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'doc' | 'xls' | 'rtf' | 'odt' | 'ods' | 'odp' | 'epub' | 'archive-entry'
  text: string
  range: Record<string, string | number>
  hasMore: boolean
  next?: Record<string, string | number>
  redacted: number
  truncated: boolean
}
