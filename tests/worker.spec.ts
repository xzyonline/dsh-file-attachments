import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { runParserWorker, type WorkerLike } from '../src/parser-worker.ts'

class WorkerTracker {
  live = 0
  factory = (): WorkerLike => {
    const worker = new EventEmitter() as WorkerLike & EventEmitter
    this.live++
    worker.terminate = async () => {
      this.live--
      return 0
    }
    return worker
  }
}

describe('runParserWorker', () => {
  it('terminates a timed-out parser and leaves no live worker', async () => {
    const tracker = new WorkerTracker()

    await expect(runParserWorker({ kind: 'test-hang', path: '/dev/null' }, {
      signal: new AbortController().signal,
      timeoutMs: 20,
      workerFactory: tracker.factory,
    })).rejects.toMatchObject({ code: 'PARSER_TIMEOUT' })
    expect(tracker.live).toBe(0)
  })

  it('terminates on caller cancellation', async () => {
    const controller = new AbortController()
    const tracker = new WorkerTracker()
    const promise = runParserWorker({ kind: 'test-hang', path: '/dev/null' }, {
      signal: controller.signal,
      workerFactory: tracker.factory,
    })
    controller.abort(new Error('cancelled'))

    await expect(promise).rejects.toThrow('cancelled')
    expect(tracker.live).toBe(0)
  })

  it('maps an oversized worker result to a stable output-limit error', async () => {
    const workerFactory = () => {
      const worker = new EventEmitter() as WorkerLike & EventEmitter
      worker.terminate = async () => 0
      queueMicrotask(() => worker.emit('message', { text: 'x'.repeat(300_000) }))
      return worker
    }

    await expect(runParserWorker({ kind: 'test-result', path: '/dev/null' }, {
      signal: new AbortController().signal,
      workerFactory,
    })).rejects.toMatchObject({ code: 'PARSER_OUTPUT_LIMIT' })
  })
})
