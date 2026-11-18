import { type Expr, CONSTANTS, freeSymbols, isSym } from './expr'
import { Rational, lcm } from './rational'
import { splitCoef } from './simplify'

const GREEK = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'rho',
  'sigma',
  'tau',
  'phi',
  'chi',
  'psi',
  'omega',
])

const TEX_FN: Record<string, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  cot: '\\cot',
  sec: '\\sec',
  csc: '\\csc',
  asin: '\\arcsin',
  acos: '\\arccos',
  atan: '\\arctan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  ln: '\\ln',
  gcd: '\\gcd',
  lcm: '\\operatorname{lcm}',
  sign: '\\operatorname{sgn}',
  mod: '\\operatorname{mod}',
}
const TRIG = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh'])

/** Is this term printed with a leading minus sign? */
function isNegative(e: Expr): boolean {
  if (e.kind === 'num') return e.value.sign() < 0
  if (e.kind === 'mul' && e.factors[0].kind === 'num') return e.factors[0].value.sign() < 0
  return false
}

function negateTerm(e: Expr): Expr {
  if (e.kind === 'num') return { kind: 'num', value: e.value.neg() }
  if (e.kind === 'mul' && e.factors[0].kind === 'num') {
    const c = e.factors[0].value.neg()
    const rest = e.factors.slice(1)
    if (c.isOne()) return rest.length === 1 ? rest[0] : { kind: 'mul', factors: rest }
    return { kind: 'mul', factors: [{ kind: 'num', value: c }, ...rest] }
  }
  return e
}

/** Factors with a negative numeric exponent go into the denominator. */
function splitFraction(factors: readonly Expr[]): { top: Expr[]; bottom: Expr[] } {
  const top: Expr[] = []
  const bottom: Expr[] = []
  for (const f of factors) {
    if (f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.sign() < 0) {
      const e = f.exp.value.neg()
      bottom.push(e.isOne() ? f.base : { kind: 'pow', base: f.base, exp: { kind: 'num', value: e } })
    } else top.push(f)
  }
  return { top, bottom }
}

/** A sum of constants such as -3/2 + √5/2 is printed over a common denominator. */
function hasDenominator(t: Expr): boolean {
  const rest = splitCoef(t)[1]
  if (!rest) return false
  const fs = rest.kind === 'mul' ? rest.factors : [rest]
  return fs.some((f) => f.kind === 'pow' && f.exp.kind === 'num' && f.exp.value.sign() < 0)
}

function commonDenominator(terms: readonly Expr[]): bigint | null {
  if (terms.some(hasDenominator)) return null
  const ds = terms.map((t) => splitCoef(t)[0].d)
  if (ds[0] > 1n && ds.every((d) => d === ds[0])) return ds[0]
  if (terms.some((t) => freeSymbols(t).size > 0)) return null
  let d = 1n
  for (const t of terms) d = lcm(d, splitCoef(t)[0].d)
  return d > 1n ? d : null
}

function scaleTerm(t: Expr, by: bigint): Expr {
  const [c, rest] = splitCoef(t)
  const nc = c.mul(new Rational(by))
  if (!rest) return { kind: 'num', value: nc }
  if (nc.isOne()) return rest
  const fs = rest.kind === 'mul' ? rest.factors : [rest]
  return { kind: 'mul', factors: [{ kind: 'num', value: nc }, ...fs] }
}

// ---------------------------------------------------------------------------
// LaTeX

export function toTex(e: Expr): string {
  switch (e.kind) {
    case 'num':
      return numTex(e.value)
    case 'sym':
      return symTex(e.name)
    case 'add': {
      const d = commonDenominator(e.terms)
      if (d !== null && e.terms.length > 1) {
        const scaled = e.terms.map((t) => scaleTerm(t, d))
        if (scaled.every(isNegative)) return `-\\frac{${sumTex(scaled.map(negateTerm))}}{${d}}`
        return `\\frac{${sumTex(scaled)}}{${d}}`
      }
      return sumTex(e.terms)
    }
    case 'mul':
      return mulTex(e.factors)
    case 'pow':
      return powTex(e.base, e.exp)
    case 'fn':
      return fnTex(e.name, e.args)
  }
}

function sumTex(terms: readonly Expr[]): string {
  let out = ''
  terms.forEach((t, idx) => {
    if (idx === 0) out += toTex(t)
    else if (isNegative(t)) {
      const n = negateTerm(t)
      out += ' - ' + (n.kind === 'add' ? `\\left(${toTex(n)}\\right)` : toTex(n))
    } else out += ' + ' + toTex(t)
  })
  return out
}

