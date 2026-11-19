import { differentiate } from './diff'
import { type Expr, contains, freeSymbols, isSym, mul, num, pow, substitute, sym } from './expr'
import { identify } from './identify'
import { compile } from './numeric'
import { literalTex } from './arithmetic'
import { type Poly, polyFromExpr, ratFromExpr } from './poly'
import { formatNumber, toPlain, toTex, toText } from './print'
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
  const aSay = toPlain(a)
  /** f with x replaced by the limit point, written out before working it out. */
  const putIn = (g: Expr) => {
    const raw = substitute(g, x, a)
    return literalTex(raw, { stack: true }) ?? toTex(raw)
  }

  if (!atInf) {
    const direct = safeSubstitute(f, x, a)
    const dv = direct ? compile(direct, '_')(0) : NaN
    if (
      direct &&
      Number.isFinite(dv) &&
      numeric.kind === 'finite' &&
      Math.abs(dv - numeric.value) < 1e-5 * Math.max(1, Math.abs(dv))
    ) {
      const shown = putIn(f)
      steps.push({
        title: `Try putting ${x} = ${aSay} straight into the function. It gives an ordinary number, so that number is the limit`,
        tex: `${L} ${toTex(f)} = ${shown === toTex(direct) ? '' : `${shown} = `}${toTex(direct)}`,
      })
      exact = { kind: 'finite', value: dv, exact: direct }
    } else {
      // Say why putting the number in doesn't work.
      const fr = fraction(f)
      const top = fr && safeSubstitute(fr.top, x, a)
      const bottom = fr && safeSubstitute(fr.bottom, x, a)
      if (fr && top && bottom) {
        const tv = compile(top, '_')(0)
        const bv = compile(bottom, '_')(0)
        const frac = `\\frac{${putIn(fr.top)}}{${putIn(fr.bottom)}}`
        if (Math.abs(bv) < 1e-12 && Math.abs(tv) < 1e-12)
          steps.push({
            title: `Try putting ${x} = ${aSay} straight in. The top and the bottom both become 0, and 0/0 doesn't tell us the answer. We need another way`,
            tex: `${frac} = \\frac{0}{0}`,
          })
        else if (Math.abs(bv) < 1e-12 && Number.isFinite(tv)) {
          const end = `\\frac{${toTex(top)}}{0}`
          steps.push({
            title: `Try putting ${x} = ${aSay} straight in. The bottom becomes 0 but the top doesn't. Dividing by a number very close to 0 gives a huge number`,
            tex: frac === end ? frac : `${frac} = ${end}`,
          })
        }
      }
    }
  }

  if (!exact) {
    // Rational functions: cancel common factors (finite a) or compare degrees (a = ±∞).
    const rf = ratFromExpr(f, x)
    const fr = fraction(f)
    if (rf && fr) {
      const reduced = simplify(mul(rf.num.toExpr(x), pow(rf.den.toExpr(x), -1)))
      if (atInf) {
        const dn = rf.num.degree
        const dd = rf.den.degree
        const X = sym(x)
        const xd = toPlain(simplify(pow(X, dd)))
        const divided = (p: Poly) =>
          p.c
            .map((c, i) => (c.isZero() ? null : simplify(mul(num(c), pow(X, i - dd)))))
            .filter((t): t is Expr => t !== null)
            .reverse()
        const sumTex = (ts: Expr[]) => (ts.length ? toTex(ts.length === 1 ? ts[0] : { kind: 'add', terms: ts }) : '0')
        // Use the fraction as written (not rescaled), so the numbers match what was typed.
        const P0 = polyFromExpr(fr.top, x) ?? rf.num
        const Q0 = polyFromExpr(fr.bottom, x) ?? rf.den
        const topTerms = divided(P0)
        const botTerms = divided(Q0)
        if (dd > 0) {
          steps.push({
            title: `The highest power of ${x} on the bottom is ${xd}. Divide every term on the top and the bottom by ${xd}`,
            tex: `${L} \\frac{${sumTex(topTerms)}}{${sumTex(botTerms)}}`,
          })
          const vanish = (ts: Expr[]) => ts.map((t) => (contains(t, x) && polyFromExpr(t, x) === null ? num(0) : t))
          if (dn <= dd)
            steps.push({
              title: `As ${x} gets huge, a number divided by a power of ${x} gets closer and closer to 0. So those terms become 0`,
              tex: `\\frac{${sumTex(vanish(topTerms))}}{${sumTex(vanish(botTerms))}}`,
            })
        }
        if (dn < dd) {
          exact = { kind: 'finite', value: 0, exact: num(0) }
          steps.push({
            title: 'The top goes to 0 and the bottom does not, so the fraction goes to 0',
            tex: `${L} ${toTex(f)} = 0`,
          })
        } else if (dn === dd) {
          const r = rf.num.lead.div(rf.den.lead)
          exact = { kind: 'finite', value: r.toNumber(), exact: num(r) }
          const ratio = `\\frac{${toTex(num(P0.lead))}}{${toTex(num(Q0.lead))}}`
          steps.push({
            title: 'What is left is the number in front of the highest power on top, divided by the one on the bottom',
            tex: `${L} ${toTex(f)} = ${ratio === toTex(num(r)) ? '' : `${ratio} = `}${toTex(num(r))}`,
          })
        } else {
          const sgn = rf.num.lead.div(rf.den.lead).sign() * ((dn - dd) % 2 === 1 ? infSign : 1)
          exact = { kind: 'inf', sign: sgn > 0 ? 1 : -1 }
          steps.push({
            title: `The top still has ${x} in it after dividing, so it keeps growing while the bottom settles down. The fraction grows without limit`,
            tex: `${L} ${toTex(f)} = ${sgn > 0 ? '\\infty' : '-\\infty'}`,
          })
        }
      } else {
        const P = polyFromExpr(fr.top, x)
        const Q = polyFromExpr(fr.bottom, x)
        const g = P && Q ? P.gcd(Q) : null
        if (P && Q && g && g.degree >= 1) {
          steps.push({
            title: `Factor the top and the bottom. They share the factor (${toPlain(g.toExpr(x))})`,
            tex: `${L} \\frac{${factorPair(g, P.divmod(g).q, x)}}{${factorPair(g, Q.divmod(g).q, x)}}`,
          })
          steps.push({
            title: `Cancel (${toPlain(g.toExpr(x))}) from the top and the bottom. That is allowed because ${x} only gets close to ${aSay}, it is never exactly ${aSay}`,
            tex: `${L} ${toTex(reduced)}`,
          })
        }
        if (rf.den.eval(numValue(a)).isZero()) {
          const l = oneSided(fn_, aNum, -1)
          const r = oneSided(fn_, aNum, 1)
          if (side === '')
            steps.push({
              title: `So near ${x} = ${aSay} the function shoots off towards ∞ or −∞. Check which way it goes on each side`,
              tex: `${limTex(x, aTex, '-')} ${toTex(f)} = ${valueTex(l)},\\quad ${limTex(x, aTex, '+')} ${toTex(f)} = ${valueTex(r)}`,
            })
          else {
            const one = side === '+' ? r : l
            steps.push({
              title: `Coming from the ${side === '+' ? 'right' : 'left'}, ${x} is just ${side === '+' ? 'above' : 'below'} ${aSay}. The function shoots off towards ${valueTex(one) === '\\infty' ? '∞' : '−∞'} there`,
              tex: `${L} ${toTex(f)} = ${valueTex(one)}`,
            })
          }
          if (side === '') {
            const both = combine(l, r)
            steps.push({
              title:
                both.kind === 'dne'
                  ? 'The two sides go in different directions, so the limit does not exist'
                  : 'Both sides go the same way, so that is the limit',
            })
          }
          exact = numeric
        } else {
          const v = rf.num.eval(numValue(a)).div(rf.den.eval(numValue(a)))
          const shown = putIn(reduced)
          steps.push({
            title: `Now put ${x} = ${aSay} in`,
            tex: `${L} ${toTex(reduced)} = ${shown === toTex(num(v)) ? '' : `${shown} = `}${toTex(num(v))}`,
          })
          exact = { kind: 'finite', value: v.toNumber(), exact: num(v) }
        }
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
      const form = zeroZero ? '0/0' : '∞/∞'
      steps.push({
        title:
          round === 1
            ? `This is a ${form} form, so use L'Hôpital's rule: take the derivative of the top and of the bottom separately, then try again`
            : `It is still ${form}, so use L'Hôpital's rule again`,
        tex: `${L} \\frac{${toTex(cur.top)}}{${toTex(cur.bottom)}} = ${L} \\frac{\\frac{d}{d${x}}\\left[${toTex(cur.top)}\\right]}{\\frac{d}{d${x}}\\left[${toTex(cur.bottom)}\\right]}`,
      })
      steps.push({
        title: 'The derivative of the top',
        tex: `\\frac{d}{d${x}}\\left[${toTex(cur.top)}\\right] = ${toTex(top)}`,
      })
      steps.push({
        title: 'The derivative of the bottom',
        tex: `\\frac{d}{d${x}}\\left[${toTex(cur.bottom)}\\right] = ${toTex(bottom)}`,
      })
      const q = simplify(mul(top, pow(bottom, -1)))
      if (!atInf) {
        const direct = safeSubstitute(q, x, a)
        const v = direct ? compile(direct, '_')(0) : NaN
        if (direct && Number.isFinite(v)) {
          steps.push({
            title: `Now put ${x} = ${aSay} into the new fraction`,
            tex: `${L} \\frac{${toTex(top)}}{${toTex(bottom)}} = \\frac{${putIn(top)}}{${putIn(bottom)}} = ${toTex(direct)}`,
          })
          exact = { kind: 'finite', value: v, exact: direct }
          break
        }
      } else {
        const p = polyFromExpr(q, x)
        if (p && p.isConstant()) {
          exact = { kind: 'finite', value: p.coef(0).toNumber(), exact: num(p.coef(0)) }
          steps.push({
            title: `The ${x}'s are gone and a plain number is left. That is the limit`,
            tex: `= ${toTex(num(p.coef(0)))}`,
          })
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
        title: `Look at each side of ${x} = ${aSay}: coming from the left and coming from the right`,
        tex: `${limTex(x, aTex, '-')} = ${valueTex(l)},\\quad ${limTex(x, aTex, '+')} = ${valueTex(r)}`,
      })
      if (l.kind !== 'dne' || r.kind !== 'dne')
        notes.push('The left and right limits differ, so the two-sided limit does not exist.')
    } else {
      steps.push({
        title: `There is no exact method here, so work out the function for values of ${x} closer and closer to ${atInf ? (infSign > 0 ? '∞' : '−∞') : aSay}, and watch where the answers head`,
        tex: `${L} ${toTex(f)} = ${valueTex(numeric)}`,
        substeps: valueTable(fn_, x, atInf ? infSign * Infinity : aNum, side),
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

/** A few values of the function as x gets closer to the point, to show the trend. */
function valueTable(f: (v: number) => number, x: string, a: number, side: '' | '+' | '-'): Step[] {
  const dir = side === '-' ? -1 : 1
  const xs = Number.isFinite(a)
    ? [0.1, 0.01, 0.001, 0.0001].map((h) => a + dir * h)
    : [10, 100, 1000, 10000].map((k) => Math.sign(a) * k)
  return xs
    .map((v) => ({ v, y: f(v) }))
    .filter(({ y }) => Number.isFinite(y))
    .map(({ v, y }) => ({
      title: `${x} = ${formatNumber(v, 6)}`,
      tex: `f(${formatNumber(v, 6)}) \\approx ${formatNumber(y, 8)}`,
    }))
}

/** "(x − 2)(x + 2)" with the shared factor first. */
function factorPair(g: Poly, rest: Poly, x: string): string {
  const multi = (p: Poly) => p.c.filter((c) => !c.isZero()).length > 1
  const gt = toTex(g.toExpr(x))
  const gw = multi(g) ? `\\left(${gt}\\right)` : gt
  if (rest.isConstant()) {
    const c = rest.coef(0)
    return c.isOne() ? gt : `${toTex(num(c))}${gw}`
  }
  const rt = toTex(rest.toExpr(x))
  return `${gw}${multi(rest) ? `\\left(${rt}\\right)` : rt}`
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
