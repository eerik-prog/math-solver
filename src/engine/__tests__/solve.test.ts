import { describe, expect, it } from 'vitest'
import { answers, ok } from './helpers'

describe('linear equations', () => {
  it('solves with textbook steps', () => {
    const s = ok('2x + 3 = 7')
    expect(s.answers.map((a) => a.text)).toEqual(['x = 2'])
    expect(s.steps.map((st) => st.title)).toEqual([
      'Subtract 3 from both sides. This leaves the x term on its own',
      'Divide both sides by 2. This leaves x on its own',
      'Check: put x = 2 back into the original equation. The left side comes out as 7, the same as the right side ✓',
    ])
  })

  it('handles x on both sides and fractions', () => {
    expect(answers('3(x - 2) = 2x + 5')).toEqual(['x = 11'])
    expect(answers('7 = 2x + 3')).toEqual(['x = 2'])
    expect(answers('x/2 + x/3 = 10')).toEqual(['x = 12'])
    expect(answers('0.5x + 1.25 = 2')).toEqual(['x = 3/2'])
  })

  it('detects identities and contradictions', () => {
    expect(answers('2(x+1) = 2x + 2')).toEqual(['All real numbers'])
    expect(answers('x = x + 1')).toEqual(['No real solution'])
  })

  it('solves for a variable with symbolic parameters', () => {
    expect(answers('solve a x + b = c for x')).toEqual(['x = (-b + c)/a'])
  })
})

describe('polynomial equations', () => {
  it('solves quadratics exactly', () => {
    expect(answers('x^2 - 5x + 6 = 0')).toEqual(['x = 2', 'x = 3'])
    expect(answers('x^2 = 2')).toEqual(['x = -sqrt(2)', 'x = sqrt(2)'])
    expect(answers('2x^2 + 3x - 1 = 0')).toEqual(['x = -(3 + sqrt(17))/4', 'x = (-3 + sqrt(17))/4'])
    expect(answers('x^2 - 6x + 9 = 0')).toEqual(['x = 3'])
    expect(answers('x^2 + 3x = 0')).toEqual(['x = -3', 'x = 0'])
  })

  it('gives complex roots when there are no real ones', () => {
    const s = ok('x^2 + 2x + 5 = 0')
    expect(s.answers[0].text).toBe('No real solution')
    expect(s.answers.filter((a) => a.complex).map((a) => a.text)).toEqual(['x = -1 - 2i', 'x = -1 + 2i'])
  })

  it('factors cubics and quartics', () => {
    expect(answers('x^3 - 6x^2 + 11x - 6 = 0')).toEqual(['x = 1', 'x = 2', 'x = 3'])
    expect(answers('x^4 - 5x^2 + 4 = 0')).toEqual(['x = -2', 'x = -1', 'x = 1', 'x = 2'])
    expect(answers('2x^3 - 3x^2 - 3x + 2 = 0')).toEqual(['x = -1', 'x = 1/2', 'x = 2'])
    expect(answers('x^3 = 8').filter((a) => !a.includes('i'))).toEqual(['x = 2'])
  })

  it('falls back to numerical roots for unsolvable quintics', () => {
    const s = ok('x^5 - x - 1 = 0')
    const real = s.answers.filter((a) => !a.complex)
    expect(real).toHaveLength(1)
    expect(Number(real[0].text.split('= ')[1])).toBeCloseTo(1.1673039783, 8)
  })
})

