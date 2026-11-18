import { type Expr, add, freeSymbols, key, mul, num, pow, sym } from './expr'
import { compile } from './numeric'
import { Poly, factorPoly, polyFromExpr, ratFromExpr, rationalRoots } from './poly'
import { toTex, toText } from './print'
import { MathError, Rational, gcd, primeFactors } from './rational'
import { expand, simplest, simplify, splitCoef } from './simplify'
import type { Answer, PlotSpec, Solution, Step } from './types'

/** Flattens nested sums/products from the parser without changing anything else. */
export function tidy(e: Expr): Expr {
  switch (e.kind) {
    case 'add': {
      const terms: Expr[] = []
      for (const t of e.terms.map(tidy)) terms.push(...(t.kind === 'add' ? t.terms : [t]))
      return { kind: 'add', terms }
    }
    case 'mul': {
      const fs: Expr[] = []
      for (const f of e.factors.map(tidy)) fs.push(...(f.kind === 'mul' ? f.factors : [f]))
      if (fs.length === 2 && fs[0].kind === 'num' && fs[0].value.eq(Rational.MINUS_ONE) && fs[1].kind === 'num') return num(fs[1].value.neg())
      // keep a single numeric coefficient in front: 2·x·3 → 6x is a change, so only move a lone number
      const nums = fs.filter((f) => f.kind === 'num')
      if (nums.length === 1 && fs[0].kind !== 'num') return { kind: 'mul', factors: [nums[0], ...fs.filter((f) => f !== nums[0])] }
      return { kind: 'mul', factors: fs }
    }
    case 'pow':
      return { kind: 'pow', base: tidy(e.base), exp: tidy(e.exp) }
    case 'fn':
      return { kind: 'fn', name: e.name, args: e.args.map(tidy) }
    default:
      return e
  }
}

export function functionPlot(e: Expr, x: string | null, label = 'f'): PlotSpec | undefined {
  if (!x) return undefined
  const vars = freeSymbols(e)
  vars.delete(x)
  if (vars.size) return undefined
  const f = compile(e, x)
  let finite = 0
  for (let v = -10; v <= 10; v += 0.5) if (Number.isFinite(f(v))) finite++
  if (finite < 3) return undefined
  return { variable: x, fns: [{ expr: toText(e), label }], xRange: [-10, 10] }
}

/** Factored form of a polynomial as TeX, e.g. 2(x − 1)²(x + 3). */
export function polyFactoredTex(p: Poly, x: string): { tex: string; text: string; trivial: boolean } {
  const { content, factors } = factorPoly(p)
  const nonConst = factors.filter((f) => f.poly.degree >= 1)
  const needParens = (q: Poly) => q.c.filter((c) => !c.isZero()).length > 1
  const multi = nonConst.length > 1 || nonConst.some((f) => f.mult > 1) || !content.isOne()
  const texParts = nonConst.map((f) => {
    const t = toTex(f.poly.toExpr(x))
    const base = needParens(f.poly) && multi ? `\\left(${t}\\right)` : t
    return f.mult > 1 ? `${needParens(f.poly) ? base : `{${base}}`}^{${f.mult}}` : base
  })
  const textParts = nonConst.map((f) => {
    const t = toText(f.poly.toExpr(x))
    const base = needParens(f.poly) && multi ? `(${t})` : t
    return f.mult > 1 ? `${base}^${f.mult}` : base
  })
  const cTex = content.isOne() ? '' : content.eq(Rational.MINUS_ONE) ? '-' : toTex(num(content))
  const cText = content.isOne() ? '' : content.eq(Rational.MINUS_ONE) ? '-' : content.isInteger() ? content.toString() : `(${content})`
  const trivial = nonConst.length <= 1 && (nonConst[0]?.mult ?? 1) === 1 && (content.isOne() || nonConst.length === 0)
  return { tex: cTex + texParts.join(''), text: cText + textParts.join(''), trivial }
}

export function pickVariable(e: Expr, hint?: string): string | null {
  if (hint) return hint
  const vs = [...freeSymbols(e)].sort()
  if (vs.length === 0) return null
  for (const pref of ['x', 'y', 'z', 't']) if (vs.includes(pref)) return pref
  return vs[0]
}

