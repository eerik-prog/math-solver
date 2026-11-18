import { differentiate } from './diff'
import { type Expr, contains, freeSymbols, isSym, mul, num, pow, substitute } from './expr'
import { identify } from './identify'
import { compile } from './numeric'
import { polyFromExpr, ratFromExpr } from './poly'
import { formatNumber, toTex, toText } from './print'
import { MathError } from './rational'
import { simplify } from './simplify'
import type { Solution, Step } from './types'

type LimitValue =
  { kind: 'finite'; value: number; exact: Expr | null } | { kind: 'inf'; sign: 1 | -1 } | { kind: 'dne' }

function limTex(x: string, a: string, side: '' | '+' | '-'): string {
  return `\\lim_{${x} \\to ${a}${side ? `^{${side}}` : ''}}`
}

/** Numerically estimates a one-sided limit, with Richardson extrapolation. */
function oneSided(f: (v: number) => number, a: number, dir: 1 | -1): LimitValue {
  const vals: number[] = []
  for (let k = 1; k <= 8; k++) vals.push(Number.isFinite(a) ? f(a + dir * Math.pow(10, -k)) : f(dir * Math.pow(10, k)))
  const finite = vals.filter(Number.isFinite)
  if (finite.length < 5) return { kind: 'dne' }
  const last = finite.slice(-4)
  const growing = last.every((v, i) => i === 0 || Math.abs(v) > Math.abs(last[i - 1]) * 1.5)
  if (growing && Math.abs(last[3]) > 1e5 && last.every((v) => Math.sign(v) === Math.sign(last[3])))
    return { kind: 'inf', sign: last[3] > 0 ? 1 : -1 }
  const [p, q, r] = last.slice(-3)
  const tol = 1e-5 * Math.max(1, Math.abs(r))
  if (!(Math.abs(r - q) <= tol && Math.abs(q - p) <= 10 * tol + 1e-4 * Math.max(1, Math.abs(r)))) return { kind: 'dne' }
  // Values shrinking steadily towards zero: the limit is 0.
  if (last.every((v, i) => i === 0 || Math.abs(v) < 0.5 * Math.abs(last[i - 1])) && Math.abs(r) < 1e-3)
    return { kind: 'finite', value: 0, exact: num(0) }
  // Errors usually shrink like 1/x (or h), so extrapolate: L ≈ f₂ + (f₂ − f₁)/9.
  const rich = finite.slice(1).map((v, i) => v + (v - finite[i]) / 9)
  const rn = rich.length
  const richSpread = Math.abs(rich[rn - 1] - rich[rn - 2]) + Math.abs(rich[rn - 2] - rich[rn - 3])
  const rawSpread = Math.abs(r - q) + Math.abs(q - p)
  // Very close to the point, rounding error dominates: use the middle of the sequence.
  const best = richSpread < rawSpread ? rich[rn - 3] : r
  const v = Math.abs(best) < 1e-7 ? 0 : best
  return { kind: 'finite', value: v, exact: identify(v, 1e-8) }
}

function combine(l: LimitValue, r: LimitValue): LimitValue {
  if (
    l.kind === 'finite' &&
    r.kind === 'finite' &&
    Math.abs(l.value - r.value) <= 1e-5 * Math.max(1, Math.abs(l.value))
  )
    return r
  if (l.kind === 'inf' && r.kind === 'inf' && l.sign === r.sign) return r
  return { kind: 'dne' }
}

function valueTex(v: LimitValue): string {
  if (v.kind === 'finite') return v.exact ? toTex(v.exact) : formatNumber(v.value)
  if (v.kind === 'inf') return v.sign > 0 ? '\\infty' : '-\\infty'
  return '\\text{does not exist}'
}

/** Splits a canonical product into numerator and denominator. */
function fraction(e: Expr): { top: Expr; bottom: Expr } | null {
  const fs = e.kind === 'mul' ? e.factors : [e]
  const bottom = fs.filter((f) => f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.sign() < 0)
  if (!bottom.length) return null
  const top = fs.filter((f) => !bottom.includes(f))
  return {
    top: simplify(mul(...(top.length ? top : [num(1)]))),
    bottom: simplify(mul(...bottom.map((f) => (f.kind === 'pow' ? pow(f.base, simplify(mul(num(-1), f.exp))) : f)))),
  }
}

function safeSubstitute(e: Expr, x: string, a: Expr): Expr | null {
  try {
    const v = simplify(substitute(e, x, a))
    return contains(v, x) ? null : v
  } catch (err) {
    if (err instanceof MathError) return null
    throw err
  }
}