describe('other equation types', () => {
  it('solves rational equations and excludes bad values', () => {
    expect(answers('1/x + 1/(x+1) = 1')).toEqual(['x = (1 - sqrt(5))/2', 'x = (1 + sqrt(5))/2'])
    expect(answers('(x^2-1)/(x-1) = 0')).toEqual(['x = -1'])
    expect(answers('x/(x-2) = 2/(x-2)')).toEqual(['No real solution'])
  })

  it('solves radical equations and rejects extraneous roots', () => {
    const s = ok('sqrt(x+3) = x - 3')
    expect(s.answers.map((a) => a.text)).toEqual(['x = 6'])
    expect(JSON.stringify(s.steps)).toContain('x = 1')
  })

  it('solves exponential and logarithmic equations', () => {
    expect(answers('2^x = 8')).toEqual(['x = 3'])
    expect(answers('2^(x+1) = 32')).toEqual(['x = 4'])
    expect(answers('ln(x) = 2')).toEqual(['x = e^2'])
    expect(answers('e^(2x) - 3e^x + 2 = 0')).toEqual(['x = 0', 'x = ln(2)'])
    expect(answers('3^x = -1')).toEqual(['No real solution'])
  })

  it('gives general solutions for trigonometric equations', () => {
    expect(answers('sin(x) = 1/2')).toEqual(['x = pi/6 + 2pi*n', 'x = 5pi/6 + 2pi*n'])
    expect(answers('cos(x) = 1')).toEqual(['x = 2pi*n'])
    expect(answers('tan(x) = 1')).toEqual(['x = pi/4 + pi*n'])
    expect(answers('sin(x) = 2')).toEqual(['No real solution'])
  })

  it('solves absolute value equations', () => {
    expect(answers('|2x - 1| = 5')).toEqual(['x = -2', 'x = 3'])
    expect(answers('|x| = -1')).toEqual(['No real solution'])
  })

  it('finds numerical solutions of transcendental equations', () => {
    const [a] = answers('cos(x) = x')
    expect(Number(a.split('= ')[1])).toBeCloseTo(0.7390851332, 8)
  })

  it('checks statements without variables', () => {
    expect(answers('2 + 2 = 4')).toEqual(['True'])
    expect(answers('2^10 < 1000')).toEqual(['False'])
  })
})

describe('inequalities', () => {
  it('flips the sign when dividing by a negative', () => {
    const s = ok('3 - 2x > 7')
    expect(s.answers[0].text).toBe('x ∈ (-∞, -2)')
    expect(s.steps.some((st) => /flips/.test(st.title))).toBe(true)
  })

  it('solves polynomial and rational inequalities', () => {
    expect(answers('x^2 - 4 < 0')).toEqual(['x ∈ (-2, 2)'])
    expect(answers('x^2 - x - 6 >= 0')).toEqual(['x ∈ (-∞, -2] ∪ [3, ∞)'])
    expect(answers('(x-1)/(x+2) >= 0')).toEqual(['x ∈ (-∞, -2) ∪ [1, ∞)'])
    expect(answers('x^2 + 1 > 0')).toEqual(['All real numbers'])
    expect(answers('x^2 < 0')).toEqual(['No solution'])
  })

  it('solves compound inequalities', () => {
    expect(answers('1 < 2x + 3 <= 7')).toEqual(['x ∈ (-1, 2]'])
  })

  it('handles non-polynomial inequalities numerically', () => {
    expect(answers('sqrt(x) > 2')).toEqual(['x ∈ (4, ∞)'])
    expect(answers('e^x <= 1')).toEqual(['x ∈ (-∞, 0]'])
  })
})

describe('systems', () => {
  it('solves linear systems by row reduction', () => {
    expect(answers('x + y = 5, x - y = 1')).toEqual(['x = 3', 'y = 2'])
    expect(answers('2x + 3y - z = 1; x - y + 2z = 3; 3x + y + z = 6')).toEqual(['x = 3', 'y = -2', 'z = -1'])
    expect(answers('x + y = 1 and 2x + 2y = 2')).toEqual(['x = -y + 1', 'y is any real number'])
    expect(answers('x + y = 1, x + y = 2')).toEqual(['No solution'])
  })

  it('solves simple non-linear systems by substitution', () => {
    expect(answers('x + y = 5 and xy = 6')).toEqual(['x = 3, y = 2', 'x = 2, y = 3'])
    expect(answers('y = x^2, y = 2x + 3')).toEqual(['x = -1, y = 1', 'x = 3, y = 9'])
  })
})
