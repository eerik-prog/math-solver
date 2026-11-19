import { evaluateProblem, literalTex } from './arithmetic'
import { expandProblem, factorProblem, pickVariable, simplifyProblem, tidy } from './algebra'
import { differentiate, nthDerivative, ordinal } from './diff'
import { type Expr, INF, add, contains, freeSymbols, mul, neg, num, substitute } from './expr'
import { identify } from './identify'
import { inequalityIntervals, inequalitySolution, intersectIntervals, OP_TEX } from './inequality'
import { antiderivative } from './integrate'
import { solveLimit } from './limit'
import { compile, integrateNumeric } from './numeric'
import { type Relation, normalizeInput, parseExpression, parseRelation, splitRelation } from './parser'
import { formatNumber, texNumber, toPlain, toTex, toText } from './print'
import { MathError } from './rational'
import { simplest, simplify } from './simplify'
import { solveEquationProblem } from './solve'
import { solveSystem } from './systems'
import type { Answer, Solution, SolveResponse, Step } from './types'

export type { Solution, SolveResponse, Step, Answer } from './types'

const EXAMPLE_FOR: Record<string, string> = {
  solve: 'solve 2x + 3 = 7',
  find: 'find x: x^2 = 9',
  simplify: 'simplify (x^2 - 1)/(x - 1)',
  expand: 'expand (x + 1)^2',
  factor: 'factor x^2 - 5x + 6',
  factorise: 'factor x^2 - 5x + 6',
  factorize: 'factor x^2 - 5x + 6',
  integrate: 'integrate x^2 dx',
  integral: 'integral of x^2 from 0 to 1',
  int: 'integrate x^2 dx',
  '∫': '∫ x^2 dx',
  derivative: 'derivative of x^3',
  differentiate: 'differentiate sin(x^2)',
  'd/dx': 'd/dx x^3',
  limit: 'limit of sin(x)/x as x -> 0',
  lim: 'lim x->0 sin(x)/x',
  evaluate: 'evaluate 2^10',
  calculate: 'calculate 3/4 + 1/6',
  compute: 'compute 12 * 7',
  what: 'what is 15% * 80',
}

const OP_TEXT_PLAIN: Record<string, string> = { '<': '<', '>': '>', '<=': '≤', '>=': '≥', '!=': '≠', '=': '=' }

const WRT = String.raw`(?:\s+(?:with\s+respect\s+to|wrt|w\.r\.t\.?)\s+([a-zA-Z]))?`

/** Splits "a = b, c = d" / "a=b; c=d" / "a=b and c=d" into separate equations. */
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
    if (depth === 0 && /^\s+and\s+/i.test(s.slice(i))) {
      const m = /^\s+and\s+/i.exec(s.slice(i))!
      parts.push(cur)
      cur = ''
      i += m[0].length - 1
      continue
    }
    cur += c
  }
  parts.push(cur)
  const eqs = parts.map((p) => p.trim()).filter(Boolean)
  if (eqs.length < 2 || !eqs.every((p) => /=/.test(p))) return null
  return eqs
}

