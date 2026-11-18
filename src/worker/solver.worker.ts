/// <reference lib="webworker" />
import { solve } from '../engine'

export interface SolveRequest {
  id: number
  input: string
}

self.onmessage = (event: MessageEvent<SolveRequest>) => {
  const { id, input } = event.data
  const response = solve(input)
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, response })
}