export function simplifyProblem(input: Expr): Solution {
  const e = tidy(input)
  const steps: Step[] = []
  const notes: string[] = []
  const answers: Answer[] = []
  const x = pickVariable(e)
  const vars = freeSymbols(e)

  // Univariate rational expressions: factor and cancel.
  if (x && vars.size === 1) {
    const dens: Poly[] = []
    const rf = ratFromExpr(simplify(e), x, dens)
    if (rf && (!rf.den.isConstant() || dens.length > 0)) {
      const fullNum = rf.num
      const fullDen = rf.den
      ratFromExpr(e, x, dens)
      const excluded: Rational[] = []
      for (const d of dens) for (const r of rationalRoots(d).roots) if (!excluded.some((v) => v.eq(r.value))) excluded.push(r.value)
      const result = simplify(mul(fullNum.toExpr(x), pow(fullDen.toExpr(x), -1)))
      const raw = simplify(e)
      if (key(raw) !== key(result)) {
        steps.push({ title: 'Write as a single fraction, factor, and cancel common factors', tex: `${toTex(e)} = ${toTex(result)}` })
      }
      answers.push({ tex: toTex(result), text: toText(result) })
      const nf = polyFactoredTex(fullNum, x)
      const df = polyFactoredTex(fullDen, x)
      if (!nf.trivial || !df.trivial) notes.push(`Factored: (${nf.text}) / (${df.text})`)
      if (excluded.length) notes.push(`Valid for ${excluded.map((v) => `${x} ≠ ${v}`).join(', ')} (the original expression is undefined there).`)
      return { kind: 'simplify', title: 'Simplify', problemTex: toTex(e), answers, steps, notes, plot: functionPlot(result, x) }
    }
  }

  const s = simplify(e)
  const best = simplest(s)
  if (key(best) !== key(tidy(e))) {
    steps.push({ title: 'Combine like terms and simplify', tex: `${toTex(e)} = ${toTex(s)}` })
    if (key(best) !== key(s)) steps.push({ title: 'Expanding gives a shorter form', tex: `= ${toTex(best)}` })
  } else steps.push({ title: 'The expression is already as simple as it gets' })
  answers.push({ tex: toTex(best), text: toText(best) })
  if (x && vars.size === 1) {
    const p = polyFromExpr(best, x)
    if (p && p.degree >= 2) {
      const f = polyFactoredTex(p, x)
      if (!f.trivial) notes.push(`Factored form: ${f.text}`)
    }
  }
  return { kind: 'simplify', title: 'Simplify', problemTex: toTex(e), answers, steps, notes, plot: functionPlot(best, x) }
}

export function expandProblem(input: Expr): Solution {
  const e = tidy(input)
  const r = expand(e)
  const steps: Step[] = [
    { title: 'Multiply out every product and power of sums (distributive law), then combine like terms', tex: `${toTex(e)} = ${toTex(r)}` },
  ]
  const x = pickVariable(e)
  return { kind: 'expand', title: 'Expand', problemTex: toTex(e), answers: [{ tex: toTex(r), text: toText(r) }], steps, notes: [], plot: functionPlot(r, x) }
}

