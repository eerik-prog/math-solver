import { type Expr, add, frac, mul, num, pow, sym } from './expr'
import { MathError, Rational, divisors, gcd, lcm } from './rational'
import { simplify } from './simplify'

/** Univariate polynomial with exact rational coefficients; c[i] multiplies x^i. */
export class Poly {
  readonly c: readonly Rational[]

  constructor(c: readonly Rational[]) {
    let n = c.length
    while (n > 0 && c[n - 1].isZero()) n--
    this.c = c.slice(0, n)
  }

  static constant(r: Rational | number): Poly {
    return new Poly([r instanceof Rational ? r : Rational.of(r)])
  }
  static x(): Poly {
    return new Poly([Rational.ZERO, Rational.ONE])
  }
  /** (x - r) */
  static linearRoot(r: Rational): Poly {
    return new Poly([r.neg(), Rational.ONE])
  }

  get degree(): number {
    return this.c.length - 1
  }
  get lead(): Rational {
    return this.c[this.c.length - 1] ?? Rational.ZERO
  }
  coef(i: number): Rational {
    return this.c[i] ?? Rational.ZERO
  }
  isZero(): boolean {
    return this.c.length === 0
  }
  isConstant(): boolean {
    return this.c.length <= 1
  }

  add(o: Poly): Poly {
    const n = Math.max(this.c.length, o.c.length)
    return new Poly(Array.from({ length: n }, (_, i) => this.coef(i).add(o.coef(i))))
  }
  sub(o: Poly): Poly {
    return this.add(o.neg())
  }
  neg(): Poly {
    return new Poly(this.c.map((r) => r.neg()))
  }
  scale(r: Rational): Poly {
    return new Poly(this.c.map((v) => v.mul(r)))
  }
  mul(o: Poly): Poly {
    if (this.isZero() || o.isZero()) return new Poly([])
    const out = Array.from({ length: this.c.length + o.c.length - 1 }, () => Rational.ZERO)
    this.c.forEach((a, i) => {
      if (a.isZero()) return
      o.c.forEach((b, j) => {
        out[i + j] = out[i + j].add(a.mul(b))
      })
    })
    return new Poly(out)
  }
  pow(n: number): Poly {
    let r = Poly.constant(1)
    for (let i = 0; i < n; i++) r = r.mul(this)
    return r
  }

  divmod(d: Poly): { q: Poly; r: Poly } {
    if (d.isZero()) throw new MathError('Division by zero polynomial')
    let r = new Poly(this.c)
    const q = Array.from({ length: Math.max(0, this.degree - d.degree + 1) }, () => Rational.ZERO)
    while (!r.isZero() && r.degree >= d.degree) {
      const k = r.degree - d.degree
      const f = r.lead.div(d.lead)
      q[k] = f
      const shifted = new Poly([...Array.from({ length: k }, () => Rational.ZERO), ...d.c.map((v) => v.mul(f))])
      r = r.sub(shifted)
    }
    return { q: new Poly(q), r }
  }

  eval(x: Rational): Rational {
    let acc = Rational.ZERO
    for (let i = this.c.length - 1; i >= 0; i--) acc = acc.mul(x).add(this.c[i])
    return acc
  }
  evalNum(x: number): number {
    let acc = 0
    for (let i = this.c.length - 1; i >= 0; i--) acc = acc * x + this.c[i].toNumber()
    return acc
  }

  derivative(): Poly {
    return new Poly(this.c.slice(1).map((v, i) => v.mul(Rational.of(i + 1))))
  }

  monic(): Poly {
    return this.isZero() ? this : this.scale(this.lead.inv())
  }

  /** this = content · primitive, where primitive has coprime integer coefficients and a positive lead. */
  primitive(): { content: Rational; prim: Poly } {
    if (this.isZero()) return { content: Rational.ONE, prim: this }
    let den = 1n
    for (const v of this.c) den = lcm(den, v.d)
    let g = 0n
    for (const v of this.c) g = gcd(g, v.n * (den / v.d))
    let content = new Rational(g, den)
    if (this.lead.sign() < 0) content = content.neg()
    return { content, prim: this.scale(content.inv()) }
  }

