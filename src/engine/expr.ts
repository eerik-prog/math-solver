import { Rational } from './rational'

/**
 * Expression tree. Subtraction is represented as addition of a term multiplied
 * by -1 and division as multiplication by a power with exponent -1, which keeps
 * the simplifier small. The printers turn these back into familiar notation.
 */
export type Expr = Num | Sym | Add | Mul | Pow | Fn

export interface Num {
  readonly kind: 'num'
  readonly value: Rational
}
export interface Sym {
  readonly kind: 'sym'
  readonly name: string
}
export interface Add {
  readonly kind: 'add'
  readonly terms: readonly Expr[]
}
export interface Mul {
  readonly kind: 'mul'
  readonly factors: readonly Expr[]
}
export interface Pow {
  readonly kind: 'pow'
  readonly base: Expr
  readonly exp: Expr
}
export interface Fn {
  readonly kind: 'fn'
  readonly name: string
  readonly args: readonly Expr[]
}

/** Symbols with a fixed meaning. Everything else is a variable or parameter. */
export const CONSTANTS = new Set(['pi', 'e', 'i', 'infinity'])

export const num = (value: Rational | number | bigint): Num => ({
  kind: 'num',
  value: value instanceof Rational ? value : Rational.of(value),
})
export const frac = (n: number | bigint, d: number | bigint): Num => num(Rational.of(n, d))
export const sym = (name: string): Sym => ({ kind: 'sym', name })
export const add = (...terms: Expr[]): Expr => (terms.length === 1 ? terms[0] : { kind: 'add', terms })
export const mul = (...factors: Expr[]): Expr => (factors.length === 1 ? factors[0] : { kind: 'mul', factors })
export const pow = (base: Expr, exp: Expr | number): Expr => ({
  kind: 'pow',
  base,
  exp: typeof exp === 'number' ? num(exp) : exp,
})
export const fn = (name: string, ...args: Expr[]): Fn => ({ kind: 'fn', name, args })
export const neg = (e: Expr): Expr => mul(num(-1), e)
export const sub = (a: Expr, b: Expr): Expr => add(a, neg(b))
export const div = (a: Expr, b: Expr): Expr => mul(a, pow(b, -1))
export const sqrt = (e: Expr): Expr => pow(e, frac(1, 2))

export const ZERO = num(0)
export const ONE = num(1)
export const PI = sym('pi')
export const E = sym('e')
export const I = sym('i')
export const INF = sym('infinity')

export const isNum = (e: Expr): e is Num => e.kind === 'num'
export const isZero = (e: Expr): boolean => e.kind === 'num' && e.value.isZero()
export const isOne = (e: Expr): boolean => e.kind === 'num' && e.value.isOne()
export const isSym = (e: Expr, name?: string): e is Sym => e.kind === 'sym' && (name === undefined || e.name === name)

export function children(e: Expr): readonly Expr[] {
  switch (e.kind) {
    case 'add':
      return e.terms
    case 'mul':
      return e.factors
    case 'pow':
      return [e.base, e.exp]
    case 'fn':
      return e.args
    default:
      return []
  }
}

export function contains(e: Expr, name: string): boolean {
  if (e.kind === 'sym') return e.name === name
  return children(e).some((c) => contains(c, name))
}

export function containsFn(e: Expr, pred: (f: Fn) => boolean): boolean {
  if (e.kind === 'fn' && pred(e)) return true
  return children(e).some((c) => containsFn(c, pred))
}

/** Free variables, excluding built-in constants. */
export function freeSymbols(e: Expr, out = new Set<string>()): Set<string> {
  if (e.kind === 'sym') {
    if (!CONSTANTS.has(e.name)) out.add(e.name)
  } else for (const c of children(e)) freeSymbols(c, out)
  return out
}

export function countOccurrences(e: Expr, name: string): number {
  if (e.kind === 'sym') return e.name === name ? 1 : 0
  return children(e).reduce((s, c) => s + countOccurrences(c, name), 0)
}

export function map(e: Expr, f: (c: Expr) => Expr): Expr {
  switch (e.kind) {
    case 'add':
      return { kind: 'add', terms: e.terms.map(f) }
    case 'mul':
      return { kind: 'mul', factors: e.factors.map(f) }
    case 'pow':
      return { kind: 'pow', base: f(e.base), exp: f(e.exp) }
    case 'fn':
      return { kind: 'fn', name: e.name, args: e.args.map(f) }
    default:
      return e
  }
}

export function substitute(e: Expr, name: string, value: Expr): Expr {
  if (e.kind === 'sym') return e.name === name ? value : e
  return map(e, (c) => substitute(c, name, value))
}

/** Replaces every occurrence of a subexpression (by structural key) with another. */
export function replaceSubexpr(e: Expr, target: Expr, value: Expr): Expr {
  if (key(e) === key(target)) return value
  return map(e, (c) => replaceSubexpr(c, target, value))
}

/** A canonical string for structural comparison. */
export function key(e: Expr): string {
  switch (e.kind) {
    case 'num':
      return e.value.toString()
    case 'sym':
      return e.name
    case 'add':
      return `(+ ${e.terms.map(key).join(' ')})`
    case 'mul':
      return `(* ${e.factors.map(key).join(' ')})`
    case 'pow':
      return `(^ ${key(e.base)} ${key(e.exp)})`
    case 'fn':
      return `(${e.name} ${e.args.map(key).join(' ')})`
  }
}

export const equal = (a: Expr, b: Expr): boolean => key(a) === key(b)

export function size(e: Expr): number {
  return 1 + children(e).reduce((s, c) => s + size(c), 0)
}
