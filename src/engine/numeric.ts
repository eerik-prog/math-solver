import type { Expr } from './expr'

export type Env = Record<string, number>

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

function gcdNum(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

/** Real cube roots etc. for negative bases with odd-denominator exponents. */
function realPow(b: number, x: number): number {
  if (b < 0 && !Number.isInteger(x)) {
    // find a small odd denominator for x
    for (let d = 3; d <= 15; d += 2) {
      const n = Math.round(x * d)
      if (Math.abs(n / d - x) < 1e-12) {
        const r = Math.pow(-b, x)
        return n % 2 === 0 ? r : -r
      }
    }
    return NaN
  }
  return Math.pow(b, x)
}

/** Evaluates a real-valued expression; returns NaN outside the real domain. */
export function evalNum(e: Expr, env: Env = {}): number {
  switch (e.kind) {
    case 'num':
      return e.value.toNumber()
    case 'sym':
      if (e.name in env) return env[e.name]
      if (e.name === 'pi') return Math.PI
      if (e.name === 'e') return Math.E
      if (e.name === 'infinity') return Infinity
      return NaN
    case 'add': {
      let s = 0
      for (const t of e.terms) s += evalNum(t, env)
      return s
    }
    case 'mul': {
      let p = 1
      for (const f of e.factors) p *= evalNum(f, env)
      return p
    }
    case 'pow': {
      const b = evalNum(e.base, env)
      const x = evalNum(e.exp, env)
      if (b === 0 && x < 0) return NaN
      return realPow(b, x)
    }
    case 'fn': {
      const a = e.args.map((x) => evalNum(x, env))
      const v = a[0]
      switch (e.name) {
        case 'sin':
          return Math.sin(v)
        case 'cos':
          return Math.cos(v)
        case 'tan': {
          if (Math.abs(Math.cos(v)) < 1e-15) return NaN
          return Math.tan(v)
        }
        case 'cot':
          return Math.cos(v) / Math.sin(v)
        case 'sec':
          return 1 / Math.cos(v)
        case 'csc':
          return 1 / Math.sin(v)
        case 'asin':
          return Math.asin(v)
        case 'acos':
          return Math.acos(v)
        case 'atan':
          return Math.atan(v)
        case 'sinh':
          return Math.sinh(v)
        case 'cosh':
          return Math.cosh(v)
        case 'tanh':
          return Math.tanh(v)
        case 'ln':
          return v <= 0 ? NaN : Math.log(v)
        case 'log':
          return v <= 0 || a[1] <= 0 || a[1] === 1 ? NaN : Math.log(v) / Math.log(a[1])
        case 'abs':
          return Math.abs(v)
        case 'sign':
          return Math.sign(v)
        case 'floor':
          return Math.floor(v)
        case 'ceil':
          return Math.ceil(v)
        case 'round':
          return Math.round(v)
        case 'factorial':
          return factorial(v)
        case 'gcd':
          return a.reduce(gcdNum)
        case 'lcm':
          return a.reduce((p, c) => Math.abs(p * c) / gcdNum(p, c))
        case 'mod':
          return v - a[1] * Math.floor(v / a[1])
        default:
          return NaN
      }
    }
  }
}

/** Compiles to a fast single-variable function. */
export function compile(e: Expr, x: string, env: Env = {}): (v: number) => number {
  const scope: Env = { ...env }
  return (v: number) => {
    scope[x] = v
    return evalNum(e, scope)
  }
}

/** Brent-style bisection + secant refinement within [a, b] where f changes sign. */
export function bisect(f: (x: number) => number, a: number, b: number, fa = f(a), fb = f(b)): number | null {
  if (!(fa * fb <= 0)) return null
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2
    const fm = f(m)
    if (!Number.isFinite(fm)) return null
    if (fm === 0 || (b - a) / 2 < 1e-15 * Math.max(1, Math.abs(m))) return m
    if (fa * fm < 0) {
      b = m
      fb = fm
    } else {
      a = m
      fa = fm
    }
  }
  return (a + b) / 2
}

/**
 * Finds real roots of f in [lo, hi] by sampling for sign changes and for
 * near-zero local minima of |f| (double roots), then refining.
 */
