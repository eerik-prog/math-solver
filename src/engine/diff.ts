import { type Expr, ONE, ZERO, add, contains, div, fn, frac, isSym, mul, neg, pow, sub, sym } from './expr'
import { toPlain, toTex } from './print'
import { MathError, Rational } from './rational'
import { expand, simplest, simplify } from './simplify'
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

/** The rule for each function, in words. */
const FN_RULE: Record<string, string> = {
  sin: 'The derivative of sin is cos',
  cos: 'The derivative of cos is −sin',
  tan: 'The derivative of tan is sec²',
  cot: 'The derivative of cot is −csc²',
  sec: 'The derivative of sec is sec·tan',
  csc: 'The derivative of csc is −csc·cot',
  asin: 'The derivative of arcsin(u) is 1/√(1 − u²)',
  acos: 'The derivative of arccos(u) is −1/√(1 − u²)',
  atan: 'The derivative of arctan(u) is 1/(1 + u²)',
  sinh: 'The derivative of sinh is cosh',
  cosh: 'The derivative of cosh is sinh',
  tanh: 'The derivative of tanh is 1/cosh²',
  ln: 'The derivative of ln(u) is 1/u',
  log: 'The derivative of log_b(u) is 1/(u·ln b)',
  abs: 'The derivative of |u| is u/|u|',
}

const OUTER_NAME: Record<string, string> = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', abs: '| |' }

/**
 * Differentiates e with respect to x. The explanation goes into `steps`, one
 * small idea per step; the work for an inner part goes into substeps.
 */
export function differentiate(e: Expr, x: string, steps: Step[] = []): Expr {
  return simplify(d(simplify(e), x, steps))
}

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

/**
 * One step that sums up the derivative of a part: the part's own explanation
 * when it is a single step, otherwise a summary with the details inside.
 */
function partStep(label: string, x: string, part: Expr, result: Expr, work: Step[]): Step {
  if (work.length === 1 && !work[0].substeps?.length)
    return {
      title: label.startsWith('For ') ? `${label}: ${lowerFirst(work[0].title)}` : `${label}. ${work[0].title}`,
      tex: work[0].tex,
    }
  return {
    title: label,
    tex: `${D(x, toTex(part))} = ${toTex(result)}`,
    substeps: work.length ? work : undefined,
  }
}

/** A monomial c·xⁿ, which gets a single power-rule step. */
function monomial(e: Expr, x: string): { c: Expr; n: Expr } | null {
  if (isSym(e, x)) return { c: ONE, n: ONE }
  if (e.kind === 'pow' && isSym(e.base, x) && !contains(e.exp, x)) return { c: ONE, n: e.exp }
  if (e.kind === 'mul') {
    const vars = e.factors.filter((f) => contains(f, x))
    if (vars.length !== 1) return null
    const inner = monomial(vars[0], x)
    if (!inner || inner.c !== ONE) return null
    return { c: simplify(mul(...e.factors.filter((f) => f !== vars[0]))), n: inner.n }
  }
  return null
}

function wrap(e: Expr): string {
  const t = toTex(e)
  if (e.kind === 'add' || (e.kind === 'num' && e.value.sign() < 0) || (e.kind === 'mul' && t.startsWith('-')))
    return `\\left(${t}\\right)`
  return t
}

/** "Keep the 3 in front", or for −1 "Keep the minus sign in front". */
function keepText(c: Expr): string {
  return c.kind === 'num' && c.value.eq(Rational.MINUS_ONE)
    ? 'Keep the minus sign in front'
    : `Keep the ${toPlain(c)} in front`
}

