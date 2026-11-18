import { describe, expect, it } from 'vitest'
import { differentiate } from '../diff'
import { antiderivative } from '../integrate'
import { evalNum } from '../numeric'
import { parseExpression } from '../parser'
import { toText } from '../print'
import { simplest } from '../simplify'
import { answers, expectError, ok } from './helpers'

const d = (e: string) => toText(simplest(differentiate(parseExpression(e), 'x')))

/** Central finite difference to check derivatives independently. */
function numericDerivative(e: string, at: number): number {
  const f = parseExpression(e)
  const h = 1e-5
  return (evalNum(f, { x: at + h }) - evalNum(f, { x: at - h })) / (2 * h)
}

const DERIVATIVE_CASES = [
  'x^2 sin(x)',
  'sin(x)/x',
  'e^(2x)',
  'ln(x^2 + 1)',
  'sqrt(x)',
  '(x+1)/(x-1)',
  'x^x',
  'tan(3x)',
  'atan(x)',
  'asin(x/2)',
  'cos(x)^3',
  'log(x)',
  '2^x',
  'sec(x)',
  'x e^(-x^2)',
  'ln(sin(x))',
  'sqrt(1 - x^2)',
  '|x|',
  'cosh(2x)',
  'log_2(x^2)',
]

describe('derivatives', () => {
  it('produces textbook results', () => {
    expect(d('x^2 sin(x)')).toBe('x^2*cos(x) + 2x*sin(x)')
    expect(d('3x^4 - 2x + 7')).toBe('12x^3 - 2')
    expect(d('e^(2x)')).toBe('2e^(2x)')
    expect(d('ln(x^2+1)')).toBe('2x/(x^2 + 1)')
    expect(d('1/x')).toBe('-1/x^2')
    expect(d('(x+1)/(x-1)')).toBe('-2/(x - 1)^2')
  })

  it.each(DERIVATIVE_CASES)('matches a finite-difference check: %s', (e) => {
    const deriv = differentiate(parseExpression(e), 'x')
    for (const at of [0.3, 0.7, 1.4]) {
      const expected = numericDerivative(e, at)
      if (!Number.isFinite(expected)) continue
      expect(evalNum(deriv, { x: at })).toBeCloseTo(expected, 4)
    }
  })

  it('explains the rules used', () => {
    const s = ok('derivative of x^2 sin(x)')
    expect(s.steps[0].title).toMatch(/Product rule/)
    expect(ok('d/dx sin(x^2)').steps[0].title).toMatch(/Chain rule/)
    expect(ok('d/dx x/(x+1)').steps[0].title).toMatch(/Quotient rule/)
  })

  it('supports higher derivatives, other variables and notations', () => {
    expect(answers('second derivative of x^4')).toEqual(['12x^2'])
    expect(answers('d^2/dx^2 sin(x)')).toEqual(['-sin(x)'])
    expect(answers('differentiate t^3 with respect to t')).toEqual(['3t^2'])
    expect(answers('d/dx (a x^2)')).toEqual(['2a*x'])
  })
})

const INTEGRAL_CASES: Array<[string, string]> = [
  ['x^2', 'x^3/3'],
  ['3x^2 + 2x + 1', 'x^3 + x^2 + x'],
  ['cos(3x)', 'sin(3x)/3'],
  ['1/x', 'ln(|x|)'],
  ['1/(x^2+1)', 'atan(x)'],
  ['x e^x', 'x*e^x - e^x'],
  ['x^2 sin(x)', '-x^2*cos(x) + 2x*sin(x) + 2*cos(x)'],
  ['ln(x)', 'x*ln(x) - x'],
  ['2x cos(x^2)', 'sin(x^2)'],
  ['x/(x^2+1)', 'ln(x^2 + 1)/2'],
  ['1/(x^2-1)', '(ln(|x - 1|) - ln(|x + 1|))/2'],
  ['(2x+3)^5', '(2x + 3)^6/12'],
  ['sin(x)^2', 'x/2 - sin(2x)/4'],
  ['e^x sin(x)', '(e^x*(sin(x) - cos(x)))/2'],
  ['1/sqrt(1-x^2)', 'asin(x)'],
  ['x sqrt(x^2+1)', '(x^2 + 1)^(3/2)/3'],
  ['1/(x^2+2x+5)', 'atan((x + 1)/2)/2'],
  ['atan(x)', 'x*atan(x) - ln(x^2 + 1)/2'],
  ['2^x', '2^x/ln(2)'],
]