  gcd(o: Poly): Poly {
    let a = new Poly(this.c)
    let b: Poly = o
    while (!b.isZero()) {
      const { r } = a.divmod(b)
      a = b
      b = r
    }
    return a.monic()
  }

  equals(o: Poly): boolean {
    return this.c.length === o.c.length && this.c.every((v, i) => v.eq(o.c[i]))
  }

  toExpr(x: string): Expr {
    const v = sym(x)
    const terms: Expr[] = []
    for (let i = this.c.length - 1; i >= 0; i--) {
      if (this.c[i].isZero()) continue
      terms.push(i === 0 ? num(this.c[i]) : mul(num(this.c[i]), i === 1 ? v : pow(v, i)))
    }
    if (terms.length === 0) return num(0)
    return simplify(add(...terms))
  }
}

/** Converts an expression to a polynomial in x with rational coefficients, or null. */
export function polyFromExpr(e: Expr, x: string): Poly | null {
  switch (e.kind) {
    case 'num':
      return Poly.constant(e.value)
    case 'sym':
      return e.name === x ? Poly.x() : null
    case 'add': {
      let acc = Poly.constant(0)
      for (const t of e.terms) {
        const p = polyFromExpr(t, x)
        if (!p) return null
        acc = acc.add(p)
      }
      return acc
    }
    case 'mul': {
      let acc = Poly.constant(1)
      for (const f of e.factors) {
        const p = polyFromExpr(f, x)
        if (!p) return null
        acc = acc.mul(p)
      }
      return acc
    }
    case 'pow': {
      if (e.exp.kind !== 'num' || !e.exp.value.isInteger() || e.exp.value.sign() < 0) return null
      const n = Number(e.exp.value.n)
      if (n > 200) return null
      const b = polyFromExpr(e.base, x)
      return b && b.pow(n)
    }
    default:
      return null
  }
}

export interface RatFunc {
  num: Poly
  den: Poly
}

/**
 * Converts to a ratio of polynomials. Every denominator met on the way is
 * pushed to `dens`, so callers can exclude points where the original
 * expression is undefined even after cancellation.
 */
export function ratFromExpr(e: Expr, x: string, dens: Poly[] = []): RatFunc | null {
  switch (e.kind) {
    case 'num':
    case 'sym': {
      const p = polyFromExpr(e, x)
      return p && { num: p, den: Poly.constant(1) }
    }
    case 'add': {
      let acc: RatFunc = { num: Poly.constant(0), den: Poly.constant(1) }
      for (const t of e.terms) {
        const r = ratFromExpr(t, x, dens)
        if (!r) return null
        acc = reduce({ num: acc.num.mul(r.den).add(r.num.mul(acc.den)), den: acc.den.mul(r.den) })
      }
      return acc
    }
    case 'mul': {
      let acc: RatFunc = { num: Poly.constant(1), den: Poly.constant(1) }
      for (const f of e.factors) {
        const r = ratFromExpr(f, x, dens)
        if (!r) return null
        acc = reduce({ num: acc.num.mul(r.num), den: acc.den.mul(r.den) })
      }
      return acc
    }
    case 'pow': {
      if (e.exp.kind !== 'num' || !e.exp.value.isInteger()) return null
      const n = Number(e.exp.value.n)
      if (Math.abs(n) > 100) return null
      const b = ratFromExpr(e.base, x, dens)
      if (!b) return null
      if (n >= 0) return { num: b.num.pow(n), den: b.den.pow(n) }
      if (b.num.isZero()) throw new MathError('Division by zero')
      if (!b.num.isConstant()) dens.push(b.num)
      return { num: b.den.pow(-n), den: b.num.pow(-n) }
    }
    default:
      return null
  }
}

