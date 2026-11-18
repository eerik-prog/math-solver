import { describe, expect, it } from 'vitest'
import { Rational, divisors, exactRoot, extractPower, primeFactors } from '../rational'

describe('Rational', () => {
  it('normalises sign and lowest terms', () => {
    expect(Rational.of(6, -8).toString()).toBe('-3/4')
    expect(Rational.of(0, 5).toString()).toBe('0')
  })

  it('does exact arithmetic', () => {
    const a = Rational.of(1, 3)
    const b = Rational.of(1, 6)
    expect(a.add(b).toString()).toBe('1/2')
    expect(a.sub(b).toString()).toBe('1/6')
    expect(a.mul(b).toString()).toBe('1/18')
    expect(a.div(b).toString()).toBe('2')
    expect(Rational.of(2, 3).pow(-2).toString()).toBe('9/4')
  })

  it('parses decimals exactly', () => {
    expect(Rational.parse('0.1').add(Rational.parse('0.2')).toString()).toBe('3/10')
    expect(Rational.parse('1.5e-3').toString()).toBe('3/2000')
    expect(Rational.parse('.25').toString()).toBe('1/4')
  })

  it('handles huge integers', () => {
    expect(Rational.of(2).pow(100).toString()).toBe('1267650600228229401496703205376')
  })

  it('throws on division by zero', () => {
    expect(() => Rational.ONE.div(Rational.ZERO)).toThrow(/Division by zero/)
  })

  it('finds rational approximations', () => {
    expect(Rational.approximate(0.75)?.toString()).toBe('3/4')
    expect(Rational.approximate(Math.PI)).toBeNull()
  })

  it('floors negative fractions correctly', () => {
    expect(Rational.of(-7, 2).floor()).toBe(-4n)
    expect(Rational.of(7, 2).floor()).toBe(3n)
  })
})

describe('integer helpers', () => {
  it('computes exact roots', () => {
    expect(exactRoot(27n, 3)).toBe(3n)
    expect(exactRoot(-8n, 3)).toBe(-2n)
    expect(exactRoot(10n, 2)).toBeNull()
  })

  it('extracts perfect powers', () => {
    expect(extractPower(72n, 2)).toEqual({ outside: 6n, inside: 2n })
  })

  it('factors integers', () => {
    expect(primeFactors(360n)).toEqual([
      [2n, 3],
      [3n, 2],
      [5n, 1],
    ])
    expect(divisors(12n)).toEqual([1n, 2n, 3n, 4n, 6n, 12n])
  })
})
