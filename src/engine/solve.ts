import {
  type Expr,
  ONE,
  PI,
  ZERO,
  add,
  contains,
  countOccurrences,
  div,
  fn,
  freeSymbols,
  isSym,
  isZero,
  key,
  mul,
  neg,
  num,
  pow,
  sub,
  substitute,
  sym,
} from './expr'
import { identify } from './identify'
import { compile, evalNum, findRealRoots } from './numeric'
import { type Complex, Poly, complexRoots, factorPoly, polyFromExpr, quadraticRoots, ratFromExpr, rationalRoots } from './poly'
import { formatNumber, texNumber, toTex, toText } from './print'
import { Rational } from './rational'
import { simplify } from './simplify'
import type { Answer, PlotSpec, Solution, Step } from './types'

export const eqTex = (l: Expr, r: Expr, op = '='): string => `${toTex(l)} ${op} ${toTex(r)}`

/** A solution value: exact when we have one, always with a numeric value when real. */
export interface Root {
  exact: Expr | null
  value: number
  /** Present for general solutions of periodic equations (contains the integer parameter). */
  general?: boolean
  /** The solution depends on other letters (parameters), so it can't be checked numerically. */
  symbolic?: boolean
}

export interface PolyRoots {
  real: Root[]
  complex: Array<{ exact: Expr | null; z: Complex }>
}

// ---------------------------------------------------------------------------
// Polynomial equations p(x) = 0

function rootOf(e: Expr): Root {
  return { exact: e, value: evalNum(e) }
}

function factoredTex(p: Poly, x: string): string {
  const { content, factors } = factorPoly(p)
  const parts = factors.map((f) => {
    const t = toTex(f.poly.toExpr(x))
    const needParens = f.poly.degree >= 1 && (factors.length > 1 || f.mult > 1 || !content.isOne()) && f.poly.c.filter((c) => !c.isZero()).length > 1
    const base = needParens ? `\\left(${t}\\right)` : t
    return f.mult > 1 ? `${needParens ? base : `{${base}}`}^{${f.mult}}` : base
  })
  const c = content.isOne() ? '' : content.eq(Rational.MINUS_ONE) ? '-' : toTex(num(content))
  return c + parts.join('')
}

