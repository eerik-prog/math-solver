import { type Expr, add, freeSymbols, key, mul, num, pow, sym } from './expr'
import { compile } from './numeric'
import { Poly, factorPoly, polyFromExpr, ratFromExpr, rationalRoots } from './poly'
import { toPlain, toTex, toText } from './print'
import { MathError, Rational, gcd, lcm, primeFactors } from './rational'
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
      if (fs.length === 2 && fs[0].kind === 'num' && fs[0].value.eq(Rational.MINUS_ONE) && fs[1].kind === 'num')
        return num(fs[1].value.neg())
      // keep a single numeric coefficient in front: 2·x·3 → 6x is a change, so only move a lone number
      const nums = fs.filter((f) => f.kind === 'num')
      if (nums.length === 1 && fs[0].kind !== 'num')
        return { kind: 'mul', factors: [nums[0], ...fs.filter((f) => f !== nums[0])] }
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
  const cText = content.isOne()
    ? ''
    : content.eq(Rational.MINUS_ONE)
      ? '-'
      : content.isInteger()
        ? content.toString()
        : `(${content})`
  const trivial = nonConst.length <= 1 && (nonConst[0]?.mult ?? 1) === 1 && (content.isOne() || nonConst.length === 0)
  return { tex: cTex + texParts.join(''), text: cText + textParts.join(''), trivial }
}

/** Top and bottom of a single fraction, without cancelling anything. */
function fractionParts(e: Expr, x: string): Fraction | null {
  const factors = e.kind === 'mul' ? e.factors : [e]
  let top = Poly.constant(1)
  let bottom = Poly.constant(1)
  const tops: Expr[] = []
  const bottoms: Expr[] = []
  for (const f of factors) {
    if (f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.isInteger() && f.exp.value.sign() < 0) {
      const b = polyFromExpr(f.base, x)
      if (!b) return null
      bottom = bottom.mul(b.pow(Number(-f.exp.value.n)))
      bottoms.push(f.exp.value.eq(Rational.MINUS_ONE) ? f.base : pow(f.base, num(f.exp.value.neg())))
    } else {
      const t = polyFromExpr(f, x)
      if (!t) return null
      top = top.mul(t)
      tops.push(f)
    }
  }
  const asTex = (fs: Expr[]) => (fs.length === 0 ? '1' : toTex(fs.length === 1 ? fs[0] : mul(...fs)))
  return { num: top, den: bottom, numTex: asTex(tops), denTex: asTex(bottoms) }
}

interface Fraction {
  num: Poly
  den: Poly
  /** How the top and bottom were written before anything was changed. */
  numTex: string
  denTex: string
}