function powerRule(e: Expr, x: string, c: Expr, n: Expr, steps: Step[]): Expr {
  const X = sym(x)
  const nMinus1 = simplify(sub(n, ONE))
  const res = simplify(mul(c, n, pow(X, nMinus1)))
  const lhs = D(x, toTex(e))
  const isOneC = c.kind === 'num' && c.value.isOne()
  const keep = keepText(c)
  if (isSym(e, x) || (n.kind === 'num' && n.value.isOne())) {
    steps.push(
      isOneC
        ? { title: `The derivative of ${x} is 1`, tex: `${lhs} = 1` }
        : {
            title: `${keep}. The derivative of ${x} is 1`,
            tex: `${lhs} = ${wrap(c)} \\cdot 1 = ${toTex(res)}`,
          },
    )
    return res
  }
  const nTex = n.kind === 'num' && n.value.sign() >= 0 && n.value.isInteger() ? toTex(n) : `\\left(${toTex(n)}\\right)`
  const asPower =
    n.kind === 'num' && (!n.value.isInteger() || n.value.sign() < 0)
      ? `Write ${toPlain(simplify(pow(X, n)))} as a power: ${x}^${n.value.isInteger() ? n.value.toString() : `(${n.value.toString()})`}. `
      : ''
  const rule = `Power rule: bring the power ${toPlain(n)} down in front, then lower the power by 1`
  steps.push({
    title: isOneC
      ? `${asPower}${rule}`
      : `${keep}. ${asPower}${rule.replace('Power rule: bring', 'Use the power rule on the rest: bring')}`,
    tex: `${lhs} = ${isOneC ? '' : `${wrap(c)} \\cdot `}${nTex} \\cdot ${x}^{${toTex(n)} - 1} = ${toTex(res)}`,
  })
  return res
}

