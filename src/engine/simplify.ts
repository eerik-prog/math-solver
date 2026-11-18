import {
  type Expr,
  type Fn,
  CONSTANTS,
  E,
  contains,
  I,
  ONE,
  PI,
  ZERO,
  frac,
  freeSymbols,
  isNum,
  isOne,
  isSym,
  isZero,
  key,
  num,
  size,
} from './expr'
import { MathError, Rational, exactRoot, extractPower, gcd, lcm } from './rational'

/** Results of `simplify` are remembered so re-simplifying canonical trees is free. */
const canonical = new WeakSet<object>()
const mark = <T extends Expr>(e: T): T => {
  canonical.add(e)
  return e
}

/**
 * Brings an expression into a canonical form: flattens sums and products,
 * combines like terms and powers, evaluates exact numeric parts (including
 * radicals and well-known trigonometric values) and orders terms.
 */
export function simplify(e: Expr): Expr {
  if (canonical.has(e)) return e
  let r: Expr
  switch (e.kind) {
    case 'num':
    case 'sym':
      r = e
      break
    case 'add':
      r = simplifyAdd(e.terms.map(simplify))
      break
    case 'mul':
      r = simplifyMul(e.factors.map(simplify))
      break
    case 'pow':
      r = simplifyPow(simplify(e.base), simplify(e.exp))
      break
    case 'fn':
      r = simplifyFn(e.name, e.args.map(simplify))
      break
  }
  return mark(r)
}

// ---------------------------------------------------------------------------
// Sums

/** Splits a canonical term into its rational coefficient and the rest. */
export function splitCoef(t: Expr): [Rational, Expr | null] {
  if (t.kind === 'num') return [t.value, null]
  if (t.kind === 'mul' && t.factors[0].kind === 'num') {
    const rest = t.factors.slice(1)
    return [t.factors[0].value, rest.length === 1 ? rest[0] : mark({ kind: 'mul', factors: rest })]
  }
  return [Rational.ONE, t]
}

function withCoef(c: Rational, rest: Expr | null): Expr {
  if (rest === null) return num(c)
  if (c.isZero()) return ZERO
  if (c.isOne()) return rest
  const factors = rest.kind === 'mul' ? rest.factors : [rest]
  return mark({ kind: 'mul', factors: [num(c), ...factors] })
}

function simplifyAdd(terms: Expr[]): Expr {
  const flat: Expr[] = []
  for (const t of terms) {
    if (t.kind === 'add') flat.push(...t.terms)
    else flat.push(t)
  }
  let constant = Rational.ZERO
  const groups = new Map<string, { coef: Rational; rest: Expr }>()
  for (const t of flat) {
    const [c, rest] = splitCoef(t)
    if (rest === null) {
      constant = constant.add(c)
      continue
    }
    const k = key(rest)
    const g = groups.get(k)
    if (g) g.coef = g.coef.add(c)
    else groups.set(k, { coef: c, rest })
  }
  const out: Expr[] = []
  for (const { coef, rest } of groups.values()) if (!coef.isZero()) out.push(withCoef(coef, rest))
  if (!constant.isZero()) out.push(num(constant))
  if (out.length === 0) return ZERO
  if (out.length === 1) return out[0]
  out.sort(compareTerms)
  return { kind: 'add', terms: out }
}

/** Exponent of each variable in a term, used for polynomial-style ordering. */
function monomial(t: Expr, out = new Map<string, number>()): Map<string, number> {
  if (t.kind === 'sym' && !CONSTANTS.has(t.name)) out.set(t.name, (out.get(t.name) ?? 0) + 1)
  else if (t.kind === 'pow' && t.base.kind === 'sym' && !CONSTANTS.has(t.base.name) && t.exp.kind === 'num')
    out.set(t.base.name, (out.get(t.base.name) ?? 0) + t.exp.value.toNumber())
  else if (t.kind === 'mul') for (const f of t.factors) monomial(f, out)
  return out
}

