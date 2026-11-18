import { type Expr, ONE, ZERO, add, contains, div, fn, frac, isSym, mul, neg, pow, sub } from './expr'
import { toTex } from './print'
import { MathError } from './rational'
import { simplest, simplify } from './simplify'
import type { Step } from './types'

const D = (x: string, inner: string) => `\\frac{d}{d${x}}\\left[${inner}\\right]`

/** Derivative of the outer function f evaluated at u, i.e. f'(u). */
function outerDerivative(name: string, args: readonly Expr[]): Expr {
  const [u] = args
  switch (name) {
    case 'sin':
      return fn('cos', u)
    case 'cos':
      return neg(fn('sin', u))
    case 'tan':
      return pow(fn('sec', u), 2)
    case 'cot':
      return neg(pow(fn('csc', u), 2))
    case 'sec':
      return mul(fn('sec', u), fn('tan', u))
    case 'csc':
      return neg(mul(fn('csc', u), fn('cot', u)))
    case 'asin':
      return pow(sub(ONE, pow(u, 2)), frac(-1, 2))
    case 'acos':
      return neg(pow(sub(ONE, pow(u, 2)), frac(-1, 2)))
    case 'atan':
      return pow(add(ONE, pow(u, 2)), -1)
    case 'sinh':
      return fn('cosh', u)
    case 'cosh':
      return fn('sinh', u)
    case 'tanh':
      return pow(fn('cosh', u), -2)
    case 'ln':
      return pow(u, -1)
    case 'log':
      return pow(mul(u, fn('ln', args[1])), -1)
    case 'abs':
      return div(u, fn('abs', u))
  }
  throw new MathError(`I can't differentiate ${name}(…)`)
}

const FN_RULE: Record<string, string> = {
  sin: 'The derivative of sin is cos',
  cos: 'The derivative of cos is −sin',
  tan: 'The derivative of tan is sec²',
  cot: 'The derivative of cot is −csc²',
  sec: 'The derivative of sec is sec·tan',
  csc: 'The derivative of csc is −csc·cot',
  asin: 'Derivative of arcsin',
  acos: 'Derivative of arccos',
  atan: 'Derivative of arctan',
  sinh: 'The derivative of sinh is cosh',
  cosh: 'The derivative of cosh is sinh',
  tanh: 'Derivative of tanh',
  ln: 'The derivative of ln(u) is 1/u',
  log: 'The derivative of log_b(u) is 1/(u·ln b)',
  abs: 'The derivative of |u| is u/|u|',
}

/**
 * Differentiates e with respect to x, recording the rule used at every
 * non-trivial node into `steps` (children's work goes into substeps).
 */
export function differentiate(e: Expr, x: string, steps: Step[] = []): Expr {
  return simplify(d(simplify(e), x, steps))
}