/** Solves p(x) = 0 with explanatory steps. */
export function solvePolynomial(p: Poly, x: string, steps: Step[]): PolyRoots {
  const deg = p.degree
  const real: Root[] = []
  const complex: PolyRoots['complex'] = []
  if (deg === 1) {
    const r = p.coef(0).neg().div(p.coef(1))
    steps.push({ title: `Solve the linear equation for ${x}`, tex: `${x} = ${toTex(num(r))}` })
    real.push(rootOf(num(r)))
    return { real, complex }
  }
  if (deg === 2) return solveQuadratic(p, x, steps)

  // Binomial: a·x^n + c = 0
  const nonzero = p.c.map((c, i) => (c.isZero() ? -1 : i)).filter((i) => i >= 0)
  if (nonzero.length === 2 && nonzero[0] === 0 && rationalRoots(p).roots.length === 0) {
    const n = deg
    const rhs = p.coef(0).neg().div(p.lead)
    steps.push({ title: `Isolate ${x}^${n}`, tex: `${x}^{${n}} = ${toTex(num(rhs))}` })
    if (n % 2 === 1) {
      const r = simplify(pow(num(rhs), num(Rational.of(1, n))))
      steps.push({ title: `Take the ${ordinalRoot(n)} root of both sides (odd root, one real solution)`, tex: `${x} = ${toTex(r)}` })
      real.push(rootOf(r))
    } else if (rhs.sign() >= 0) {
      const r = simplify(pow(num(rhs), num(Rational.of(1, n))))
      steps.push({ title: `Take the ${ordinalRoot(n)} root of both sides; an even root gives ±`, tex: `${x} = \\pm ${toTex(r)}` })
      if (isZero(r)) real.push(rootOf(r))
      else real.push(rootOf(simplify(neg(r))), rootOf(r))
    } else {
      steps.push({ title: `An even power can't be negative, so there are no real solutions` })
    }
    for (const z of complexRoots(p)) if (z.im !== 0) complex.push({ exact: null, z })
    return { real, complex }
  }

  // Biquadratic: a·x⁴ + b·x² + c = 0
  if (deg === 4 && p.coef(1).isZero() && p.coef(3).isZero()) {
    const q = new Poly([p.coef(0), p.coef(2), p.coef(4)])
    const u = x === 'u' ? 't' : 'u'
    steps.push({
      title: `Only even powers appear, so substitute ${u} = ${x}²`,
      tex: `${toTex(q.toExpr(u))} = 0`,
    })
    const sub: Step[] = []
    const ur = solveQuadratic(q, u, sub)
    steps.push({ title: `Solve the quadratic in ${u}`, substeps: sub })
    const sols: string[] = []
    for (const r of ur.real) {
      if (!r.exact) continue
      if (r.value > 0) {
        const s = simplify(pow(r.exact, num(Rational.HALF)))
        real.push(rootOf(simplify(neg(s))), rootOf(s))
        sols.push(`${x} = \\pm ${toTex(s)}`)
      } else if (r.value === 0) {
        real.push(rootOf(ZERO))
        sols.push(`${x} = 0`)
      } else {
        const s = simplify(pow(simplify(neg(r.exact)), num(Rational.HALF)))
        complex.push({ exact: simplify(mul(neg(ONE), sym('i'), s)), z: { re: 0, im: -evalNum(s) } })
        complex.push({ exact: simplify(mul(sym('i'), s)), z: { re: 0, im: evalNum(s) } })
        sols.push(`${x}^2 = ${toTex(r.exact)} \\text{ (no real solution)}`)
      }
    }
    if (ur.complex.length) {
      for (const z of complexRoots(p))
        if (z.im !== 0 && !complex.some((k) => Math.abs(k.z.re - z.re) < 1e-9 && Math.abs(k.z.im - z.im) < 1e-9)) complex.push({ exact: null, z })
    }
    steps.push({ title: `Undo the substitution: ${x} = ±√${u}`, tex: sols.join(',\\quad ') })
    real.sort((a, b) => a.value - b.value)
    return { real, complex }
  }

  // General: factor out x^k, rational roots, then quadratic formula or numerics.
  const { roots, rest, candidates } = rationalRoots(p)
  if (roots.length > 0) {
    steps.push({
      title: 'Factor the polynomial (rational root theorem: try ±(factors of the constant term)/(factors of the leading coefficient))',
      tex: `${factoredTex(p, x)} = 0`,
      substeps: candidates
        ? [{ title: `Tried ${candidates} candidate${candidates === 1 ? '' : 's'}; found ${roots.map((r) => `${x} = ${r.value.toString()}`).join(', ')}` }]
        : undefined,
    })
    steps.push({
      title: 'Set each factor equal to zero',
      tex: roots.map((r) => `${x} = ${toTex(num(r.value))}${r.mult > 1 ? `\\;(\\text{multiplicity } ${r.mult})` : ''}`).join(',\\quad '),
    })
    for (const r of roots) real.push(rootOf(num(r.value)))
  }
  if (rest.degree === 2) {
    const sub: Step[] = []
    const q = solveQuadratic(rest, x, sub)
    steps.push({ title: `Solve the remaining quadratic factor ${toText(rest.toExpr(x))} = 0`, substeps: sub })
    real.push(...q.real)
    complex.push(...q.complex)
  } else if (rest.degree === 1) {
    const r = rest.coef(0).neg().div(rest.coef(1))
    real.push(rootOf(num(r)))
  } else if (rest.degree >= 3) {
    const zs = complexRoots(rest)
    const reals = zs.filter((z) => z.im === 0)
    steps.push({
      title:
        roots.length > 0
          ? `The remaining factor ${toText(rest.toExpr(x))} has no rational roots, so find its roots numerically`
          : 'There are no rational roots, so find the roots numerically (Durand–Kerner iteration)',
      tex: reals.length ? reals.map((z) => `${x} \\approx ${texNumber(z.re)}`).join(',\\quad ') : undefined,
    })
    for (const z of zs) {
      if (z.im === 0) real.push({ exact: identify(z.re), value: z.re })
      else complex.push({ exact: null, z })
    }
  }
  real.sort((a, b) => a.value - b.value)
  return { real: dedupeRoots(real), complex }
}

function ordinalRoot(n: number): string {
  return n === 2 ? 'square' : n === 3 ? 'cube' : `${n}th`
}

