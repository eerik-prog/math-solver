import { describe, expect, it } from 'vitest'
import { solve } from '../engine'
import { readAs } from '../worker/readAs'

/** The solution shows systems as cases; the one-line preview separates them with commas. */
const oneLine = (tex: string) =>
  tex.replace(/^\\begin\{cases\} (.*) \\end\{cases\}$/, (_, body: string) => body.split(' \\\\ ').join(',\\quad '))

describe('readAs (the "We read this as" preview)', () => {
  // The preview must show the problem exactly as the solver's own heading does.
  const SAME_AS_SOLUTION = [
    'x^2 - 5x + 6 = 0',
    '2x + 3 = 11',
    '3(x - 2) = 2x + 5',
    '2(x+1)',
    'x sin x',
    'sin x^2',
    '1/2x',
    'x²−4',
    '3 - 2x > 7',
    '(x - 1)/(x + 2) >= 0',
    '1 < 2x + 3 <= 9',
    '|2x - 1| = 5',
    'x + y = 10, x - y = 4',
    'x + y = 5 and xy = 6',
    '0.1 + 0.2',
    '15% * 80',
    '(3/4 + 5/6) * 12 - 2^3',
    '3 - -2',
    '2^100',
    'sqrt(72)',
    'simplify (x^2 - 9)/(x - 3)',
    'expand (2x - 3)^3',
    'factor x^4 - 16',
    'factor 360',
    'solve x^2 - 4',
    'find x: x^2 = 9',
    'what is 2 + 2',
    'derivative of x^2 sin(x)',
    'second derivative of e^(2x)',
    'd/dx ln(x^2 + 1)',
    'differentiate sin(x^2)',
    'integrate x e^x dx',
    'integrate x^2 + 1 dx',
    'integrate x^2 from 0 to 3',
    'integrate e^(-x^2) from -infinity to infinity',
    'limit of sin(x)/x as x -> 0',
    'limit of 1/x as x -> 0+',
    'lim x->infinity (3x^2 + 1)/(2x^2 - 5)',
  ]
  it.each(SAME_AS_SOLUTION)('%s', (input) => {
    const res = solve(input)
    if (!res.ok) throw new Error(res.error)
    expect(readAs(input)).toBe(oneLine(res.solution.problemTex))
  })

  it('shows nothing for empty, unfinished or unreadable input', () => {
    for (const input of ['', '   ', '2x + (3', 'x = ', 'solve', 'integrate', 'limit of sin(x)/x as x', '2 +', '@'])
      expect(readAs(input)).toBeNull()
  })

  it('makes implied multiplication and function arguments visible', () => {
    expect(readAs('2(x+1)')).toBe('2 \\left(x + 1\\right)')
    expect(readAs('sin x^2')).toBe('\\sin(x^{2})')
    expect(readAs('sin^2 x')).toBe('\\sin^{2}(x)')
  })
})
