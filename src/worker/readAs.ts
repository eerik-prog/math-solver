import { tidy } from '../engine/algebra'
import { literalTex } from '../engine/arithmetic'
import { type Expr, freeSymbols } from '../engine/expr'
import { normalizeInput, parseExpression, parseRelation, splitRelation } from '../engine/parser'
import { toTex } from '../engine/print'

/**
 * How the solver reads the typed problem, as LaTeX, for the "We read this as" line under the input.
 * It only parses (no solving), so it is fast enough to run on every keystroke. The command words
 * follow `solveText` in src/engine/index.ts, and the maths is printed the same way the solution's
 * `problemTex` is (src/__tests__/readAs.test.ts checks they agree). Returns null when the input is
 * empty, unfinished or can't be read.
 */
export function readAs(raw: string): string | null {
  try {
    return interpret(raw)
  } catch {
    return null
  }
}

const OP_TEX: Record<string, string> = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '!=': '\\ne' }
const ORDER: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
}
const WRT = String.raw`(?:\s+(?:with\s+respect\s+to|wrt|w\.r\.t\.?)\s+([a-zA-Z]))?`

function interpret(raw: string): string | null {
  const s = normalizeInput(raw)
    .trim()
    .replace(/[?.]+$/, '')
    .trim()
    .replace(/^(?:please\s+)?(?:can you\s+)?/i, '')
  if (!s) return null
  let m: RegExpExecArray | null

  if ((m = /^(?:what\s+is|what's|calculate|compute|evaluate|eval)\s+(.+)$/i.exec(s))) return relationOrExpression(m[1])
  if (
    (m =
      /^(?:simplify|expand|multiply\s+out|factor|factorise|factorize|factorization\s+of|prime\s+factors\s+of)\s+(.+)$/i.exec(
        s,
      ))
  )
    return expression(m[1])

  // Derivatives
  if (
    (m = new RegExp(
      String.raw`^(?:find\s+)?(?:the\s+)?(?:(first|second|third|fourth|1st|2nd|3rd|4th)\s+)?derivative\s+of\s+(.+?)${WRT}$`,
      'i',
    ).exec(s))
  )
    return derivative(m[2], ORDER[(m[1] ?? 'first').toLowerCase()] ?? 1, m[3])
  if ((m = new RegExp(String.raw`^(?:differentiate|derive|diff)\s+(.+?)${WRT}$`, 'i').exec(s)))
    return derivative(m[1], 1, m[2])
  if ((m = /^d\^?\(?(\d)\)?\s*\/\s*d([a-zA-Z])\^?\(?\d\)?\s*(.+)$/i.exec(s)))
    return derivative(stripBrackets(m[3]), Number(m[1]), m[2])
  if ((m = /^d\s*\/\s*d([a-zA-Z])\s*(.+)$/i.exec(s))) return derivative(stripBrackets(m[2]), 1, m[1])

  // Integrals
  if (
    (m = /^(?:find\s+)?(?:the\s+)?(?:definite\s+|indefinite\s+)?(?:integral|antiderivative)(?:\s+of)?\s*(.+)$/i.exec(s))
  )
    return integral(m[1])
  if ((m = /^(?:integrate\s*|int\s+|∫\s*)(.+)$/i.exec(s))) return integral(m[1])

  // Limits
  if (
    (m =
      /^(?:find\s+)?(?:the\s+)?(?:limit|lim)\s*(?:of\s+)?(.+?)\s+as\s+([a-zA-Z])\s*(?:->|→|approaches|goes\s+to|tends\s+to)\s*(.+)$/i.exec(
        s,
      ))
  )
    return limit(m[1], m[2], m[3])
  if ((m = /^lim(?:it)?\s*_?\s*[{(]?\s*([a-zA-Z])\s*(?:->|→)\s*([^\s})]+?)\s*[})]?\s+(.+)$/i.exec(s)))
    return limit(m[3], m[1], m[2])

  // A command word on its own, or the start of one, isn't a problem yet.
  if (
    /^(?:solve|find|simplify|expand|factor\w*|integrate|integral|int|∫|derivative|differentiate|limit|lim)\b/i.test(s)
  ) {
    if ((m = /^(?:solve|find)\s+(?:for\s+)?([a-zA-Z])\s*(?:if|when|where|:|,)\s*(.+)$/i.exec(s)))
      return relationOrExpression(m[2], true)
    if ((m = /^(?:solve|find)\s+(.+?)(?:\s*,?\s+for\s+([a-zA-Z]))?$/i.exec(s))) return relationOrExpression(m[1], true)
    return null
  }
  return relationOrExpression(s)
}

const tex = (e: Expr) => toTex(tidy(e))

function expression(text: string): string {
  return tex(parseExpression(text))
}

/** An equation, inequality (also chained), system, or a plain expression. */
function relationOrExpression(text: string, solving = false): string {
  const system = splitSystem(text)
  if (system) return system.map((p) => relation(p)).join(',\\quad ')
  const rels = splitRelation(text)
  if (rels && rels.length === 2) {
    const [r1, r2] = rels
    return `${expression(r1.lhs)} ${OP_TEX[r1.op]} ${expression(r1.rhs)} ${OP_TEX[r2.op]} ${expression(r2.rhs)}`
  }
  if (rels) return relation(text)
  const e = parseExpression(text)
  if (freeSymbols(e).size === 0) return literalTex(e) ?? toTex(e)
  // "solve x^2 - 4" means x^2 - 4 = 0
  return solving ? `${tex(e)} = 0` : tex(e)
}

function relation(text: string): string {
  const rel = parseRelation(text)
  if (!rel) throw new Error('not a relation')
  return `${tex(rel.lhs)} ${OP_TEX[rel.op]} ${tex(rel.rhs)}`
}

function derivative(body: string, order: number, hint?: string): string {
  const e = parseExpression(body)
  const x = hint ?? variableOf(e)
  const op = order === 1 ? `\\frac{d}{d${x}}` : `\\frac{d^{${order}}}{d${x}^{${order}}}`
  return `${op}\\left[${tex(e)}\\right]`
}

function integral(rest: string): string {
  let s = rest.trim()
  let lower: string | undefined
  let upper: string | undefined
  let m = /^_\{?\(?([^\s^}]+?)\)?\}?\^\{?\(?([^\s}]+?)\)?\}?\s+(.+)$/.exec(s)
  if (m) [, lower, upper, s] = m
  m = /^from\s+(.+?)\s+to\s+(.+?)\s+of\s+(.+)$/i.exec(s)
  if (m) [, lower, upper, s] = m
  m = /^(.+?)\s*(?:,\s*)?(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/i.exec(s)
  if (m) [, s, lower, upper] = m
  let variable: string | undefined
  m = /^(.*?)\s*\*?\s*d([a-zA-Z])\s*$/.exec(s)
  if (m && m[1].trim()) [, s, variable] = m
  m = /^(.+?)\s+(?:with\s+respect\s+to|wrt)\s+([a-zA-Z])$/i.exec(s)
  if (m) [, s, variable] = m
  const e = tidy(parseExpression(s))
  const x = variable ?? variableOf(e)
  const body = e.kind === 'add' ? `\\left(${toTex(e)}\\right)` : toTex(e)
  const limits = lower !== undefined && upper !== undefined ? `_{${bound(lower)}}^{${bound(upper)}}` : ''
  return `\\int${limits} ${body}\\,d${x}`
}