function solveQuadratic(p: Poly, x: string, steps: Step[]): PolyRoots {
  const [c, b, a] = [p.coef(0), p.coef(1), p.coef(2)]
  const real: Root[] = []
  const complex: PolyRoots['complex'] = []
  const X = sym(x)
  if (c.isZero()) {
    const lin = new Poly([b, a])
    steps.push({ title: `Factor out ${x}`, tex: `${x}\\left(${toTex(lin.toExpr(x))}\\right) = 0` })
    const r = b.neg().div(a)
    steps.push({ title: 'Set each factor equal to zero', tex: `${x} = 0 \\quad\\text{or}\\quad ${toTex(lin.toExpr(x))} = 0 \\;\\Rightarrow\\; ${x} = ${toTex(num(r))}` })
    real.push(rootOf(ZERO), rootOf(num(r)))
    real.sort((u, v) => u.value - v.value)
    return { real, complex }
  }
  if (b.isZero()) {
    const rhs = c.neg().div(a)
    steps.push({ title: `Isolate ${x}²`, tex: `${x}^{2} = ${toTex(num(rhs))}` })
    const s = simplify(pow(num(rhs.abs()), num(Rational.HALF)))
    if (rhs.sign() > 0) {
      steps.push({ title: 'Take the square root of both sides (remember ±)', tex: `${x} = \\pm ${toTex(s)}` })
      real.push(rootOf(simplify(neg(s))), rootOf(s))
    } else {
      steps.push({ title: `A square can't be negative, so there are no real solutions. Over the complex numbers:`, tex: `${x} = \\pm ${toTex(simplify(mul(s, sym('i'))))}` })
      const v = evalNum(s)
      complex.push({ exact: simplify(neg(mul(s, sym('i')))), z: { re: 0, im: -v } }, { exact: simplify(mul(s, sym('i'))), z: { re: 0, im: v } })
    }
    return { real, complex }
  }
  const { disc, roots } = quadraticRoots(p)
  steps.push({
    title: 'Identify the coefficients of ax² + bx + c = 0',
    tex: `a = ${toTex(num(a))},\\quad b = ${toTex(num(b))},\\quad c = ${toTex(num(c))}`,
  })
  const paren = (r: Rational) => (r.sign() < 0 || !r.isInteger() ? `\\left(${toTex(num(r))}\\right)` : toTex(num(r)))
  steps.push({
    title: 'Compute the discriminant Δ = b² − 4ac',
    tex: `\\Delta = ${paren(b)}^{2} - 4 \\cdot ${paren(a)} \\cdot ${paren(c)} = ${toTex(num(disc))}`,
  })
  const sqrtD = disc.sign() >= 0 ? simplify(pow(num(disc), num(Rational.HALF))) : null
  const rationalRootsOnly = sqrtD !== null && sqrtD.kind === 'num'
  if (rationalRootsOnly && !disc.isZero()) {
    steps.push({ title: 'Δ is a perfect square, so the quadratic factors over the rational numbers', tex: `${factoredTex(p, x)} = 0` })
    steps.push({ title: 'Set each factor equal to zero', tex: roots.map((r) => `${x} = ${toTex(r)}`).join(',\\quad ') })
    real.push(...roots.map(rootOf))
    real.sort((u, v) => u.value - v.value)
    return { real, complex }
  }
  const formula = `${x} = \\frac{-${paren(b)} \\pm \\sqrt{${toTex(num(disc))}}}{2 \\cdot ${paren(a)}}`
  if (disc.isZero()) {
    steps.push({ title: 'Δ = 0, so there is exactly one (repeated) solution x = −b / (2a)', tex: `${x} = ${toTex(roots[0])}` })
    real.push(rootOf(roots[0]))
  } else if (disc.sign() > 0) {
    steps.push({ title: 'Δ > 0, so there are two real solutions. Use the quadratic formula x = (−b ± √Δ) / (2a)', tex: formula })
    steps.push({ title: 'Simplify', tex: roots.map((r) => `${x} = ${toTex(r)}`).join(',\\quad ') })
    real.push(...roots.map(rootOf))
  } else {
    steps.push({ title: 'Δ < 0, so there are no real solutions. The quadratic formula gives two complex solutions', tex: formula })
    steps.push({ title: 'Simplify using √(−1) = i', tex: roots.map((r) => `${x} = ${toTex(r)}`).join(',\\quad ') })
    for (const r of roots) {
      const re = evalNum(simplify(substitute(r, 'i', ZERO)))
      const im = evalNum(simplify(substitute(sub(r, substitute(r, 'i', ZERO)), 'i', ONE)))
      complex.push({ exact: r, z: { re, im } })
    }
  }
  void X
  real.sort((u, v) => u.value - v.value)
  return { real, complex }
}

function dedupeRoots(rs: Root[]): Root[] {
  const out: Root[] = []
  for (const r of rs) {
    if (!out.some((o) => (o.exact && r.exact && key(o.exact) === key(r.exact)) || (!o.general && !r.general && Math.abs(o.value - r.value) < 1e-9 * Math.max(1, Math.abs(r.value)))))
      out.push(r)
  }
  return out
}

// ---------------------------------------------------------------------------
// Isolating a single occurrence of x by undoing operations

interface Branch {
  f: Expr
  g: Expr
  general: boolean
}

function paramName(x: string): string {
  return x === 'n' ? 'k' : 'n'
}

