import { type Expr, PI, fn, mul, num, sqrt } from './expr'
import { evalNum } from './numeric'
import { Rational } from './rational'
import { simplify } from './simplify'

/**
 * Recognises a floating-point value as a simple closed form (a fraction,
 * a multiple of π, a square root or a logarithm). Very strict tolerance, and
 * the guess is re-evaluated before being accepted.
 */
export function identify(v: number): Expr | null {
  if (!Number.isFinite(v)) return null
  const tol = 1e-11
  const accept = (e: Expr): Expr | null => {
    const s = simplify(e)
    return Math.abs(evalNum(s) - v) <= 1e-9 * Math.max(1, Math.abs(v)) ? s : null
  }
  const r = Rational.approximate(v, 1000, tol)
  if (r) return num(r)
  const rp = Rational.approximate(v / Math.PI, 24, tol)
  if (rp && !rp.isZero()) return accept(mul(num(rp), PI))
  const rsp = Rational.approximate(v / Math.sqrt(Math.PI), 24, tol)
  if (rsp && !rsp.isZero()) {
    const e = accept(mul(num(rsp), sqrt(PI)))
    if (e) return e
  }
  const rp2 = Rational.approximate(v / (Math.PI * Math.PI), 24, tol)
  if (rp2 && !rp2.isZero()) {
    const e = accept(mul(num(rp2), PI, PI))
    if (e) return e
  }
  const sq = Rational.approximate(v * v, 400, tol)
  if (sq && sq.sign() > 0) {
    const e = accept(mul(num(Math.sign(v)), sqrt(num(sq))))
    if (e) return e
  }
  const ex = Rational.approximate(Math.exp(v), 200, 1e-10)
  if (ex && ex.sign() > 0 && !ex.isOne()) {
    const e = accept(fn('ln', num(ex)))
    if (e) return e
  }
  return null
}