function relationProblem(text: string, hint?: string): Solution {
  const system = splitSystem(text)
  if (system) return solveSystem(system.map((p) => parseRelation(p)!))
  const rels = splitRelation(text)
  if (!rels) {
    const e = parseExpression(text)
    const x = pickVariable(e, hint)
    if (!x) return evaluateProblem(e)
    // "solve x^2 - 4" means x^2 - 4 = 0
    return solveEquationProblem(e, num(0), x)
  }
  if (rels.length === 2) {
    // compound inequality a < f(x) < b
    const [r1, r2] = rels
    if (r1.op === '=' || r2.op === '=') throw new MathError('Only inequalities can be chained, like 1 < 2x + 3 < 7')
    const a = parseExpression(r1.lhs)
    const mid = parseExpression(r1.rhs)
    const b = parseExpression(r2.rhs)
    const x = pickVariable(mid, hint) ?? 'x'
    const steps: Step[] = []
    const notes: string[] = []
    const s1: Step[] = []
    const s2: Step[] = []
    const i1 = inequalityIntervals(a, r1.op, mid, x, s1, notes)
    const i2 = inequalityIntervals(mid, r2.op, b, x, s2, notes)
    steps.push({
      title: `A double inequality is two inequalities at once. Solve them one at a time. First: ${toPlain(simplify(a))} ${OP_TEXT_PLAIN[r1.op]} ${toPlain(simplify(mid))}`,
      substeps: s1,
    })
    steps.push({
      title: `Second: ${toPlain(simplify(mid))} ${OP_TEXT_PLAIN[r2.op]} ${toPlain(simplify(b))}`,
      substeps: s2,
    })
    steps.push({ title: `Both have to be true at the same time, so keep only the ${x} values that work for both` })
    const ivs = intersectIntervals(i1, i2)
    return inequalitySolution(
      a,
      r1.op,
      b,
      x,
      ivs,
      steps,
      notes,
      `${toTex(tidy(a))} ${OP_TEX[r1.op]} ${toTex(tidy(mid))} ${OP_TEX[r2.op]} ${toTex(tidy(b))}`,
    )
  }
  const rel = parseRelation(text) as Relation
  const x = pickVariable(add(rel.lhs, rel.rhs), hint)
  if (!x) return truthProblem(rel)
  if (rel.op === '=') return solveEquationProblem(tidy(rel.lhs), tidy(rel.rhs), x)
  return solveInequality2(rel, x)
}

function solveInequality2(rel: Relation, x: string): Solution {
  const steps: Step[] = []
  const notes: string[] = []
  const ivs = inequalityIntervals(rel.lhs, rel.op, rel.rhs, x, steps, notes)
  return inequalitySolution(tidy(rel.lhs), rel.op, tidy(rel.rhs), x, ivs, steps, notes)
}

function truthProblem(rel: Relation): Solution {
  const l = simplify(rel.lhs)
  const r = simplify(rel.rhs)
  const lv = compile(l, '_')(0)
  const rv = compile(r, '_')(0)
  const d = simplify(add(l, neg(r)))
  const eps = 1e-12 * Math.max(1, Math.abs(lv), Math.abs(rv))
  const truth =
    rel.op === '='
      ? d.kind === 'num'
        ? d.value.isZero()
        : Math.abs(lv - rv) <= eps
      : rel.op === '<'
        ? lv < rv - eps
        : rel.op === '>'
          ? lv > rv + eps
          : rel.op === '<='
            ? lv <= rv + eps
            : rel.op === '>='
              ? lv >= rv - eps
              : Math.abs(lv - rv) > eps
  return {
    kind: 'evaluate',
    title: 'Check the statement',
    problemTex: `${toTex(tidy(rel.lhs))} ${OP_TEX[rel.op]} ${toTex(tidy(rel.rhs))}`,
    answers: [{ tex: truth ? '\\text{True}' : '\\text{False}', text: truth ? 'True' : 'False' }],
    steps: [{ title: 'Evaluate both sides', tex: `${toTex(l)} \\quad\\text{and}\\quad ${toTex(r)}` }],
    notes: [],
  }
}