/** Adds fractions over a common bottom, step by step. Returns the combined top and bottom. */
function sumSteps(e: Expr & { kind: 'add' }, x: string, steps: Step[]): Fraction | null {
  const terms = e.terms.map((t) => fractionParts(t, x))
  if (terms.some((t) => !t) || terms.length > 6) return null
  const ts = (terms as Fraction[]).map((t) =>
    t.den.lead.sign() < 0 ? { num: t.num.scale(Rational.MINUS_ONE), den: t.den.scale(Rational.MINUS_ONE) } : t,
  )
  if (ts.every((t) => t.den.isConstant())) return null
  let common = Poly.constant(1)
  let factor = 1n
  for (const t of ts) {
    const { content, prim } = t.den.primitive()
    if (!content.isInteger()) return null
    factor = lcm(factor, content.n)
    common = common.mul(prim).divmod(common.gcd(prim)).q
  }
  common = common.primitive().prim.scale(Rational.of(factor))
  const bottom = polyFactoredTex(common, x).tex
  const wrap = (p: Poly) => {
    const t = toTex(p.toExpr(x))
    return p.c.filter((c) => !c.isZero()).length > 1 ? `\\left(${t}\\right)` : t
  }
  let total = Poly.constant(0)
  const shown: string[] = []
  for (const t of ts) {
    const m = common.divmod(t.den).q
    const top = t.num.mul(m)
    total = total.add(top)
    const neg = t.num.lead.sign() < 0
    const n = neg ? t.num.scale(Rational.MINUS_ONE) : t.num
    const k = m.isConstant() ? m.coef(0) : null
    const topTex =
      k && k.isOne()
        ? toTex(n.toExpr(x))
        : n.isConstant() && n.coef(0).isOne()
          ? toTex(m.toExpr(x))
          : k
            ? toTex(n.mul(m).toExpr(x))
            : n.isConstant()
              ? `${toTex(num(n.coef(0)))}${wrap(m)}`
              : `${wrap(n)}${wrap(m)}`
    const frac = `\\frac{${topTex}}{${bottom}}`
    shown.push(shown.length === 0 ? (neg ? `-${frac}` : frac) : `${neg ? '-' : '+'} ${frac}`)
  }
  steps.push({
    title: 'To add fractions, they need the same bottom. Find the smallest bottom that every part fits into',
    tex: `\\text{common bottom} = ${bottom}`,
  })
  steps.push({
    title:
      'Multiply the top and the bottom of each fraction by whatever its bottom is missing. This does not change its value, because it is the same as multiplying by 1',
    tex: `${toTex(e)} = ${shown.join(' ')}`,
  })
  steps.push({
    title: 'Now all the bottoms are the same, so multiply out the tops and add them. Keep the bottom as it is',
    tex: `= \\frac{${toTex(total.toExpr(x))}}{${bottom}}`,
  })
  if (total.isZero()) steps.push({ title: 'The top is 0, so the whole fraction is 0', tex: '= 0' })
  return { num: total, den: common, numTex: toTex(total.toExpr(x)), denTex: bottom }
}

/** Factor the top and bottom of a fraction and cancel what they share. Returns false when nothing cancels. */
function cancelSteps(parts: Fraction, x: string, result: Expr, steps: Step[], bottomShown: boolean): boolean {
  if (parts.den.isConstant() || parts.num.isZero()) return false
  const g = parts.num.gcd(parts.den).primitive().prim
  if (g.degree < 1) return false
  const top = polyFactoredTex(parts.num, x)
  const bottom = polyFactoredTex(parts.den, x)
  if (!top.trivial && sameTex(parts.numTex, top.tex) === false)
    steps.push({
      title: 'Factor the top: write it as things multiplied together',
      tex: `${parts.numTex} = ${top.tex}`,
    })
  if (!bottom.trivial && !bottomShown && sameTex(parts.denTex, bottom.tex) === false)
    steps.push({
      title: 'Factor the bottom in the same way',
      tex: `${parts.denTex} = ${bottom.tex}`,
    })
  const gf = polyFactoredTex(g, x)
  const gText = factoredPlain(g, x)
  const roots = rationalRoots(g).roots.map((r) => `${x} ≠ ${toPlain(num(r.value))}`)
  steps.push({
    title:
      `The top and the bottom both have ${gf.trivial ? 'a factor of' : 'the factors'} ${gf.trivial && g.c.filter((c) => !c.isZero()).length > 1 ? `(${gText})` : gText}. Cancel ${gf.trivial ? 'it' : 'them'}, because anything divided by itself is 1` +
      (roots.length ? `. (This only works when ${roots.join(' and ')}, so that we are not dividing by 0)` : ''),
    tex: `\\frac{${cancelPair(g, parts.num.divmod(g).q, x)}}{${cancelPair(g, parts.den.divmod(g).q, x)}} = ${toTex(result)}`,
  })
  return true
}

const sameTex = (a: string, b: string) => a.replace(/[\s{}]/g, '') === b.replace(/[\s{}]/g, '')

/** Factored form in plain text with real minus signs and superscripts, e.g. x(x − 1)². */
function factoredPlain(p: Poly, x: string): string {
  const { content, factors } = factorPoly(p)
  const parts = factors.filter((f) => f.poly.degree >= 1)
  const many = parts.length > 1 || parts.some((f) => f.mult > 1) || !content.isOne()
  const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
  const body = parts
    .map((f) => {
      const t = toPlain(f.poly.toExpr(x))
      const w = many && f.poly.c.filter((c) => !c.isZero()).length > 1 ? `(${t})` : t
      return f.mult > 1 ? w + sup(f.mult) : w
    })
    .join('')
  return (content.isOne() ? '' : content.eq(Rational.MINUS_ONE) ? '−' : toPlain(num(content))) + body
}