function d(e: Expr, x: string, steps: Step[]): Expr {
  if (!contains(e, x)) return ZERO
  const lhs = D(x, toTex(e))
  switch (e.kind) {
    case 'sym':
      return ONE
    case 'add': {
      const work: Step[] = []
      const parts = e.terms.map((t) => d(t, x, work))
      const res = simplify(add(...parts))
      steps.push({
        title: 'Sum rule: differentiate each term separately',
        tex: `${lhs} = ${e.terms.map((t) => D(x, toTex(t))).join(' + ')} = ${toTex(res)}`,
        substeps: work,
      })
      return res
    }
    case 'mul': {
      const consts = e.factors.filter((f) => !contains(f, x))
      const vars = e.factors.filter((f) => contains(f, x))
      if (consts.length > 0) {
        const c = simplify(mul(...consts))
        const u = simplify(mul(...vars))
        const work: Step[] = []
        const du = d(u, x, work)
        const res = simplify(mul(c, du))
        steps.push({
          title: 'Constant multiple rule: keep the constant, differentiate the rest',
          tex: `${lhs} = ${factorTex(c)} \\cdot ${D(x, toTex(u))} = ${toTex(res)}`,
          substeps: work,
        })
        return res
      }
      const denom = vars.filter((f) => f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.sign() < 0)
      if (denom.length > 0) {
        const top = simplify(mul(...vars.filter((f) => !denom.includes(f))))
        const bottom = simplify(mul(...denom.map((f) => (f.kind === 'pow' ? pow(f.base, simplify(neg(f.exp))) : f))))
        if (contains(top, x)) {
          const work: Step[] = []
          const du = d(top, x, work)
          const dv = d(bottom, x, work)
          const res = simplify(div(sub2(mul(du, bottom), mul(top, dv)), pow(bottom, 2)))
          steps.push({
            title: 'Quotient rule: (u/v)′ = (u′v − uv′) / v²',
            tex: `${lhs} = \\frac{${factorTex(du)} \\cdot ${factorTex(bottom)} - ${factorTex(top)} \\cdot ${factorTex(dv)}}{${factorTex(bottom)}^{2}} = ${toTex(simplest(res))}`,
            substeps: work,
          })
          return res
        }
      }
      const [u, ...restFactors] = vars
      const v = simplify(mul(...restFactors))
      const work: Step[] = []
      const du = d(u, x, work)
      const dv = d(v, x, work)
      const res = simplify(add(mul(du, v), mul(u, dv)))
      steps.push({
        title: 'Product rule: (uv)′ = u′v + uv′',
        tex: `${lhs} = ${D(x, toTex(u))} \\cdot ${factorTex(v)} + ${factorTex(u)} \\cdot ${D(x, toTex(v))} = ${toTex(res)}`,
        substeps: work,
      })
      return res
    }
    case 'pow': {
      const { base, exp } = e
      if (!contains(exp, x)) {
        const nMinus1 = simplify(sub(exp, ONE))
        if (isSym(base, x)) {
          const res = simplify(mul(exp, pow(base, nMinus1)))
          steps.push({
            title: `Power rule: d/d${x}[${x}ⁿ] = n·${x}ⁿ⁻¹`,
            tex: `${lhs} = ${factorTex(exp)} \\cdot ${toTex({ kind: 'pow', base, exp: nMinus1 })} = ${toTex(res)}`,
          })
          return res
        }
        const work: Step[] = []
        const db = d(base, x, work)
        const res = simplify(mul(exp, pow(base, nMinus1), db))
        steps.push({
          title: 'Power rule with the chain rule: (uⁿ)′ = n·uⁿ⁻¹·u′',
          tex: `${lhs} = ${factorTex(exp)} \\cdot ${toTex({ kind: 'pow', base, exp: nMinus1 })} \\cdot ${D(x, toTex(base))} = ${toTex(res)}`,
          substeps: work,
        })
        return res
      }
      if (!contains(base, x)) {
        const work: Step[] = []
        const dg = d(exp, x, work)
        const lnb = isSym(base, 'e') ? ONE : fn('ln', base)
        const res = simplify(mul(e, lnb, dg))
        const chain = isSym(exp, x) ? '' : ` \\cdot ${D(x, toTex(exp))}`
        steps.push({
          title: isSym(base, 'e') ? 'Exponential rule: (eᵘ)′ = eᵘ·u′' : 'Exponential rule: (aᵘ)′ = aᵘ·ln(a)·u′',
          tex: `${lhs} = ${toTex(e)}${isSym(base, 'e') ? '' : ` \\cdot \\ln\\left(${toTex(base)}\\right)`}${chain} = ${toTex(res)}`,
          substeps: work,
        })
        return res
      }
      // f^g: logarithmic differentiation
      const work: Step[] = []
      const df = d(base, x, work)
      const dg = d(exp, x, work)
      const res = simplify(mul(e, add(mul(dg, fn('ln', base)), mul(exp, df, pow(base, -1)))))
      steps.push({
        title: 'Logarithmic differentiation: (fᵍ)′ = fᵍ·(g′·ln f + g·f′/f)',
        tex: `${lhs} = ${toTex(res)}`,
        substeps: work,
      })
      return res
    }
    case 'fn': {
      if (e.name === 'log' && contains(e.args[1], x)) {
        // log_g(f) = ln f / ln g
        return d(simplify(div(fn('ln', e.args[0]), fn('ln', e.args[1]))), x, steps)
      }
      if (e.args.length !== 1 && e.name !== 'log') throw new MathError(`I can't differentiate ${e.name}(…)`)
      const u = e.args[0]
      const outer = simplify(outerDerivative(e.name, e.args))
      if (isSym(u, x)) {
        steps.push({ title: FN_RULE[e.name] ?? 'Standard derivative', tex: `${lhs} = ${toTex(outer)}` })
        return outer
      }
      const work: Step[] = []
      const du = d(u, x, work)
      const res = simplify(mul(outer, du))
      steps.push({
        title: `Chain rule: ${FN_RULE[e.name] ?? 'differentiate the outer function'}, then multiply by the derivative of the inside`,
        tex: `${lhs} = ${factorTex(outer)} \\cdot ${D(x, toTex(u))} = ${toTex(res)}`,
        substeps: work,
      })
      return res
    }
    case 'num':
      return ZERO
  }
}

function sub2(a: Expr, b: Expr): Expr {
  return add(a, neg(b))
}

function factorTex(e: Expr): string {
  const t = toTex(e)
  if (e.kind === 'add' || (e.kind === 'num' && e.value.sign() < 0) || (e.kind === 'mul' && t.startsWith('-')))
    return `\\left(${t}\\right)`
  return t
}

export function nthDerivative(e: Expr, x: string, n: number, steps: Step[]): Expr {
  let cur = simplify(e)
  for (let k = 1; k <= n; k++) {
    const work: Step[] = []
    const next = differentiate(cur, x, work)
    const nice = simplest(next)
    if (n === 1) steps.push(...work)
    else
      steps.push({
        title: `${ordinal(k)} derivative`,
        tex: `${k === 1 ? `\\frac{d}{d${x}}` : `\\frac{d^{${k}}}{d${x}^{${k}}}`}\\left[${toTex(e)}\\right] = ${toTex(nice)}`,
        substeps: work,
      })
    cur = nice
  }
  return cur
}

export function ordinal(k: number): string {
  return ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth'][k] ?? `${k}th`
}
