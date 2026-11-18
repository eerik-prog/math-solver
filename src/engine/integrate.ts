import { differentiate } from './diff'
import {
  type Expr,
  type Fn,
  ONE,
  add,
  contains,
  div,
  fn,
  freeSymbols,
  isSym,
  key,
  mul,
  neg,
  num,
  pow,
  replaceSubexpr,
  size,
  sqrt,
  sub,
  substitute,
  sym,
} from './expr'
import { solveLinear } from './linalg'
import { numericallyEqual } from './numeric'
import { Poly, factorPoly, polyFromExpr, ratFromExpr } from './poly'
import { toTex, toText as textOf } from './print'
import { Rational } from './rational'
import { expand, simplest, simplify } from './simplify'
import type { Step } from './types'

const MAX_DEPTH = 6

function intTex(e: Expr, x: string): string {
  const t = toTex(e)
  return e.kind === 'add' ? `\\int \\left(${t}\\right)\\,d${x}` : `\\int ${t}\\,d${x}`
}

/** Finds an antiderivative with steps, verified by differentiating it back. */
export function antiderivative(e: Expr, x: string): { F: Expr; steps: Step[] } | null {
  const steps: Step[] = []
  const target = simplify(e)
  const F = integ(target, x, steps, 0)
  if (!F) return null
  const nice = simplest(F)
  let check: Expr
  try {
    check = differentiate(nice, x)
  } catch {
    return null
  }
  if (!numericallyEqual(check, target, x)) return null
  return { F: nice, steps }
}

function linear(u: Expr, x: string): { a: Rational; b: Rational } | null {
  const p = polyFromExpr(u, x)
  if (!p || p.degree !== 1) return null
  return { a: p.coef(1), b: p.coef(0) }
}

function integ(e: Expr, x: string, steps: Step[], depth: number): Expr | null {
  if (depth > MAX_DEPTH) return null
  e = simplify(e)
  const lhs = intTex(e, x)
  const X = sym(x)

  if (!contains(e, x)) {
    const F = simplify(mul(e, X))
    steps.push({ title: 'The integral of a constant c is c·' + x, tex: `${lhs} = ${toTex(F)}` })
    return F
  }

  // Polynomials: power rule term by term.
  const p = polyFromExpr(e, x)
  if (p && e.kind !== 'mul' && e.kind !== 'pow') {
    const F = new Poly([Rational.ZERO, ...p.c.map((c, i) => c.div(Rational.of(i + 1)))]).toExpr(x)
    steps.push({
      title: `Power rule: ∫${x}ⁿ d${x} = ${x}ⁿ⁺¹/(n+1)` + (e.kind === 'add' ? ', term by term' : ''),
      tex: `${lhs} = ${toTex(F)}`,
    })
    return F
  }

  if (e.kind === 'add') {
    const sub: Step[] = []
    const parts: Expr[] = []
    for (const t of e.terms) {
      const r = integ(t, x, sub, depth + 1)
      if (!r) {
        parts.length = 0
        break
      }
      parts.push(r)
    }
    if (parts.length === e.terms.length) {
      const F = simplify(add(...parts))
      steps.push({
        title: 'Sum rule: integrate each term separately',
        tex: `${lhs} = ${e.terms.map((t) => intTex(t, x)).join(' + ')} = ${toTex(F)}`,
        substeps: sub,
      })
      return F
    }
  }

  if (e.kind === 'mul') {
    const consts = e.factors.filter((f) => !contains(f, x))
    if (consts.length > 0) {
      const c = simplify(mul(...consts))
      const rest = simplify(mul(...e.factors.filter((f) => contains(f, x))))
      const sub: Step[] = []
      const r = integ(rest, x, sub, depth + 1)
      if (r) {
        const F = simplify(mul(c, r))
        steps.push({
          title: 'Constant multiple rule: move the constant outside the integral',
          tex: `${lhs} = ${toTex(c)} ${intTex(rest, x)} = ${toTex(F)}`,
          substeps: sub,
        })
        return F
      }
      return null
    }
  }

  const table = tableIntegral(e, x)
  if (table) {
    steps.push({ title: table.rule, tex: `${lhs} = ${toTex(table.F)}` })
    return table.F
  }

  const rational = integrateRational(e, x, depth)
  if (rational) {
    steps.push(...rational.steps)
    return rational.F
  }

  const usub = uSubstitution(e, x, depth)
  if (usub) {
    steps.push(...usub.steps)
    return usub.F
  }

  const parts = byParts(e, x, depth)
  if (parts) {
    steps.push(...parts.steps)
    return parts.F
  }

  try {
    const ex = expand(e)
    if (key(ex) !== key(e) && size(ex) < 4 * size(e) + 20) {
      const sub: Step[] = []
      const F = integ(ex, x, sub, depth + 1)
      if (F) {
        steps.push({ title: 'Expand the integrand first', tex: `${lhs} = ${intTex(ex, x)}`, substeps: sub })
        return F
      }
    }
  } catch {
    /* too large to expand */
  }
  return null
}