/** g·rest as TeX with g struck out, e.g. \cancel{(x − 3)}(x + 3). */
function cancelPair(g: Poly, rest: Poly, x: string): string {
  const multi = (p: Poly) => p.c.filter((c) => !c.isZero()).length > 1
  const gf = polyFactoredTex(g, x)
  const crossed = `\\cancel{${multi(g) && gf.trivial ? `\\left(${gf.tex}\\right)` : gf.tex}}`
  if (rest.isConstant()) {
    const c = rest.coef(0)
    return c.isOne() ? crossed : `${toTex(num(c))}${crossed}`
  }
  const { content, prim } = rest.primitive()
  const rt = polyFactoredTex(prim, x)
  const restTex = multi(prim) && !rt.tex.startsWith('\\left') ? `\\left(${rt.tex}\\right)` : rt.tex
  const c = content.isOne() ? '' : content.eq(Rational.MINUS_ONE) ? '-' : toTex(num(content))
  return `${c}${crossed}${restTex}`
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
    if (rf) ratFromExpr(e, x, dens)
    if (rf && (!rf.den.isConstant() || dens.length > 0)) {
      const fullNum = rf.num
      const fullDen = rf.den
      const excluded: Rational[] = []
      for (const d of dens)
        for (const r of rationalRoots(d).roots) if (!excluded.some((v) => v.eq(r.value))) excluded.push(r.value)
      const result = simplify(mul(fullNum.toExpr(x), pow(fullDen.toExpr(x), -1)))
      const raw = simplify(e)
      let parts = fractionParts(e, x)
      const fromSum = !parts && e.kind === 'add'
      if (fromSum && key(raw) !== key(result)) parts = sumSteps(e, x, steps)
      const cancelled = parts !== null && dens.length > 0 && cancelSteps(parts, x, result, steps, fromSum)
      if (!cancelled && key(raw) !== key(result)) {
        if (steps.length === 0)
          steps.push({
            title: 'Write it as one fraction, factor, and cancel what the top and bottom share',
            tex: `${toTex(e)} = ${toTex(result)}`,
          })
        else if (
          steps[steps.length - 1].tex !== `= ${toTex(result)}` &&
          !(result.kind === 'num' && result.value.isZero())
        )
          steps.push({
            title: 'Multiply out the bottom too. Both ways of writing it are correct',
            tex: `= ${toTex(result)}`,
          })
      }
      answers.push({ tex: toTex(result), text: toText(result) })
      const nf = polyFactoredTex(fullNum, x)
      const df = polyFactoredTex(fullDen, x)
      if (!nf.trivial || !df.trivial) notes.push(`Factored: (${nf.text}) / (${df.text})`)
      if (excluded.length)
        notes.push(
          `Valid for ${excluded.map((v) => `${x} ≠ ${v}`).join(', ')} (the original expression is undefined there).`,
        )
      return {
        kind: 'simplify',
        title: 'Simplify',
        problemTex: toTex(e),
        answers,
        steps,
        notes,
        plot: functionPlot(result, x),
      }
    }
  }

  const s = simplify(e)
  const best = simplest(s)
  if (key(best) !== key(tidy(e))) {
    steps.push({
      title: 'Combine like terms: add up terms that have exactly the same letters and powers',
      tex: `${toTex(e)} = ${toTex(s)}`,
    })
    if (key(best) !== key(s)) steps.push({ title: 'Expanding gives a shorter form', tex: `= ${toTex(best)}` })
  } else steps.push({ title: 'There are no like terms to combine, so it is already as simple as it gets' })
  answers.push({ tex: toTex(best), text: toText(best) })
  if (x && vars.size === 1) {
    const p = polyFromExpr(best, x)
    if (p && p.degree >= 2) {
      const f = polyFactoredTex(p, x)
      if (!f.trivial) notes.push(`Factored form: ${f.text}`)
    }
  }
  return {
    kind: 'simplify',
    title: 'Simplify',
    problemTex: toTex(e),
    answers,
    steps,
    notes,
    plot: functionPlot(best, x),
  }
}