function numTex(v: Rational): string {
  if (v.isInteger()) return v.n.toString()
  const s = v.sign() < 0 ? '-' : ''
  return `${s}\\frac{${v.abs().n}}{${v.d}}`
}

function symTex(name: string): string {
  if (name === 'pi') return '\\pi'
  if (name === 'infinity') return '\\infty'
  if (GREEK.has(name)) return `\\${name}`
  if (name.length > 1) return `\\mathrm{${name}}`
  return name
}

function factorTex(f: Expr): string {
  if (f.kind === 'add') return `\\left(${toTex(f)}\\right)`
  if (f.kind === 'num' && (f.value.sign() < 0 || !f.value.isInteger())) return `\\left(${toTex(f)}\\right)`
  return toTex(f)
}

function joinFactors(fs: Expr[]): string {
  let out = ''
  fs.forEach((f, i) => {
    const t = factorTex(f)
    if (i > 0) {
      const prev = fs[i - 1]
      const needsDot = /^[0-9.]/.test(t) || (prev.kind === 'num' && t.startsWith('\\frac'))
      out += needsDot ? ' \\cdot ' : t.startsWith('\\') ? ' ' : ''
    }
    out += t
  })
  return out
}

function mulTex(factors: readonly Expr[]): string {
  let coef = Rational.ONE
  let rest = factors
  if (factors[0].kind === 'num') {
    coef = factors[0].value
    rest = factors.slice(1)
  }
  const sign = coef.sign() < 0 ? '-' : ''
  const c = coef.abs()
  const { top, bottom } = splitFraction(rest)
  const topFs: Expr[] = []
  if (c.n !== 1n || top.length === 0) topFs.push({ kind: 'num', value: new Rational(c.n) })
  topFs.push(...top)
  const botFs: Expr[] = []
  if (c.d !== 1n) botFs.push({ kind: 'num', value: new Rational(c.d) })
  botFs.push(...bottom)
  // Keep "2x" style instead of "2·1" artefacts.
  const topTex = topFs.length === 1 ? toTex(topFs[0]) : joinFactors(topFs)
  if (botFs.length === 0) return sign + topTex
  const botTex = botFs.length === 1 ? toTex(botFs[0]) : joinFactors(botFs)
  return `${sign}\\frac{${topTex}}{${botTex}}`
}

function baseTex(b: Expr): string {
  if (b.kind === 'add' || b.kind === 'mul' || b.kind === 'pow') return `\\left(${toTex(b)}\\right)`
  if (b.kind === 'num' && (b.value.sign() < 0 || !b.value.isInteger())) return `\\left(${toTex(b)}\\right)`
  if (b.kind === 'fn' && b.name !== 'abs') return `\\left(${toTex(b)}\\right)`
  return toTex(b)
}

function powTex(b: Expr, x: Expr): string {
  if (x.kind === 'num') {
    const v = x.value
    if (v.sign() < 0) {
      const p: Expr = v.neg().isOne() ? b : { kind: 'pow', base: b, exp: { kind: 'num', value: v.neg() } }
      return `\\frac{1}{${toTex(p)}}`
    }
    if (v.n === 1n && v.d === 2n) return `\\sqrt{${toTex(b)}}`
    if (v.n === 1n && v.d > 2n) return `\\sqrt[${v.d}]{${toTex(b)}}`
    if (b.kind === 'fn' && TRIG.has(b.name) && v.isInteger()) {
      return `${TEX_FN[b.name]}^{${v.n}}${paren(toTex(b.args[0]))}`
    }
  }
  return `${baseTex(b)}^{${toTex(x)}}`
}

/** Plain parentheses for short arguments, stretchy ones for tall content. */
export function paren(inner: string): string {
  return /\\frac|\\int|\\sum|\\left|\\begin/.test(inner) ? `\\left(${inner}\\right)` : `(${inner})`
}

function fnTex(name: string, args: readonly Expr[]): string {
  const inner = args.map(toTex).join(', ')
  switch (name) {
    case 'abs':
      return `\\left|${inner}\\right|`
    case 'floor':
      return `\\left\\lfloor ${inner}\\right\\rfloor`
    case 'ceil':
      return `\\left\\lceil ${inner}\\right\\rceil`
    case 'factorial': {
      const a = args[0]
      const t = a.kind === 'num' || a.kind === 'sym' ? toTex(a) : `\\left(${toTex(a)}\\right)`
      return `${t}!`
    }
    case 'log': {
      const base = args[1]
      const b = base.kind === 'num' && base.value.n === 10n && base.value.d === 1n ? '' : `_{${toTex(base)}}`
      return `\\log${b}${paren(toTex(args[0]))}`
    }
    case 'round':
      return `\\operatorname{round}${paren(inner)}`
  }
  const f = TEX_FN[name] ?? `\\operatorname{${name}}`
  return `${f}${paren(inner)}`
}

