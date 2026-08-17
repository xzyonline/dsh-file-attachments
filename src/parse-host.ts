import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { runParserWorker, type WorkerFactory, type WorkerLike } from './parser-worker.ts'
import { LIMITS, WORKER_RESOURCE_LIMITS } from './shared/contracts.ts'
import type { ParserRequest } from './worker-protocol.ts'

const require = createRequire(import.meta.url)

/** 生产环境 worker 入口(lib/parse-worker-entry.js,由 tsdown 与 lib/index.js 一同构建)。 */
function resolveWorkerEntry(): string | undefined {
  try {
    return require.resolve('./parse-worker-entry.js')
  } catch {
    return undefined
  }
}

function createThreadWorker(message: ParserRequest, options: { resourceLimits: Record<string, number> }): WorkerLike {
  const entry = resolveWorkerEntry()
  if (entry === undefined) throw new Error('parse-worker-entry.js 未构建,无法启动解析 Worker')
  const worker = new Worker(entry, {
    workerData: message,
    resourceLimits: WORKER_RESOURCE_LIMITS,
  })
  return worker as unknown as WorkerLike
}

let factoryOverride: WorkerFactory | undefined

/** 测试接缝:注入内联工厂后可完全绕过 worker_threads。 */
export function setParseWorkerFactory(factory: WorkerFactory | undefined): void {
  factoryOverride = factory
}

/**
 * 在独立 worker 线程内执行解析/列表/检测。
 * 主线程侧的超时与 terminate 对 worker 内的同步解析同样生效——这是
 * AbortSignal.timeout 无法打断 word-extractor/xlsx/unzipSync 的真正补救。
 */
export async function runParsedInWorker(message: ParserRequest, signal: AbortSignal, timeoutMs: number = LIMITS.parserTimeoutMs): Promise<unknown> {
  const response = await runParserWorker(message, { signal, timeoutMs, workerFactory: factoryOverride ?? createThreadWorker }) as { ok?: boolean; value?: unknown }
  if (response !== null && typeof response === 'object' && response.ok === true && 'value' in response) return response.value
  return response
}
