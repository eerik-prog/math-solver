import type { SolveResponse } from './engine/types'
import type { WorkerReply, WorkerRequest } from './worker/solver.worker'

const TIMEOUT_MS = 8000

type Pending = { settle: (reply: WorkerReply | null) => void; timer?: ReturnType<typeof setTimeout> }

/**
 * Runs the solver in a Web Worker so the page never freezes. If a problem
 * takes too long the worker is terminated and replaced.
 */
export class SolverClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private lastError = ''

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker/solver.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const p = this.pending.get(event.data.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(event.data.id)
        p.settle(event.data)
      }
      this.worker.onerror = () => this.reset('The solver stopped unexpectedly. Please try again.')
    }
    return this.worker
  }

  private reset(error: string) {
    this.worker?.terminate()
    this.worker = null
    this.lastError = error
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.settle(null)
    }
    this.pending.clear()
  }

  private send(type: WorkerRequest['type'], input: string, settle: Pending['settle'], timeoutMs?: number) {
    const worker = this.ensureWorker()
    const id = this.nextId++
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => this.reset('This problem took too long to solve. Try simplifying it or splitting it into parts.'),
            timeoutMs,
          )
    this.pending.set(id, { settle, timer })
    worker.postMessage({ id, type, input } satisfies WorkerRequest)
  }

  /** Starts the worker ahead of time, so the first problem doesn't wait for it to load. */
  warm() {
    this.ensureWorker()
  }

  solve(input: string): Promise<SolveResponse> {
    return new Promise((resolve) =>
      this.send(
        'solve',
        input,
        (reply) => resolve(reply?.response ?? { ok: false, error: this.lastError, ms: 0 }),
        TIMEOUT_MS,
      ),
    )
  }

  /** LaTeX for how the problem is read (parsed, not solved), or null if it can't be read yet. */
  readAs(input: string): Promise<string | null> {
    return new Promise((resolve) => this.send('readAs', input, (reply) => resolve(reply?.readAs ?? null)))
  }
}