function isolate(L: Expr, R: Expr, x: string, steps: Step[]): Branch[] | null {
  let branches: Branch[] = contains(L, x) ? [{ f: L, g: R, general: false }] : [{ f: R, g: L, general: false }]
  const N = sym(paramName(x))
  const done: Branch[] = []
  for (let guard = 0; guard < 40 && branches.length; guard++) {
    const next: Branch[] = []
    const lines: string[] = []
    let title = ''
    for (const br of branches) {
      const { f, g } = br
      if (isSym(f, x)) {
        done.push(br)
        continue
      }
      const push = (nf: Expr, ng: Expr, t: string, general = br.general) => {
        const sg = simplify(ng)
        next.push({ f: nf, g: sg, general })
        lines.push(eqTex(nf, sg))
        if (!title) title = t
      }
      switch (f.kind) {
        case 'add': {
          const withX = f.terms.find((t) => contains(t, x))!
          const others = simplify(add(...f.terms.filter((t) => t !== withX)))
          const neg_ = isNegativeTerm(others)
          push(withX, sub(g, others), neg_ ? `Add ${toText(simplify(neg(others)))} to both sides` : `Subtract ${toText(others)} from both sides`)
          break
        }
        case 'mul': {
          const withX = f.factors.find((t) => contains(t, x))!
          const others = simplify(mul(...f.factors.filter((t) => t !== withX)))
          if (others.kind === 'pow' && others.exp.kind === 'num' && others.exp.value.eq(Rational.MINUS_ONE))
            push(withX, mul(g, others.base), `Multiply both sides by ${toText(others.base)}`)
          else push(withX, div(g, others), `Divide both sides by ${toText(others)}`)
          break
        }
        case 'pow': {
          const { base, exp } = f
          if (contains(base, x)) {
            if (exp.kind === 'num') {
              const v = exp.value
              if (v.eq(Rational.MINUS_ONE)) {
                if (isZero(g)) return []
                push(base, pow(g, -1), 'Take the reciprocal of both sides')
                break
              }
              const inv = v.inv()
              if (v.n % 2n === 0n) {
                // even power: ±
                const gv = evalNum(g)
                if (!freeSymbols(g).size && gv < 0) {
                  title = title || `An even power can't equal a negative number`
                  break
                }
                const root = simplify(pow(g, num(inv)))
                if (isZero(root)) push(base, root, `Take the ${ordinalRoot(Number(v.n))} root of both sides`)
                else {
                  push(base, root, `Take the ${ordinalRoot(Number(v.n))} root of both sides (±)`)
                  push(base, neg(root), `Take the ${ordinalRoot(Number(v.n))} root of both sides (±)`)
                }
              } else {
                if (v.d % 2n === 0n && !freeSymbols(g).size && evalNum(g) < 0) {
                  title = title || 'A square root is never negative, so this branch has no solution'
                  break
                }
                push(
                  base,
                  pow(g, num(inv)),
                  v.d === 1n ? `Take the ${ordinalRoot(Number(v.n))} root of both sides` : `Raise both sides to the power ${inv.toString()}`,
                )
              }
              break
            }
            if (!contains(exp, x)) {
              push(base, pow(g, pow(exp, -1)), `Raise both sides to the power 1/${toText(exp)}`)
              break
            }
            return null
          }
          // x in the exponent
          if (!freeSymbols(g).size && evalNum(g) <= 0) {
            title = title || 'An exponential is always positive, so there is no solution'
            break
          }
          if (isSym(base, 'e')) push(exp, fn('ln', g), 'Take the natural logarithm of both sides')
          else push(exp, fn('log', g, base), `Take the logarithm base ${toText(base)} of both sides`)
          break
        }
        case 'fn': {
          const a = f.args[0]
          if (f.args.length > 1 && (f.name !== 'log' || contains(f.args[1], x))) return null
          const gv = freeSymbols(g).size ? NaN : evalNum(g)
          switch (f.name) {
            case 'ln':
              push(a, pow(sym('e'), g), 'Exponentiate both sides (eˡⁿ ᵘ = u)')
              break
            case 'log':
              push(a, pow(f.args[1], g), `Raise ${toText(f.args[1])} to the power of both sides`)
              break
            case 'sqrt':
              push(a, pow(g, 2), 'Square both sides')
              break
            case 'abs':
              if (gv < 0) {
                title = title || 'An absolute value is never negative, so there is no solution'
                break
              }
              if (gv === 0) push(a, ZERO, 'The absolute value is zero only when the inside is zero')
              else {
                push(a, g, 'Split the absolute value into two cases: u = c or u = −c')
                push(a, neg(g), 'Split the absolute value into two cases: u = c or u = −c')
              }
              break
            case 'sin':
            case 'cos': {
              if (Math.abs(gv) > 1 + 1e-12) {
                title = title || `${f.name} only takes values between −1 and 1, so there is no solution`
                break
              }
              const inv = simplify(fn(f.name === 'sin' ? 'asin' : 'acos', g))
              const period = mul(num(2), PI, N)
              const t = `Apply the inverse function; ${f.name} repeats every 2π, so add 2π${N.name} (${N.name} any integer)`
              if (f.name === 'sin') {
                push(a, add(inv, period), t, true)
                const other = simplify(sub(PI, inv))
                if (key(other) !== key(inv)) push(a, add(other, period), t, true)
              } else {
                push(a, add(inv, period), t, true)
                const other = simplify(neg(inv))
                if (key(other) !== key(inv) && !isZero(inv)) push(a, add(other, period), t, true)
              }
              break
            }
            case 'tan':
              push(a, add(fn('atan', g), mul(PI, N)), `Apply arctan; tan repeats every π, so add π${N.name} (${N.name} any integer)`, true)
              break
            case 'asin':
              push(a, fn('sin', g), 'Take sin of both sides')
              break
            case 'acos':
              push(a, fn('cos', g), 'Take cos of both sides')
              break
            case 'atan':
              push(a, fn('tan', g), 'Take tan of both sides')
              break
            default:
              return null
          }
          break
        }
        default:
          return null
      }
    }
    if (lines.length) steps.push({ title, tex: lines.join(' \\quad\\text{or}\\quad ') })
    else if (title) steps.push({ title })
    branches = next
  }
  return done
}

