import {
  type Expr,
  ONE,
  PI,
  ZERO,
  add,
  children,
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
  size,
  sub,
  substitute,
  sym,
} from './expr'
import { literalTex } from './arithmetic'
import { identify } from './identify'
import { compile, evalNum, findRealRoots } from './numeric'
import {
  type Complex,
  Poly,
  complexRoots,
  factorPoly,
  polyFromExpr,
  quadraticRoots,
  ratFromExpr,
  rationalRoots,
} from './poly'
import { formatNumber, texNumber, toPlain, toTex, toText } from './print'
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
    const needParens =
      f.poly.degree >= 1 &&
      (factors.length > 1 || f.mult > 1 || !content.isOne()) &&
      f.poly.c.filter((c) => !c.isZero()).length > 1
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
    steps.push({ title: `Get ${x}${n === 3 ? '³' : `^${n}`} on its own`, tex: `${x}^{${n}} = ${toTex(num(rhs))}` })
    if (n % 2 === 1) {
      const r = simplify(pow(num(rhs), num(Rational.of(1, n))))
      steps.push({
        title: `Take the ${ordinalRoot(n)} root of both sides. An odd root gives just one real answer`,
        tex: `${x} = ${toTex(r)}`,
      })
      real.push(rootOf(r))
    } else if (rhs.sign() >= 0) {
      const r = simplify(pow(num(rhs), num(Rational.of(1, n))))
      steps.push({
        title: `Take the ${ordinalRoot(n)} root of both sides. Don't forget ±: a negative number to an even power is positive too`,
        tex: `${x} = \\pm ${toTex(r)}`,
      })
      if (isZero(r)) real.push(rootOf(r))
      else real.push(rootOf(simplify(neg(r))), rootOf(r))
    } else {
      steps.push({ title: `A number to an even power can't be negative, so there is no real answer` })
    }
    for (const z of complexRoots(p)) if (z.im !== 0) complex.push({ exact: null, z })
    return { real, complex }
  }

  // Biquadratic: a·x⁴ + b·x² + c = 0
  if (deg === 4 && p.coef(1).isZero() && p.coef(3).isZero()) {
    const q = new Poly([p.coef(0), p.coef(2), p.coef(4)])
    const u = x === 'u' ? 't' : 'u'
    steps.push({
      title: `Only even powers of ${x} appear. Let ${u} = ${x}², so ${x}⁴ = ${u}² and the equation becomes a quadratic`,
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
        if (z.im !== 0 && !complex.some((k) => Math.abs(k.z.re - z.re) < 1e-9 && Math.abs(k.z.im - z.im) < 1e-9))
          complex.push({ exact: null, z })
    }
    steps.push({ title: `Go back to ${x}: since ${u} = ${x}², ${x} = ±√${u}`, tex: sols.join(',\\quad ') })
    real.sort((a, b) => a.value - b.value)
    return { real, complex }
  }

  // General: factor out x^k, rational roots, then quadratic formula or numerics.
  const { roots, rest } = rationalRoots(p)
  if (roots.length > 0) {
    const pe = p.toExpr(x)
    const tries: Step[] = roots.slice(0, 4).map((r) => {
      const v = num(r.value)
      return {
        title: `Try ${x} = ${say(r.value)}: the left side comes out as 0, so (${sayExpr(new Poly([r.value.neg(), Rational.ONE]).toExpr(x))}) is a factor`,
        tex: `${toTex(substitute(pe, x, v))} = 0`,
      }
    })
    const prim = p.primitive().prim
    const low = prim.c.findIndex((c) => !c.isZero())
    const c0 = prim.coef(low).abs()
    const an = prim.lead.abs()
    const hint = an.isOne()
      ? `the numbers that divide the last number, ${c0} (with + or −)`
      : `fractions whose top divides ${c0} and whose bottom divides ${an} (with + or −)`
    steps.push({
      title:
        low > 0
          ? `Every term has ${x} in it, so ${x} = 0 is one answer. To find others, try ${hint}`
          : `Look for simple answers first. Good guesses are ${hint}`,
      substeps: tries,
    })
    steps.push({
      title: 'Write the left side as factors (brackets multiplied together)',
      tex: `${factoredTex(p, x)} = 0`,
    })
    steps.push({
      title: 'The factors multiply to give 0, so one of them must be 0. Set each one equal to 0',
      tex: roots
        .map((r) => `${x} = ${toTex(num(r.value))}${r.mult > 1 ? `\\;(\\text{repeated ${r.mult} times})` : ''}`)
        .join(',\\quad '),
    })
    for (const r of roots) real.push(rootOf(num(r.value)))
  }
  if (rest.degree === 2) {
    const sub: Step[] = []
    const q = solveQuadratic(rest, x, sub)
    steps.push({ title: `Solve the bracket that is left, ${sayExpr(rest.toExpr(x))} = 0`, substeps: sub })
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

/** A number in a formula: brackets around negatives and fractions. */
const par = (r: Rational) => (r.sign() < 0 || !r.isInteger() ? `\\left(${toTex(num(r))}\\right)` : toTex(num(r)))
/** A number in a sentence, with a real minus sign. */
const say = (r: Rational) => r.toString().replace(/^-/, '−')
const sayExpr = toPlain

/** a·x² + c = k: get x² on its own, then take the square root (±). */
function solvePureSquare(left: Poly, right: Poly, x: string, steps: Step[]): PolyRoots {
  const a = left.coef(2)
  const c = left.coef(0)
  const k = right.coef(0)
  const real: Root[] = []
  const complex: PolyRoots['complex'] = []
  const ax2 = toTex(simplify(mul(num(a), pow(sym(x), 2))))
  const rhs = k.sub(c).div(a)
  if (!c.isZero())
    steps.push({
      title: `${c.sign() > 0 ? `Subtract ${say(c)} from` : `Add ${say(c.neg())} to`} both sides${a.isOne() ? `, so ${x}² is on its own` : ''}`,
      tex: `${ax2} = ${toTex(num(k.sub(c)))}`,
    })
  if (!a.isOne())
    steps.push({
      title: `Divide both sides by ${say(a)}, so ${x}² is on its own`,
      tex: `${x}^{2} = ${toTex(num(rhs))}`,
    })
  const s = simplify(pow(num(rhs.abs()), num(Rational.HALF)))
  if (rhs.isZero()) {
    steps.push({ title: `Only 0 squared is 0`, tex: `${x} = 0` })
    real.push(rootOf(ZERO))
  } else if (rhs.sign() > 0) {
    const why =
      s.kind === 'num'
        ? `both ${toText(s)}² and (−${toText(s)})² equal ${say(rhs)}`
        : 'a negative number squared is positive too'
    steps.push({
      title: `Take the square root of both sides. Don't forget ±, because ${why}`,
      tex: `${x} = \\pm ${toTex(s)}`,
    })
    real.push(rootOf(simplify(neg(s))), rootOf(s))
  } else {
    steps.push({
      title: `A square is never negative, so there is no real answer. With complex numbers (where i = √−1):`,
      tex: `${x} = \\pm ${toTex(simplify(mul(s, sym('i'))))}`,
    })
    const v = evalNum(s)
    complex.push(
      { exact: simplify(neg(mul(s, sym('i')))), z: { re: 0, im: -v } },
      { exact: simplify(mul(s, sym('i'))), z: { re: 0, im: v } },
    )
  }
  return { real, complex }
}

function solveQuadratic(p0: Poly, x: string, steps: Step[]): PolyRoots {
  let p = p0
  if (p.coef(2).sign() < 0 && !p.coef(1).isZero() && !p.coef(0).isZero()) {
    p = p.neg()
    steps.push({
      title: `Multiply every term by −1, so the number in front of ${x}² is positive. That makes the next steps easier`,
      tex: `${toTex(p.toExpr(x))} = 0`,
    })
  }
  const [c, b, a] = [p.coef(0), p.coef(1), p.coef(2)]
  const real: Root[] = []
  const complex: PolyRoots['complex'] = []
  if (c.isZero()) {
    const lin = new Poly([b, a])
    const linTex = toTex(lin.toExpr(x))
    const r = b.neg().div(a)
    steps.push({
      title: `Every term has an ${x} in it, so take ${x} out as a common factor`,
      tex: `${x}\\left(${linTex}\\right) = 0`,
    })
    steps.push({
      title: 'Two things multiply to give 0, so one of them must be 0',
      tex: `${x} = 0 \\quad\\text{or}\\quad ${linTex} = 0`,
    })
    steps.push({ title: `Solve ${sayExpr(lin.toExpr(x))} = 0`, tex: `${x} = ${toTex(num(r))}` })
    real.push(rootOf(ZERO), rootOf(num(r)))
    real.sort((u, v) => u.value - v.value)
    return { real, complex }
  }
  if (b.isZero()) return solvePureSquare(p, Poly.constant(0), x, steps)
  const { disc, roots } = quadraticRoots(p)
  steps.push({
    title: `Read off a, b and c: the number in front of ${x}², the number in front of ${x}, and the number on its own`,
    tex: `a = ${toTex(num(a))},\\quad b = ${toTex(num(b))},\\quad c = ${toTex(num(c))}`,
  })
  const sqrtD = disc.sign() >= 0 ? simplify(pow(num(disc), num(Rational.HALF))) : null

  // x² + bx + c with whole-number answers: find two numbers that multiply to c and add to b.
  if (a.isOne() && b.isInteger() && c.isInteger() && sqrtD?.kind === 'num' && roots.every((r) => r.kind === 'num')) {
    const found = roots.map((r) => (r.kind === 'num' ? r.value : Rational.ZERO))
    const rs = found.length === 1 ? [found[0], found[0]] : found
    if (rs.every((r) => r.isInteger())) {
      const [m, k] = rs.map((r) => r.neg())
      const bracket = (r: Rational) => toTex(new Poly([r.neg(), Rational.ONE]).toExpr(x))
      steps.push({
        title: `Find two numbers that multiply to make c = ${say(c)} and add up to b = ${say(b)}. They are ${say(m)} and ${say(k)}`,
        tex: `${par(m)} \\times ${par(k)} = ${toTex(num(c))},\\quad ${par(m)} + ${par(k)} = ${toTex(num(b))}`,
      })
      steps.push({
        title: 'Use the two numbers to write the left side as two brackets multiplied together',
        tex: `\\left(${bracket(rs[0])}\\right)\\left(${bracket(rs[1])}\\right) = 0`,
      })
      if (disc.isZero()) {
        steps.push({ title: 'Both brackets are the same, so it must be 0', tex: `${bracket(rs[0])} = 0` })
        steps.push({ title: `Solve for ${x}`, tex: `${x} = ${toTex(num(rs[0]))}` })
        real.push(rootOf(num(rs[0])))
      } else {
        steps.push({
          title: 'Two brackets multiply to give 0, so one of them must be 0',
          tex: `${bracket(rs[0])} = 0 \\quad\\text{or}\\quad ${bracket(rs[1])} = 0`,
        })
        steps.push({
          title: 'Solve each one',
          tex: `${x} = ${toTex(num(rs[0]))} \\quad\\text{or}\\quad ${x} = ${toTex(num(rs[1]))}`,
        })
        real.push(...rs.map((r) => rootOf(num(r))))
      }
      real.sort((u, v) => u.value - v.value)
      return { real, complex }
    }
  }

  // Quadratic formula, one small move at a time.
  const bb = b.mul(b)
  const fourAC = Rational.of(4).mul(a).mul(c)
  steps.push({
    title: 'Work out the discriminant Δ = b² − 4ac. Its sign tells you how many answers there are',
    tex: `\\Delta = ${par(b)}^{2} - 4 \\cdot ${par(a)} \\cdot ${par(c)} = ${toTex(num(bb))} - ${par(fourAC)} = ${toTex(num(disc))}`,
  })
  const negB = b.neg()
  const twoA = a.mul(Rational.of(2))
  const formula = `${x} = \\frac{-${par(b)} \\pm \\sqrt{${toTex(num(disc))}}}{2 \\cdot ${par(a)}}`
  if (disc.isZero()) {
    steps.push({
      title: `Δ is 0, so there is only one answer: ${x} = −b ÷ 2a`,
      tex: `${x} = \\frac{-${par(b)}}{2 \\cdot ${par(a)}} = ${toTex(roots[0])}`,
    })
    real.push(rootOf(roots[0]))
    return { real, complex }
  }
  if (disc.sign() > 0) {
    steps.push({
      title: `Δ is positive, so there are two answers. Put a, b and Δ into the quadratic formula ${x} = (−b ± √Δ) ÷ 2a`,
      tex: formula,
    })
    const rootTex = sqrtD ? toTex(sqrtD) : ''
    const simpler = sqrtD && sqrtD.kind !== 'num' && rootTex !== `\\sqrt{${disc}}`
    steps.push({
      title: simpler
        ? `Tidy up: −b = ${say(negB)}, 2a = ${say(twoA)}, and √${disc} simplifies to ${sayExpr(sqrtD!)}`
        : `Tidy up: −b = ${say(negB)}, √Δ = ${sqrtD ? sayExpr(sqrtD) : ''} and 2a = ${say(twoA)}`,
      tex: `${x} = \\frac{${toTex(num(negB))} \\pm ${rootTex}}{${toTex(num(twoA))}}`,
    })
    const half = (sign: '+' | '-') => {
      const raw = `\\frac{${toTex(num(negB))} ${sign} ${rootTex}}{${toTex(num(twoA))}}`
      const val = simplify(div(sign === '+' ? add(num(negB), sqrtD!) : sub(num(negB), sqrtD!), num(twoA)))
      const valTex = toTex(val)
      return raw === valTex ? `${x} = ${raw}` : `${x} = ${raw} = ${valTex}`
    }
    steps.push({
      title: 'Split the ± into two answers: one with + and one with −',
      tex: `${half('+')} \\quad\\text{or}\\quad ${half('-')}`,
    })
    real.push(...roots.map(rootOf))
  } else {
    steps.push({
      title:
        'Δ is negative. No real number squared is negative, so there are no real answers. The quadratic formula still gives two complex answers',
      tex: formula,
    })
    steps.push({ title: 'Simplify, using i = √−1', tex: roots.map((r) => `${x} = ${toTex(r)}`).join(',\\quad ') })
    for (const r of roots) {
      const re = evalNum(simplify(substitute(r, 'i', ZERO)))
      const im = evalNum(simplify(substitute(sub(r, substitute(r, 'i', ZERO)), 'i', ONE)))
      complex.push({ exact: r, z: { re, im } })
    }
  }
  real.sort((u, v) => u.value - v.value)
  return { real, complex }
}

function dedupeRoots(rs: Root[]): Root[] {
  const out: Root[] = []
  for (const r of rs) {
    if (
      !out.some(
        (o) =>
          (o.exact && r.exact && key(o.exact) === key(r.exact)) ||
          (!o.general && !r.general && Math.abs(o.value - r.value) < 1e-9 * Math.max(1, Math.abs(r.value))),
      )
    )
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
    const pre: Step[] = []
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
        // Show the right side before tidying it when that helps: x = 4/2 = 2, x = 2³ = 8.
        const raw = toTex(ng)
        const shown = toTex(sg)
        const showRaw = !general && raw !== shown && raw.length < 60 && !freeSymbols(ng).size
        lines.push(showRaw ? `${toTex(nf)} = ${raw} = ${shown}` : eqTex(nf, sg))
        if (!title) title = t
      }
      switch (f.kind) {
        case 'add': {
          const withX = f.terms.find((t) => contains(t, x))!
          const others = simplify(add(...f.terms.filter((t) => t !== withX)))
          const neg_ = isNegativeTerm(others)
          const on = isSym(withX, x) ? x : `the ${x} part`
          push(
            withX,
            add(g, simplify(neg(others))),
            neg_
              ? `Add ${sayExpr(simplify(neg(others)))} to both sides. This leaves ${on} on its own`
              : `Subtract ${sayExpr(others)} from both sides. This leaves ${on} on its own`,
          )
          break
        }
        case 'mul': {
          const withX = f.factors.find((t) => contains(t, x))!
          const others = simplify(mul(...f.factors.filter((t) => t !== withX)))
          const on = isSym(withX, x) ? x : `the ${x} part`
          if (others.kind === 'pow' && others.exp.kind === 'num' && others.exp.value.eq(Rational.MINUS_ONE))
            push(
              withX,
              mul(g, others.base),
              `Multiply both sides by ${sayExpr(others.base)}. This leaves ${on} on its own`,
            )
          else if (others.kind === 'num' && !others.value.isInteger())
            push(
              withX,
              mul(g, num(others.value.inv())),
              `Multiply both sides by ${say(others.value.inv())}. This leaves ${on} on its own`,
            )
          else push(withX, div(g, others), `Divide both sides by ${sayExpr(others)}. This leaves ${on} on its own`)
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
                const t = `Take the ${ordinalRoot(Number(v.n))} root of both sides. Don't forget ±: a negative number to an even power is positive too`
                if (isZero(root)) push(base, root, `Take the ${ordinalRoot(Number(v.n))} root of both sides`)
                else {
                  push(base, root, t)
                  push(base, neg(root), t)
                }
              } else {
                if (v.d % 2n === 0n && !freeSymbols(g).size && evalNum(g) < 0) {
                  title = title || 'A square root is never negative, so this branch has no solution'
                  break
                }
                push(
                  base,
                  pow(g, num(inv)),
                  v.d === 1n
                    ? `Take the ${ordinalRoot(Number(v.n))} root of both sides. This undoes the power ${v.n}`
                    : v.n === 1n && v.d === 2n
                      ? 'Square both sides. This undoes the square root'
                      : `Raise both sides to the power ${inv.toString()}. This undoes the power ${v.toString()}`,
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
          if (isSym(base, 'e'))
            push(exp, fn('ln', g), 'Take ln (the natural log) of both sides. It undoes e to a power: ln(eᵘ) = u')
          else
            push(
              exp,
              fn('log', g, base),
              `Take log base ${sayExpr(base)} of both sides. It undoes ${sayExpr(base)} to a power, and answers "${sayExpr(base)} to what power gives ${sayExpr(g)}?"`,
            )
          break
        }
        case 'fn': {
          const a = f.args[0]
          if (f.args.length > 1 && (f.name !== 'log' || contains(f.args[1], x))) return null
          const gv = freeSymbols(g).size ? NaN : evalNum(g)
          switch (f.name) {
            case 'ln':
              push(a, pow(sym('e'), g), 'Raise e to the power of each side. This undoes ln, because e^ln(u) = u')
              break
            case 'log':
              push(
                a,
                pow(f.args[1], g),
                `Raise ${sayExpr(f.args[1])} to the power of each side. This undoes log base ${sayExpr(f.args[1])}`,
              )
              break
            case 'sqrt':
              push(a, pow(g, 2), 'Square both sides. This undoes the square root')
              break
            case 'abs':
              if (gv < 0) {
                title = title || 'An absolute value is never negative, so there is no solution'
                break
              }
              if (gv === 0) push(a, ZERO, 'The absolute value is zero only when the inside is zero')
              else {
                const t = `|u| = ${sayExpr(g)} means u is ${sayExpr(g)} or −${sayExpr(g)} (both are ${sayExpr(g)} away from 0). Split into two cases`
                push(a, g, t)
                push(a, neg(g), t)
              }
              break
            case 'sin':
            case 'cos': {
              if (Math.abs(gv) > 1 + 1e-12) {
                title = title || `${f.name} only takes values between −1 and 1, so there is no solution`
                break
              }
              const arc = f.name === 'sin' ? 'arcsin' : 'arccos'
              const inv = simplify(fn(f.name === 'sin' ? 'asin' : 'acos', g))
              const period = mul(num(2), PI, N)
              const t = `${f.name} repeats every 2π, so add 2π${N.name}, where ${N.name} can be any whole number`
              const other = f.name === 'sin' ? simplify(sub(PI, inv)) : simplify(neg(inv))
              const hasOther = key(other) !== key(inv) && (f.name === 'sin' || !isZero(inv))
              if (branches.length === 1) {
                pre.push({
                  title: `Use ${arc} to undo ${f.name}. This gives one answer`,
                  tex: `${toTex(a)} = \\${arc}\\left(${toTex(g)}\\right) = ${toTex(inv)}`,
                })
                if (hasOther) {
                  const how = f.name === 'sin' ? `\\pi - ${toTex(inv)}` : `-${toTex(inv)}`
                  pre.push({
                    title:
                      f.name === 'sin'
                        ? 'sin has the same value at π minus that angle, which gives a second answer'
                        : 'cos has the same value at minus that angle, which gives a second answer',
                    tex: `${toTex(a)} = ${how === toTex(other) ? how : `${how} = ${toTex(other)}`}`,
                  })
                }
              }
              push(a, add(inv, period), t, true)
              if (hasOther) push(a, add(other, period), t, true)
              break
            }
            case 'tan':
              push(
                a,
                add(fn('atan', g), mul(PI, N)),
                `Use arctan to undo tan. tan repeats every π, so add π${N.name}, where ${N.name} can be any whole number`,
                true,
              )
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
    steps.push(...pre)
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
    const kids =
      n.kind === 'add'
        ? n.terms
        : n.kind === 'mul'
          ? n.factors
          : n.kind === 'pow'
            ? [n.base, n.exp]
            : n.kind === 'fn'
              ? n.args
              : []
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
  const result = (
    real: Root[],
    complex: PolyRoots['complex'] = [],
    extra: Partial<EquationResult> = {},
  ): EquationResult => ({
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
    if (p.degree <= 1) return result(linearSteps(L0, R0, pl, pr, x, steps))
    // x² = 9 or 2x² + 1 = 9: no need to move everything across first.
    if (p.degree === 2 && pl.degree === 2 && pl.coef(1).isZero() && pr.isConstant() && !p.coef(0).isZero()) {
      const r = solvePureSquare(pl, pr, x, steps)
      return result(r.real, r.complex)
    }
    const expanded = p.toExpr(x)
    if (!isZero(R) || key(expanded) !== key(L))
      steps.push({
        title: 'Move everything to the left side, so the right side is 0. Then multiply out and tidy up',
        tex: `${toTex(expanded)} = 0`,
      })
    const r = solvePolynomial(p, x, steps)
    return result(r.real, r.complex)
  }

  // 2) Rational equation
  const dens = [...denominatorsOf(L, x), ...denominatorsOf(R, x)]
  const rf = ratFromExpr(diff, x, dens)
  if (rf && (!rf.den.isConstant() || dens.length > 0)) {
    const N = rf.num
    const excludedVals: Rational[] = []
    for (const d of [...dens, rf.den])
      for (const r of rationalRoots(d).roots) if (!excludedVals.some((v) => v.eq(r.value))) excludedVals.push(r.value)
    steps.push({
      title: 'Move everything to one side and combine it into one fraction',
      tex: `\\frac{${toTex(N.toExpr(x))}}{${toTex(rf.den.toExpr(x))}} = 0`,
    })
    if (excludedVals.length)
      steps.push({
        title: `Note the values ${x} can't be: they would make a bottom (denominator) equal to 0, and we can't divide by 0`,
        tex: excludedVals.map((v) => `${x} \\neq ${toTex(num(v))}`).join(',\\quad '),
      })
    if (N.isConstant()) {
      steps.push({ title: 'The top of the fraction is a number that is not 0, so the fraction can never be 0' })
      return result([], [], { excluded: excludedVals.map((v) => num(v)) })
    }
    steps.push({
      title: 'A fraction is 0 only when its top (numerator) is 0. So set the top equal to 0',
      tex: `${toTex(N.toExpr(x))} = 0`,
    })
    const r =
      N.degree <= 1
        ? { real: [rootOf(num(N.coef(0).neg().div(N.coef(1))))], complex: [] }
        : solvePolynomial(N, x, steps)
    const kept = r.real.filter((root) => !excludedVals.some((v) => Math.abs(v.toNumber() - root.value) < 1e-12))
    const rejected = r.real.filter((root) => !kept.includes(root))
    if (rejected.length)
      steps.push({
        title: "Throw away answers that would make a bottom 0, because the original equation doesn't work there",
        tex: rejected
          .map((q) => `${x} = ${q.exact ? toTex(q.exact) : texNumber(q.value)} \\text{ is excluded}`)
          .join(',\\quad '),
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
    title:
      'There is no exact method for this one. Instead, look for where the left side minus the right side equals 0, by trying values closer and closer',
    tex: `f(${x}) = ${toTex(diff)} = 0`,
  })
  const limited = roots.length > 12 ? roots.filter((r) => Math.abs(r) <= 10) : roots
  if (roots.length > 12)
    notes.push(`There are many solutions (the function is likely periodic); showing those between −10 and 10.`)
  if (roots.length)
    notes.push('Solutions were found numerically in the range −100 ≤ x ≤ 100 (searching wider if none were found).')
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
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)))
      ok.push(r)
    else bad.push(r)
  }
  if (announce || bad.length) {
    steps.push({
      title: bad.length
        ? 'Check each possible answer in the original equation. Throw away the ones that do not work'
        : 'Check each possible answer in the original equation',
      tex: [
        ...ok.map((r) => `${x} = ${r.exact ? toTex(r.exact) : texNumber(r.value)} \\;\\checkmark`),
        ...bad.map((r) => `${x} = ${r.exact ? toTex(r.exact) : texNumber(r.value)} \\;\\times`),
      ].join(',\\quad '),
    })
  }
  return ok.sort((a, b) => a.value - b.value)
}

/** Two lines of working, lined up on the = sign. */
const aligned = (rows: Array<[string, string]>) =>
  `\\begin{aligned} ${rows.map(([l, r]) => `${l} &= ${r}`).join(' \\\\ ')} \\end{aligned}`

/** Does the expression have brackets to multiply out, like 3(x − 2)? */
function hasBrackets(e: Expr): boolean {
  if (e.kind === 'mul' && e.factors.some((f) => f.kind === 'add')) return true
  if (e.kind === 'pow' && e.base.kind === 'add') return true
  return children(e).some(hasBrackets)
}

/** The terms after multiplying out brackets, before like terms are combined. */
function distributed(e: Expr): Expr[] {
  if (e.kind === 'add') return e.terms.flatMap(distributed)
  if (e.kind === 'mul') {
    const sums = e.factors.filter((f) => f.kind === 'add')
    if (sums.length === 1 && sums[0].kind === 'add') {
      const others = e.factors.filter((f) => f !== sums[0])
      return sums[0].terms.flatMap((t) => distributed(mul(...others, t)))
    }
  }
  const t = simplify(e)
  return t.kind === 'add' ? [...t.terms] : [t]
}

const sumOf = (terms: Expr[]): Expr => (terms.length === 1 ? terms[0] : { kind: 'add', terms })

function linearSteps(L0: Expr, R0: Expr, pl: Poly, pr: Poly, x: string, steps: Step[]): Root[] {
  const X = sym(x)
  let [a1, b1, a2, b2] = [pl.coef(1), pl.coef(0), pr.coef(1), pr.coef(0)]
  const lin = (a: Rational, b: Rational) => simplify(add(mul(num(a), X), num(b)))
  const L = simplify(L0)
  const R = simplify(R0)
  const brackets = hasBrackets(L0) || hasBrackets(R0)
  const Ld = distributed(L0)
  const Rd = distributed(R0)
  if (brackets)
    steps.push({
      title: 'Multiply out the brackets: multiply each term inside by what is outside',
      tex: eqTex(sumOf(Ld), sumOf(Rd)),
    })
  const crowded = (ts: Expr[]) =>
    ts.filter((t) => contains(t, x)).length > 1 || ts.filter((t) => !contains(t, x)).length > 1
  if (crowded(Ld) || crowded(Rd))
    steps.push({
      title: `Combine like terms: add up the ${x} terms, and add up the plain numbers`,
      tex: eqTex(lin(a1, b1), lin(a2, b2)),
    })
  else if (!brackets && (key(lin(a1, b1)) !== key(L) || key(lin(a2, b2)) !== key(R)))
    steps.push({ title: 'Simplify both sides', tex: eqTex(lin(a1, b1), lin(a2, b2)) })
  if (a1.isZero()) {
    ;[a1, b1, a2, b2] = [a2, b2, a1, b1]
    steps.push({ title: `Swap the two sides so ${x} is on the left`, tex: eqTex(lin(a1, b1), lin(a2, b2)) })
  }
  if (!a2.isZero()) {
    const t = toTex(simplify(mul(num(a2.abs()), X)))
    const op = a2.sign() > 0 ? '-' : '+'
    const before = [toTex(lin(a1, b1)), toTex(lin(a2, b2))]
    a1 = a1.sub(a2)
    steps.push({
      title: `${a2.sign() > 0 ? `Subtract ${sayExpr(simplify(mul(num(a2), X)))} from` : `Add ${sayExpr(simplify(mul(num(a2.neg()), X)))} to`} both sides. This gets all the ${x} terms on the left`,
      tex: aligned([
        [`${before[0]} ${op} ${t}`, `${before[1]} ${op} ${t}`],
        [toTex(lin(a1, b1)), toTex(num(b2))],
      ]),
    })
    a2 = Rational.ZERO
  }
  if (!b1.isZero()) {
    const c = toTex(num(b1.abs()))
    const op = b1.sign() > 0 ? '-' : '+'
    steps.push({
      title: `${b1.sign() > 0 ? `Subtract ${say(b1)} from` : `Add ${say(b1.neg())} to`} both sides. This leaves the ${x} term on its own`,
      tex: aligned([
        [`${toTex(lin(a1, b1))} ${op} ${c}`, `${toTex(num(b2))} ${op} ${c}`],
        [toTex(lin(a1, Rational.ZERO)), toTex(num(b2.sub(b1)))],
      ]),
    })
    b2 = b2.sub(b1)
    b1 = Rational.ZERO
  }
  const r = b2.div(a1)
  if (!a1.isOne()) {
    const ax = toTex(lin(a1, Rational.ZERO))
    if (a1.eq(Rational.MINUS_ONE)) {
      steps.push({
        title: `Multiply both sides by −1. This changes −${x} into ${x}`,
        tex: aligned([
          [`-1 \\cdot \\left(${ax}\\right)`, `-1 \\cdot ${par(b2)}`],
          [x, toTex(num(r))],
        ]),
      })
    } else if (a1.isInteger()) {
      steps.push({
        title: `Divide both sides by ${say(a1)}. This leaves ${x} on its own`,
        tex: aligned([
          [
            `\\frac{${ax}}{${toTex(num(a1))}}`,
            b2.isInteger() ? `\\frac{${toTex(num(b2))}}{${toTex(num(a1))}}` : `${par(b2)} \\div ${par(a1)}`,
          ],
          [x, toTex(num(r))],
        ]),
      })
    } else {
      const inv = a1.inv()
      steps.push({
        title: inv.isInteger()
          ? `Multiply both sides by ${say(inv)}. This undoes the division and leaves ${x} on its own`
          : `Multiply both sides by ${say(inv)} (${say(a1)} turned upside down). This leaves ${x} on its own`,
        tex: aligned([
          [`${par(inv)} \\cdot ${ax}`, `${par(inv)} \\cdot ${par(b2)}`],
          [x, toTex(num(r))],
        ]),
      })
    }
  }
  return [rootOf(num(r))]
}

/** Puts each exact answer back into the original equation to show it works. */
function checkStep(L: Expr, R: Expr, x: string, roots: Root[]): Step | null {
  if (!roots.length || roots.length > 4 || size(L) + size(R) > 60) return null
  if (roots.some((r) => r.general || r.symbolic || !r.exact || r.exact.kind !== 'num')) return null
  const rightHasX = contains(R, x)
  const rows: Step[] = []
  for (const r of roots) {
    const v = r.exact!
    let lv: Expr
    let rv: Expr
    try {
      lv = simplify(substitute(L, x, v))
      rv = simplify(substitute(R, x, v))
    } catch {
      return null
    }
    if (lv.kind !== 'num' || rv.kind !== 'num' || !lv.value.eq(rv.value)) return null
    const work = (side: Expr, val: Expr) => {
      const put = substitute(side, x, v)
      const w = literalTex(put) ?? toTex(put)
      return w === toTex(val) ? w : `${w} = ${toTex(val)}`
    }
    const shown = sayExpr(lv)
    rows.push({
      title: rightHasX
        ? `${x} = ${sayExpr(v)}: both sides come out as ${shown} ✓`
        : `${x} = ${sayExpr(v)}: the left side comes out as ${shown}, the same as the right side ✓`,
      tex: rightHasX ? `${work(L, lv)} \\quad\\text{and}\\quad ${work(R, rv)}` : work(L, lv),
    })
  }
  if (rows.length === 1)
    return {
      title: `Check: put ${x} = ${sayExpr(roots[0].exact!)} back into the original equation. ${rows[0].title.replace(/^[^:]*: /, '').replace(/^./, (ch) => ch.toUpperCase())}`,
      tex: rows[0].tex,
    }
  return { title: 'Check: put each answer back into the original equation', substeps: rows }
}

function solveRadical(diff: Expr, x: string, steps: Step[]): Root[] | null {
  const terms = diff.kind === 'add' ? diff.terms : [diff]
  const isRad = (t: Expr): Expr | null => {
    const fs = t.kind === 'mul' ? t.factors : [t]
    const rads = fs.filter(
      (f) => f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.eq(Rational.HALF) && contains(f.base, x),
    )
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
  steps.push({ title: 'Get the square root on its own on one side', tex: eqTex(T, rhs) })
  const squared = A.scale(c.value.mul(c.value)).sub(rest.mul(rest))
  steps.push({
    title:
      'Square both sides to get rid of the square root. Squaring can create answers that do not really work, so we check them at the end',
    tex: `${toTex(simplify(mul(pow(c, 2), rad.base)))} = ${toTex(simplify(pow(rhs, 2)))}`,
  })
  if (squared.degree < 1) return []
  steps.push({ title: 'Multiply out and move everything to one side', tex: `${toTex(squared.toExpr(x))} = 0` })
  const r =
    squared.degree === 1
      ? { real: [rootOf(num(squared.coef(0).neg().div(squared.coef(1))))] }
      : solvePolynomial(squared, x, steps)
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
    const kids =
      n.kind === 'add'
        ? n.terms
        : n.kind === 'mul'
          ? n.factors
          : n.kind === 'pow'
            ? [n.base, n.exp]
            : n.kind === 'fn'
              ? n.args
              : []
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
    steps.push({
      title: `Let ${u} = ${sayExpr(g)}. Written with ${u}, the equation becomes a simpler polynomial`,
      tex: `${toTex(p.toExpr(u))} = 0`,
    })
    steps.push({
      title: `Solve for ${u}`,
      substeps: sub,
      tex: r.real.map((q) => `${u} = ${q.exact ? toTex(q.exact) : texNumber(q.value)}`).join(',\\quad ') || undefined,
    })
    const roots: Root[] = []
    for (const q of r.real) {
      const back: Step[] = []
      const target = q.exact ?? num(Rational.approximate(q.value, 1e9, 1e-15) ?? Rational.ZERO)
      const res = solveEq(g, target, x, back)
      steps.push({
        title: `Now go back to ${x}: solve ${sayExpr(g)} = ${q.exact ? sayExpr(q.exact) : formatNumber(q.value)}`,
        substeps: back,
      })
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
    exact = {
      kind: 'add',
      terms: [...exact.terms.filter((t) => !contains(t, n)), ...exact.terms.filter((t) => contains(t, n))],
    }
  }
  const isPlainNumber = exact && exact.kind === 'num'
  return {
    tex: `${x} = ${exact ? toTex(exact) : `${texNumber(r.value)}`}${exact ? '' : '\\ (\\text{approx.})'}`,
    text: `${x} = ${exact ? toText(exact) : formatNumber(r.value)}`,
    approx:
      exact && !isPlainNumber && Number.isFinite(r.value)
        ? r.general
          ? `${formatNumber(r.value)} (n = 0)`
          : formatNumber(r.value)
        : undefined,
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
  if (!res.identity && !res.numeric && !steps.some((st) => st.title.startsWith('Check'))) {
    const check = checkStep(L, R, x, res.real)
    if (check) steps.push(check)
  }
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
