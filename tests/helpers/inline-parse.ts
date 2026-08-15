import { executeParseRequest } from '../../src/parse-core.ts'
import { setParseWorkerFactory } from '../../src/parse-host.ts'
import type { WorkerFactory, WorkerLike } from '../../src/parser-worker.ts'

/**
 * 测试内联工厂:与真实 worker 入口共用 executeParseRequest 调度逻辑,
 * 但主线程执行,不依赖 worker_threads 与构建产物。
 */
export function installInlineParseFactory(): () => void {
  const factory: WorkerFactory = (request) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const emit = (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
    const worker: WorkerLike = {
      on(event: string, listener: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(listener)
        return worker
      },
      terminate() {
        return Promise.resolve(0)
      },
      postMessage() {
        void executeParseRequest(request).then(
          value => emit('message', { ok: true, value }),
          error => emit('message', {
            ok: false,
            code: (error as { code?: string } | null | undefined)?.code ?? 'CORRUPT_FILE',
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      },
    }
    return worker
  }
  setParseWorkerFactory(factory)
  return () => setParseWorkerFactory(undefined)
}
