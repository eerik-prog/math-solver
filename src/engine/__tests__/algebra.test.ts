import { describe, expect, it } from 'vitest'
import { answers, expectError, ok } from './helpers'

describe('arithmetic', () => {
  it('follows the order of operations step by step', () => {
    const s = ok('2 + 3 * 4')
    expect(s.answers[0].text).toBe('14')
    expect(s.steps.map((st) => st.title)).toEqual(['Multiply before you add: 3 × 4 = 12', 'Add: 2 + 12 = 14'])
  })

  it('keeps fractions exact and gives decimals', () => {
    const s = ok('1/3 + 1/6')
    expect(s.answers[0].text).toBe('1/2')
    expect(s.answers[0].approx).toBe('0.5')
    expect(answers('(3/4 + 5/6) * 12 - 2^3')).toEqual(['11'])
    expect(answers('0.1 + 0.2')).toEqual(['3/10'])
  })

  it('handles big numbers and special functions', () => {
    expect(answers('2^100')).toEqual(['1267650600228229401496703205376'])
    expect(answers('20!')).toEqual(['2432902008176640000'])
    expect(answers('gcd(84, 36)')).toEqual(['12'])
    expect(answers('lcm(4, 6)')).toEqual(['12'])
    expect(answers('mod(17, 5)')).toEqual(['2'])
    expect(answers('15% * 80')).toEqual(['12'])
  })

  it('simplifies irrational values exactly', () => {
    expect(answers('sqrt(72)')).toEqual(['6sqrt(2)'])
    expect(answers('sin(pi/3)')).toEqual(['sqrt(3)/2'])
    expect(ok('pi').answers[0].approx).toBe('3.14159265359')
  })

  it('reports division by zero', () => {
    expectError('1/0', /zero/)
    expectError('5 / (2 - 2)', /zero/)
  })

  it('understands natural-language prefixes', () => {
    expect(answers('what is 7 * 6')).toEqual(['42'])
    expect(answers('calculate 2^10')).toEqual(['1024'])
  })
})

describe('simplify, expand and factor', () => {
  it('cancels common factors and notes restrictions', () => {
    const s = ok('simplify (x^2 - 9)/(x - 3)')
    expect(s.answers[0].text).toBe('x + 3')
    expect(s.notes.join(' ')).toMatch(/x ≠ 3/)
  })

  it('expands', () => {
    expect(answers('expand (2x - 3)^3')).toEqual(['8x^3 - 36x^2 + 54x - 27'])
    expect(answers('expand (x + 1)(x - 1)(x + 2)')).toEqual(['x^3 + 2x^2 - x - 2'])
  })

  it('factors polynomials over the rationals', () => {
    expect(answers('factor x^2 - 5x + 6')).toEqual(['(x - 2)(x - 3)'])
    expect(answers('factor x^4 - 16')).toEqual(['(x + 2)(x - 2)(x^2 + 4)'])
    expect(answers('factor 2x^2 + 7x + 3')).toEqual(['(x + 3)(2x + 1)'])
    expect(answers('factor x^3 - 3x^2 + 3x - 1')).toEqual(['(x - 1)^3'])
    expect(answers('factor x^4 + 3x^2 + 2')).toEqual(['(x^2 + 1)(x^2 + 2)'])
    expect(answers('factor x^2 + 1')).toEqual(['x^2 + 1'])
    expect(answers('factor 4x^2 - 8x')).toEqual(['4x(x - 2)'])
  })

  it('factors integers and multivariate expressions', () => {
    expect(answers('factor 360')).toEqual(['2^3 · 3^2 · 5'])
    expect(ok('factor 97').notes).toContain('97 is a prime number.')
    expect(answers('factor 6x^2y + 9xy^2')).toEqual(['3x*y(2x + 3y)'])
  })

  it('simplifies expressions with several variables', () => {
    expect(answers('simplify 2a + 3b - a + b')).toEqual(['a + 4b'])
    expect(answers('x^2 + 2x + 1')).toEqual(['x^2 + 2x + 1'])
    expect(ok('x^2 + 2x + 1').notes).toContain('Factored form: (x + 1)^2')
  })
})

describe('input handling', () => {
  it('rejects empty and malformed input with a helpful message', () => {
    expectError('', /Type a math problem/)
    expectError('2x + ', /ends too early|Missing/)
    expectError('solve (x + 1 = 2', /parenthes/)
  })

  it('asks for a problem after a bare command and rejects unknown words', () => {
    expectError('solve', /Add a problem after "solve"/)
    expectError('integrate', /Add a problem/)
    expectError('derivative of', /Add a problem/)
    expectError('hello', /don't know the word "hello"/)
  })

  it('returns an error rather than a wrong answer for odd input', () => {
    for (const s of [
      '=',
      '===',
      '()',
      '|',
      'sin',
      'x^^2',
      'lim',
      'integrate',
      '1/',
      '2(',
      'x = ',
      'derivative of',
      '∫',
      'solve',
      'factor',
      'x < < 2',
      '%',
      '!',
    ]) {
      expect(() => answers(s)).toThrow()
    }
  })
})