// ---------------------------------------------------------------------------
// Table of standard integrals with a linear inner function u = a·x + b

function tableIntegral(e: Expr, x: string): { F: Expr; rule: string } | null {
  const X = sym(x)
  const over = (lin: { a: Rational }, F: Expr) => simplify(mul(num(lin.a.inv()), F))
  const chainNote = (lin: { a: Rational; b: Rational }) =>
    lin.a.isOne() && lin.b.isZero() ? '' : ` (the inner function is linear, so divide by its slope ${lin.a.toString()})`

  if (e.kind === 'sym') {
    return { F: simplify(div(pow(X, 2), num(2))), rule: 'Power rule' }
  }

  if (e.kind === 'pow') {
    const { base, exp } = e
    // (ax+b)^n
    if (!contains(exp, x)) {
      const lin = linear(base, x)
      if (lin) {
        if (exp.kind === 'num' && exp.value.eq(Rational.MINUS_ONE)) {
          return {
            F: over(lin, fn('ln', fn('abs', base))),
            rule: `∫ 1/u du = ln|u|${chainNote(lin)}`,
          }
        }
        const n1 = simplify(add(exp, ONE))
        return {
          F: over(lin, div(pow(base, n1), n1)),
          rule: `Power rule: ∫uⁿ du = uⁿ⁺¹/(n+1)${chainNote(lin)}`,
        }
      }
      // trig squares
      if (exp.kind === 'num' && exp.value.eq(Rational.of(2)) && base.kind === 'fn') {
        const u = base.args[0]
        const l = linear(u, x)
        if (l) {
          switch (base.name) {
            case 'sec':
              return { F: over(l, fn('tan', u)), rule: '∫sec²(u) du = tan(u)' }
            case 'csc':
              return { F: over(l, neg(fn('cot', u))), rule: '∫csc²(u) du = −cot(u)' }
            case 'sin':
              return {
                F: simplify(sub(div(X, num(2)), over(l, div(fn('sin', mul(num(2), u)), num(4))))),
                rule: 'Use the identity sin²(u) = (1 − cos 2u)/2',
              }
            case 'cos':
              return {
                F: simplify(add(div(X, num(2)), over(l, div(fn('sin', mul(num(2), u)), num(4))))),
                rule: 'Use the identity cos²(u) = (1 + cos 2u)/2',
              }
            case 'tan':
              return { F: simplify(sub(over(l, fn('tan', u)), X)), rule: 'Use the identity tan²(u) = sec²(u) − 1' }
          }
        }
      }
      // 1/sqrt(r + p x^2)
      if (exp.kind === 'num' && exp.value.eq(Rational.of(-1, 2))) {
        const q = polyFromExpr(base, x)
        if (q && q.degree === 2 && q.coef(1).isZero()) {
          const pc = q.coef(2)
          const r = q.coef(0)
          if (pc.sign() < 0 && r.sign() > 0) {
            const k = simplify(sqrt(num(pc.neg())))
            return {
              F: simplify(div(fn('asin', mul(X, sqrt(num(pc.neg().div(r))))), k)),
              rule: '∫ 1/√(a² − u²) du = arcsin(u/a)',
            }
          }
          if (pc.sign() > 0) {
            const k = simplify(sqrt(num(pc)))
            return {
              F: simplify(div(fn('ln', fn('abs', add(mul(k, X), sqrt(base)))), k)),
              rule: '∫ 1/√(u² + a²) du = ln|u + √(u² + a²)|',
            }
          }
        }
      }
    }
    // c^(ax+b)
    if (!contains(base, x)) {
      const lin = linear(exp, x)
      if (lin) {
        if (isSym(base, 'e')) return { F: over(lin, e), rule: `∫eᵘ du = eᵘ${chainNote(lin)}` }
        return {
          F: over(lin, div(e, fn('ln', base))),
          rule: `∫aᵘ du = aᵘ / ln(a)${chainNote(lin)}`,
        }
      }
    }
  }

  if (e.kind === 'fn' && e.args.length >= 1) {
    const u = e.args[0]
    const lin = linear(u, x)
    if (!lin) return null
    const n = chainNote(lin)
    const lnAbs = (v: Expr) => fn('ln', fn('abs', v))
    switch (e.name) {
      case 'sin':
        return { F: over(lin, neg(fn('cos', u))), rule: `∫sin(u) du = −cos(u)${n}` }
      case 'cos':
        return { F: over(lin, fn('sin', u)), rule: `∫cos(u) du = sin(u)${n}` }
      case 'tan':
        return { F: over(lin, neg(lnAbs(fn('cos', u)))), rule: `∫tan(u) du = −ln|cos(u)|${n}` }
      case 'cot':
        return { F: over(lin, lnAbs(fn('sin', u))), rule: `∫cot(u) du = ln|sin(u)|${n}` }
      case 'sec':
        return { F: over(lin, lnAbs(add(fn('sec', u), fn('tan', u)))), rule: `∫sec(u) du = ln|sec(u) + tan(u)|${n}` }
      case 'csc':
        return { F: over(lin, neg(lnAbs(add(fn('csc', u), fn('cot', u))))), rule: `∫csc(u) du = −ln|csc(u) + cot(u)|${n}` }
      case 'sinh':
        return { F: over(lin, fn('cosh', u)), rule: `∫sinh(u) du = cosh(u)${n}` }
      case 'cosh':
        return { F: over(lin, fn('sinh', u)), rule: `∫cosh(u) du = sinh(u)${n}` }
      case 'tanh':
        return { F: over(lin, fn('ln', fn('cosh', u))), rule: `∫tanh(u) du = ln(cosh(u))${n}` }
      case 'ln':
        return { F: over(lin, sub(mul(u, fn('ln', u)), u)), rule: `∫ln(u) du = u·ln(u) − u (integration by parts)${n}` }
      case 'log':
        if (contains(e.args[1], x)) return null
        return {
          F: over(lin, div(sub(mul(u, fn('ln', u)), u), fn('ln', e.args[1]))),
          rule: `∫log_b(u) du = (u·ln(u) − u)/ln(b)${n}`,
        }
      case 'asin':
        return {
          F: over(lin, add(mul(u, fn('asin', u)), sqrt(sub(ONE, pow(u, 2))))),
          rule: `∫arcsin(u) du = u·arcsin(u) + √(1 − u²)${n}`,
        }
      case 'acos':
        return {
          F: over(lin, sub(mul(u, fn('acos', u)), sqrt(sub(ONE, pow(u, 2))))),
          rule: `∫arccos(u) du = u·arccos(u) − √(1 − u²)${n}`,
        }
      case 'atan':
        return {
          F: over(lin, sub(mul(u, fn('atan', u)), div(fn('ln', add(ONE, pow(u, 2))), num(2)))),
          rule: `∫arctan(u) du = u·arctan(u) − ln(1 + u²)/2${n}`,
        }
      case 'abs':
        return { F: over(lin, div(mul(u, fn('abs', u)), num(2))), rule: `∫|u| du = u·|u|/2${n}` }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Rational functions: long division + partial fractions

function integrateRational(e: Expr, x: string, depth: number): { F: Expr; steps: Step[] } | null {
  const rf = ratFromExpr(e, x)
  if (!rf || rf.den.isConstant()) return null
  const steps: Step[] = []
  const X = sym(x)
  let { num: N } = rf
  const { den: Dn } = rf
  const terms: Expr[] = []
  const pieces: Expr[] = []
  if (N.degree >= Dn.degree) {
    const { q, r } = N.divmod(Dn)
    N = r
    const Qe = q.toExpr(x)
    pieces.push(Qe)
    steps.push({
      title: 'The numerator has a degree at least that of the denominator, so divide the polynomials first',
      tex: `\\frac{${toTex(rf.num.toExpr(x))}}{${toTex(Dn.toExpr(x))}} = ${toTex(Qe)} + \\frac{${toTex(r.toExpr(x))}}{${toTex(Dn.toExpr(x))}}`,
    })
    const F = new Poly([Rational.ZERO, ...q.c.map((c, i) => c.div(Rational.of(i + 1)))]).toExpr(x)
    terms.push(F)
  }
  if (!N.isZero()) {
    const { content, factors } = factorPoly(Dn)
    if (factors.some((f) => f.poly.degree > 2 || (f.poly.degree === 2 && f.mult > 1))) return null
    const target = N.scale(content.inv())
    let Dp = Poly.constant(1)
    for (const f of factors) Dp = Dp.mul(f.poly.pow(f.mult))
    const basis: Poly[] = []
    const shape: Array<{ factor: Poly; power: number; linearNumerator: boolean }> = []
    for (const f of factors) {
      if (f.poly.degree === 1) {
        for (let k = 1; k <= f.mult; k++) {
          basis.push(Dp.divmod(f.poly.pow(k)).q)
          shape.push({ factor: f.poly, power: k, linearNumerator: false })
        }
      } else {
        const rest = Dp.divmod(f.poly).q
        basis.push(rest.mul(Poly.x()), rest)
        shape.push({ factor: f.poly, power: 1, linearNumerator: true })
      }
    }
    const n = basis.length
    if (n !== Dp.degree) return null
    const A = Array.from({ length: n }, (_, row) => basis.map((b) => b.coef(row)))
    const sol = solveLinear(A, Array.from({ length: n }, (_, row) => target.coef(row)))
    if (!sol) return null
    let idx = 0
    const decomposition: Expr[] = []
    const sub: Step[] = []
    for (const s of shape) {
      const fx = s.factor.toExpr(x)
      if (!s.linearNumerator) {
        const A0 = sol[idx++]
        if (A0.isZero()) continue
        const termE = simplify(div(num(A0), pow(fx, s.power)))
        decomposition.push(termE)
        const p = s.factor.coef(1)
        const F =
          s.power === 1
            ? simplify(mul(num(A0.div(p)), fn('ln', fn('abs', fx))))
            : simplify(mul(num(A0.div(p.mul(Rational.of(1 - s.power)))), pow(fx, 1 - s.power)))
        sub.push({ title: s.power === 1 ? '∫ A/(px + q) dx = (A/p)·ln|px + q|' : 'Power rule with u = px + q', tex: `${intTex(termE, x)} = ${toTex(F)}` })
        terms.push(F)
      } else {
        const B = sol[idx++]
        const C = sol[idx++]
        const [c0, b0, a0] = [s.factor.coef(0), s.factor.coef(1), s.factor.coef(2)]
        const termE = simplify(div(add(mul(num(B), X), num(C)), fx))
        decomposition.push(termE)
        // (Bx + C) = (B/2a)(2ax + b) + (C − Bb/2a)
        const k1 = B.div(a0.mul(Rational.of(2)))
        const k2 = C.sub(k1.mul(b0))
        const disc = a0.mul(c0).mul(Rational.of(4)).sub(b0.mul(b0)) // > 0 for irreducible
        const root = simplify(sqrt(num(disc)))
        const lnPart = simplify(mul(num(k1), fn('ln', a0.sign() > 0 ? fx : fn('abs', fx))))
        const atanPart = simplify(
          mul(num(k2.mul(Rational.of(2))), pow(root, -1), fn('atan', div(add(mul(num(a0.mul(Rational.of(2))), X), num(b0)), root))),
        )
        const F = simplify(add(lnPart, atanPart))
        sub.push({
          title: 'Split into a logarithm part (numerator ∝ derivative of the denominator) and an arctangent part',
          tex: `${intTex(termE, x)} = ${toTex(F)}`,
        })
        terms.push(F)
      }
    }
    if (decomposition.length > 1 || factors.length > 1 || factors[0]?.mult > 1) {
      steps.push({
        title: 'Factor the denominator and split into partial fractions',
        tex: `\\frac{${toTex(N.toExpr(x))}}{${toTex(Dn.toExpr(x))}} = ${decomposition.map(toTex).join(' + ').replace(/\+ -/g, '- ')}`,
      })
    }
    steps.push({ title: 'Integrate each fraction', substeps: sub, tex: undefined })
  } else if (pieces.length) {
    steps.push({ title: 'Integrate the polynomial with the power rule' })
  }
  void depth
  const F = simplify(add(...terms))
  return { F, steps }
}

// ---------------------------------------------------------------------------
// u-substitution: look for a factor that is (a constant multiple of) g′(x)

function subexpressions(e: Expr, x: string, out: Map<string, Expr>): Map<string, Expr> {
  if (!contains(e, x) || isSym(e, x)) return out
  out.set(key(e), e)
  const kids = e.kind === 'add' ? e.terms : e.kind === 'mul' ? e.factors : e.kind === 'pow' ? [e.base, e.exp] : e.kind === 'fn' ? e.args : []
  for (const k of kids) subexpressions(k, x, out)
  return out
}

function freshVar(e: Expr, x: string): string {
  const used = freeSymbols(e)
  return ['u', 't', 'w', 'v'].find((n) => n !== x && !used.has(n)) ?? 'u'
}

function uSubstitution(e: Expr, x: string, depth: number): { F: Expr; steps: Step[] } | null {
  const candidates = [...subexpressions(e, x, new Map()).values()]
    .filter((g) => key(g) !== key(e) && !linear(g, x))
    .sort((a, b) => size(b) - size(a))
  const u = freshVar(e, x)
  const U = sym(u)
  for (const g of candidates) {
    let dg: Expr
    try {
      dg = differentiate(g, x)
    } catch {
      continue
    }
    if (dg.kind === 'num' && dg.value.isZero()) continue
    let inner: Expr
    try {
      inner = simplify(replaceSubexpr(simplify(div(e, dg)), g, U))
    } catch {
      continue
    }
    if (contains(inner, x)) {
      // g = x^n: replace leftover x^k terms, e.g. x^3 / (x^4 + 1)
      continue
    }
    const sub: Step[] = []
    const Fu = integ(inner, u, sub, depth + 1)
    if (!Fu) continue
    const F = simplify(substitute(Fu, u, g))
    return {
      F,
      steps: [
        {
          title: `Substitute ${u} = ${textOf(g)}, so d${u} = (${textOf(dg)}) d${x}`,
          tex: `${intTex(e, x)} = ${intTex(inner, u)}`,
        },
        { title: `Integrate with respect to ${u}`, tex: `${intTex(inner, u)} = ${toTex(Fu)}`, substeps: sub },
        { title: `Substitute back ${u} = ${textOf(g)}`, tex: `${toTex(F)}` },
      ],
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Integration by parts

const TABULAR_FNS = new Set(['sin', 'cos', 'sinh', 'cosh'])

function byParts(e: Expr, x: string, depth: number): { F: Expr; steps: Step[] } | null {
  if (e.kind !== 'mul' && !(e.kind === 'fn' && (e.name === 'ln' || e.name === 'atan' || e.name === 'log'))) return null
  const factors = e.kind === 'mul' ? e.factors : [e]
  const X = sym(x)
  // Split into polynomial part P and one transcendental factor T.
  const polyFactors: Expr[] = []
  const others: Expr[] = []
  for (const f of factors) (polyFromExpr(f, x) ? polyFactors : others).push(f)
  if (others.length === 1) {
    const T = others[0]
    const P = polyFromExpr(simplify(mul(...polyFactors)), x) ?? Poly.constant(1)
    const isTabular =
      (T.kind === 'fn' && TABULAR_FNS.has(T.name) && linear(T.args[0], x)) ||
      (T.kind === 'pow' && !contains(T.base, x) && linear(T.exp, x))
    if (isTabular && P.degree >= 1) {
      // ∫P·T = P·T₁ − P′·T₂ + P″·T₃ − …
      const ints: Expr[] = []
      let cur: Expr = T
      for (let k = 0; k <= P.degree; k++) {
        const t = integ(cur, x, [], depth + 1)
        if (!t) return null
        cur = simplify(t)
        ints.push(cur)
      }
      let deriv = P
      const terms: Expr[] = []
      const sub: Step[] = []
      for (let k = 0; k <= P.degree; k++) {
        const sign = k % 2 === 0 ? 1 : -1
        terms.push(simplify(mul(num(sign), deriv.toExpr(x), ints[k])))
        sub.push({
          title: `${k === 0 ? 'u' : 'u' + '′'.repeat(k)} = ${textOf(deriv.toExpr(x))}, ${'∫'.repeat(k + 1)}dv = ${textOf(ints[k])}`,
        })
        deriv = deriv.derivative()
      }
      const F = simplify(add(...terms))
      return {
        F,
        steps: [
          {
            title: `Integration by parts (∫u dv = uv − ∫v du) with u = ${textOf(P.toExpr(x))} and dv = ${textOf(T)} d${x}, repeated until u′ = 0`,
            tex: `${intTex(e, x)} = ${toTex(F)}`,
            substeps: sub,
          },
        ],
      }
    }
    // ∫P·ln(g), ∫P·atan(g): u = T, dv = P dx
    if (T.kind === 'fn' && (T.name === 'ln' || T.name === 'atan' || T.name === 'log')) {
      const V = new Poly([Rational.ZERO, ...P.c.map((c, i) => c.div(Rational.of(i + 1)))]).toExpr(x)
      const dT = differentiate(T, x)
      const rest = simplify(mul(V, dT))
      const sub: Step[] = []
      const R = integ(rest, x, sub, depth + 1)
      if (!R) return null
      const F = simplify(sub2(mul(V, T), R))
      return {
        F,
        steps: [
          {
            title: `Integration by parts with u = ${textOf(T)} and dv = ${textOf(P.toExpr(x))} d${x}, so du = ${textOf(dT)} d${x} and v = ${textOf(V)}`,
            tex: `${intTex(e, x)} = ${toTex(simplify(mul(V, T)))} - ${intTex(rest, x)}`,
          },
          { title: 'Evaluate the remaining integral', tex: `${intTex(rest, x)} = ${toTex(R)}`, substeps: sub },
          { title: 'Combine', tex: toTex(F) },
        ],
      }
    }
  }
  // e^(ax) · sin(bx) / cos(bx)
  if (others.length === 2 && polyFactors.length <= 1) {
    const c0 = polyFactors.length ? polyFromExpr(polyFactors[0], x) : Poly.constant(1)
    if (!c0 || c0.degree > 0) return null
    const expF = others.find((f) => f.kind === 'pow' && isSym(f.base, 'e') && linear(f.exp, x))
    const trig = others.find((f): f is Fn => f.kind === 'fn' && (f.name === 'sin' || f.name === 'cos') && !!linear(f.args[0], x))
    if (expF && trig && expF.kind === 'pow') {
      const la = linear(expF.exp, x)!
      const lb = linear(trig.args[0], x)!
      if (!la.b.isZero() || !lb.b.isZero()) return null
      const a = num(la.a)
      const b = num(lb.a)
      const den = simplify(add(pow(a, 2), pow(b, 2)))
      const s = fn('sin', trig.args[0])
      const c = fn('cos', trig.args[0])
      const inner = trig.name === 'sin' ? sub(mul(a, s), mul(b, c)) : add(mul(a, c), mul(b, s))
      const F = simplify(mul(c0.coef(0).isZero() ? ONE : num(c0.coef(0)), expF, inner, pow(den, -1)))
      return {
        F,
        steps: [
          {
            title: 'Integrate by parts twice; the original integral reappears, so solve for it',
            tex: `${intTex(e, x)} = ${toTex(F)}`,
          },
        ],
      }
    }
  }
  void X
  return null
}

function sub2(a: Expr, b: Expr): Expr {
  return add(a, neg(b))
}

