import { describe, expect, it } from 'vitest'
import { solve } from '..'
import { differentiate } from '../diff'
import { key } from '../expr'
import { antiderivative } from '../integrate'
import { evalNum } from '../numeric'
import { parseExpression } from '../parser'
import { toText } from '../print'
import { simplify } from '../simplify'

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const rand = rng(12345)
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

function randomExpr(depth: number): string {
  if (depth === 0 || rand() < 0.25) {
    const r = rand()
    return r < 0.5 ? 'x' : String(int(1, 9))
  }
  const a = randomExpr(depth - 1)
  const b = randomExpr(depth - 1)
  switch (int(0, 8)) {
    case 0:
      return `(${a}) + (${b})`
    case 1:
      return `(${a}) - (${b})`
    case 2:
      return `(${a}) * (${b})`
    case 3:
      return `(${a}) / (${b} + 10)`
    case 4:
      return `(${a})^${int(2, 3)}`
    case 5:
      return `sin(${a})`
    case 6:
      return `e^(${a} / 10)`
    case 7:
      return `ln((${a})^2 + 1)`
    default:
      return `sqrt((${a})^2 + 1)`
  }
}

describe('property checks', () => {
  it('finds every root of random polynomials with integer roots', () => {
    for (let i = 0; i < 60; i++) {
      const deg = int(1, 4)
      const roots = Array.from({ length: deg }, () => int(-9, 9))
      const lead = int(1, 3) * (rand() < 0.5 ? -1 : 1)
      const poly = `${lead}${roots.map((r) => `(x - (${r}))`).join('')} = 0`
      const res = solve(poly)
      expect(res.ok, poly).toBe(true)
      if (!res.ok) continue
      const got = res.solution.answers.filter((a) => !a.complex).map((a) => Number(a.text.replace('x = ', '')))
      expect(got, poly).toEqual([...new Set(roots)].sort((a, b) => a - b))
    }
  })

  it('solves random linear equations correctly', () => {
    for (let i = 0; i < 60; i++) {
      const [a, b, c, d] = [int(-9, 9), int(-20, 20), int(-9, 9), int(-20, 20)]
      if (a === c) continue
      const eq = `${a}x + (${b}) = ${c}x + (${d})`
      const res = solve(eq)
      expect(res.ok, eq).toBe(true)
      if (!res.ok) continue
      const x = (d - b) / (a - c)
      const [num, den] = res.solution.answers[0].text.replace('x = ', '').split('/').map(Number)
      expect(num / (den ?? 1), eq).toBeCloseTo(x, 12)
    }
  })

  it('differentiates random expressions correctly (checked by finite differences)', () => {
    for (let i = 0; i < 80; i++) {
      const src = randomExpr(3)
      const e = parseExpression(src)
      const d = differentiate(e, 'x')
      for (const at of [0.37, 1.21]) {
        const h = 1e-6
        const fd = (evalNum(e, { x: at + h }) - evalNum(e, { x: at - h })) / (2 * h)
        const v = evalNum(d, { x: at })
        if (!Number.isFinite(fd) || Math.abs(fd) > 1e6) continue
        expect(Math.abs(v - fd), `${src} at ${at}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(fd)))
      }
    }
  })

  it('only returns antiderivatives that differentiate back to the integrand', () => {
    let found = 0
    for (let i = 0; i < 80; i++) {
      const src = randomExpr(2)
      const e = parseExpression(src)
      const r = antiderivative(e, 'x')
      if (!r) continue
      found++
      const back = differentiate(r.F, 'x')
      for (const at of [0.5, 1.7]) {
        const want = evalNum(e, { x: at })
        if (!Number.isFinite(want)) continue
        expect(evalNum(back, { x: at }), src).toBeCloseTo(want, 6)
      }
    }
    expect(found).toBeGreaterThan(20)
  })

  it('prints expressions that parse back to the same thing', () => {
    for (let i = 0; i < 80; i++) {
      const e = simplify(parseExpression(randomExpr(3)))
      const again = simplify(parseExpression(toText(e)))
      expect(key(again), toText(e)).toBe(key(e))
    }
  })

  it('agrees with the numeric value after simplifying', () => {
    for (let i = 0; i < 80; i++) {
      const src = randomExpr(3)
      const e = parseExpression(src)
      const s = simplify(e)
      for (const at of [0.3, 2.2, -1.4]) {
        const a = evalNum(e, { x: at })
        const b = evalNum(s, { x: at })
        if (!Number.isFinite(a)) continue
        expect(b, src).toBeCloseTo(a, 6)
      }
    }
  })
})