// ---------------------------------------------------------------------------
// Plain text (re-parsable by our parser)

export function toText(e: Expr): string {
  switch (e.kind) {
    case 'num':
      return e.value.toString()
    case 'sym':
      return e.name === 'infinity' ? '∞' : e.name
    case 'add': {
      const d = commonDenominator(e.terms)
      if (d !== null && e.terms.length > 1) {
        const scaled = e.terms.map((t) => scaleTerm(t, d))
        if (scaled.every(isNegative)) return `-(${toText({ kind: 'add', terms: scaled.map(negateTerm) })})/${d}`
        return `(${toText({ kind: 'add', terms: scaled })})/${d}`
      }
      let out = ''
      e.terms.forEach((t, i) => {
        if (i === 0) out += toText(t)
        else if (isNegative(t)) {
          const n = negateTerm(t)
          out += ' - ' + (n.kind === 'add' ? `(${toText(n)})` : toText(n))
        } else out += ' + ' + toText(t)
      })
      return out
    }
    case 'mul': {
      let coef = Rational.ONE
      let rest = e.factors
      if (rest[0].kind === 'num') {
        coef = rest[0].value
        rest = rest.slice(1)
      }
      const sign = coef.sign() < 0 ? '-' : ''
      const c = coef.abs()
      const { top, bottom } = splitFraction(rest)
      const parts = top.map(textFactor)
      let topStr = parts.join('*')
      if (c.n !== 1n || parts.length === 0) {
        const lead = c.n.toString()
        topStr =
          parts.length === 0
            ? lead
            : /^[a-z(]/i.test(parts[0]) && top[0].kind !== 'fn'
              ? lead + topStr
              : lead + '*' + topStr
      }
      const botParts = bottom.map(textFactor)
      if (c.d !== 1n) botParts.unshift(c.d.toString())
      if (botParts.length === 0) return sign + topStr
      const botStr = botParts.length === 1 ? botParts[0] : `(${botParts.join('*')})`
      const topWrapped = top.length + (c.n !== 1n ? 1 : 0) > 1 && /[+-]/.test(topStr.slice(1)) ? `(${topStr})` : topStr
      return `${sign}${topWrapped}/${botStr}`
    }
    case 'pow': {
      const { base, exp } = e
      if (exp.kind === 'num' && exp.value.sign() < 0) {
        const p: Expr = exp.value.neg().isOne()
          ? base
          : { kind: 'pow', base, exp: { kind: 'num', value: exp.value.neg() } }
        return `1/${textFactor(p)}`
      }
      if (exp.kind === 'num' && exp.value.n === 1n && exp.value.d === 2n) return `sqrt(${toText(base)})`
      const b =
        base.kind === 'sym' ||
        (base.kind === 'num' && base.value.isInteger() && base.value.sign() >= 0) ||
        base.kind === 'fn'
          ? toText(base)
          : `(${toText(base)})`
      const x =
        exp.kind === 'sym' || (exp.kind === 'num' && exp.value.isInteger() && exp.value.sign() >= 0)
          ? toText(exp)
          : `(${toText(exp)})`
      return `${b}^${x}`
    }
    case 'fn': {
      if (e.name === 'abs') return `|${toText(e.args[0])}|`
      if (e.name === 'factorial') return `${textFactor(e.args[0])}!`
      if (e.name === 'log') {
        const b = e.args[1]
        if (b.kind === 'num' && b.value.n === 10n && b.value.d === 1n) return `log(${toText(e.args[0])})`
        return `log(${toText(e.args[0])}, ${toText(b)})`
      }
      return `${e.name}(${e.args.map(toText).join(', ')})`
    }
  }
}

function textFactor(f: Expr): string {
  const t = toText(f)
  if (f.kind === 'add' || (f.kind === 'num' && !f.value.isInteger()) || (f.kind === 'num' && f.value.sign() < 0))
    return `(${t})`
  if (f.kind === 'mul') return `(${t})`
  return t
}

/** Short decimal form for display. */
export function formatNumber(v: number, digits = 10): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '-∞'
  if (Math.abs(v) < 1e-12) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e15 || abs < 1e-6) {
    const [m, ex] = v.toExponential(digits - 1).split('e')
    return `${trimZeros(m)}e${Number(ex)}`
  }
  return trimZeros(v.toPrecision(digits))
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

export function texNumber(v: number): string {
  const s = formatNumber(v)
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s)
  return m ? `${m[1]} \\times 10^{${m[2]}}` : s
}

export { isSym, CONSTANTS }
