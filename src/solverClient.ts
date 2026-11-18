import type { SolveResponse } from './engine/types'

const TIMEOUT_MS = 8000

type Pending = { resolve: (r: SolveResponse) => void; timer: ReturnType<typeof setTimeout> }

/**
 * Runs the solver in a Web Worker so the page never freezes. If a problem
 * takes too long the worker is terminated and replaced.
 */
export class SolverClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker/solver.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<{ id: number; response: SolveResponse }>) => {
        const p = this.pending.get(event.data.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(event.data.id)
        p.resolve(event.data.response)
      }
      this.worker.onerror = () => this.reset('The solver stopped unexpectedly. Please try again.')
    }
    return this.worker
  }

  private reset(error: string) {
    this.worker?.terminate()
    this.worker = null
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve({ ok: false, error, ms: 0 })
    }
    this.pending.clear()
  }

  solve(input: string): Promise<SolveResponse> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.reset('This problem took too long to solve. Try simplifying it or splitting it into parts.'), TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      worker.postMessage({ id, input })
    })
  }
}