function derivativeProblem(exprText: string, order: number, hint?: string): Solution {
  const e = parseExpression(exprText)
  const x = pickVariable(e, hint) ?? 'x'
  const steps: Step[] = []
  const r = nthDerivative(e, x, order, steps)
  const res = simplest(r)
  const op = order === 1 ? `\\frac{d}{d${x}}` : `\\frac{d^{${order}}}{d${x}^{${order}}}`
  const raw = simplify(e)
  if (order === 1) {
    const last = steps[steps.length - 1]
    if (!last || !last.tex?.endsWith(toTex(res)))
      steps.push({ title: 'Tidy up the answer', tex: `${op}\\left[${toTex(raw)}\\right] = ${toTex(res)}` })
  }
  const vars = freeSymbols(e)
  vars.delete(x)
  return {
    kind: 'derivative',
    title: order === 1 ? `Differentiate with respect to ${x}` : `${ordinal(order)} derivative with respect to ${x}`,
    problemTex: `${op}\\left[${toTex(tidy(e))}\\right]`,
    answers: [{ tex: `${order === 1 ? `f'(${x})` : `f^{(${order})}(${x})`} = ${toTex(res)}`, text: toText(res) }],
    steps,
    notes: vars.size ? [`Other letters (${[...vars].join(', ')}) are treated as constants.`] : [],
    plot: vars.size
      ? undefined
      : {
          variable: x,
          fns: [
            { expr: toText(raw), label: 'f' },
            { expr: toText(res), label: order === 1 ? 'f′' : `f^(${order})` },
          ],
          xRange: [-10, 10],
        },
  }
}

interface IntegralSpec {
  body: string
  variable?: string
  lower?: string
  upper?: string
}

function parseIntegral(rest: string): IntegralSpec {
  let s = rest.trim()
  let lower: string | undefined
  let upper: string | undefined
  let m = /^_\{?\(?([^\s^}]+?)\)?\}?\^\{?\(?([^\s}]+?)\)?\}?\s+(.+)$/.exec(s)
  if (m) {
    lower = m[1]
    upper = m[2]
    s = m[3]
  }
  m = /^from\s+(.+?)\s+to\s+(.+?)\s+of\s+(.+)$/i.exec(s)
  if (m) {
    lower = m[1]
    upper = m[2]
    s = m[3]
  }
  m = /^(.+?)\s*(?:,\s*)?(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/i.exec(s)
  if (m) {
    s = m[1]
    lower = m[2]
    upper = m[3]
  }
  let variable: string | undefined
  m = /^(.*?)\s*\*?\s*d([a-zA-Z])\s*$/.exec(s)
  if (m && m[1].trim()) {
    s = m[1]
    variable = m[2]
  }
  m = /^(.+?)\s+(?:with\s+respect\s+to|wrt)\s+([a-zA-Z])$/i.exec(s)
  if (m) {
    s = m[1]
    variable = m[2]
  }
  return { body: s.trim(), variable, lower, upper }
}

function integralProblem(spec: IntegralSpec): Solution {
  const e = parseExpression(spec.body)
  const x = pickVariable(e, spec.variable) ?? 'x'
  const definite = spec.lower !== undefined && spec.upper !== undefined
  const result = antiderivative(e, x)
  const steps: Step[] = []
  const notes: string[] = []
  const answers: Answer[] = []
  const body = tidy(e)
  const bodyTex = body.kind === 'add' ? `\\left(${toTex(body)}\\right)` : toTex(body)
  const otherVars = freeSymbols(e)
  otherVars.delete(x)

  if (!definite) {
    if (!result) {
      throw new MathError(
        `I couldn't find an antiderivative in terms of elementary functions. ${otherVars.size ? '' : 'Try a definite integral (add "from a to b") to get a numerical value.'}`,
      )
    }
    steps.push(...result.steps)
    steps.push({
      title: 'Add + C. A constant disappears when you take a derivative, so any constant could be added to the answer',
      tex: `\\int ${bodyTex}\\,d${x} = ${toTex(result.F)} + C`,
    })
    const check = derivativeCheck(result.F, e, x)
    if (check) steps.push(check)
    answers.push({ tex: `${toTex(result.F)} + C`, text: `${toText(result.F)} + C` })
    return {
      kind: 'integral',
      title: `Integrate with respect to ${x}`,
      problemTex: `\\int ${bodyTex}\\,d${x}`,
      answers,
      steps,
      notes: otherVars.size ? [`Other letters (${[...otherVars].join(', ')}) are treated as constants.`] : [],
      plot: otherVars.size
        ? undefined
        : {
            variable: x,
            fns: [
              { expr: toText(simplify(e)), label: 'f' },
              { expr: toText(result.F), label: 'F (C = 0)' },
            ],
            xRange: [-10, 10],
          },
    }
  }

  if (otherVars.size) throw new MathError('Definite integrals need an integrand with only the integration variable')
  const a = parseBound(spec.lower!)
  const b = parseBound(spec.upper!)
  const an = boundValue(a)
  const bn = boundValue(b)
  const f = compile(simplify(e), x)
  const problemTex = `\\int_{${toTex(a)}}^{${toTex(b)}} ${bodyTex}\\,d${x}`
  // Detect singularities inside the interval.
  const lo = Math.max(Math.min(an, bn), -1e6)
  const hi = Math.min(Math.max(an, bn), 1e6)
  let singular = false
  for (let i = 1; i < 2000; i++) {
    const v = f(lo + ((hi - lo) * i) / 2000)
    if (!Number.isFinite(v)) {
      singular = true
      break
    }
  }
  const numeric = integrateNumeric(f, an, bn)
  let exact: Expr | null = null
  if (result && !singular && Number.isFinite(an) && Number.isFinite(bn)) {
    steps.push(...result.steps)
    const Fa = safe(() => simplify(substitute(result.F, x, a)))
    const Fb = safe(() => simplify(substitute(result.F, x, b)))
    if (Fa && Fb) {
      const val = simplest(simplify(add(Fb, neg(Fa))))
      const v = compile(val, '_')(0)
      if (Number.isFinite(v) && Math.abs(v - numeric.value) <= 1e-6 * Math.max(1, Math.abs(v))) {
        exact = val
        const put = (at: Expr, value: Expr) => {
          const raw = substitute(spreadFraction(result.F), x, at)
          const shown = literalTex(raw, { stack: true }) ?? toTex(raw)
          return `F(${toTex(at)}) = ${shown === toTex(value) ? '' : `${shown} = `}${toTex(value)}`
        }
        const wrap = (t: Expr) =>
          (t.kind === 'num' && t.value.sign() >= 0) || t.kind === 'sym' ? toTex(t) : `\\left(${toTex(t)}\\right)`
        steps.push(
          {
            title: `Call the antiderivative F(${x}). For a definite integral there is no need for + C`,
            tex: `F(${x}) = ${toTex(result.F)}`,
          },
          { title: `Put the top limit, ${x} = ${toPlain(b)}, into F`, tex: put(b, Fb) },
          { title: `Put the bottom limit, ${x} = ${toPlain(a)}, into F`, tex: put(a, Fa) },
          {
            title: 'Subtract: top minus bottom. This is the Fundamental Theorem of Calculus',
            tex: `\\int_{${toTex(a)}}^{${toTex(b)}} ${bodyTex}\\,d${x} = F(${toTex(b)}) - F(${toTex(a)}) = ${wrap(Fb)} - ${wrap(Fa)} = ${toTex(val)}`,
          },
        )
        notes.push(
          `This is the area between the graph and the x-axis from ${x} = ${toPlain(a)} to ${x} = ${toPlain(b)}. Parts below the axis count as negative.`,
        )
      }
    }
  }
  if (!exact) {
    if (singular)
      notes.push(
        'The integrand is undefined somewhere in the interval, so this is an improper integral; the value below is a numerical estimate and may not exist.',
      )
    if (!Number.isFinite(numeric.value) || numeric.error > 1e-3 * Math.max(1, Math.abs(numeric.value))) {
      notes.push('The numerical estimate did not converge well; the integral may diverge.')
    }
    steps.push({
      title: result
        ? 'Estimate the value numerically: add up the area of many thin slices under the graph (adaptive Gauss–Kronrod quadrature)'
        : 'There is no simple formula for this antiderivative, so estimate the area numerically: add up many thin slices under the graph (adaptive Gauss–Kronrod quadrature)',
      tex: `${problemTex} \\approx ${texNumber(numeric.value)}`,
    })
    exact = identify(numeric.value)
    if (exact) notes.push(`The numerical value matches ${toText(exact)}.`)
  }
  const value = exact ? compile(exact, '_')(0) : numeric.value
  answers.push({
    tex: exact ? toTex(exact) : `\\approx ${texNumber(numeric.value)}`,
    text: exact ? toText(exact) : formatNumber(numeric.value),
    approx: exact && exact.kind !== 'num' ? formatNumber(value) : undefined,
  })
  const finiteA = Number.isFinite(an) ? an : -10
  const finiteB = Number.isFinite(bn) ? bn : 10
  const pad = Math.max(1, Math.abs(finiteB - finiteA) * 0.3)
  return {
    kind: 'integral',
    title: `Definite integral with respect to ${x}`,
    problemTex,
    answers,
    steps,
    notes,
    plot: {
      variable: x,
      fns: [{ expr: toText(simplify(e)), label: `y = ${toText(simplify(e))}` }],
      shade: [finiteA, finiteB],
      xRange: [Math.min(finiteA, finiteB) - pad, Math.max(finiteA, finiteB) + pad],
    },
  }
}

/** Shows that the antiderivative is right by taking its derivative. */
function derivativeCheck(F: Expr, f: Expr, x: string): Step | null {
  try {
    const back = simplest(differentiate(F, x))
    if (toTex(back).length > 160) return null
    const same = toTex(back) === toTex(simplify(f)) || toTex(back) === toTex(tidy(f))
    return {
      title: `Check: take the derivative of the answer. ${same ? 'It gives back' : 'It simplifies to'} the function we started with ✓`,
      tex: `\\frac{d}{d${x}}\\left[${toTex(F)} + C\\right] = ${toTex(back)}`,
    }
  } catch {
    return null
  }
}

function safe<T>(f: () => T): T | null {
  try {
    return f()
  } catch {
    return null
  }
}

function parseBound(s: string): Expr {
  const t = s.trim().toLowerCase()
  if (/^(\+)?(inf|infinity|oo|∞)$/.test(t)) return INF
  if (/^-(inf|infinity|oo|∞)$/.test(t)) return mul(num(-1), INF)
  return simplify(parseExpression(s))
}

function boundValue(e: Expr): number {
  if (contains(e, 'infinity')) return e.kind === 'mul' ? -Infinity : Infinity
  return compile(e, '_')(0)
}

function limitProblem(body: string, x: string, approach: string): Solution {
  let a = approach.trim()
  let side: '' | '+' | '-' = ''
  const sideMatch = /^(.+?)\s*(\^?\s*[+-]|\s+from\s+the\s+(left|right)|\s+from\s+(below|above))$/i.exec(a)
  if (sideMatch && !/^[+-]?(inf|infinity|oo|∞)$/i.test(a)) {
    a = sideMatch[1]
    const tag = sideMatch[2].toLowerCase()
    side = tag.includes('+') || tag.includes('right') || tag.includes('above') ? '+' : '-'
  }
  const point = parseBound(a)
  return solveLimit(parseExpression(body), x, point, side)
}

/** Interprets the typed problem and solves it. Throws MathError for invalid input. */
export function solveText(raw: string): Solution {
  let s = normalizeInput(raw)
    .trim()
    .replace(/[?.]+$/, '')
    .trim()
  if (!s) throw new MathError('Type a math problem to get started')
  s = s.replace(/^(?:please\s+)?(?:can you\s+)?/i, '')
  let m: RegExpExecArray | null
  if (
    (m =
      /^(solve|find|simplify|expand|factor|factorise|factorize|integrate|integral(?:\s+of)?|int|∫|derivative(?:\s+of)?|differentiate|d\/dx|limit(?:\s+of)?|lim|evaluate|calculate|compute|what\s+is)$/i.exec(
        s,
      ))
  ) {
    throw new MathError(
      `Add a problem after "${m[1]}", for example: ${EXAMPLE_FOR[m[1].split(/\s/)[0].toLowerCase()] ?? `${m[1]} 2x + 3 = 7`}`,
    )
  }

  if ((m = /^(?:what\s+is|what's|calculate|compute|evaluate|eval)\s+(.+)$/i.exec(s))) {
    const inner = m[1]
    if (splitRelation(inner)) return relationProblem(inner)
    const e = parseExpression(inner)
    return freeSymbols(e).size ? simplifyProblem(e) : evaluateProblem(e)
  }
  if ((m = /^simplify\s+(.+)$/i.exec(s))) return simplifyProblem(parseExpression(m[1]))
  if ((m = /^(?:expand|multiply\s+out)\s+(.+)$/i.exec(s))) return expandProblem(parseExpression(m[1]))
  if ((m = /^(?:factor|factorise|factorize|factorization\s+of|prime\s+factors\s+of)\s+(.+)$/i.exec(s)))
    return factorProblem(parseExpression(m[1]))

  // Derivatives
  if (
    (m = new RegExp(
      String.raw`^(?:find\s+)?(?:the\s+)?(?:(first|second|third|fourth|1st|2nd|3rd|4th)\s+)?derivative\s+of\s+(.+?)${WRT}$`,
      'i',
    ).exec(s))
  ) {
    const order =
      { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 }[
        (m[1] ?? 'first').toLowerCase()
      ] ?? 1
    return derivativeProblem(m[2], order, m[3])
  }
  if ((m = new RegExp(String.raw`^(?:differentiate|derive|diff)\s+(.+?)${WRT}$`, 'i').exec(s)))
    return derivativeProblem(m[1], 1, m[2])
  if ((m = /^d\^?\(?(\d)\)?\s*\/\s*d([a-zA-Z])\^?\(?\d\)?\s*(.+)$/i.exec(s)))
    return derivativeProblem(stripBrackets(m[3]), Number(m[1]), m[2])
  if ((m = /^d\s*\/\s*d([a-zA-Z])\s*(.+)$/i.exec(s))) return derivativeProblem(stripBrackets(m[2]), 1, m[1])

  // Integrals
  if (
    (m = /^(?:find\s+)?(?:the\s+)?(?:definite\s+|indefinite\s+)?(?:integral|antiderivative)(?:\s+of)?\s*(.+)$/i.exec(s))
  )
    return integralProblem(parseIntegral(m[1]))
  if ((m = /^(?:integrate\s*|int\s+|∫\s*)(.+)$/i.exec(s))) return integralProblem(parseIntegral(m[1]))

  // Limits
  if (
    (m =
      /^(?:find\s+)?(?:the\s+)?(?:limit|lim)\s*(?:of\s+)?(.+?)\s+as\s+([a-zA-Z])\s*(?:->|→|approaches|goes\s+to|tends\s+to)\s*(.+)$/i.exec(
        s,
      ))
  )
    return limitProblem(m[1], m[2], m[3])
  if ((m = /^lim(?:it)?\s*_?\s*[{(]?\s*([a-zA-Z])\s*(?:->|→)\s*([^\s})]+?)\s*[})]?\s+(.+)$/i.exec(s)))
    return limitProblem(m[3], m[1], m[2])

  // Solve
  if ((m = /^(?:solve|find)\s+(?:for\s+)?([a-zA-Z])\s*(?:if|when|where|:|,)\s*(.+)$/i.exec(s)))
    return relationProblem(m[2], m[1])
  if ((m = /^(?:solve|find)\s+(.+?)(?:\s*,?\s+for\s+([a-zA-Z]))?$/i.exec(s))) return relationProblem(m[1], m[2])

  if (splitRelation(s) || splitSystem(s)) return relationProblem(s)
  const e = parseExpression(s)
  if (freeSymbols(e).size === 0) return evaluateProblem(e)
  return simplifyProblem(e)
}

function stripBrackets(s: string): string {
  const t = s.trim()
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('(') && t.endsWith(')') && balanced(t.slice(1, -1))))
    return t.slice(1, -1)
  return t
}

