import { describe, expect, it } from 'vitest'
import { parseExpression } from '../parser'
import { toTex, toText } from '../print'
import { expand, simplify } from '../simplify'

const s = (e: string) => toText(simplify(parseExpression(e)))
const x = (e: string) => toText(expand(parseExpression(e)))
const t = (e: string) => toTex(simplify(parseExpression(e)))

describe('simplify', () => {
  it('combines like terms and powers', () => {
    expect(s('2x + 3x - x')).toBe('4x')
    expect(s('x * x^2 * x^-1')).toBe('x^2')
    expect(s('3x^2y - 2xy + x^2 y')).toBe('4x^2*y - 2x*y')
    expect(s('x/2 + x/3')).toBe('5x/6')
  })

  it('simplifies radicals exactly', () => {
    expect(s('sqrt(72)')).toBe('6sqrt(2)')
    expect(s('sqrt(8) + sqrt(18)')).toBe('5sqrt(2)')
    expect(s('sqrt(2) * sqrt(6)')).toBe('2sqrt(3)')
    expect(s('1/sqrt(2)')).toBe('sqrt(2)/2')
    expect(s('cbrt(-27)')).toBe('-3')
    expect(s('4^(1/4)')).toBe('sqrt(2)')
    expect(s('sqrt(-9)')).toBe('3i')
  })

  it('knows exact trigonometric and logarithmic values', () => {
    expect(s('sin(pi/6)')).toBe('1/2')
    expect(s('cos(3pi/4)')).toBe('-sqrt(2)/2')
    expect(s('tan(pi/3)')).toBe('sqrt(3)')
    expect(s('sin(-x)')).toBe('-sin(x)')
    expect(s('acos(1/2)')).toBe('pi/3')
    expect(s('ln(e^5)')).toBe('5')
    expect(s('e^(ln(x))')).toBe('x')
    expect(s('log_3(81)')).toBe('4')
  })

  it('handles absolute values and even powers', () => {
    expect(s('sqrt(x^2)')).toBe('|x|')
    expect(s('|x^2 + 1|')).toBe('x^2 + 1')
    expect(s('|-2x|')).toBe('2*|x|')
  })

  it('expands products and powers', () => {
    expect(x('(x+1)^2')).toBe('x^2 + 2x + 1')
    expect(x('(x+y)^3')).toBe('x^3 + 3x^2*y + 3x*y^2 + y^3')
    expect(x('(x-2)(x+3)')).toBe('x^2 + x - 6')
    expect(x('(a+b)(a-b)')).toBe('a^2 - b^2')
  })

  it('prints readable LaTeX', () => {
    expect(t('(-3 + sqrt(5))/2')).toBe('\\frac{-3 + \\sqrt{5}}{2}')
    expect(t('x^(-2)')).toBe('\\frac{1}{x^{2}}')
    expect(t('sin(x)^2')).toBe('\\sin^{2}(x)')
    expect(t('2 - (3 + x)')).toBe('-x - 1')
  })
})