function reduce(r: RatFunc): RatFunc {
  if (r.num.isZero()) return { num: r.num, den: Poly.constant(1) }
  let { num: n, den: d } = r
  if (!d.isConstant()) {
    const g = n.gcd(d)
    if (g.degree > 0) {
      n = n.divmod(g).q
      d = d.divmod(g).q
    }
  }
  const s = d.lead.inv()
  return { num: n.scale(s), den: d.scale(s) }
}

// ---------------------------------------------------------------------------
// Roots

export interface RationalRootResult {
  roots: { value: Rational; mult: number }[]
  /** Remaining factor with no rational roots (constant if fully factored). */
  rest: Poly
  /** Steps for explaining the search (candidate count etc.). */
  candidates: number
}

export function rationalRoots(p: Poly): RationalRootResult {
  const roots: { value: Rational; mult: number }[] = []
  let rest = p
  let zeroMult = 0
  while (!rest.isZero() && rest.degree > 0 && rest.coef(0).isZero()) {
    rest = new Poly(rest.c.slice(1))
    zeroMult++
  }
  if (zeroMult) roots.push({ value: Rational.ZERO, mult: zeroMult })
  let candidates = 0
  if (rest.degree >= 1) {
    const { prim } = rest.primitive()
    const a0 = prim.coef(0).n
    const an = prim.lead.n
    const ps = divisors(a0)
    const qs = divisors(an)
    if (ps && qs && ps.length * qs.length <= 20000) {
      const seen = new Set<string>()
      const cands: Rational[] = []
      for (const q of qs)
        for (const pp of ps)
          for (const s of [1n, -1n]) {
            const r = new Rational(s * pp, q)
            if (!seen.has(r.toString())) {
              seen.add(r.toString())
              cands.push(r)
            }
          }
      candidates = cands.length
      cands.sort((a, b) => Math.abs(a.toNumber()) - Math.abs(b.toNumber()) || b.sign() - a.sign())
      for (const r of cands) {
        if (rest.degree < 1) break
        let mult = 0
        while (rest.degree >= 1 && rest.eval(r).isZero()) {
          rest = rest.divmod(Poly.linearRoot(r)).q
          mult++
        }
        if (mult) roots.push({ value: r, mult })
      }
    }
  }
  roots.sort((a, b) => a.value.cmp(b.value))
  return { roots, rest, candidates }
}

export interface Complex {
  re: number
  im: number
}

/** All complex roots by the Durand–Kerner iteration, polished with Newton steps. */
export function complexRoots(p: Poly): Complex[] {
  const n = p.degree
  if (n < 1) return []
  const lead = p.lead.toNumber()
  const a = p.c.map((v) => v.toNumber() / lead)
  const evalC = (z: Complex): Complex => {
    let re = 0,
      im = 0
    for (let i = n; i >= 0; i--) {
      const nr = re * z.re - im * z.im + a[i]
      im = re * z.im + im * z.re
      re = nr
    }
    return { re, im }
  }
  const radius = 1 + Math.max(...a.slice(0, n).map(Math.abs))
  let zs: Complex[] = Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n + 0.4
    return { re: radius * 0.5 * Math.cos(t), im: radius * 0.5 * Math.sin(t) }
  })
  for (let iter = 0; iter < 500; iter++) {
    let delta = 0
    zs = zs.map((z, i) => {
      const num = evalC(z)
      let dr = 1,
        di = 0
      zs.forEach((w, j) => {
        if (j === i) return
        const xr = z.re - w.re,
          xi = z.im - w.im
        const nr = dr * xr - di * xi
        di = dr * xi + di * xr
        dr = nr
      })
      const den = dr * dr + di * di || 1e-300
      const qr = (num.re * dr + num.im * di) / den
      const qi = (num.im * dr - num.re * di) / den
      delta = Math.max(delta, Math.hypot(qr, qi))
      return { re: z.re - qr, im: z.im - qi }
    })
    if (delta < 1e-14 * radius) break
  }
  return zs
    .map((z) => ({ re: clean(z.re), im: Math.abs(z.im) < 1e-9 * Math.max(1, Math.abs(z.re)) ? 0 : clean(z.im) }))
    .sort((u, v) => u.re - v.re || u.im - v.im)
}