export function compareTerms(a: Expr, b: Expr): number {
  const ma = monomial(a)
  const mb = monomial(b)
  const da = [...ma.values()].reduce((s, v) => s + v, 0)
  const db = [...mb.values()].reduce((s, v) => s + v, 0)
  if (da !== db) return db - da
  const vars = [...new Set([...ma.keys(), ...mb.keys()])].sort()
  for (const v of vars) {
    const d = (mb.get(v) ?? 0) - (ma.get(v) ?? 0)
    if (d !== 0) return d
  }
  const ia = contains(a, 'i') ? 1 : 0
  const ib = contains(b, 'i') ? 1 : 0
  if (ia !== ib) return ia - ib
  // (1 − √5) rather than (−√5 + 1): plain numbers lead in purely numeric sums
  if (a.kind === 'num' && isNumericRadical(b)) return -1
  if (b.kind === 'num' && isNumericRadical(a)) return 1
  const sa = splitCoef(a)[0].sign()
  const sb = splitCoef(b)[0].sign()
  if (sa !== sb && da === 0 && freeSymbols(a).size > 0 && freeSymbols(b).size > 0) return sb - sa
  const va = freeSymbols(a).size > 0 ? 1 : 0
  const vb = freeSymbols(b).size > 0 ? 1 : 0
  if (va !== vb) return vb - va
  const ka = key(splitCoef(a)[1] ?? a)
  const kb = key(splitCoef(b)[1] ?? b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

function isNumericRadical(e: Expr): boolean {
  if (e.kind === 'num') return true
  if (e.kind === 'pow') return e.base.kind === 'num' && e.exp.kind === 'num'
  if (e.kind === 'mul') return e.factors.every(isNumericRadical)
  return false
}

// ---------------------------------------------------------------------------
// Products

function factorRank(f: Expr): number {
  if (f.kind === 'num') return 0
  if (f.kind === 'pow' && f.base.kind === 'num') return 1
  if (f.kind === 'sym' && f.name === 'i') return 7
  if (f.kind === 'sym' && CONSTANTS.has(f.name)) return 2
  if (f.kind === 'sym') return 3
  if (f.kind === 'pow' && f.base.kind === 'sym' && !CONSTANTS.has(f.base.name) && f.exp.kind === 'num') return 3
  if (f.kind === 'pow' && f.base.kind === 'sym' && f.exp.kind === 'num') return 2
  if (f.kind === 'fn' || f.kind === 'pow') return 4
  return 5
}

function baseName(f: Expr): string {
  if (f.kind === 'pow') return key(f.base)
  return key(f)
}

function compareFactors(a: Expr, b: Expr): number {
  const ra = factorRank(a)
  const rb = factorRank(b)
  if (ra !== rb) return ra - rb
  const ka = baseName(a)
  const kb = baseName(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  const ea = key(a)
  const eb = key(b)
  return ea < eb ? -1 : ea > eb ? 1 : 0
}

function simplifyMul(factors: Expr[]): Expr {
  const flat: Expr[] = []
  for (const f of factors) {
    if (f.kind === 'mul') flat.push(...f.factors)
    else flat.push(f)
  }
  let coef = Rational.ONE
  const groups = new Map<string, { base: Expr; exps: Expr[] }>()
  for (const f of flat) {
    if (f.kind === 'num') {
      coef = coef.mul(f.value)
      continue
    }
    const [b, x] = f.kind === 'pow' ? [f.base, f.exp] : [f, ONE]
    const k = key(b)
    const g = groups.get(k)
    if (g) g.exps.push(x)
    else groups.set(k, { base: b, exps: [x] })
  }
  if (coef.isZero()) return ZERO

  const out: Expr[] = []
  const radicals = new Map<number, bigint>()
  const absorb = (p: Expr) => {
    if (p.kind === 'num') coef = coef.mul(p.value)
    else if (p.kind === 'mul') p.factors.forEach(absorb)
    else if (
      p.kind === 'pow' &&
      p.base.kind === 'num' &&
      p.base.value.isInteger() &&
      p.base.value.sign() > 0 &&
      p.exp.kind === 'num' &&
      p.exp.value.n === 1n &&
      p.exp.value.d <= 64n
    ) {
      const q = Number(p.exp.value.d)
      radicals.set(q, (radicals.get(q) ?? 1n) * p.base.value.n)
    } else out.push(p)
  }
  for (const { base, exps } of groups.values()) {
    const x = exps.length === 1 ? exps[0] : simplify({ kind: 'add', terms: exps })
    if (isZero(x)) continue
    absorb(simplifyPow(base, x))
  }
  for (const [q, product] of radicals) {
    const r = numPow(new Rational(product), Rational.of(1, q))
    if (r.kind === 'num') coef = coef.mul(r.value)
    else if (r.kind === 'mul') {
      for (const f of r.factors) {
        if (f.kind === 'num') coef = coef.mul(f.value)
        else out.push(f)
      }
    } else out.push(r)
  }
  if (coef.isZero()) return ZERO
  out.sort(compareFactors)
  if (out.length === 0) return num(coef)
  if (out.length === 1 && coef.isOne()) return out[0]
  if (out.length === 1 && out[0].kind === 'add') {
    // Distribute a numeric coefficient over a sum: 2(x + 1) -> 2x + 2.
    const c = coef
    return simplifyAdd(out[0].terms.map((t) => simplifyMul([num(c), t])))
  }
  return { kind: 'mul', factors: coef.isOne() ? out : [num(coef), ...out] }
}

// ---------------------------------------------------------------------------
// Powers

/** Exact rational power of a rational number, with radicals in simplest form. */
export function numPow(b: Rational, x: Rational): Expr {
  if (x.isInteger()) {
    if (b.isZero() && x.sign() < 0) throw new MathError('Division by zero')
    return num(b.pow(x.n))
  }
  if (b.isZero()) {
    if (x.sign() < 0) throw new MathError('Division by zero')
    return ZERO
  }
  if (b.isOne()) return ONE
  if (b.sign() < 0) {
    if (x.d % 2n === 1n) {
      const r = numPow(b.neg(), x)
      return x.n % 2n === 0n ? r : simplifyMul([num(-1), r])
    }
    if (x.d === 2n) return simplifyMul([simplifyPow(I, num(x.n)), numPow(b.neg(), x)])
    return mark({ kind: 'pow', base: num(b), exp: num(x) })
  }
  const k = x.floor()
  const f = x.sub(new Rational(k))
  let coef = b.pow(k)
  let q = Number(f.d)
  const a = f.n
  // (n/d)^(a/q) = (n^a * d^(q-a))^(1/q) / d
  const N = b.n ** a * b.d ** (f.d - a)
  if (N.toString().length > 80) return mark({ kind: 'pow', base: num(b), exp: num(x) })
  coef = coef.div(new Rational(b.d))
  const { outside, inside } = extractPower(N, q)
  coef = coef.mul(new Rational(outside))
  let s = inside
  // 4^(1/4) -> 2^(1/2)
  for (let j = 2; j <= q; j++) {
    while (q % j === 0) {
      const r = exactRoot(s, j)
      if (r === null) break
      s = r
      q /= j
    }
  }
  if (s === 1n) return num(coef)
  const rad: Expr = mark({ kind: 'pow', base: num(s), exp: frac(1, q) })
  if (coef.isOne()) return rad
  return mark({ kind: 'mul', factors: [num(coef), rad] })
}

function isEvenInteger(e: Expr): boolean {
  return e.kind === 'num' && e.value.isInteger() && e.value.n % 2n === 0n
}

function simplifyPow(b: Expr, x: Expr): Expr {
  if (isZero(x)) return ONE
  if (isOne(x)) return b
  if (isOne(b)) return ONE
  if (x.kind === 'num') {
    const xv = x.value
    if (b.kind === 'num') return numPow(b.value, xv)
    if (isSym(b, 'i') && xv.isInteger()) {
      const m = Number(((xv.n % 4n) + 4n) % 4n)
      return [ONE, I, num(-1), simplifyMul([num(-1), I])][m]
    }
    if (b.kind === 'pow') {
      if (xv.isInteger() || (b.exp.kind === 'num' && b.exp.value.n % 2n !== 0n)) {
        return simplifyPow(b.base, simplifyMul([b.exp, x]))
      }
      if (isEvenInteger(b.exp)) {
        return simplifyPow(simplifyFn('abs', [b.base]), simplifyMul([b.exp, x]))
      }
    }
    if (b.kind === 'mul') {
      if (xv.isInteger()) return simplifyMul(b.factors.map((f) => simplifyPow(f, x)))
      const [c, rest] = splitCoef(b)
      if (rest && !c.isOne() && c.sign() > 0) return simplifyMul([numPow(c, xv), simplifyPow(rest, x)])
    }
    if (b.kind === 'fn' && b.name === 'abs' && isEvenInteger(x)) return simplifyPow(b.args[0], x)
  } else {
    // e^(ln y) = y, e^(c ln y) = y^c
    if (isSym(b, 'e')) {
      if (x.kind === 'fn' && x.name === 'ln') return x.args[0]
      if (x.kind === 'mul') {
        const lnIdx = x.factors.findIndex((f) => f.kind === 'fn' && f.name === 'ln')
        if (lnIdx >= 0 && x.factors.length === 2 && x.factors[1 - lnIdx].kind === 'num') {
          return simplifyPow((x.factors[lnIdx] as Fn).args[0], x.factors[1 - lnIdx])
        }
      }
    }
    if (b.kind === 'num' && x.kind === 'fn' && x.name === 'log' && key(x.args[1]) === key(b)) return x.args[0]
    if (b.kind === 'pow' && b.base.kind !== 'num') return simplifyPow(b.base, simplifyMul([b.exp, x]))
  }
  return { kind: 'pow', base: b, exp: x }
}

// ---------------------------------------------------------------------------
// Functions

/** Returns r when the expression is exactly r·π. */
export function piMultiple(e: Expr): Rational | null {
  if (isZero(e)) return Rational.ZERO
  if (isSym(e, 'pi')) return Rational.ONE
  if (e.kind === 'mul' && e.factors.length === 2 && e.factors[0].kind === 'num' && isSym(e.factors[1], 'pi'))
    return e.factors[0].value
  return null
}

const HALF_SQRT2 = (): Expr => simplifyMul([frac(1, 2), numPow(Rational.of(2), Rational.HALF)])
const HALF_SQRT3 = (): Expr => simplifyMul([frac(1, 2), numPow(Rational.of(3), Rational.HALF)])

/** sin(kπ/12) for k a multiple of 2 or 3; null otherwise. */
function sinTwelfths(k: number): Expr | null {
  k = ((k % 24) + 24) % 24
  if (k > 12) {
    const v = sinTwelfths(k - 12)
    return v && simplifyMul([num(-1), v])
  }
  if (k > 6) k = 12 - k
  switch (k) {
    case 0:
      return ZERO
    case 2:
      return frac(1, 2)
    case 3:
      return HALF_SQRT2()
    case 4:
      return HALF_SQRT3()
    case 6:
      return ONE
    default:
      return null
  }
}

function trigExact(name: string, r: Rational): Expr | null {
  const k12 = r.mul(Rational.of(12))
  if (!k12.isInteger()) return null
  const k = Number(k12.n % 48n)
  const s = () => sinTwelfths(k)
  const c = () => sinTwelfths(k + 6)
  const ratio = (a: Expr | null, b: Expr | null): Expr | null => {
    if (!a || !b || isZero(b)) return null
    return simplify({ kind: 'mul', factors: [a, { kind: 'pow', base: b, exp: num(-1) }] })
  }
  switch (name) {
    case 'sin':
      return s()
    case 'cos':
      return c()
    case 'tan':
      return ratio(s(), c())
    case 'cot':
      return ratio(c(), s())
    case 'sec':
      return ratio(ONE, c())
    case 'csc':
      return ratio(ONE, s())
  }
  return null
}

let inverseTable: Map<string, Map<string, Rational>> | null = null
function inverseTrig(name: string, v: Expr): Expr | null {
  if (!inverseTable) {
    inverseTable = new Map()
    const ranges: Record<string, [number, number]> = { asin: [-6, 6], acos: [0, 12], atan: [-5, 5] }
    const fnOf: Record<string, string> = { asin: 'sin', acos: 'cos', atan: 'tan' }
    for (const [inv, [lo, hi]] of Object.entries(ranges)) {
      const m = new Map<string, Rational>()
      for (let k = lo; k <= hi; k++) {
        const val = trigExact(fnOf[inv], Rational.of(k, 12))
        if (val) {
          const kk = key(val)
          if (!m.has(kk)) m.set(kk, Rational.of(k, 12))
        }
      }
      inverseTable.set(inv, m)
    }
  }
  const r = inverseTable.get(name)?.get(key(v))
  return r ? simplifyMul([num(r), PI]) : null
}

const ODD_FNS = new Set(['sin', 'tan', 'cot', 'csc', 'asin', 'atan', 'sinh', 'tanh'])
const EVEN_FNS = new Set(['cos', 'sec', 'cosh', 'abs'])

function hasNegativeCoef(e: Expr): boolean {
  return splitCoef(e)[0].sign() < 0 && e.kind !== 'num'
}

function negate(e: Expr): Expr {
  return simplifyMul([num(-1), e])
}

function factorial(n: bigint): bigint {
  let r = 1n
  for (let i = 2n; i <= n; i++) r *= i
  return r
}

/** Conservative check that an expression is ≥ 0 for every real input. */
export function isNonNegative(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
      return e.value.sign() >= 0
    case 'sym':
      return e.name === 'pi' || e.name === 'e'
    case 'add':
    case 'mul': {
      const parts = e.kind === 'add' ? e.terms : e.factors
      return parts.every(isNonNegative)
    }
    case 'pow':
      return isEvenInteger(e.exp) || isNonNegative(e.base) || (e.base.kind === 'num' && e.base.value.sign() > 0)
    case 'fn':
      return e.name === 'abs' || e.name === 'cosh' || (e.name === 'factorial')
  }
}

/** Is a constant expression (no variables) and numerically positive? */
function constantSign(e: Expr): number {
  if (freeSymbols(e).size > 0 || contains(e, 'i')) return 0
  const v = approxConstant(e)
  return Number.isFinite(v) ? Math.sign(v) : 0
}

function approxConstant(e: Expr): number {
  switch (e.kind) {
    case 'num':
      return e.value.toNumber()
    case 'sym':
      return e.name === 'pi' ? Math.PI : e.name === 'e' ? Math.E : NaN
    case 'add':
      return e.terms.reduce((s, t) => s + approxConstant(t), 0)
    case 'mul':
      return e.factors.reduce((s, t) => s * approxConstant(t), 1)
    case 'pow':
      return Math.pow(approxConstant(e.base), approxConstant(e.exp))
    case 'fn': {
      const a = e.args.map(approxConstant)
      const f = (Math as unknown as Record<string, (...v: number[]) => number>)[e.name]
      if (e.name === 'ln') return Math.log(a[0])
      if (e.name === 'log') return Math.log(a[0]) / Math.log(a[1])
      return typeof f === 'function' ? f(...a) : NaN
    }
  }
}

function simplifyFn(name: string, args: Expr[]): Expr {
  const [a] = args
  if (args.length === 1) {
    if (ODD_FNS.has(name) && hasNegativeCoef(a)) return negate(simplifyFn(name, [negate(a)]))
    if (EVEN_FNS.has(name) && hasNegativeCoef(a)) return simplifyFn(name, [negate(a)])
  }
  switch (name) {
    case 'sin':
    case 'cos':
    case 'tan':
    case 'cot':
    case 'sec':
    case 'csc': {
      const r = piMultiple(a)
      if (r) {
        const v = trigExact(name, r)
        if (v) return v
      }
      const inv = { sin: 'asin', cos: 'acos', tan: 'atan' }[name as 'sin']
      if (a.kind === 'fn' && a.name === inv) return a.args[0]
      break
    }
    case 'asin':
    case 'acos':
    case 'atan': {
      const v = inverseTrig(name, a)
      if (v) return v
      break
    }
    case 'sinh':
    case 'tanh':
      if (isZero(a)) return ZERO
      break
    case 'cosh':
      if (isZero(a)) return ONE
      break
    case 'ln': {
      if (isOne(a)) return ZERO
      if (isSym(a, 'e')) return ONE
      if (isZero(a)) throw new MathError('ln(0) is undefined')
      if (a.kind === 'pow' && isSym(a.base, 'e')) return a.exp
      break
    }
    case 'log': {
      const b = args[1]
      if (isOne(a)) return ZERO
      if (key(a) === key(b)) return ONE
      if (a.kind === 'pow' && key(a.base) === key(b)) return a.exp
      if (a.kind === 'num' && b.kind === 'num' && a.value.sign() > 0 && b.value.sign() > 0) {
        // log_b(a) is rational when a and b are powers of a common base.
        const v = Math.log(a.value.toNumber()) / Math.log(b.value.toNumber())
        const r = Rational.approximate(v, 64, 1e-12)
        if (r) {
          const check = numPow(b.value, r)
          if (check.kind === 'num' && check.value.eq(a.value)) return num(r)
        }
      }
      break
    }
    case 'abs': {
      if (a.kind === 'num') return num(a.value.abs())
      if (isNonNegative(a)) return a
      const s = constantSign(a)
      if (s > 0) return a
      if (s < 0) return negate(a)
      if (a.kind === 'mul') {
        const [c, rest] = splitCoef(a)
        if (!c.isOne() && rest) return simplifyMul([num(c.abs()), simplifyFn('abs', [rest])])
      }
      break
    }
    case 'sign':
      if (a.kind === 'num') return num(a.value.sign())
      break
    case 'floor':
    case 'ceil':
    case 'round':
      if (a.kind === 'num') {
        const v = a.value
        if (name === 'floor') return num(v.floor())
        if (name === 'ceil') return num(-v.neg().floor())
        return num(v.add(Rational.HALF).floor())
      }
      break
    case 'factorial':
      if (a.kind === 'num') {
        if (!a.value.isInteger() || a.value.sign() < 0) throw new MathError('Factorial needs a non-negative integer')
        if (a.value.n > 2000n) throw new MathError('Factorial argument too large')
        return num(factorial(a.value.n))
      }
      break
    case 'gcd':
    case 'lcm':
      if (args.every((x) => isNum(x) && x.value.isInteger())) {
        const vals = args.map((x) => (x as { value: Rational }).value.n)
        return num(vals.reduce((p, c) => (name === 'gcd' ? gcd(p, c) : lcm(p, c))))
      }
      break
    case 'mod':
      if (args.length === 2 && isNum(args[0]) && isNum(args[1])) {
        const x = args[0].value
        const m = args[1].value
        if (m.isZero()) throw new MathError('Division by zero')
        return num(x.sub(m.mul(new Rational(x.div(m).floor()))))
      }
      break
  }
  return { kind: 'fn', name, args }
}

// ---------------------------------------------------------------------------
// Expansion

const MAX_TERMS = 3000

/** Multiplies out products of sums and positive integer powers of sums. */
export function expand(e: Expr): Expr {
  const s = simplify(e)
  const r = expandInner(s)
  return simplify(r)
}

function termsOf(e: Expr): readonly Expr[] {
  return e.kind === 'add' ? e.terms : [e]
}

/** Distributes a product of (already expanded) factors into a list of terms. */
function distribute(factors: Expr[]): Expr {
  let acc: Expr[] = [ONE]
  for (const f of factors) {
    const next: Expr[] = []
    for (const a of acc) for (const b of termsOf(f)) next.push(simplify({ kind: 'mul', factors: [a, b] }))
    if (next.length > MAX_TERMS) throw new MathError('Expression too large to expand')
    acc = simplifyTermsList(next)
  }
  return simplify({ kind: 'add', terms: acc })
}

function simplifyTermsList(terms: Expr[]): Expr[] {
  return [...termsOf(simplify({ kind: 'add', terms }))]
}

function expandInner(e: Expr): Expr {
  switch (e.kind) {
    case 'add':
      return simplify({ kind: 'add', terms: e.terms.map(expandInner) })
    case 'mul':
      return distribute(e.factors.map(expandInner))
    case 'pow': {
      const b = expandInner(e.base)
      if (b.kind === 'add' && e.exp.kind === 'num' && e.exp.value.isInteger()) {
        const n = Number(e.exp.value.n)
        if (n > 0 && n <= 40) return distribute(Array.from({ length: n }, () => b))
        if (n < 0 && n >= -40) {
          return simplify({ kind: 'pow', base: distribute(Array.from({ length: -n }, () => b)), exp: num(-1) })
        }
      }
      return simplify({ kind: 'pow', base: b, exp: expandInner(e.exp) })
    }
    case 'fn':
      return simplify({ kind: 'fn', name: e.name, args: e.args.map(expandInner) })
    default:
      return e
  }
}

/** Picks the smaller of the simplified and expanded forms. */
export function simplest(e: Expr): Expr {
  const s = simplify(e)
  try {
    const x = expand(s)
    return size(x) < size(s) ? x : s
  } catch {
    return s
  }
}

export { E, PI }
