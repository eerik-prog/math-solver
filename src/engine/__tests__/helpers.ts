import { expect } from 'vitest'
import { solve } from '..'
import type { Solution } from '../types'

export function ok(input: string): Solution {
  const r = solve(input)
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error}`)
  return r.solution
}

/** Plain-text answers, e.g. ["x = 2", "x = 3"]. */
export function answers(input: string): string[] {
  return ok(input).answers.map((a) => a.text)
}

export function expectError(input: string, pattern?: RegExp) {
  const r = solve(input)
  expect(r.ok, `"${input}" should fail`).toBe(false)
  if (!r.ok && pattern) expect(r.error).toMatch(pattern)
}