function clean(v: number): number {
  const r = Math.round(v)
  return Math.abs(v - r) < 1e-10 ? r : v
}

/** Exact roots of a quadratic as expressions (possibly with radicals or i). */
export function quadraticRoots(p: Poly): { disc: Rational; roots: Expr[] } {
  if (p.degree !== 2) throw new Error('not quadratic')
  const [c, b, a] = [p.coef(0), p.coef(1), p.coef(2)]
  const disc = b.mul(b).sub(Rational.of(4).mul(a).mul(c))
  const center = b.neg().div(a.mul(Rational.of(2)))
  if (disc.isZero()) return { disc, roots: [num(center)] }
  const k = Rational.ONE.div(a.mul(Rational.of(2))).abs()
  const root = (s: number) => simplify(add(num(center), mul(num(k.mul(Rational.of(s))), pow(num(disc), frac(1, 2)))))
  return { disc, roots: [root(-1), root(1)] }
}

/**
 * Factors over the rationals: content · x^k · linear factors · other factors.
 * Quadratic factors without rational roots are found by pairing numeric roots.
 */
export function factorPoly(p: Poly): { content: Rational; factors: { poly: Poly; mult: number }[] } {
  const { content, prim } = p.primitive()
  const factors: { poly: Poly; mult: number }[] = []
  const { roots, rest } = rationalRoots(prim)
  for (const { value, mult } of roots) {
    // (q x - p) with integer coefficients
    factors.push({ poly: new Poly([Rational.of(-value.n), Rational.of(value.d)]), mult })
  }
  let remaining = rest.primitive().prim
  if (remaining.degree >= 4 && remaining.degree <= 12) {
    const found = splitQuadratics(remaining)
    for (const q of found.quadratics) {
      const existing = factors.find((f) => f.poly.equals(q))
      if (existing) existing.mult++
      else factors.push({ poly: q, mult: 1 })
    }
    remaining = found.rest
  }
  if (remaining.degree >= 1) factors.push({ poly: remaining, mult: 1 })
  // Linear factors stay in root order; higher-degree ones go after, by degree then coefficients.
  const cmpPoly = (a: Poly, b: Poly) => {
    for (let i = 0; i <= a.degree; i++) {
      const c = a.coef(i).cmp(b.coef(i))
      if (c) return c
    }
    return 0
  }
  factors.sort((a, b) =>
    a.poly.degree <= 1 && b.poly.degree <= 1 ? 0 : a.poly.degree - b.poly.degree || cmpPoly(a.poly, b.poly),
  )
  // content correction: product of primitive factors may differ from prim by a constant
  let product = Poly.constant(1)
  for (const f of factors) product = product.mul(f.poly.pow(f.mult))
  const adjust = product.isZero() ? Rational.ONE : prim.lead.div(product.lead)
  return { content: content.mul(adjust), factors }
}

function splitQuadratics(p: Poly): { quadratics: Poly[]; rest: Poly } {
  const quadratics: Poly[] = []
  let rest = p
  let progress = true
  while (progress && rest.degree >= 4) {
    progress = false
    const zs = complexRoots(rest)
    outer: for (let i = 0; i < zs.length; i++)
      for (let j = i + 1; j < zs.length; j++) {
        const s = zs[i].re + zs[j].re
        const si = zs[i].im + zs[j].im
        const pr = zs[i].re * zs[j].re - zs[i].im * zs[j].im
        const pi = zs[i].re * zs[j].im + zs[i].im * zs[j].re
        if (Math.abs(si) > 1e-7 || Math.abs(pi) > 1e-7) continue
        const b = Rational.approximate(-s, 1000, 1e-8)
        const c = Rational.approximate(pr, 1000, 1e-8)
        if (!b || !c) continue
        const q = new Poly([c, b, Rational.ONE]).primitive().prim
        const { q: quot, r } = rest.divmod(q)
        if (r.isZero()) {
          quadratics.push(q)
          rest = quot.primitive().prim
          progress = true
          break outer
        }
      }
  }
  return { quadratics, rest }
}
