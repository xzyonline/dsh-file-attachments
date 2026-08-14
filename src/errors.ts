import type { AttachmentErrorCode } from './shared/contracts.ts'

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: AttachmentErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'AttachmentError'
    this.code = code
    this.details = details
  }
}
