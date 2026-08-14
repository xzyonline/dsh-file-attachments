import { AttachmentError } from './errors.ts'
import { LIMITS } from './shared/contracts.ts'
import type { ParserRequest, ParserResponse } from './worker-protocol.ts'

export interface WorkerLike {
  on(event: string, listener: (...args: unknown[]) => void): this
  terminate(): Promise<number> | number
  postMessage?(message: unknown): void
}

export type WorkerFactory = (request: ParserRequest, options: { resourceLimits: Record<string, number> }) => WorkerLike

export async function runParserWorker(
  request: ParserRequest,
  options: { signal: AbortSignal; timeoutMs?: number; workerFactory?: WorkerFactory },
): Promise<ParserResponse> {
  const factory = options.workerFactory ?? (() => {
    throw new AttachmentError('UNSUPPORTED_FILE_TYPE', '当前运行环境未配置解析 Worker')
  })
  const worker = factory(request, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } })
  const timeoutMs = options.timeoutMs ?? LIMITS.parserTimeoutMs

  return new Promise<ParserResponse>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const settle = async (kind: 'resolve' | 'reject', value: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
      try { await worker.terminate() } catch { /* cleanup is best effort */ }
      if (kind === 'resolve') resolve(value as ParserResponse)
      else reject(value)
    }
    const abort = () => { void settle('reject', options.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')) }
    timer = setTimeout(() => { void settle('reject', new AttachmentError('PARSER_TIMEOUT', '解析超过时间限制')) }, timeoutMs)

    options.signal.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: unknown) => {
      let size = 0
      try { size = Buffer.byteLength(JSON.stringify(message)) } catch { size = LIMITS.readBytes + 1 }
      if (size > LIMITS.readBytes) {
        void settle('reject', new AttachmentError('PARSER_OUTPUT_LIMIT', '解析输出超过读取上限'))
      } else {
        void settle('resolve', message as ParserResponse)
      }
    })
    worker.on('error', error => void settle('reject', error))
    worker.on('exit', code => {
      if (code !== 0) void settle('reject', new AttachmentError('CORRUPT_FILE', `解析 Worker 异常退出 (${String(code)})`))
    })
    worker.postMessage?.(request)
  })
}