/** The two brackets in (a + b)(c + d), (a + b)², or a number times a bracket. */
function bracketPair(e: Expr): [Expr, Expr] | null {
  if (e.kind === 'pow' && e.base.kind === 'add' && e.exp.kind === 'num' && e.exp.value.eq(Rational.of(2)))
    return [e.base, e.base]
  if (e.kind === 'mul' && e.factors.length === 2) {
    const [a, b] = e.factors
    if (a.kind === 'add' || b.kind === 'add') return [a, b]
  }
  return null
}

const termsOf = (e: Expr): readonly Expr[] => (e.kind === 'add' ? e.terms : [e])
const wrapTex = (e: Expr) => {
  const t = toTex(e)
  return e.kind === 'add' || t.startsWith('-') ? `\\left(${t}\\right)` : t
}

function expandSteps(e: Expr, r: Expr): Step[] {
  const pair = bracketPair(e)
  if (!pair) {
    return [
      {
        title:
          'Multiply out every bracket: multiply each term in one bracket by each term in the other. Then combine like terms',
        tex: `${toTex(e)} = ${toTex(r)}`,
      },
    ]
  }
  const [A, B] = pair
  const steps: Step[] = []
  if (e.kind === 'pow')
    steps.push({
      title: 'Squaring a bracket means multiplying it by itself',
      tex: `${toTex(e)} = ${wrapTex(A)}${wrapTex(B)}`,
    })
  const products: Array<[Expr, Expr]> = []
  for (const a of termsOf(A)) for (const b of termsOf(B)) products.push([a, b])
  steps.push({
    title:
      A.kind === 'add' && B.kind === 'add'
        ? 'Multiply each term in the first bracket by each term in the second bracket'
        : 'Multiply the term outside by each term inside the bracket',
    tex: products.map(([a, b], i) => `${i ? '+ ' : ''}${wrapTex(a)} \\cdot ${wrapTex(b)}`).join(' '),
  })
  const each = products.map(([a, b]) => simplify(mul(a, b)))
  const listed: Expr = each.length === 1 ? each[0] : { kind: 'add', terms: each }
  steps.push({ title: 'Work out each product', tex: toTex(listed) })
  if (toTex(listed) !== toTex(r))
    steps.push({ title: 'Combine like terms (terms with the same power of the letter)', tex: toTex(r) })
  return steps
}

