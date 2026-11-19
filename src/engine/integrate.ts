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
import { toPlain, toTex } from './print'
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

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

/** One step for a part: its own explanation when it is a single step, else a summary with details inside. */
function partStep(label: string, part: Expr, x: string, F: Expr, work: Step[]): Step {
  if (work.length === 1 && !work[0].substeps?.length)
    return {
      title: label.startsWith('For ') ? `${label}: ${lowerFirst(work[0].title)}` : `${label}. ${work[0].title}`,
      tex: work[0].tex,
    }
  return { title: label, tex: `${intTex(part, x)} = ${toTex(F)}`, substeps: work.length ? work : undefined }
}

const keepText = (c: Expr) =>
  c.kind === 'num' && c.value.eq(Rational.MINUS_ONE)
    ? 'Keep the minus sign in front'
    : `Keep the ${toPlain(c)} in front`

/** c·xⁿ with n ≠ −1: one power-rule step. */
function monomialIntegral(e: Expr, x: string, steps: Step[]): Expr | null {
  const X = sym(x)
  let c: Expr = ONE
  let n: Expr | null = null
  if (isSym(e, x)) n = ONE
  else if (e.kind === 'pow' && isSym(e.base, x) && !contains(e.exp, x)) n = e.exp
  else if (e.kind === 'mul') {
    const vars = e.factors.filter((f) => contains(f, x))
    if (vars.length === 1) {
      const v = vars[0]
      if (isSym(v, x)) n = ONE
      else if (v.kind === 'pow' && isSym(v.base, x) && !contains(v.exp, x)) n = v.exp
      if (n) c = simplify(mul(...e.factors.filter((f) => f !== v)))
    }
  }
  if (!n) return null
  if (n.kind === 'num' && n.value.eq(Rational.MINUS_ONE)) return null
  const n1 = simplify(add(n, ONE))
  const F = simplify(mul(c, div(pow(X, n1), n1)))
  const plainC = c.kind === 'num' && c.value.isOne()
  const asPower =
    n.kind === 'num' && (!n.value.isInteger() || n.value.sign() < 0)
      ? `Write ${toPlain(simplify(pow(X, n)))} as a power: ${x}^${n.value.isInteger() ? n.value.toString() : `(${n.value.toString()})`}. `
      : ''
  const rule = 'Power rule: add 1 to the power, then divide by the new power'
  const nTex = n.kind === 'num' && n.value.sign() < 0 ? `\\left(${toTex(n)}\\right)` : toTex(n)
  steps.push({
    title: plainC ? `${asPower}${rule}` : `${keepText(c)}. ${asPower}${rule}`,
    tex: `${intTex(e, x)} = ${plainC ? '' : `${toTex(c)} \\cdot `}\\frac{${x}^{${nTex} + 1}}{${nTex} + 1} = ${toTex(F)}`,
  })
  return F
}

