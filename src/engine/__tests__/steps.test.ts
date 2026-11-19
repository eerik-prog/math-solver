import katex from 'katex'
import { describe, expect, it } from 'vitest'
import type { Step } from '../types'
import { ok } from './helpers'

/** Every step, with its substeps, in order. */
function flat(steps: Step[]): Step[] {
  return steps.flatMap((s) => [s, ...flat(s.substeps ?? [])])
}

function titles(input: string): string[] {
  return flat(ok(input).steps).map((s) => s.title)
}

const PROBLEMS = [
  // arithmetic
  '2 + 3 * 4',
  '(3/4 + 5/6) * 12 - 2^3',
  '1/3 + 1/6',
  '2/3 * 9/4',
  '(1/2) / (3/4)',
  '0.1 + 0.2',
  '1.5 * 2.4',
  '20% of 80',
  '-3 * -4 + 10 / 2',
  '12 - 8 - 2',
  '2^3^2',
  'sqrt(72)',
  'gcd(84, 36)',
  'lcm(4, 6)',
  '5!',
  'mod(17, 5)',
  '|3 - 10|',
  // equations
  '2x + 3 = 11',
  '3(x - 2) = 2x + 5',
  'x/2 + x/3 = 10',
  'x^2 - 5x + 6 = 0',
  'x^2 - 6x + 9 = 0',
  '2x^2 + 3x - 2 = 0',
  'x^2 + x + 1 = 0',
  '-x^2 + 4 = 0',
  'x^2 = 16',
  'x^3 - 6x^2 + 11x - 6 = 0',
  'sqrt(x + 3) = x - 3',
  '2^(x+1) = 32',
  'sin(x) = 1/2',
  '|2x - 1| = 5',
  'log(x) = 2',
  '1/x + 1/(x+1) = 1',
  'x^4 - 5x^2 + 4 = 0',
  // inequalities and systems
  '3 - 2x > 7',
  'x^2 - x - 6 <= 0',
  '1 < 2x + 3 <= 9',
  'x + y = 10, x - y = 4',
  'x + y = 5 and xy = 6',
  'x + y + z = 6, x - y = 0, 2x + z = 5',
  // calculus
  'derivative of x^2 sin(x)',
  'd/dx ln(x^2 + 1)',
  'd/dx (x+1)/(x-1)',
  'd/dx 3x^4 - 2x + 7',
  'd/dx e^(2x)',
  'second derivative of x^4',
  'integrate x e^x dx',
  'integrate x^2 e^x dx',
  'integrate x ln(x) dx',
  'integrate 3x^2 + 2x + 1 dx',
  'integrate 1/(x^2 - 1) dx',
  'integrate 2x cos(x^2) dx',
  'integrate x^2 from 0 to 3',
  'integrate sin(x) from 0 to pi',
  'limit of sin(x)/x as x -> 0',
  'limit of (x^2 - 1)/(x - 1) as x -> 1',
  'limit of (3x^2 + 1)/(x^2 - 2) as x -> infinity',
  'limit of 1/x as x -> 0+',
  'limit of (x + 1) as x -> 2',
  // algebra
  'factor x^4 - 16',
  'factor x^2 - 5x + 6',
  'factor 360',
  'expand (2x - 3)^3',
  'expand (x + 1)(x - 2)',
  'simplify (x^2 - 9)/(x - 3)',
  'simplify 1/x + 1/(x+1)',
  'simplify 2x + 3x - x',
]

