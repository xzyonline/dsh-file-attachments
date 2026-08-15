import { parentPort, workerData } from 'node:worker_threads'
import { AttachmentError } from './errors.ts'
import { executeParseRequest } from './parse-core.ts'
import type { ParserRequest } from './worker-protocol.ts'

if (parentPort === null) throw new Error('parse worker 入口只能在 worker 线程内运行')

executeParseRequest(workerData as ParserRequest).then(
  value => { parentPort!.postMessage({ ok: true, value }) },
  error => {
    const owned = error instanceof AttachmentError
      ? { ok: false, code: error.code, message: error.message }
      : { ok: false, code: 'CORRUPT_FILE', message: `附件解析失败（${(error as { name?: string } | null | undefined)?.name ?? 'InternalError'}）` }
    parentPort!.postMessage(owned)
  },
)