function integ(e: Expr, x: string, steps: Step[], depth: number): Expr | null {
  if (depth > MAX_DEPTH) return null
  e = simplify(e)
  const lhs = intTex(e, x)
  const X = sym(x)

  if (!contains(e, x)) {
    const F = simplify(mul(e, X))
    steps.push({
      title: `${toPlain(e)} is a constant. The integral of a constant k is k·${x}`,
      tex: `${lhs} = ${toTex(F)}`,
    })
    return F
  }

  const mono = monomialIntegral(e, x, steps)
  if (mono) return mono

  if (e.kind === 'add') {
    const work: Step[] = []
    const parts: Expr[] = []
    for (const t of e.terms) {
      const w: Step[] = []
      const r = integ(t, x, w, depth + 1)
      if (!r) {
        parts.length = 0
        break
      }
      parts.push(r)
      work.push(partStep(`For ${toPlain(t)}`, t, x, r, w))
    }
    if (parts.length === e.terms.length) {
      const F = simplify(add(...parts))
      steps.push({
        title: 'Integrate each term on its own, then add them up (the sum rule)',
        tex: `${lhs} = ${e.terms.map((t) => intTex(t, x)).join(' + ')}`,
      })
      steps.push(...work)
      const raw: Expr = { kind: 'add', terms: parts }
      const rawTex = toTex(raw)
      steps.push({
        title: 'Add the results together',
        tex: `${lhs} = ${rawTex === toTex(F) ? '' : `${rawTex} = `}${toTex(F)}`,
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
        if (sub.length === 1 && !sub[0].substeps?.length) {
          steps.push({
            title: `${keepText(c)}. ${sub[0].title}`,
            tex: `${lhs} = ${toTex(c)} ${intTex(rest, x)} = ${toTex(F)}`,
          })
        } else {
          steps.push({
            title: `${keepText(c)}, and integrate the rest`,
            tex: `${lhs} = ${toTex(c)} ${intTex(rest, x)}`,
          })
          steps.push(...sub)
          steps.push({ title: `Multiply by ${toPlain(c)}`, tex: `${lhs} = ${toTex(F)}` })
        }
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

  const rational = integrateRational(e, x)
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
        steps.push({
          title: 'Multiply out first, so each term can be integrated on its own',
          tex: `${lhs} = ${intTex(ex, x)}`,
        })
        steps.push(...sub)
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
    lin.a.isOne()
      ? ''
      : `. The inside has ${lin.a.toString().replace(/^-/, '−')}${x} in it, so also divide by ${lin.a.toString().replace(/^-/, '−')}`

  if (e.kind === 'sym') {
    return { F: simplify(div(pow(X, 2), num(2))), rule: 'Power rule: add 1 to the power, then divide by the new power' }
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
            rule: `The integral of 1/u is ln|u|${chainNote(lin)}`,
          }
        }
        const n1 = simplify(add(exp, ONE))
        return {
          F: over(lin, div(pow(base, n1), n1)),
          rule: `Power rule: add 1 to the power, then divide by the new power${chainNote(lin)}`,
        }
      }
      // trig squares
      if (exp.kind === 'num' && exp.value.eq(Rational.of(2)) && base.kind === 'fn') {
        const u = base.args[0]
        const l = linear(u, x)
        if (l) {
          switch (base.name) {
            case 'sec':
              return { F: over(l, fn('tan', u)), rule: 'The integral of sec² is tan' }
            case 'csc':
              return { F: over(l, neg(fn('cot', u))), rule: 'The integral of csc² is −cot' }
            case 'sin':
              return {
                F: simplify(sub(div(X, num(2)), over(l, div(fn('sin', mul(num(2), u)), num(4))))),
                rule: 'Rewrite sin² with the identity sin²(u) = (1 − cos 2u)/2, then integrate each part',
              }
            case 'cos':
              return {
                F: simplify(add(div(X, num(2)), over(l, div(fn('sin', mul(num(2), u)), num(4))))),
                rule: 'Rewrite cos² with the identity cos²(u) = (1 + cos 2u)/2, then integrate each part',
              }
            case 'tan':
              return {
                F: simplify(sub(over(l, fn('tan', u)), X)),
                rule: 'Rewrite tan² as sec² − 1, then integrate each part',
              }
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
              rule: 'This matches the arcsin pattern: the integral of 1/√(a² − u²) is arcsin(u/a)',
            }
          }
          if (pc.sign() > 0) {
            const k = simplify(sqrt(num(pc)))
            return {
              F: simplify(div(fn('ln', fn('abs', add(mul(k, X), sqrt(base)))), k)),
              rule: 'This matches the pattern: the integral of 1/√(u² + a²) is ln|u + √(u² + a²)|',
            }
          }
        }
      }
    }
    // c^(ax+b)
    if (!contains(base, x)) {
      const lin = linear(exp, x)
      if (lin) {
        if (isSym(base, 'e')) return { F: over(lin, e), rule: `The integral of eᵘ is eᵘ itself${chainNote(lin)}` }
        return {
          F: over(lin, div(e, fn('ln', base))),
          rule: `The integral of aᵘ is aᵘ ÷ ln(a)${chainNote(lin)}`,
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
        return { F: over(lin, neg(fn('cos', u))), rule: `The integral of sin is −cos${n}` }
      case 'cos':
        return { F: over(lin, fn('sin', u)), rule: `The integral of cos is sin${n}` }
      case 'tan':
        return { F: over(lin, neg(lnAbs(fn('cos', u)))), rule: `The integral of tan(u) is −ln|cos(u)|${n}` }
      case 'cot':
        return { F: over(lin, lnAbs(fn('sin', u))), rule: `The integral of cot(u) is ln|sin(u)|${n}` }
      case 'sec':
        return {
          F: over(lin, lnAbs(add(fn('sec', u), fn('tan', u)))),
          rule: `The integral of sec(u) is ln|sec(u) + tan(u)|${n}`,
        }
      case 'csc':
        return {
          F: over(lin, neg(lnAbs(add(fn('csc', u), fn('cot', u))))),
          rule: `The integral of csc(u) is −ln|csc(u) + cot(u)|${n}`,
        }
      case 'sinh':
        return { F: over(lin, fn('cosh', u)), rule: `The integral of sinh is cosh${n}` }
      case 'cosh':
        return { F: over(lin, fn('sinh', u)), rule: `The integral of cosh is sinh${n}` }
      case 'tanh':
        return { F: over(lin, fn('ln', fn('cosh', u))), rule: `The integral of tanh(u) is ln(cosh(u))${n}` }
      case 'ln':
        return {
          F: over(lin, sub(mul(u, fn('ln', u)), u)),
          rule: `The integral of ln(u) is u·ln(u) − u (found with integration by parts)${n}`,
        }
      case 'log':
        if (contains(e.args[1], x)) return null
        return {
          F: over(lin, div(sub(mul(u, fn('ln', u)), u), fn('ln', e.args[1]))),
          rule: `The integral of log_b(u) is (u·ln(u) − u) ÷ ln(b)${n}`,
        }
      case 'asin':
        return {
          F: over(lin, add(mul(u, fn('asin', u)), sqrt(sub(ONE, pow(u, 2))))),
          rule: `The integral of arcsin(u) is u·arcsin(u) + √(1 − u²)${n}`,
        }
      case 'acos':
        return {
          F: over(lin, sub(mul(u, fn('acos', u)), sqrt(sub(ONE, pow(u, 2))))),
          rule: `The integral of arccos(u) is u·arccos(u) − √(1 − u²)${n}`,
        }
      case 'atan':
        return {
          F: over(lin, sub(mul(u, fn('atan', u)), div(fn('ln', add(ONE, pow(u, 2))), num(2)))),
          rule: `The integral of arctan(u) is u·arctan(u) − ln(1 + u²)/2${n}`,
        }
      case 'abs':
        return { F: over(lin, div(mul(u, fn('abs', u)), num(2))), rule: `The integral of |u| is u·|u|/2${n}` }
    }
  }
  return null
}

/** (x − 1)(x + 1) for a denominator that splits into several factors. */
function polyFactoredText(p: Poly, x: string): string | null {
  const { content, factors } = factorPoly(p)
  if (factors.length < 2 && (factors[0]?.mult ?? 1) === 1) return null
  const parts = factors.map((f) => {
    const t = `\\left(${toTex(f.poly.toExpr(x))}\\right)`
    return f.mult > 1 ? `${t}^{${f.mult}}` : t
  })
  const c = content.isOne() ? '' : content.eq(Rational.MINUS_ONE) ? '-' : toTex(num(content))
  return c + parts.join('')
}

// ---------------------------------------------------------------------------
// Rational functions: long division + partial fractions

function integrateRational(e: Expr, x: string): { F: Expr; steps: Step[] } | null {
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
      title: 'The top has a power at least as high as the bottom, so divide first (polynomial long division)',
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
    const sol = solveLinear(
      A,
      Array.from({ length: n }, (_, row) => target.coef(row)),
    )
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
        sub.push({
          title:
            s.power === 1
              ? `The integral of 1/u is ln|u|. Here u = ${toPlain(fx)}${p.isOne() ? '' : `, so also divide by ${p.toString()}`}`
              : `Power rule with u = ${toPlain(fx)}: add 1 to the power, then divide by the new power`,
          tex: `${intTex(termE, x)} = ${toTex(F)}`,
        })
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
          mul(
            num(k2.mul(Rational.of(2))),
            pow(root, -1),
            fn('atan', div(add(mul(num(a0.mul(Rational.of(2))), X), num(b0)), root)),
          ),
        )
        const F = simplify(add(lnPart, atanPart))
        sub.push({
          title:
            'Split the top into a part that is a multiple of the derivative of the bottom (gives ln) and a number left over (gives arctan)',
          tex: `${intTex(termE, x)} = ${toTex(F)}`,
        })
        terms.push(F)
      }
    }
    if (decomposition.length > 1 || factors.length > 1 || factors[0]?.mult > 1) {
      const factored = polyFactoredText(Dn, x)
      if (factored)
        steps.push({
          title: 'Factor the bottom of the fraction',
          tex: `${toTex(Dn.toExpr(x))} = ${factored}`,
        })
      steps.push({
        title: 'Split the fraction into simpler fractions, one for each factor (partial fractions)',
        tex: `\\frac{${toTex(N.toExpr(x))}}{${toTex(Dn.toExpr(x))}} = ${decomposition.map(toTex).join(' + ').replace(/\+ -/g, '- ')}`,
      })
    }
    steps.push({ title: 'Integrate each simple fraction on its own', substeps: sub, tex: undefined })
  } else if (pieces.length) {
    steps.push({ title: 'Integrate what is left with the power rule' })
  }
  const F = simplify(add(...terms))
  if (terms.length > 1) steps.push({ title: 'Add the results together', tex: `${intTex(e, x)} = ${toTex(F)}` })
  return { F, steps }
}