function balanced(s: string): boolean {
  let d = 0
  for (const c of s) {
    if (c === '(') d++
    if (c === ')' && --d < 0) return false
  }
  return d === 0
}

/** Safe wrapper used by the worker and tests. */
export function solve(input: string): SolveResponse {
  const start = performance.now()
  try {
    const solution = solveText(input)
    return { ok: true, solution, ms: performance.now() - start }
  } catch (err) {
    const msg =
      err instanceof MathError
        ? err.message
        : err instanceof RangeError
          ? 'This problem is too complex to solve here'
          : 'Something went wrong while solving this problem'
    if (!(err instanceof MathError)) console.error(err)
    return { ok: false, error: msg, ms: performance.now() - start }
  }
}

/** x³/3 is stored as (1/3)·x³. Write it as a fraction again so F(3) shows as 3³/3. */
function spreadFraction(e: Expr): Expr {
  if (e.kind === 'add') return { kind: 'add', terms: e.terms.map(spreadFraction) }
  if (e.kind !== 'mul' || e.factors[0].kind !== 'num' || e.factors[0].value.isInteger()) return e
  const { n, d } = e.factors[0].value
  const top = n < 0n ? -n : n
  const factors: Expr[] = [
    ...(n < 0n ? [num(-1)] : []),
    ...(top === 1n ? [] : [num(top)]),
    ...e.factors.slice(1),
    { kind: 'pow', base: num(d), exp: num(-1) },
  ]
  return { kind: 'mul', factors }
}