function limit(body: string, x: string, approach: string): string {
  let a = approach.trim()
  let side = ''
  const sideMatch = /^(.+?)\s*(\^?\s*[+-]|\s+from\s+the\s+(left|right)|\s+from\s+(below|above))$/i.exec(a)
  if (sideMatch && !/^[+-]?(inf|infinity|oo|∞)$/i.test(a)) {
    a = sideMatch[1]
    const tag = sideMatch[2].toLowerCase()
    side = tag.includes('+') || tag.includes('right') || tag.includes('above') ? '^{+}' : '^{-}'
  }
  return `\\lim_{${x} \\to ${bound(a)}${side}} ${expression(body)}`
}

function bound(s: string): string {
  const t = s.trim().toLowerCase()
  if (/^(\+)?(inf|infinity|oo|∞)$/.test(t)) return '\\infty'
  if (/^-(inf|infinity|oo|∞)$/.test(t)) return '-\\infty'
  return expression(s)
}

function variableOf(e: Expr): string {
  const vs = [...freeSymbols(e)].sort()
  return ['x', 'y', 'z', 't'].find((v) => vs.includes(v)) ?? vs[0] ?? 'x'
}

/** "a = b, c = d" / "a = b; c = d" / "a = b and c = d", as in the engine. */
function splitSystem(s: string): string[] | null {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') depth--
    if (depth === 0 && (c === ';' || c === ',' || c === '\n')) {
      parts.push(cur)
      cur = ''
      continue
    }
    const and = depth === 0 ? /^\s+and\s+/i.exec(s.slice(i)) : null
    if (and) {
      parts.push(cur)
      cur = ''
      i += and[0].length - 1
      continue
    }
    cur += c
  }
  parts.push(cur)
  const eqs = parts.map((p) => p.trim()).filter(Boolean)
  return eqs.length >= 2 && eqs.every((p) => p.includes('=')) ? eqs : null
}

function stripBrackets(s: string): string {
  const t = s.trim()
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1)
  if (t.startsWith('(') && t.endsWith(')')) {
    let d = 0
    for (const c of t.slice(1, -1)) {
      if (c === '(') d++
      if (c === ')' && --d < 0) return t
    }
    if (d === 0) return t.slice(1, -1)
  }
  return t
}