// ---------------------------------------------------------------------------
// u-substitution: look for a factor that is (a constant multiple of) g′(x)

function subexpressions(e: Expr, x: string, out: Map<string, Expr>): Map<string, Expr> {
  if (!contains(e, x) || isSym(e, x)) return out
  out.set(key(e), e)
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
          title: `Notice that ${toPlain(dg)} is (a multiple of) the derivative of ${toPlain(g)}. That means a substitution will work: let ${u} = ${toPlain(g)}`,
          tex: `${u} = ${toTex(g)}`,
        },
        {
          title: `Take the derivative of ${u}, so we can swap d${x} for d${u}`,
          tex: `d${u} = ${dg.kind === 'add' ? `\\left(${toTex(dg)}\\right)` : toTex(dg)}\\,d${x}`,
        },
        {
          title: `Rewrite the whole integral using ${u}. Every ${x} should disappear`,
          tex: `${intTex(e, x)} = ${intTex(inner, u)}`,
        },
        partStep(`Integrate with respect to ${u}`, inner, u, Fu, sub),
        {
          title: `Put ${toPlain(g)} back in place of ${u}`,
          tex: `${toTex(substitute(Fu, u, g)) === toTex(F) ? '' : `${toTex(substitute(Fu, u, g))} = `}${toTex(F)}`,
        },
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
          title: `Row ${k + 1}: ${k === 0 ? 'u' : `derivative ${k} of u`} = ${toPlain(deriv.toExpr(x))}, integral ${k + 1} of dv = ${toPlain(ints[k])}. Multiply them with sign ${sign > 0 ? '+' : '−'}`,
          tex: `${sign > 0 ? '+' : '-'}\\left(${toTex(deriv.toExpr(x))}\\right) \\cdot ${ints[k].kind === 'add' ? `\\left(${toTex(ints[k])}\\right)` : toTex(ints[k])}`,
        })
        deriv = deriv.derivative()
      }
      const F = simplify(add(...terms))
      const Pe = P.toExpr(x)
      const dP = P.derivative().toExpr(x)
      const intro: Step[] = [
        {
          title:
            'This is a product of two different kinds of function, so use integration by parts: ∫u dv = u·v − ∫v du',
          tex: `\\int u\\,dv = u v - \\int v\\,du`,
        },
        {
          title: `Choose u = ${toPlain(Pe)}, because it gets simpler when you take its derivative. The rest is dv = ${toPlain(T)} d${x}`,
          tex: `u = ${toTex(Pe)},\\quad dv = ${toTex(T)}\\,d${x}`,
        },
        {
          title: `Find du (take the derivative of u) and v (integrate dv)`,
          tex: `du = ${dP.kind === 'add' ? `\\left(${toTex(dP)}\\right)` : toTex(dP)}\\,d${x},\\quad v = ${toTex(ints[0])}`,
        },
      ]
      if (P.degree === 1) {
        const vdu = simplify(mul(ints[0], dP))
        return {
          F,
          steps: [
            ...intro,
            {
              title: 'Put them into the formula u·v − ∫v du',
              tex: `${intTex(e, x)} = ${toTex(simplify(mul(Pe, ints[0])))} - ${intTex(vdu, x)}`,
            },
            {
              title: 'Work out the integral that is left. It is simpler than the one we started with',
              tex: `${intTex(vdu, x)} = ${toTex(simplify(mul(dP, ints[1])))}`,
            },
            { title: 'Put it all together', tex: `${intTex(e, x)} = ${toTex(F)}` },
          ],
        }
      }
      return {
        F,
        steps: [
          ...intro,
          {
            title: `The integral that is left still has ${x} in it, so repeat integration by parts until u becomes a number. A table keeps track: keep taking derivatives of u and integrals of dv, with signs + − + …`,
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
            title: `We know the derivative of ${toPlain(T)} but not an easy integral of it, so use integration by parts: ∫u dv = u·v − ∫v du`,
            tex: `\\int u\\,dv = u v - \\int v\\,du`,
          },
          {
            title: `Choose u = ${toPlain(T)} and dv = ${toPlain(P.toExpr(x))} d${x}. Then find du (derivative of u) and v (integral of dv)`,
            tex: `du = ${toTex(dT)}\\,d${x},\\quad v = ${toTex(V)}`,
          },
          {
            title: 'Put them into the formula u·v − ∫v du',
            tex: `${intTex(e, x)} = ${toTex(simplify(mul(V, T)))} - ${intTex(rest, x)}`,
          },
          partStep('Work out the integral that is left', rest, x, R, sub),
          { title: 'Put it all together', tex: `${intTex(e, x)} = ${toTex(F)}` },
        ],
      }
    }
  }
  // e^(ax) · sin(bx) / cos(bx)
  if (others.length === 2 && polyFactors.length <= 1) {
    const c0 = polyFactors.length ? polyFromExpr(polyFactors[0], x) : Poly.constant(1)
    if (!c0 || c0.degree > 0) return null
    const expF = others.find((f) => f.kind === 'pow' && isSym(f.base, 'e') && linear(f.exp, x))
    const trig = others.find(
      (f): f is Fn => f.kind === 'fn' && (f.name === 'sin' || f.name === 'cos') && !!linear(f.args[0], x),
    )
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
            title:
              'Use integration by parts twice. The integral we started with comes back, so treat it like an unknown and solve for it',
            tex: `${intTex(e, x)} = ${toTex(F)}`,
          },
        ],
      }
    }
  }
  return null
}

function sub2(a: Expr, b: Expr): Expr {
  return add(a, neg(b))
}
