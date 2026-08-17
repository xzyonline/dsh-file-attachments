import { listArchive } from './archive.ts'
import { detectFileFromPath } from './detect.ts'
import { AttachmentError } from './errors.ts'
import { readAttachment } from './read.ts'
import type { ParserRequest, ReadAttachmentRequest } from './worker-protocol.ts'

/**
 * [parse-core] worker 线程内的解析请求统一调度：与测试内联工厂共用同一实现，
 * 保证两条路径行为一致(协议不会漂移)。
 * 命名辨析：parse-core=worker 内调度；parse-host=主线程侧调用桥；
 * parser-worker=Worker 生命周期管理；parse-worker-entry=worker 线程入口。
 *
 * 解析请求的统一调度:worker 线程与测试内联工厂共用同一实现,
 * 保证两条路径行为一致(协议不会漂移)。
 */
export async function executeParseRequest(message: ParserRequest): Promise<unknown> {
  const signal = new AbortController().signal
  switch (message.op) {
    case 'read': {
      if (typeof message.path !== 'string' || message.path === '') throw new AttachmentError('CORRUPT_FILE', '缺少附件内容路径')
      const handle = {
        path: message.path,
        metadata: { detected: { family: String(message.detectedFamily ?? ''), kind: String(message.detectedKind ?? '') } },
      }
      return await readAttachment(handle, (message.request ?? {}) as ReadAttachmentRequest, signal)
    }
    case 'list': {
      if (typeof message.path !== 'string' || message.path === '') throw new AttachmentError('CORRUPT_FILE', '缺少附件内容路径')
      const request = (message.request ?? {}) as { cursor?: number; limit?: number; prefix?: string }
      return await listArchive(message.path, request, signal)
    }
    case 'detect': {
      if (typeof message.path !== 'string' || message.path === '') throw new AttachmentError('CORRUPT_FILE', '缺少待检测文件路径')
      return await detectFileFromPath({ name: String(message.name ?? ''), declaredMime: String(message.declaredMime ?? ''), path: message.path, signal })
    }
    default:
      throw new AttachmentError('UNSUPPORTED_FILE_TYPE', `未知解析操作：${String(message.op ?? message.kind ?? '?')}`)
  }
}
