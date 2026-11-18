import { describe, expect, it } from 'vitest'
import { parseExpression, splitRelation } from '../parser'
import { toText } from '../print'
import { simplify } from '../simplify'

const p = (s: string) => toText(simplify(parseExpression(s)))

describe('parser', () => {
  it('understands implicit multiplication', () => {
    expect(p('2x')).toBe('2x')
    expect(p('2(x+1)')).toBe('2x + 2')
    expect(p('(x+1)(x-1)')).toBe('(x - 1)*(x + 1)')
    expect(p('xy')).toBe('x*y')
  })

  it('respects precedence and associativity', () => {
    expect(p('2 + 3 * 4')).toBe('14')
    expect(p('2^3^2')).toBe('512')
    expect(p('-2^2')).toBe('-4')
    expect(p('8 / 2 / 2')).toBe('2')
  })

  it('parses functions with and without parentheses', () => {
    expect(p('sin x')).toBe('sin(x)')
    expect(p('sin 2x')).toBe('sin(2x)')
    expect(p('sin^2 x')).toBe('sin(x)^2')
    expect(p('sin^-1(x)')).toBe('asin(x)')
    expect(p('log_2(8)')).toBe('3')
    expect(p('ln(e)')).toBe('1')
    expect(p('log(1000)')).toBe('3')
  })

  it('accepts unicode and alternative notation', () => {
    expect(p('√16')).toBe('4')
    expect(p('x²')).toBe('x^2')
    expect(p('3×4÷6')).toBe('2')
    expect(p('π')).toBe('pi')
    expect(p('|−3|')).toBe('3')
    expect(p('5!')).toBe('120')
    expect(p('sin(30°)')).toBe('1/2')
    expect(p('50%')).toBe('1/2')
  })

  it('reports helpful errors', () => {
    expect(() => parseExpression('(x+1')).toThrow(/closing parenthesis/)
    expect(() => parseExpression('x+1)')).toThrow(/Too many closing/)
    expect(() => parseExpression('2 +')).toThrow()
    expect(() => parseExpression('2 $ 3')).toThrow(/symbol/)
    expect(() => parseExpression('')).toThrow()
  })

  it('splits relations at the top level', () => {
    expect(splitRelation('x + 1 = 3')).toEqual([{ lhs: 'x + 1 ', op: '=', rhs: ' 3' }])
    expect(splitRelation('1 < x <= 3')?.map((r) => r.op)).toEqual(['<', '<='])
    expect(splitRelation('x ≥ 2')?.[0].op).toBe('>=')
    expect(splitRelation('x + 1')).toBeNull()
  })
})