export function factorProblem(input: Expr): Solution {
  const e = tidy(input)
  const s = simplify(e)
  const steps: Step[] = []
  const notes: string[] = []
  if (s.kind === 'num') {
    if (!s.value.isInteger()) throw new MathError('Only whole numbers can be factored into primes')
    const n = s.value.n
    const f = primeFactors(n)
    if (!f) throw new MathError('That number is too large to factor here')
    if (n < 0n) notes.push('The sign is kept in front.')
    const tex = f.length === 0 ? n.toString() : (n < 0n ? '-' : '') + f.map(([p, c]) => (c > 1 ? `${p}^{${c}}` : `${p}`)).join(' \\cdot ')
    const text = f.length === 0 ? n.toString() : (n < 0n ? '-' : '') + f.map(([p, c]) => (c > 1 ? `${p}^${c}` : `${p}`)).join(' · ')
    let m = n < 0n ? -n : n
    for (const [p, c] of f)
      for (let i = 0; i < c; i++) {
        steps.push({ title: `Divide by the prime ${p}`, tex: `${m} \\div ${p} = ${m / p}` })
        m /= p
      }
    if (f.length === 1 && f[0][1] === 1) notes.push(`${n < 0n ? -n : n} is a prime number.`)
    return { kind: 'factor', title: 'Prime factorization', problemTex: toTex(e), answers: [{ tex, text }], steps, notes }
  }
  const x = pickVariable(s)
  const vars = freeSymbols(s)
  const ex = expand(s)
  if (x && vars.size === 1) {
    const p = polyFromExpr(ex, x)
    if (p) {
      const f = polyFactoredTex(p, x)
      const { content } = factorPoly(p)
      if (!content.isOne()) steps.push({ title: 'Factor out the greatest common factor', tex: `${toTex(ex)} = ${toTex(num(content))}\\left(${toTex(p.scale(content.inv()).toExpr(x))}\\right)` })
      const { roots } = rationalRoots(p)
      if (roots.length)
        steps.push({
          title: `Find the roots (each root r gives a factor (${x} − r))`,
          tex: roots.map((r) => `${x} = ${toTex(num(r.value))}`).join(',\\quad '),
        })
      steps.push({ title: f.trivial ? 'This polynomial cannot be factored further over the rational numbers' : 'Write the product of the factors', tex: `${toTex(ex)} = ${f.tex}` })
      return {
        kind: 'factor',
        title: 'Factor',
        problemTex: toTex(e),
        answers: [{ tex: f.tex, text: f.text }],
        steps,
        notes,
        plot: functionPlot(ex, x),
      }
    }
  }
  // Multivariate: pull out the common monomial factor.
  const terms = ex.kind === 'add' ? ex.terms : [ex]
  let g = 0n
  let den = 1n
  const minPow = new Map<string, Rational>()
  terms.forEach((t, i) => {
    const [c, rest] = splitCoef(t)
    g = gcd(g, c.n)
    den = den * c.d / gcd(den, c.d)
    const powers = new Map<string, Rational>()
    const fs = rest ? (rest.kind === 'mul' ? rest.factors : [rest]) : []
    for (const f of fs) {
      if (f.kind === 'sym') powers.set(f.name, Rational.ONE)
      else if (f.kind === 'pow' && f.base.kind === 'sym' && f.exp.kind === 'num' && f.exp.value.sign() > 0) powers.set(f.base.name, f.exp.value)
    }
    if (i === 0) for (const [k, v] of powers) minPow.set(k, v)
    else
      for (const k of [...minPow.keys()]) {
        const v = powers.get(k)
        if (!v) minPow.delete(k)
        else if (v.cmp(minPow.get(k)!) < 0) minPow.set(k, v)
      }
  })
  const lead = splitCoef(terms[0])[0]
  let common: Expr = num(new Rational(lead.sign() < 0 ? -g : g, den))
  for (const [k, v] of minPow) common = mul(common, pow(sym(k), num(v)))
  common = simplify(common)
  if (terms.length < 2 || (common.kind === 'num' && common.value.isOne())) {
    steps.push({ title: 'There is no common factor to take out' })
    return { kind: 'factor', title: 'Factor', problemTex: toTex(e), answers: [{ tex: toTex(ex), text: toText(ex) }], steps, notes: ['Only common factors are extracted for expressions with several variables.'] }
  }
  const inner = simplify(add(...terms.map((t) => simplify(mul(t, pow(common, -1))))))
  const tex = `${toTex(common)}\\left(${toTex(inner)}\\right)`
  steps.push({ title: 'Find the greatest common factor of all terms and take it out', tex: `${toTex(ex)} = ${tex}` })
  return {
    kind: 'factor',
    title: 'Factor',
    problemTex: toTex(e),
    answers: [{ tex, text: `${toText(common)}(${toText(inner)})` }],
    steps,
    notes,
  }
}