function d(e: Expr, x: string, steps: Step[]): Expr {
  const lhs = D(x, toTex(e))
  if (!contains(e, x)) {
    steps.push({
      title: `${toPlain(e)} is a constant (it has no ${x} in it), so its derivative is 0`,
      tex: `${lhs} = 0`,
    })
    return ZERO
  }
  const mono = monomial(e, x)
  if (mono) return powerRule(e, x, mono.c, mono.n, steps)
  switch (e.kind) {
    case 'add': {
      steps.push({
        title: 'Take the derivative of each term on its own, then add them up (the sum rule)',
        tex: `${lhs} = ${e.terms.map((t) => D(x, toTex(t))).join(' + ')}`,
      })
      const parts = e.terms.map((t) => {
        const work: Step[] = []
        const r = simplify(d(t, x, work))
        steps.push(partStep(`For ${toPlain(t)}`, x, t, r, work))
        return r
      })
      const res = simplify(add(...parts))
      const raw: Expr = parts.length > 1 ? { kind: 'add', terms: parts } : parts[0]
      const rawTex = toTex(raw)
      steps.push({
        title: 'Add the results together',
        tex: `${lhs} = ${rawTex === toTex(res) ? '' : `${rawTex} = `}${toTex(res)}`,
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
        const du = simplify(d(u, x, work))
        const res = simplify(mul(c, du))
        if (work.length === 1 && !work[0].substeps?.length) {
          steps.push({
            title: `${keepText(c)}. ${work[0].title}`,
            tex: `${lhs} = ${wrap(c)} \\cdot ${D(x, toTex(u))} = ${wrap(c)} \\cdot ${wrap(du)} = ${toTex(res)}`,
          })
        } else {
          steps.push({
            title: `${keepText(c)}, and take the derivative of ${toPlain(u)}`,
            tex: `${lhs} = ${wrap(c)} \\cdot ${D(x, toTex(u))}`,
          })
          steps.push(...work)
          steps.push({
            title: `Multiply by ${toPlain(c)}`,
            tex: `${lhs} = ${wrap(c)} \\cdot ${wrap(du)} = ${toTex(res)}`,
          })
        }
        return res
      }
      const denom = vars.filter((f) => f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.sign() < 0)
      if (denom.length > 0) {
        const top = simplify(mul(...vars.filter((f) => !denom.includes(f))))
        const bottom = simplify(mul(...denom.map((f) => (f.kind === 'pow' ? pow(f.base, simplify(neg(f.exp))) : f))))
        if (contains(top, x)) return quotientRule(e, top, bottom, x, steps)
      }
      const [u, ...restFactors] = vars
      const v = simplify(mul(...restFactors))
      steps.push({
        title: `This is two parts multiplied together, so use the product rule: (u·v)′ = u′·v + u·v′`,
        tex: `u = ${toTex(u)},\\quad v = ${toTex(v)}`,
      })
      const workU: Step[] = []
      const du = simplify(d(u, x, workU))
      steps.push(partStep(`Find u′, the derivative of u = ${toPlain(u)}`, x, u, du, workU))
      const workV: Step[] = []
      const dv = simplify(d(v, x, workV))
      steps.push(partStep(`Find v′, the derivative of v = ${toPlain(v)}`, x, v, dv, workV))
      const res = simplify(add(mul(du, v), mul(u, dv)))
      steps.push({
        title: 'Put u, v, u′ and v′ into u′·v + u·v′, then tidy up',
        tex: `${lhs} = ${wrap(du)} \\cdot ${wrap(v)} + ${wrap(u)} \\cdot ${wrap(dv)} = ${toTex(res)}`,
      })
      return res
    }
    case 'pow': {
      const { base, exp } = e
      if (!contains(exp, x)) return chainPower(e, base, exp, x, steps)
      if (!contains(base, x)) return exponential(e, base, exp, x, steps)
      // f^g: logarithmic differentiation
      const work: Step[] = []
      const df = d(base, x, work)
      const dg = d(exp, x, work)
      const res = simplify(mul(e, add(mul(dg, fn('ln', base)), mul(exp, df, pow(base, -1)))))
      steps.push({
        title:
          'Both the base and the power contain ' +
          x +
          ', so use logarithmic differentiation: (fᵍ)′ = fᵍ·(g′·ln f + g·f′/f)',
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
      const rule = FN_RULE[e.name] ?? 'Use the standard derivative'
      if (isSym(u, x)) {
        steps.push({ title: rule, tex: `${lhs} = ${toTex(outer)}` })
        return outer
      }
      const name = OUTER_NAME[e.name] ?? e.name
      steps.push({
        title: `There is a function inside another function, so use the chain rule. The outside is ${name}, the inside is u = ${toPlain(u)}`,
        tex: `u = ${toTex(u)}`,
      })
      const U = sym(x === 'u' ? 'w' : 'u')
      const withU = e.name === 'log' ? fn('log', U, e.args[1]) : fn(e.name, U)
      steps.push({
        title: `Take the derivative of the outside and leave the inside as it is. ${rule}`,
        tex: `\\frac{d}{d${U.name}}\\left[${toTex(withU)}\\right] = ${toTex(simplify(outerDerivative(e.name, withU.args)))} = ${toTex(outer)}`,
      })
      const work: Step[] = []
      const du = simplify(d(u, x, work))
      steps.push(partStep(`Take the derivative of the inside, ${toPlain(u)}`, x, u, du, work))
      const res = simplify(mul(outer, du))
      steps.push({
        title: 'Multiply the two results together',
        tex: `${lhs} = ${wrap(outer)} \\cdot ${wrap(du)} = ${toTex(res)}`,
      })
      return res
    }
    case 'sym':
      return ONE
    case 'num':
      return ZERO
  }
}

function quotientRule(e: Expr, top: Expr, bottom: Expr, x: string, steps: Step[]): Expr {
  const lhs = D(x, toTex(e))
  steps.push({
    title: `This is a fraction with ${x} on the top and the bottom, so use the quotient rule: (u/v)′ = (u′·v − u·v′) / v²`,
    tex: `u = ${toTex(top)},\\quad v = ${toTex(bottom)}`,
  })
  const workU: Step[] = []
  const du = simplify(d(top, x, workU))
  steps.push(partStep(`Find u′, the derivative of the top`, x, top, du, workU))
  const workV: Step[] = []
  const dv = simplify(d(bottom, x, workV))
  steps.push(partStep(`Find v′, the derivative of the bottom`, x, bottom, dv, workV))
  const numer = simplify(sub(mul(du, bottom), mul(top, dv)))
  steps.push({
    title: 'Put u, v, u′ and v′ into the quotient rule',
    tex: `${lhs} = \\frac{${wrap(du)} \\cdot ${wrap(bottom)} - ${wrap(top)} \\cdot ${wrap(dv)}}{${wrap(bottom)}^{2}}`,
  })
  let tidyTop = numer
  try {
    const ex = expand(numer)
    if (toTex(ex).length < toTex(numer).length || ex.kind !== 'add') tidyTop = ex
  } catch {
    /* keep it as it is */
  }
  const res = simplify(div(tidyTop, pow(bottom, 2)))
  steps.push({
    title: 'Multiply out the top and simplify',
    tex: `${lhs} = \\frac{${toTex(tidyTop)}}{${wrap(bottom)}^{2}}`,
  })
  return res
}

/** (inside)ⁿ: the power rule on the outside, times the derivative of the inside. */
function chainPower(e: Expr, base: Expr, exp: Expr, x: string, steps: Step[]): Expr {
  const lhs = D(x, toTex(e))
  const nMinus1 = simplify(sub(exp, ONE))
  const outer = simplify(mul(exp, pow(base, nMinus1)))
  const isRoot = exp.kind === 'num' && exp.value.eq(Rational.HALF)
  steps.push({
    title: isRoot
      ? `A square root is the power 1/2. The inside is u = ${toPlain(base)}, so use the chain rule`
      : `A bracket is raised to a power, so use the chain rule. Treat the inside, u = ${toPlain(base)}, as one block`,
    tex: `u = ${toTex(base)}`,
  })
  const U = sym(x === 'u' ? 'w' : 'u')
  steps.push({
    title: `Power rule on the outside: bring the ${toPlain(exp)} down and lower the power by 1. Leave the inside as it is`,
    tex: `\\frac{d}{d${U.name}}\\left[${toTex(pow(U, exp))}\\right] = ${toTex(simplify(mul(exp, pow(U, nMinus1))))} = ${toTex(outer)}`,
  })
  const work: Step[] = []
  const du = simplify(d(base, x, work))
  steps.push(partStep(`Take the derivative of the inside, ${toPlain(base)}`, x, base, du, work))
  const res = simplify(mul(exp, pow(base, nMinus1), du))
  steps.push({
    title: 'Multiply the two results together',
    tex: `${lhs} = ${wrap(outer)} \\cdot ${wrap(du)} = ${toTex(res)}`,
  })
  return res
}

/** eᵘ and aᵘ. */
function exponential(e: Expr, base: Expr, exp: Expr, x: string, steps: Step[]): Expr {
  const lhs = D(x, toTex(e))
  const isE = isSym(base, 'e')
  const lnb = isE ? ONE : fn('ln', base)
  const outer = simplify(mul(e, lnb))
  const b = toPlain(base)
  if (isSym(exp, x)) {
    steps.push({
      title: isE ? `The derivative of eˣ is eˣ itself` : `The derivative of ${b}ˣ is ${b}ˣ · ln(${b})`,
      tex: `${lhs} = ${toTex(outer)}`,
    })
    return outer
  }
  steps.push({
    title: isE
      ? `e is raised to a power that is not just ${x}, so use the chain rule with u = ${toPlain(exp)}. The derivative of eᵘ is eᵘ times u′`
      : `${b} is raised to a power that is not just ${x}, so use the chain rule with u = ${toPlain(exp)}. The derivative of ${b}ᵘ is ${b}ᵘ · ln(${b}) times u′`,
    tex: `u = ${toTex(exp)}`,
  })
  const work: Step[] = []
  const du = simplify(d(exp, x, work))
  steps.push(partStep(`Take the derivative of the power, ${toPlain(exp)}`, x, exp, du, work))
  const res = simplify(mul(outer, du))
  steps.push({
    title: 'Multiply the two results together',
    tex: `${lhs} = ${wrap(outer)} \\cdot ${wrap(du)} = ${toTex(res)}`,
  })
  return res
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
        title:
          k === 1
            ? `${ordinal(k)} derivative`
            : `${ordinal(k)} derivative: take the derivative of the ${ordinal(k - 1).toLowerCase()} derivative`,
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