function isNegativeTerm(e: Expr): boolean {
  if (e.kind === 'num') return e.value.sign() < 0
  if (e.kind === 'mul' && e.factors[0].kind === 'num') return e.factors[0].value.sign() < 0
  if (e.kind === 'add') return e.terms.every(isNegativeTerm)
  return false
}

// ---------------------------------------------------------------------------
// Equation solving entry point

export interface EquationResult {
  real: Root[]
  complex: PolyRoots['complex']
  identity: boolean
  excluded: Expr[]
  notes: string[]
  numeric: boolean
}

function denominatorsOf(e: Expr, x: string): Poly[] {
  const out: Poly[] = []
  const walk = (n: Expr) => {
    if (n.kind === 'pow' && n.exp.kind === 'num' && n.exp.value.sign() < 0 && contains(n.base, x)) {
      const p = polyFromExpr(n.base, x)
      if (p) out.push(p)
    }
    const kids = n.kind === 'add' ? n.terms : n.kind === 'mul' ? n.factors : n.kind === 'pow' ? [n.base, n.exp] : n.kind === 'fn' ? n.args : []
    kids.forEach(walk)
  }
  walk(e)
  return out
}

/** Core solver for L = R in x, returning roots and the explanation. */
export function solveEq(L0: Expr, R0: Expr, x: string, steps: Step[]): EquationResult {
  const L = simplify(L0)
  const R = simplify(R0)
  const notes: string[] = []
  const result = (real: Root[], complex: PolyRoots['complex'] = [], extra: Partial<EquationResult> = {}): EquationResult => ({
    real,
    complex,
    identity: false,
    excluded: [],
    notes,
    numeric: false,
    ...extra,
  })
  const diff = simplify(sub(L, R))

  if (!contains(diff, x)) {
    const holds = isZero(diff)
    steps.push({
      title: holds ? `Both sides are equal for every ${x}` : `The ${x} terms cancel and a false statement remains`,
      tex: holds ? `${toTex(L)} = ${toTex(R)}` : `${toTex(diff)} \\neq 0`,
    })
    return result([], [], { identity: holds })
  }

  // 1) Both sides polynomial
  const pl = polyFromExpr(L, x)
  const pr = polyFromExpr(R, x)
  if (pl && pr) {
    const p = pl.sub(pr)
    if (p.degree <= 1) return result(linearSteps(L, R, pl, pr, x, steps))
    const expanded = p.toExpr(x)
    steps.push({ title: 'Move every term to the left side and simplify', tex: `${toTex(expanded)} = 0` })
    const r = solvePolynomial(p, x, steps)
    return result(r.real, r.complex)
  }

  // 2) Rational equation
  const dens = [...denominatorsOf(L, x), ...denominatorsOf(R, x)]
  const rf = ratFromExpr(diff, x, dens)
  if (rf && (!rf.den.isConstant() || dens.length > 0)) {
    const N = rf.num
    const excludedVals: Rational[] = []
    for (const d of [...dens, rf.den]) for (const r of rationalRoots(d).roots) if (!excludedVals.some((v) => v.eq(r.value))) excludedVals.push(r.value)
    steps.push({
      title: 'Move everything to one side and combine into a single fraction',
      tex: `\\frac{${toTex(N.toExpr(x))}}{${toTex(rf.den.toExpr(x))}} = 0`,
    })
    if (excludedVals.length)
      steps.push({
        title: 'Note where the original equation is undefined (a denominator would be zero)',
        tex: excludedVals.map((v) => `${x} \\neq ${toTex(num(v))}`).join(',\\quad '),
      })
    if (N.isConstant()) {
      steps.push({ title: 'The numerator is a nonzero constant, so the fraction is never zero' })
      return result([], [], { excluded: excludedVals.map((v) => num(v)) })
    }
    steps.push({ title: 'A fraction is zero exactly when its numerator is zero', tex: `${toTex(N.toExpr(x))} = 0` })
    const r = N.degree <= 1 ? { real: [rootOf(num(N.coef(0).neg().div(N.coef(1))))], complex: [] } : solvePolynomial(N, x, steps)
    const kept = r.real.filter((root) => !excludedVals.some((v) => Math.abs(v.toNumber() - root.value) < 1e-12))
    const rejected = r.real.filter((root) => !kept.includes(root))
    if (rejected.length)
      steps.push({
        title: 'Discard solutions that make a denominator zero',
        tex: rejected.map((q) => `${x} = ${q.exact ? toTex(q.exact) : texNumber(q.value)} \\text{ is excluded}`).join(',\\quad '),
      })
    return result(kept, r.complex, { excluded: excludedVals.map((v) => num(v)) })
  }

  // 3) One occurrence of x: undo the operations around it
  if (countOccurrences(L, x) + countOccurrences(R, x) === 1) {
    const isoSteps: Step[] = []
    const branches = isolate(L, R, x, isoSteps)
    if (branches) {
      steps.push(...isoSteps)
      const roots: Root[] = []
      for (const b of branches) {
        const g = simplify(b.g)
        const value = evalNum(b.general ? substitute(g, paramName(x), ZERO) : g)
        const symbolic = [...freeSymbols(g)].some((v) => v !== paramName(x))
        if (!b.general && !symbolic && !Number.isFinite(value)) continue
        roots.push({ exact: g, value, general: b.general, symbolic })
      }
      if (roots.some((r) => r.general)) notes.push(`${paramName(x)} can be any integer (…, −2, −1, 0, 1, 2, …).`)
      return result(verify(dedupeRoots(roots), L, R, x, steps), [])
    }
  }

  // 4) A single square root: isolate it and square both sides
  const radical = solveRadical(diff, x, steps)
  if (radical) return result(verify(radical, L, R, x, steps, true), [])

  // 5) Substitution u = g(x) turning it into a polynomial
  const subst = solveBySubstitution(diff, x, steps)
  if (subst) return result(verify(subst, L, R, x, steps), [])

  // 6) Numerical root finding
  const f = compile(diff, x)
  let roots = findRealRoots(f, -100, 100)
  if (roots.length === 0) roots = findRealRoots(f, -10000, 10000, 40000)
  steps.push({
    title: 'No exact algebraic method applies, so look for the roots of the left side minus the right side numerically',
    tex: `f(${x}) = ${toTex(diff)} = 0`,
  })
  const limited = roots.length > 12 ? roots.filter((r) => Math.abs(r) <= 10) : roots
  if (roots.length > 12) notes.push(`There are many solutions (the function is likely periodic); showing those between −10 and 10.`)
  if (roots.length) notes.push('Solutions were found numerically in the range −100 ≤ x ≤ 100 (searching wider if none were found).')
  return result(
    limited.map((v) => ({ exact: identify(v), value: v })),
    [],
    { numeric: true },
  )
}