describe('every step', () => {
  it.each(PROBLEMS)('renders as valid math and reads as plain words: %s', (input) => {
    const s = ok(input)
    const render = (tex: string) => katex.renderToString(tex, { throwOnError: true, strict: 'error' })
    expect(() => render(s.problemTex)).not.toThrow()
    for (const a of s.answers) expect(() => render(a.tex), a.tex).not.toThrow()
    for (const step of flat(s.steps)) {
      if (step.tex) expect(() => render(step.tex!), step.tex).not.toThrow()
      // titles are read as text, so no code-style maths in them
      expect(step.title, step.title).not.toMatch(/\*|sqrt\(|\\[a-z]+|\^\d/)
      expect(step.title.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('arithmetic steps', () => {
  it('explains why each operation comes first', () => {
    expect(titles('2 + 3 * 4')).toEqual(['Multiply before you add: 3 × 4 = 12', 'Add: 2 + 12 = 14'])
    expect(titles('12 - 8 - 2')[0]).toMatch(/left to right/i)
    expect(titles('(3/4 + 5/6) * 12 - 2^3')[0]).toMatch(/^Brackets first/)
  })

  it('shows how fractions are added', () => {
    const all = titles('1/3 + 1/6').join('\n')
    expect(all).toMatch(/bottom numbers are different \(3 and 6\)/)
    expect(all).toMatch(/multiply the top and the bottom by 2/)
    expect(all).toMatch(/Now the bottoms match/)
  })

  it('explains signs and powers in words', () => {
    expect(titles('-3 * -4 + 10 / 2').join('\n')).toMatch(/a negative and a negative make a positive/)
    expect(titles('2^3^2').join('\n')).toMatch(/means .* × /)
  })

  it('keeps decimals as decimals and offers the fraction too', () => {
    const s = ok('0.1 + 0.2')
    expect(flat(s.steps).some((st) => st.tex?.includes('0.3'))).toBe(true)
    expect(titles('0.1 + 0.2').join('\n')).toMatch(/fraction/)
  })

  it('simplifies square roots by finding a square factor', () => {
    expect(titles('sqrt(72)')).toEqual([
      'Find the biggest square number that divides 72. Square numbers are 4, 9, 16, 25, 36, …',
      'Split the square root into two: √(a × b) = √a × √b',
      '√36 = 6, because 6 × 6 = 36',
    ])
  })
})

describe('equation steps', () => {
  it('checks the answer at the end', () => {
    expect(titles('2x + 3 = 11').at(-1)).toMatch(/^Check: put x = 4 back/)
  })

  it('factors a quadratic with the two-number method', () => {
    const all = titles('x^2 - 5x + 6 = 0').join('\n')
    expect(all).toMatch(/Find two numbers that multiply to make c = 6 and add up to b = −5/)
    expect(all).toMatch(/one of them must be 0/)
  })

  it('uses the formula when there is no easy factorisation', () => {
    const all = titles('2x^2 + 3x - 2 = 0').join('\n')
    expect(all).toMatch(/a, b and c/)
    expect(all).toMatch(/Δ|discriminant/i)
  })

  it('multiplies by −1 to make the leading number positive', () => {
    expect(titles('x + y = 5 and xy = 6').join('\n')).toMatch(/Multiply every term by −1/)
  })

  it('explains flipping the sign in an inequality', () => {
    expect(titles('3 - 2x > 7').join('\n')).toMatch(/flip/i)
  })
})

describe('calculus steps', () => {
  it('names each derivative rule in plain words', () => {
    expect(titles('derivative of x^2 sin(x)')[0]).toMatch(/two parts multiplied together/)
    expect(titles('d/dx ln(x^2 + 1)')[0]).toMatch(/function inside another function/)
    expect(titles('d/dx 3x^4 - 2x + 7').join('\n')).toMatch(/7 is a constant/)
  })

  it('checks an integral by differentiating it', () => {
    expect(titles('integrate 3x^2 + 2x + 1 dx').join('\n')).toMatch(/Check/)
  })

  it('works through a definite integral one limit at a time', () => {
    const s = ok('integrate x^2 from 0 to 3')
    const all = flat(s.steps)
    expect(all.map((st) => st.title)).toContain('Put the top limit, x = 3, into F')
    expect(all.find((st) => st.title.startsWith('Put the top limit'))?.tex).toBe('F(3) = \\frac{3^{3}}{3} = 9')
  })

  it('starts a limit by trying the value directly', () => {
    expect(titles('limit of (x^2 - 1)/(x - 1) as x -> 1')[0]).toMatch(/^Try putting x = 1 straight in/)
    expect(titles('limit of (x^2 - 1)/(x - 1) as x -> 1').join('\n')).toMatch(/Cancel/)
  })
})

describe('algebra steps', () => {
  it('factors and cancels, and says when that is allowed', () => {
    const s = ok('simplify (x^2 - 9)/(x - 3)')
    expect(s.steps.map((st) => st.title)).toEqual([
      'Factor the top: write it as things multiplied together',
      'The top and the bottom both have a factor of (x − 3). Cancel it, because anything divided by itself is 1. (This only works when x ≠ 3, so that we are not dividing by 0)',
    ])
    expect(s.steps[1].tex).toContain('\\cancel{')
  })

  it('adds algebraic fractions over a common bottom', () => {
    const all = titles('simplify 1/x + 1/(x+1)').join('\n')
    expect(all).toMatch(/same bottom/)
    expect(all).toMatch(/multiplying by 1/)
  })

  it('multiplies out brackets one product at a time', () => {
    const all = titles('expand (x + 1)(x - 2)').join('\n')
    expect(all).toMatch(/each term in the first bracket by each term in the second/)
  })

  it('lists the prime divisions', () => {
    expect(titles('factor 360').join('\n')).toMatch(/Multiply together all the primes/)
  })
})