export function solveLimit(f0: Expr, x: string, a: Expr, side: '' | '+' | '-' = ''): Solution {
  const f = simplify(f0)
  const steps: Step[] = []
  const notes: string[] = []
  const atInf = isSym(a, 'infinity') || (a.kind === 'mul' && a.factors.some((g) => isSym(g, 'infinity')))
  const infSign: 1 | -1 = atInf && a.kind === 'mul' ? -1 : 1
  const aTex = toTex(a)
  const L = limTex(x, aTex, side)
  const fn_ = compile(f, x)
  const aNum = atInf ? infSign * Infinity : compile(a, '_')(0)

  // Numerical estimate used both as a fallback and as a sanity check.
  let numeric: LimitValue
  if (atInf) numeric = oneSided(fn_, Infinity, infSign)
  else if (side === '+') numeric = oneSided(fn_, aNum, 1)
  else if (side === '-') numeric = oneSided(fn_, aNum, -1)
  else numeric = combine(oneSided(fn_, aNum, -1), oneSided(fn_, aNum, 1))

  let exact: LimitValue | null = null

  if (!atInf) {
    const direct = safeSubstitute(f, x, a)
    const dv = direct ? compile(direct, '_')(0) : NaN
    if (
      direct &&
      Number.isFinite(dv) &&
      numeric.kind === 'finite' &&
      Math.abs(dv - numeric.value) < 1e-5 * Math.max(1, Math.abs(dv))
    ) {
      steps.push({
        title: `The function is continuous at ${x} = ${toTex(a)}, so substitute directly`,
        tex: `${L} ${toTex(f)} = ${toTex(direct)}`,
      })
      exact = { kind: 'finite', value: dv, exact: direct }
    }
  }

  if (!exact) {
    // Rational functions: cancel common factors (finite a) or compare degrees (a = ±∞).
    const rf = ratFromExpr(f, x)
    if (rf && fraction(f)) {
      const reduced = simplify(mul(rf.num.toExpr(x), pow(rf.den.toExpr(x), -1)))
      if (atInf) {
        const dn = rf.num.degree
        const dd = rf.den.degree
        steps.push({
          title: `Divide the numerator and denominator by ${x}^${dd}, the highest power in the denominator; terms with ${x} in the denominator go to 0`,
        })
        if (dn < dd) exact = { kind: 'finite', value: 0, exact: num(0) }
        else if (dn === dd) {
          const r = rf.num.lead.div(rf.den.lead)
          exact = { kind: 'finite', value: r.toNumber(), exact: num(r) }
          steps.push({
            title: 'The degrees are equal, so the limit is the ratio of the leading coefficients',
            tex: `\\frac{${toTex(num(rf.num.lead))}}{${toTex(num(rf.den.lead))}} = ${toTex(num(r))}`,
          })
        } else {
          const s = rf.num.lead.div(rf.den.lead).sign() * ((dn - dd) % 2 === 1 ? infSign : 1)
          exact = { kind: 'inf', sign: s > 0 ? 1 : -1 }
          steps.push({ title: 'The numerator has the higher degree, so the expression grows without bound' })
        }
        if (dn < dd) steps.push({ title: 'The denominator has the higher degree, so the fraction goes to 0' })
      } else if (rf.den.eval(numValue(a)).isZero()) {
        steps.push({
          title:
            'After cancelling common factors the denominator is still zero while the numerator is not, so the function grows without bound here. Check each side',
          tex: `${L} ${toTex(f)} = ${L} ${toTex(reduced)}`,
        })
        exact = numeric
      } else {
        const v = rf.num.eval(numValue(a)).div(rf.den.eval(numValue(a)))
        steps.push({
          title: 'Cancel common factors, then substitute',
          tex: `${L} ${toTex(f)} = ${L} ${toTex(reduced)} = ${toTex(num(v))}`,
        })
        exact = { kind: 'finite', value: v.toNumber(), exact: num(v) }
      }
    }
  }

  if (!exact) {
    // L'Hôpital's rule for 0/0 or ∞/∞ quotients.
    let cur = fraction(f)
    for (let round = 1; cur && round <= 4; round++) {
      const nf = compile(cur.top, x)
      const df = compile(cur.bottom, x)
      const at = (g: (v: number) => number) => (atInf ? g(infSign * 1e8) : g(aNum + (side === '-' ? -1e-9 : 1e-9)))
      const nv = at(nf)
      const dv = at(df)
      const zeroZero = Math.abs(nv) < 1e-6 && Math.abs(dv) < 1e-6
      const infInf = Math.abs(nv) > 1e6 && Math.abs(dv) > 1e6
      if (!zeroZero && !infInf) break
      let top: Expr, bottom: Expr
      try {
        top = differentiate(cur.top, x)
        bottom = differentiate(cur.bottom, x)
      } catch {
        break
      }
      steps.push({
        title: `${zeroZero ? '0/0' : '∞/∞'} form: apply L'Hôpital's rule (differentiate the top and bottom separately)`,
        tex: `${L} \\frac{${toTex(cur.top)}}{${toTex(cur.bottom)}} = ${L} \\frac{${toTex(top)}}{${toTex(bottom)}}`,
      })
      const q = simplify(mul(top, pow(bottom, -1)))
      if (!atInf) {
        const direct = safeSubstitute(q, x, a)
        const v = direct ? compile(direct, '_')(0) : NaN
        if (direct && Number.isFinite(v)) {
          steps.push({ title: 'Now substitute directly', tex: `= ${toTex(direct)}` })
          exact = { kind: 'finite', value: v, exact: direct }
          break
        }
      } else {
        const p = polyFromExpr(q, x)
        if (p && p.isConstant()) {
          exact = { kind: 'finite', value: p.coef(0).toNumber(), exact: num(p.coef(0)) }
          steps.push({ title: 'The expression is now constant', tex: `= ${toTex(num(p.coef(0)))}` })
          break
        }
      }
      cur = fraction(q) ?? { top: q, bottom: num(1) }
    }
  }

  let final: LimitValue
  if (exact && (numeric.kind === 'dne' || sameValue(exact, numeric))) final = exact
  else if (exact && !sameValue(exact, numeric)) {
    final = numeric
    notes.push('The symbolic and numerical approaches disagreed; showing the numerical estimate.')
  } else {
    final = numeric
    if (!atInf && side === '' && numeric.kind === 'dne') {
      const l = oneSided(fn_, aNum, -1)
      const r = oneSided(fn_, aNum, 1)
      steps.push({
        title: 'Compare the one-sided limits',
        tex: `${limTex(x, aTex, '-')} = ${valueTex(l)},\\quad ${limTex(x, aTex, '+')} = ${valueTex(r)}`,
      })
      if (l.kind !== 'dne' || r.kind !== 'dne')
        notes.push('The left and right limits differ, so the two-sided limit does not exist.')
    } else {
      steps.push({
        title: 'Evaluate the function closer and closer to the limit point',
        tex: `${L} ${toTex(f)} = ${valueTex(numeric)}`,
      })
      if (numeric.kind === 'finite' && !numeric.exact) notes.push('This value was estimated numerically.')
    }
  }

  return {
    kind: 'limit',
    title: 'Evaluate the limit',
    problemTex: `${L} ${toTex(f)}`,
    answers: [
      {
        tex: `${L} ${toTex(f)} = ${valueTex(final)}`,
        text: textOf(final),
        approx:
          final.kind === 'finite' && final.exact && final.exact.kind !== 'num' ? formatNumber(final.value) : undefined,
      },
    ],
    steps,
    notes,
    plot: simplifyFree(f, x)
      ? {
          variable: x,
          fns: [{ expr: toTextSafe(f), label: `y = ${toTextSafe(f)}` }],
          xRange: atInf ? [-20, 20] : [aNum - 4, aNum + 4],
          points:
            final.kind === 'finite' && !atInf
              ? [{ x: aNum, y: final.value, label: `limit = ${formatNumber(final.value, 6)}` }]
              : [],
        }
      : undefined,
  }
}

function numValue(a: Expr) {
  if (a.kind !== 'num') throw new MathError('limit point must be a number')
  return a.value
}

function sameValue(a: LimitValue, b: LimitValue): boolean {
  if (a.kind === 'finite' && b.kind === 'finite')
    return Math.abs(a.value - b.value) <= 1e-4 * Math.max(1, Math.abs(a.value))
  if (a.kind === 'inf' && b.kind === 'inf') return a.sign === b.sign
  return a.kind === b.kind
}

function textOf(v: LimitValue): string {
  if (v.kind === 'finite') return v.exact ? toTextSafe(v.exact) : formatNumber(v.value)
  if (v.kind === 'inf') return v.sign > 0 ? '∞' : '-∞'
  return 'does not exist'
}

function toTextSafe(e: Expr): string {
  return toText(e)
}

function simplifyFree(e: Expr, x: string): boolean {
  const vs = freeSymbols(e)
  vs.delete(x)
  return vs.size === 0
}