/** Keeps solutions that satisfy the original equation (filters extraneous roots). */
function verify(roots: Root[], L: Expr, R: Expr, x: string, steps: Step[], announce = false): Root[] {
  const lf = compile(L, x, { [paramName(x)]: 0 })
  const rf = compile(R, x, { [paramName(x)]: 0 })
  const ok: Root[] = []
  const bad: Root[] = []
  for (const r of roots) {
    if (r.symbolic) {
      ok.push(r)
      continue
    }
    const a = lf(r.value)
    const b = rf(r.value)
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b))) ok.push(r)
    else bad.push(r)
  }
  if (announce || bad.length) {
    steps.push({
      title: bad.length ? 'Check each candidate in the original equation; discard the ones that fail (extraneous solutions)' : 'Check each candidate in the original equation',
      tex: [
        ...ok.map((r) => `${x} = ${r.exact ? toTex(r.exact) : texNumber(r.value)} \\;\\checkmark`),
        ...bad.map((r) => `${x} = ${r.exact ? toTex(r.exact) : texNumber(r.value)} \\;\\times`),
      ].join(',\\quad '),
    })
  }
  return ok.sort((a, b) => a.value - b.value)
}

function linearSteps(L: Expr, R: Expr, pl: Poly, pr: Poly, x: string, steps: Step[]): Root[] {
  const X = sym(x)
  let [a1, b1, a2, b2] = [pl.coef(1), pl.coef(0), pr.coef(1), pr.coef(0)]
  const lin = (a: Rational, b: Rational) => simplify(add(mul(num(a), X), num(b)))
  if (key(lin(a1, b1)) !== key(L) || key(lin(a2, b2)) !== key(R)) {
    steps.push({ title: 'Simplify both sides', tex: eqTex(lin(a1, b1), lin(a2, b2)) })
  }
  if (a1.isZero()) {
    ;[a1, b1, a2, b2] = [a2, b2, a1, b1]
    steps.push({ title: `Swap the sides so ${x} is on the left`, tex: eqTex(lin(a1, b1), lin(a2, b2)) })
  }
  if (!a2.isZero()) {
    const t = simplify(mul(num(a2.abs()), X))
    a1 = a1.sub(a2)
    steps.push({
      title: a2.sign() > 0 ? `Subtract ${toText(t)} from both sides` : `Add ${toText(t)} to both sides`,
      tex: eqTex(lin(a1, b1), num(b2)),
    })
    a2 = Rational.ZERO
  }
  if (!b1.isZero()) {
    steps.push({
      title: b1.sign() > 0 ? `Subtract ${b1.toString()} from both sides` : `Add ${b1.neg().toString()} to both sides`,
      tex: eqTex(lin(a1, Rational.ZERO), num(b2.sub(b1))),
    })
    b2 = b2.sub(b1)
    b1 = Rational.ZERO
  }
  if (!a1.isOne()) {
    steps.push({
      title: a1.eq(Rational.MINUS_ONE) ? 'Multiply both sides by −1' : `Divide both sides by ${a1.toString()}`,
      tex: `${x} = ${a1.d === 1n && b2.d === 1n && !a1.eq(Rational.MINUS_ONE) ? `\\frac{${toTex(num(b2))}}{${toTex(num(a1))}} = ` : ''}${toTex(num(b2.div(a1)))}`,
    })
  }
  const r = b2.div(a1)
  return [rootOf(num(r))]
}

