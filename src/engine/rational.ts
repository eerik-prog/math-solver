/** Exact rational arithmetic on arbitrary-precision integers. */

export function bigAbs(a: bigint): bigint {
  return a < 0n ? -a : a
}

export function gcd(a: bigint, b: bigint): bigint {
  a = bigAbs(a)
  b = bigAbs(b)
  while (b !== 0n) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n
  return bigAbs((a / gcd(a, b)) * b)
}

export class Rational {
  readonly n: bigint
  readonly d: bigint

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new MathError('Division by zero')
    if (d < 0n) {
      n = -n
      d = -d
    }
    const g = gcd(n, d)
    this.n = g > 1n ? n / g : n
    this.d = g > 1n ? d / g : d
  }

  static readonly ZERO = new Rational(0n)
  static readonly ONE = new Rational(1n)
  static readonly MINUS_ONE = new Rational(-1n)
  static readonly HALF = new Rational(1n, 2n)

  static of(n: number | bigint, d: number | bigint = 1): Rational {
    return new Rational(BigInt(n), BigInt(d))
  }

  /** Parses a decimal literal such as "12", "0.25" or "1.5e-3" exactly. */
  static parse(text: string): Rational {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim())
    if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new MathError(`Invalid number "${text}"`)
    const sign = m[1] === '-' ? -1n : 1n
    const intPart = m[2] || '0'
    const frac = m[3] ?? ''
    const exp = m[4] ? Number(m[4]) : 0
    let n = BigInt(intPart + frac) * sign
    let d = 10n ** BigInt(frac.length)
    if (exp > 0) n *= 10n ** BigInt(exp)
    if (exp < 0) d *= 10n ** BigInt(-exp)
    return new Rational(n, d)
  }

  /** Best rational approximation of a float, accepted only if it is very close. */
  static approximate(x: number, maxDen = 10000, tol = 1e-9): Rational | null {
    if (!Number.isFinite(x)) return null
    if (Number.isInteger(x) && Math.abs(x) < Number.MAX_SAFE_INTEGER) return Rational.of(x)
    let h1 = 1n,
      h0 = 0n,
      k1 = 0n,
      k0 = 1n
    let v = x
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(v)
      const ab = BigInt(a)
      const h2 = ab * h1 + h0
      const k2 = ab * k1 + k0
      if (k2 > BigInt(maxDen)) break
      h0 = h1
      h1 = h2
      k0 = k1
      k1 = k2
      if (Math.abs(Number(h1) / Number(k1) - x) <= tol * Math.max(1, Math.abs(x))) return new Rational(h1, k1)
      const frac = v - a
      if (frac < 1e-15) break
      v = 1 / frac
    }
    return null
  }

  add(o: Rational): Rational {
    return new Rational(this.n * o.d + o.n * this.d, this.d * o.d)
  }
  sub(o: Rational): Rational {
    return new Rational(this.n * o.d - o.n * this.d, this.d * o.d)
  }
  mul(o: Rational): Rational {
    return new Rational(this.n * o.n, this.d * o.d)
  }
  div(o: Rational): Rational {
    if (o.n === 0n) throw new MathError('Division by zero')
    return new Rational(this.n * o.d, this.d * o.n)
  }
  neg(): Rational {
    return new Rational(-this.n, this.d)
  }
  inv(): Rational {
    return new Rational(this.d, this.n)
  }
  abs(): Rational {
    return this.n < 0n ? this.neg() : this
  }
  /** Integer power. Throws for huge exponents to keep things bounded. */
  pow(e: bigint | number): Rational {
    let k = BigInt(e)
    if (k < 0n) return this.inv().pow(-k)
    if (k > 4096n) throw new MathError('Exponent too large')
    let result = Rational.ONE
    let base = new Rational(this.n, this.d)
    while (k > 0n) {
      if (k & 1n) result = result.mul(base)
      base = base.mul(base)
      k >>= 1n
    }
    return result
  }

  cmp(o: Rational): number {
    const diff = this.n * o.d - o.n * this.d
    return diff === 0n ? 0 : diff < 0n ? -1 : 1
  }
  eq(o: Rational): boolean {
    return this.n === o.n && this.d === o.d
  }
  isZero(): boolean {
    return this.n === 0n
  }
  isOne(): boolean {
    return this.n === 1n && this.d === 1n
  }
  isInteger(): boolean {
    return this.d === 1n
  }
  sign(): number {
    return this.n === 0n ? 0 : this.n < 0n ? -1 : 1
  }
  floor(): bigint {
    const q = this.n / this.d
    return this.n < 0n && q * this.d !== this.n ? q - 1n : q
  }
  toNumber(): number {
    // Scale down huge values to keep precision when converting.
    const n = this.n,
      d = this.d
    const nb = n.toString().length,
      db = d.toString().length
    if (nb > 300 || db > 300) {
      const shift = Math.max(nb, db) - 300
      const s = 10n ** BigInt(shift)
      return Number(n / s) / Number(d / s)
    }
    return Number(n) / Number(d)
  }
  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`
  }
}

export class MathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MathError'
  }
}

/** Integer n-th root if exact, otherwise null. */
export function exactRoot(value: bigint, k: number): bigint | null {
  if (value < 0n) {
    if (k % 2 === 0) return null
    const r = exactRoot(-value, k)
    return r === null ? null : -r
  }
  if (value < 2n) return value
  let lo = 0n
  let hi = 1n << (BigInt(value.toString(2).length) / BigInt(k) + 1n)
  const K = BigInt(k)
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (mid ** K <= value) lo = mid
    else hi = mid - 1n
  }
  return lo ** K === value ? lo : null
}

/**
 * Splits |value| into m^k * s where s has no k-th power factors (best effort for
 * large numbers: only primes below 10^5 are tried).
 */
export function extractPower(value: bigint, k: number): { outside: bigint; inside: bigint } {
  let v = bigAbs(value)
  let outside = 1n
  if (v === 0n) return { outside: 0n, inside: 1n }
  const K = BigInt(k)
  const full = exactRoot(v, k)
  if (full !== null) return { outside: full, inside: 1n }
  for (let p = 2n; p * p <= v && p < 100000n; p += p === 2n ? 1n : 2n) {
    const pk = p ** K
    while (v % pk === 0n) {
      v /= pk
      outside *= p
    }
  }
  return { outside, inside: v }
}

/** Prime factorisation for reasonably sized integers (trial division). */
export function primeFactors(value: bigint): Array<[bigint, number]> | null {
  let v = bigAbs(value)
  if (v < 2n) return []
  const out: Array<[bigint, number]> = []
  for (let p = 2n; p * p <= v; p += p === 2n ? 1n : 2n) {
    if (p > 10_000_000n) return null
    let c = 0
    while (v % p === 0n) {
      v /= p
      c++
    }
    if (c) out.push([p, c])
  }
  if (v > 1n) out.push([v, 1])
  return out
}

export function divisors(value: bigint, limit = 5000): bigint[] | null {
  const f = primeFactors(value)
  if (!f) return null
  let ds: bigint[] = [1n]
  for (const [p, c] of f) {
    const next: bigint[] = []
    for (const d of ds) {
      let m = d
      for (let i = 0; i <= c; i++) {
        next.push(m)
        m *= p
      }
    }
    ds = next
    if (ds.length > limit) return null
  }
  return ds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