export function findRealRoots(f: (x: number) => number, lo = -100, hi = 100, samples = 20000): number[] {
  const roots: number[] = []
  const h = (hi - lo) / samples
  let px = lo
  let pf = f(px)
  let ppf = NaN
  const scale = (x: number) => 1e-7 * Math.max(1, Math.abs(x))
  const push = (r: number) => {
    const v = f(r)
    if (!Number.isFinite(v)) return
    // Reject sign changes caused by poles: |f| must be tiny compared to nearby values.
    const d = 1e-3 * Math.max(1, Math.abs(r))
    const around = Math.abs(f(r - d)) + Math.abs(f(r + d))
    if (Math.abs(v) > 1e-6 * Math.max(1, around)) return
    if (!roots.some((q) => Math.abs(q - r) < scale(r) * 10)) roots.push(r)
  }
  for (let k = 1; k <= samples; k++) {
    const x = lo + k * h
    const fx = f(x)
    if (Number.isFinite(pf) && Number.isFinite(fx)) {
      if (pf === 0) push(px)
      else if (pf * fx < 0) {
        const r = bisect(f, px, x, pf, fx)
        if (r !== null) push(r)
      } else if (Number.isFinite(ppf) && Math.abs(pf) < Math.abs(ppf) && Math.abs(pf) <= Math.abs(fx) && Math.abs(pf) < 1e-3) {
        // local minimum of |f| close to zero: golden-section search on |f|
        const r = minimizeAbs(f, px - h, x)
        if (Math.abs(f(r)) < 1e-10) push(r)
      }
    }
    ppf = pf
    px = x
    pf = fx
  }
  if (Number.isFinite(pf) && pf === 0) push(px)
  return roots.sort((a, b) => a - b)
}

function minimizeAbs(f: (x: number) => number, a: number, b: number): number {
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  for (let i = 0; i < 100; i++) {
    if (Math.abs(f(c)) < Math.abs(f(d))) b = d
    else a = c
    c = b - g * (b - a)
    d = a + g * (b - a)
  }
  return (a + b) / 2
}

/** Adaptive Gauss–Kronrod (7–15) quadrature. */
export function integrateNumeric(f: (x: number) => number, a: number, b: number): { value: number; error: number } {
  if (a === b) return { value: 0, error: 0 }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // map infinite ranges with x = t / (1 - t^2)
    const g = (t: number) => {
      const x = t / (1 - t * t)
      const dx = (1 + t * t) / ((1 - t * t) * (1 - t * t))
      return f(x) * dx
    }
    const ta = a === -Infinity ? -1 : Number.isFinite(a) ? solveT(a) : 1
    const tb = b === Infinity ? 1 : Number.isFinite(b) ? solveT(b) : -1
    const eps = 1e-9
    return integrateNumeric(g, ta + (ta === -1 ? eps : 0), tb - (tb === 1 ? eps : 0))
  }
  let total = 0
  let err = 0
  const stack: Array<[number, number, number]> = [[a, b, 0]]
  let evals = 0
  while (stack.length) {
    const [lo, hi, depth] = stack.pop()!
    const [k, g] = gk15(f, lo, hi)
    evals += 15
    const e = Math.abs(k - g)
    if (e <= 1e-11 * Math.max(1, Math.abs(k)) || depth > 40 || evals > 200000) {
      total += k
      err += e
    } else {
      const m = (lo + hi) / 2
      stack.push([lo, m, depth + 1], [m, hi, depth + 1])
    }
  }
  return { value: total, error: err }
}

function solveT(x: number): number {
  // inverse of x = t / (1 - t^2) on (-1, 1)
  if (x === 0) return 0
  return (-1 + Math.sqrt(1 + 4 * x * x)) / (2 * x)
}

const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691,
  0.7415311855993945, 0.5860872354676911, 0.4058451513773972,
  0.20778495500789848, 0,
]
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019,
  0.14065325971552592, 0.1690047266392679, 0.19035057806478542,
  0.20443294007529889, 0.20948214108472782,
]
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694]

function gk15(f: (x: number) => number, a: number, b: number): [number, number] {
  const c = (a + b) / 2
  const h = (b - a) / 2
  const fc = f(c)
  let k = WGK[7] * fc
  let g = WG[3] * fc
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j]
    const f1 = f(c - dx)
    const f2 = f(c + dx)
    k += WGK[j] * (f1 + f2)
    if (j % 2 === 1) g += WG[(j - 1) / 2] * (f1 + f2)
  }
  return [k * h, g * h]
}

/** Approximately equal, relative to magnitude. */
export function close(a: number, b: number, tol = 1e-7): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
}

/** Checks two expressions agree at several sample points (where both are defined). */
export function numericallyEqual(a: Expr, b: Expr, x: string, points = [-2.3, -0.7, 0.4, 1.3, 2.9, 4.1]): boolean {
  let checked = 0
  for (const p of points) {
    const va = evalNum(a, { [x]: p })
    const vb = evalNum(b, { [x]: p })
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue
    if (!close(va, vb, 1e-6)) return false
    checked++
  }
  return checked >= 2
}