function solveRadical(diff: Expr, x: string, steps: Step[]): Root[] | null {
  const terms = diff.kind === 'add' ? diff.terms : [diff]
  const isRad = (t: Expr): Expr | null => {
    const fs = t.kind === 'mul' ? t.factors : [t]
    const rads = fs.filter((f) => f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.eq(Rational.HALF) && contains(f.base, x))
    if (rads.length !== 1) return null
    const others = fs.filter((f) => f !== rads[0])
    if (others.some((f) => contains(f, x))) return null
    return rads[0]
  }
  const radTerms = terms.filter((t) => contains(t, x) && isRad(t))
  if (radTerms.length !== 1) return null
  const T = radTerms[0]
  const rad = isRad(T)!
  if (rad.kind !== 'pow') return null
  const A = polyFromExpr(rad.base, x)
  const restE = simplify(sub(diff, T))
  const rest = polyFromExpr(restE, x)
  if (!A || !rest) return null
  const c = simplify(div(T, rad)) // constant coefficient
  if (contains(c, x) || c.kind !== 'num') return null
  // c·√A = −rest  →  c²·A = rest²
  const rhs = simplify(neg(restE))
  steps.push({ title: 'Isolate the square root on one side', tex: eqTex(T, rhs) })
  const squared = A.scale(c.value.mul(c.value)).sub(rest.mul(rest))
  steps.push({
    title: 'Square both sides (this can introduce extra solutions, so check them at the end)',
    tex: `${toTex(simplify(mul(pow(c, 2), rad.base)))} = ${toTex(simplify(pow(rhs, 2)))}`,
  })
  if (squared.degree < 1) return []
  steps.push({ title: 'Expand and move everything to one side', tex: `${toTex(squared.toExpr(x))} = 0` })
  const r = squared.degree === 1 ? { real: [rootOf(num(squared.coef(0).neg().div(squared.coef(1))))] } : solvePolynomial(squared, x, steps)
  return r.real
}

function replaceForSubstitution(e: Expr, g: Expr, x: string, U: Expr): Expr {
  if (key(e) === key(g)) return U
  // g = b^X and e = b^(k·X): e = U^k
  if (g.kind === 'pow' && e.kind === 'pow' && key(e.base) === key(g.base) && !contains(g.base, x)) {
    const k = simplify(div(e.exp, g.exp))
    if (k.kind === 'num' && k.value.isInteger()) return pow(U, k)
  }
  // g = x^(1/n): x = U^n
  if (g.kind === 'pow' && isSym(g.base, x) && g.exp.kind === 'num' && g.exp.value.n === 1n) {
    const n = Number(g.exp.value.d)
    if (isSym(e, x)) return pow(U, n)
    if (e.kind === 'pow' && isSym(e.base, x) && e.exp.kind === 'num') {
      const k = e.exp.value.mul(Rational.of(n))
      if (k.isInteger()) return pow(U, num(k))
    }
  }
  switch (e.kind) {
    case 'add':
      return { kind: 'add', terms: e.terms.map((t) => replaceForSubstitution(t, g, x, U)) }
    case 'mul':
      return { kind: 'mul', factors: e.factors.map((t) => replaceForSubstitution(t, g, x, U)) }
    case 'pow':
      return { kind: 'pow', base: replaceForSubstitution(e.base, g, x, U), exp: replaceForSubstitution(e.exp, g, x, U) }
    case 'fn':
      return { kind: 'fn', name: e.name, args: e.args.map((t) => replaceForSubstitution(t, g, x, U)) }
    default:
      return e
  }
}

