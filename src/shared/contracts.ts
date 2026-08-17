export const LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  archiveBytes: 100 * 1024 * 1024,
  decompressedBytes: 256 * 1024 * 1024,
  messageFiles: 10,
  messageBytes: 50 * 1024 * 1024,
  readBytes: 256 * 1024,
  readLines: 2_000,
  archiveEntries: 10_000,
  parserTimeoutMs: 15_000,
  archiveTimeoutMs: 10_000,
} as const

export type AttachmentId = `att_${string}`

/**
 * 附件 ID 的唯一权威格式：`att_` + 32 位小写十六进制（UUID v4 去掉连字符）。
 * store 校验、HTTP 路由、历史文本扫描统一从此派生，禁止各写各的正则。
 */
export const ID_PATTERN = 'att_[a-f0-9]{32}'

/**
 * Worker 线程 V8 内存上限（唯一权威来源）。parse-host 建 Worker 与
 * parser-worker 传给工厂的参数必须同源，禁止两侧各写一份导致漂移。
 */
export const WORKER_RESOURCE_LIMITS: Record<string, number> = {
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 64,
}
export type AttachmentErrorCode =
  | 'FILE_TOO_LARGE' | 'MESSAGE_FILES_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE'
  | 'TYPE_MISMATCH' | 'CORRUPT_FILE' | 'ENCRYPTED_FILE'
  | 'ARCHIVE_PATH_REJECTED' | 'ATTACHMENT_FORBIDDEN'
  | 'PARSER_TIMEOUT' | 'PARSER_OUTPUT_LIMIT'

export interface DetectedFileType {
  family: 'text' | 'document' | 'archive' | 'image' | 'binary' | 'unknown'
  kind: string
  mime: string
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030'
  confidence: 'high' | 'medium' | 'low'
  readable: boolean
  mismatch: boolean
  risks: readonly string[]
}

export interface AttachmentMetadata {
  id: AttachmentId
  ownerSessionId: string
  batchId: string
  safeName: string
  declaredMime: string
  detected: DetectedFileType
  bytes: number
  sha256: string
  createdAt: number
  /** 服务端 blob 的真实落盘路径(悬停提示用);旧 ref 可能缺失。 */
  storagePath?: string
}