describe('integrals', () => {
  it.each(INTEGRAL_CASES)('∫ %s dx', (f, F) => {
    const r = antiderivative(parseExpression(f), 'x')
    expect(r).not.toBeNull()
    expect(toText(r!.F)).toBe(F)
  })

  it('verifies every antiderivative by differentiating it', () => {
    for (const f of [
      'tan(x)',
      'sec(x)^2',
      'x^3/(x^2+1)',
      'ln(x)/x',
      'e^x/(1+e^x)',
      'x^2 e^(x^3)',
      '1/(x(x+1)^2)',
      '(x+1)/sqrt(x)',
      'x ln(x)',
      'sin(x) cos(x)',
    ]) {
      const r = antiderivative(parseExpression(f), 'x')
      expect(r, f).not.toBeNull()
      const back = differentiate(r!.F, 'x')
      for (const at of [0.4, 1.3, 2.2]) {
        expect(evalNum(back, { x: at })).toBeCloseTo(evalNum(parseExpression(f), { x: at }), 8)
      }
    }
  })

  it('adds the constant of integration', () => {
    expect(answers('integrate 1/x dx')).toEqual(['ln(|x|) + C'])
    expect(answers('∫ x e^x dx')).toEqual(['x*e^x - e^x + C'])
  })

  it('evaluates definite integrals exactly', () => {
    expect(answers('integrate x^2 from 0 to 1')).toEqual(['1/3'])
    expect(answers('integral of sin(x) from 0 to pi')).toEqual(['2'])
    expect(answers('∫_0^1 e^x dx')).toEqual(['e - 1'])
    expect(answers('integrate 1/x from 1 to e')).toEqual(['1'])
  })

  it('falls back to numerical integration and recognises constants', () => {
    expect(answers('integrate e^(-x^2) from -infinity to infinity')).toEqual(['sqrt(pi)'])
    const [v] = answers('integrate sin(x)/x from 0 to 1')
    expect(Number(v)).toBeCloseTo(0.9460830704, 8)
    expect(answers('integrate 1/(1+x^2) from 0 to infinity')).toEqual(['pi/2'])
  })

  it('explains when no elementary antiderivative exists', () => {
    expectError('integrate e^(x^2) dx', /elementary/)
  })
})

describe('limits', () => {
  it('evaluates classic limits', () => {
    expect(answers('limit of sin(x)/x as x -> 0')).toEqual(['1'])
    expect(answers('limit of (x^2-1)/(x-1) as x->1')).toEqual(['2'])
    expect(answers('lim x->infinity (3x^2+1)/(2x^2-5)')).toEqual(['3/2'])
    expect(answers('limit of (1 - cos(x))/x^2 as x -> 0')).toEqual(['1/2'])
    expect(answers('limit of (1 + 1/x)^x as x -> infinity')).toEqual(['e'])
    expect(answers('limit of x^2 + 3 as x -> 2')).toEqual(['7'])
  })

  it('handles one-sided and non-existent limits', () => {
    expect(answers('limit of 1/x as x -> 0')).toEqual(['does not exist'])
    expect(answers('limit of 1/x as x -> 0+')).toEqual(['∞'])
    expect(answers('limit of 1/x as x -> 0-')).toEqual(['-∞'])
    expect(answers('lim x->0+ x ln(x)')).toEqual(['0'])
  })

  it("uses L'Hôpital's rule when it applies", () => {
    const s = ok('limit of (e^x - 1)/x as x -> 0')
    expect(s.answers[0].text).toBe('1')
    expect(s.steps.some((st) => /L'Hôpital/.test(st.title))).toBe(true)
  })
})