function solveBySubstitution(diff: Expr, x: string, steps: Step[]): Root[] | null {
  const cands = new Map<string, Expr>()
  const walk = (n: Expr) => {
    if ((n.kind === 'fn' || n.kind === 'pow') && contains(n, x) && !polyFromExpr(n, x)) {
      cands.set(key(n), n)
      if (n.kind === 'pow' && !contains(n.base, x) && n.exp.kind === 'mul') {
        // e^(2x) suggests g = e^x
        const [c, ...rest] = n.exp.factors
        if (c.kind === 'num' && c.value.isInteger()) {
          const g = simplify(pow(n.base, mul(...rest)))
          cands.set(key(g), g)
        }
      }
    }
    const kids = n.kind === 'add' ? n.terms : n.kind === 'mul' ? n.factors : n.kind === 'pow' ? [n.base, n.exp] : n.kind === 'fn' ? n.args : []
    kids.forEach(walk)
  }
  walk(diff)
  const u = x === 'u' ? 't' : 'u'
  const U = sym(u)
  for (const g of cands.values()) {
    const replaced = simplify(replaceForSubstitution(diff, g, x, U))
    if (contains(replaced, x)) continue
    const p = polyFromExpr(replaced, u)
    if (!p || p.degree < 2) continue
    const sub: Step[] = []
    const r = solvePolynomial(p, u, sub)
    steps.push({ title: `Substitute ${u} = ${toText(g)}`, tex: `${toTex(p.toExpr(u))} = 0` })
    steps.push({ title: `Solve for ${u}`, substeps: sub, tex: r.real.map((q) => `${u} = ${q.exact ? toTex(q.exact) : texNumber(q.value)}`).join(',\\quad ') || undefined })
    const roots: Root[] = []
    for (const q of r.real) {
      const back: Step[] = []
      const target = q.exact ?? num(Rational.approximate(q.value, 1e9, 1e-15) ?? Rational.ZERO)
      const res = solveEq(g, target, x, back)
      steps.push({ title: `Solve ${toText(g)} = ${q.exact ? toText(q.exact) : formatNumber(q.value)}`, substeps: back })
      roots.push(...res.real)
    }
    return dedupeRoots(roots)
  }
  return null
}

// ---------------------------------------------------------------------------
// Presenting results

export function rootAnswer(x: string, r: Root): Answer {
  let exact = r.exact
  if (exact && r.general && exact.kind === 'add') {
    // show "π/6 + 2πn" rather than "2πn + π/6"
    const n = paramName(x)
    exact = { kind: 'add', terms: [...exact.terms.filter((t) => !contains(t, n)), ...exact.terms.filter((t) => contains(t, n))] }
  }
  const isPlainNumber = exact && exact.kind === 'num'
  return {
    tex: `${x} = ${exact ? toTex(exact) : `${texNumber(r.value)}`}${exact ? '' : '\\ (\\text{approx.})'}`,
    text: `${x} = ${exact ? toText(exact) : formatNumber(r.value)}`,
    approx: exact && !isPlainNumber && Number.isFinite(r.value) ? (r.general ? `${formatNumber(r.value)} (n = 0)` : formatNumber(r.value)) : undefined,
  }
}

export function complexAnswer(x: string, c: PolyRoots['complex'][number]): Answer {
  const z = c.z
  const approx = `${formatNumber(z.re)} ${z.im < 0 ? '−' : '+'} ${formatNumber(Math.abs(z.im))}i`
  return {
    tex: `${x} = ${c.exact ? toTex(c.exact) : `${texNumber(z.re)} ${z.im < 0 ? '-' : '+'} ${texNumber(Math.abs(z.im))}i`}`,
    text: `${x} = ${c.exact ? toText(c.exact) : approx}`,
    approx: c.exact ? approx : undefined,
    complex: true,
  }
}

export function solveEquationProblem(L: Expr, R: Expr, x: string): Solution {
  const steps: Step[] = []
  const res = solveEq(L, R, x, steps)
  const answers: Answer[] = []
  const notes = [...res.notes]
  if (res.identity) {
    const ex = res.excluded.length ? `,\\ ${x} \\neq ${res.excluded.map(toTex).join(', ')}` : ''
    answers.push({ tex: `\\text{All real numbers}${ex}`, text: `All real numbers` })
  } else {
    for (const r of res.real) answers.push(rootAnswer(x, r))
    if (res.real.length === 0) answers.push({ tex: '\\text{No real solution}', text: 'No real solution' })
    for (const c of res.complex) answers.push(complexAnswer(x, c))
  }
  const finite = res.real.filter((r) => Number.isFinite(r.value)).map((r) => r.value)
  return {
    kind: 'solve',
    title: `Solve for ${x}`,
    problemTex: eqTex(L, R),
    answers,
    steps,
    notes,
    plot: equationPlot(L, R, x, finite),
  }
}

export function equationPlot(L: Expr, R: Expr, x: string, roots: number[]): PlotSpec | undefined {
  const vars = new Set([...freeSymbols(L), ...freeSymbols(R)])
  vars.delete(x)
  if (vars.size) return undefined
  const lf = compile(L, x)
  const span = roots.length ? Math.max(4, (Math.max(...roots) - Math.min(...roots)) * 0.75) : 10
  const mid = roots.length ? (Math.max(...roots) + Math.min(...roots)) / 2 : 0
  return {
    variable: x,
    fns: isZero(simplify(R))
      ? [{ expr: toText(L), label: toText(L) }]
      : [
          { expr: toText(L), label: 'left side' },
          { expr: toText(R), label: 'right side' },
        ],
    points: roots.map((r) => ({ x: r, y: lf(r), label: `${x} = ${formatNumber(r, 6)}` })),
    xRange: [mid - span, mid + span],
  }
}

