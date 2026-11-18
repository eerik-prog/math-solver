import { type Expr, freeSymbols, num } from './expr'
import { evalNum } from './numeric'
import { formatNumber, toTex, toText } from './print'
import { MathError, Rational } from './rational'
import { simplify } from './simplify'
import type { Answer, Solution, Step } from './types'

const EXACT_FNS = new Set(['factorial', 'gcd', 'lcm', 'mod', 'abs', 'floor', 'ceil', 'round'])

/** -(3) and 1·x style artefacts of parsing are folded before showing steps. */
function prefold(e: Expr): Expr {
  switch (e.kind) {
    case 'add':
      return { kind: 'add', terms: e.terms.map(prefold) }
    case 'mul': {
      const fs = e.factors.map(prefold)
      if (fs.length === 2 && fs[0].kind === 'num' && fs[0].value.eq(Rational.MINUS_ONE) && fs[1].kind === 'num')
        return num(fs[1].value.neg())
      return { kind: 'mul', factors: fs }
    }
    case 'pow':
      return { kind: 'pow', base: prefold(e.base), exp: prefold(e.exp) }
    case 'fn':
      return { kind: 'fn', name: e.name, args: e.args.map(prefold) }
    default:
      return e
  }
}

const isRecip = (e: Expr) =>
  e.kind === 'pow' && e.base.kind === 'num' && e.exp.kind === 'num' && e.exp.value.eq(Rational.MINUS_ONE)

/** Can the whole tree be evaluated exactly with rational arithmetic? */
function isRationalTree(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
      return true
    case 'sym':
      return false
    case 'add':
      return e.terms.every(isRationalTree)
    case 'mul':
      return e.factors.every(isRationalTree)
    case 'pow': {
      if (!isRationalTree(e.base) || !isRationalTree(e.exp)) return false
      const x = simplify(e.exp)
      return x.kind === 'num' && x.value.isInteger()
    }
    case 'fn':
      return EXACT_FNS.has(e.name) && e.args.every(isRationalTree)
  }
}

interface Reduction {
  e: Expr
  title: string
}

/** Performs the next operation in order of operations (innermost, left to right). */
function reduceOnce(e: Expr): Reduction | null {
  switch (e.kind) {
    case 'add':
      if (e.terms.every((t) => t.kind === 'num')) {
        const [a, b] = e.terms.map((t) => (t.kind === 'num' ? t.value : Rational.ZERO))
        const v = e.terms.reduce((s, t) => s.add((t as { value: Rational }).value), Rational.ZERO)
        const subtract = e.terms.length === 2 && b.sign() < 0
        return {
          e: num(v),
          title: subtract
            ? `Subtract: ${a} − ${b.neg()} = ${v}`
            : `Add: ${e.terms.map((t) => toText(t)).join(' + ')} = ${v}`,
        }
      }
      break
    case 'mul':
      if (e.factors.every((f) => f.kind === 'num' || isRecip(f))) {
        let v = Rational.ONE
        let division = false
        for (const f of e.factors) {
          if (f.kind === 'num') v = v.mul(f.value)
          else if (f.kind === 'pow' && f.base.kind === 'num') {
            if (f.base.value.isZero()) throw new MathError('Division by zero is undefined')
            v = v.div(f.base.value)
            division = true
          }
        }
        const parts = e.factors.map((f) =>
          f.kind === 'pow' ? toText(f.base) : f.kind === 'num' && f.value.sign() < 0 ? `(${toText(f)})` : toText(f),
        )
        const desc = division ? `Divide: ${parts[0]} ÷ ${parts.slice(1).join(' ÷ ')}` : `Multiply: ${parts.join(' × ')}`
        return { e: num(v), title: `${desc} = ${v}` }
      }
      break
    case 'pow':
      if (e.base.kind === 'num' && e.exp.kind === 'num' && e.exp.value.isInteger()) {
        if (e.base.value.isZero() && e.exp.value.sign() < 0) throw new MathError('Division by zero is undefined')
        const v = e.base.value.pow(e.exp.value.n)
        return { e: num(v), title: `Evaluate the power: ${toText(e)} = ${v}` }
      }
      break
    case 'fn':
      if (e.args.every((a) => a.kind === 'num')) {
        const v = simplify(e)
        if (v.kind === 'num') return { e: v, title: `Evaluate ${fnName(e.name)}: ${toText(e)} = ${v.value}` }
      }
      break
    default:
      return null
  }
  const kids =
    e.kind === 'add'
      ? e.terms
      : e.kind === 'mul'
        ? e.factors
        : e.kind === 'pow'
          ? [e.base, e.exp]
          : e.kind === 'fn'
            ? e.args
            : []
  for (let i = 0; i < kids.length; i++) {
    // a reciprocal inside a product is reduced together with the product
    if (e.kind === 'mul' && isRecip(kids[i])) continue
    const r = reduceOnce(kids[i])
    if (r) {
      const next = [...kids]
      next[i] = r.e
      const rebuilt: Expr =
        e.kind === 'add'
          ? { kind: 'add', terms: next }
          : e.kind === 'mul'
            ? { kind: 'mul', factors: next }
            : e.kind === 'pow'
              ? { kind: 'pow', base: next[0], exp: next[1] }
              : { kind: 'fn', name: (e as { name: string }).name, args: next }
      return { e: rebuilt, title: r.title }
    }
  }
  return null
}

function fnName(n: string): string {
  return (
    {
      factorial: 'the factorial',
      gcd: 'the greatest common divisor',
      lcm: 'the least common multiple',
      mod: 'the remainder',
      abs: 'the absolute value',
    }[n] ?? n
  )
}

export function evaluateProblem(input: Expr): Solution {
  const e = prefold(input)
  const steps: Step[] = []
  const notes: string[] = []
  let result: Expr
  if (isRationalTree(e)) {
    let cur = e
    const all: Step[] = []
    for (let guard = 0; guard < 200; guard++) {
      const r = reduceOnce(cur)
      if (!r) break
      cur = r.e
      all.push({ title: r.title, tex: toTex(cur) })
    }
    result = simplify(cur)
    if (all.length > 40)
      steps.push({
        title: `Work through the ${all.length} operations in order (parentheses, powers, × ÷, + −)`,
        substeps: all,
      })
    else steps.push(...all)
    if (cur.kind === 'num' && !cur.value.isInteger()) {
      steps.push({ title: 'The result as a fraction in lowest terms', tex: toTex(cur) })
    }
  } else {
    result = simplify(e)
    if (freeSymbols(result).size) throw new MathError('This expression has variables; try "simplify" or "solve"')
    steps.push({ title: 'Simplify exactly', tex: `${toTex(e)} = ${toTex(result)}` })
  }
  const value = evalNum(result)
  const answers: Answer[] = []
  const isInt = result.kind === 'num' && result.value.isInteger()
  answers.push({
    tex: toTex(result),
    text: toText(result),
    approx: isInt ? undefined : Number.isFinite(value) ? formatNumber(value, 12) : undefined,
  })
  if (result.kind === 'num' && !result.value.isInteger() && result.value.abs().cmp(Rational.ONE) > 0) {
    const v = result.value
    const whole = v.sign() < 0 ? -v.abs().floor() : v.floor()
    const rest = v.sub(new Rational(whole)).abs()
    notes.push(`As a mixed number: ${whole} ${rest.n}/${rest.d}`)
  }
  if (!Number.isFinite(value) && result.kind !== 'num') notes.push('The value is not a real number.')
  return { kind: 'evaluate', title: 'Calculate', problemTex: toTex(e), answers, steps, notes }
}
