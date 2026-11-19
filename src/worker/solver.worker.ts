/// <reference lib="webworker" />
import { solve } from '../engine'
import type { SolveResponse } from '../engine/types'
import { readAs } from './readAs'

export type WorkerRequest = { id: number; type: 'solve' | 'readAs'; input: string }
export type WorkerReply = { id: number; response?: SolveResponse; readAs?: string | null }

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, input } = event.data
  const reply: WorkerReply = type === 'readAs' ? { id, readAs: readAs(input) } : { id, response: solve(input) }
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(reply)
}