export function expandProblem(input: Expr): Solution {
  const e = tidy(input)
  const r = expand(e)
  const steps = expandSteps(e, r)
  const x = pickVariable(e)
  return {
    kind: 'expand',
    title: 'Expand',
    problemTex: toTex(e),
    answers: [{ tex: toTex(r), text: toText(r) }],
    steps,
    notes: [],
    plot: functionPlot(r, x),
  }
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
    const tex =
      f.length === 0
        ? n.toString()
        : (n < 0n ? '-' : '') + f.map(([p, c]) => (c > 1 ? `${p}^{${c}}` : `${p}`)).join(' \\cdot ')
    const text =
      f.length === 0
        ? n.toString()
        : (n < 0n ? '-' : '') + f.map(([p, c]) => (c > 1 ? `${p}^${c}` : `${p}`)).join(' · ')
    let m = n < 0n ? -n : n
    const primes: bigint[] = []
    for (const [p, c] of f)
      for (let i = 0; i < c; i++) {
        steps.push({
          title:
            m === p
              ? `${p} is a prime number itself, so divide it by ${p} to finish`
              : `The smallest prime that divides ${m} is ${p}. Divide by it`,
          tex: `${m} \\div ${p} = ${m / p}`,
        })
        primes.push(p)
        m /= p
      }
    if (primes.length > 1)
      steps.push({
        title: 'Multiply together all the primes we divided by. Repeated primes can be written as powers',
        tex: `${n < 0n ? -n : n} = ${primes.join(' \\times ')} = ${tex.replace(/^-/, '')}`,
      })
    if (f.length === 1 && f[0][1] === 1) notes.push(`${n < 0n ? -n : n} is a prime number.`)
    return {
      kind: 'factor',
      title: 'Prime factorization',
      problemTex: toTex(e),
      answers: [{ tex, text }],
      steps,
      notes,
    }
  }
  const x = pickVariable(s)
  const vars = freeSymbols(s)
  const ex = expand(s)
  if (x && vars.size === 1) {
    const p = polyFromExpr(ex, x)
    if (p) {
      const f = polyFactoredTex(p, x)
      const { content } = factorPoly(p)
      if (!content.isOne())
        steps.push({
          title: 'Take out the biggest number that divides every term (the common factor)',
          tex: `${toTex(ex)} = ${toTex(num(content))}\\left(${toTex(p.scale(content.inv()).toExpr(x))}\\right)`,
        })
      const { roots } = rationalRoots(p)
      const monicQuadratic =
        p.degree === 2 &&
        p.lead.isOne() &&
        p.c.every((c) => c.isInteger()) &&
        roots.length > 0 &&
        roots.every((r) => r.value.isInteger()) &&
        roots.reduce((k, r) => k + r.mult, 0) === 2
      if (monicQuadratic) {
        const rs = roots.flatMap((r) => Array.from({ length: r.mult }, () => r.value))
        const [m1, m2] = rs.map((r) => r.neg())
        const say = (r: Rational) => r.toString().replace(/^-/, '−')
        const par = (r: Rational) => (r.sign() < 0 ? `\\left(${r}\\right)` : `${r}`)
        steps.push({
          title: `Find two numbers that multiply to make ${say(p.coef(0))} and add up to ${say(p.coef(1))}. They are ${say(m1)} and ${say(m2)}`,
          tex: `${par(m1)} \\times ${par(m2)} = ${p.coef(0)},\\quad ${par(m1)} + ${par(m2)} = ${p.coef(1)}`,
        })
        steps.push({
          title: 'Put each number into a bracket with ' + x,
          tex: `${toTex(ex)} = \\left(${toTex(simplify(add(sym(x), num(m1))))}\\right)\\left(${toTex(simplify(add(sym(x), num(m2))))}\\right)`,
        })
        steps.push({
          title: 'Check by multiplying the brackets back out. You get the original expression ✓',
          tex: `${f.tex} = ${toTex(ex)}`,
        })
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
      if (roots.length)
        steps.push({
          title: `Find the values of ${x} that make it 0. Each one, r, gives a factor (${x} − r)`,
          tex: roots.map((r) => `${x} = ${toTex(num(r.value))}`).join(',\\quad '),
        })
      steps.push({
        title: f.trivial
          ? 'This cannot be split into simpler brackets with whole numbers or fractions'
          : 'Write it as the brackets multiplied together',
        tex: `${toTex(ex)} = ${f.tex}`,
      })
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
    den = (den * c.d) / gcd(den, c.d)
    const powers = new Map<string, Rational>()
    const fs = rest ? (rest.kind === 'mul' ? rest.factors : [rest]) : []
    for (const f of fs) {
      if (f.kind === 'sym') powers.set(f.name, Rational.ONE)
      else if (f.kind === 'pow' && f.base.kind === 'sym' && f.exp.kind === 'num' && f.exp.value.sign() > 0)
        powers.set(f.base.name, f.exp.value)
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
    return {
      kind: 'factor',
      title: 'Factor',
      problemTex: toTex(e),
      answers: [{ tex: toTex(ex), text: toText(ex) }],
      steps,
      notes: ['Only common factors are extracted for expressions with several variables.'],
    }
  }
  const inner = simplify(add(...terms.map((t) => simplify(mul(t, pow(common, -1))))))
  const tex = `${toTex(common)}\\left(${toTex(inner)}\\right)`
  steps.push({
    title: 'Find what every term has in common (numbers and letters), and take it out in front of a bracket',
    tex: `${toTex(ex)} = ${tex}`,
  })
  return {
    kind: 'factor',
    title: 'Factor',
    problemTex: toTex(e),
    answers: [{ tex, text: `${toText(common)}(${toText(inner)})` }],
    steps,
    notes,
  }
}
