import type { Expr } from './expr'

/**
 * The parser turns "0.5" and "15%" into exact fractions. These sets remember
 * which number nodes came from a typed decimal or a percent sign, so the
 * step-by-step arithmetic can show them the way the person wrote them.
 */
const decimals = new WeakSet<Expr>()
const percents = new WeakSet<Expr>()

export function markDecimal<T extends Expr>(e: T): T {
  decimals.add(e)
  return e
}

export function markPercent<T extends Expr>(e: T): T {
  percents.add(e)
  return e
}

export const isDecimalLiteral = (e: Expr): boolean => decimals.has(e)
export const isPercentMark = (e: Expr): boolean => percents.has(e)
