import { type Expr, type Pow, fn, freeSymbols, mul, num } from './expr'
import { isDecimalLiteral, isPercentMark, markDecimal } from './literals'
import { evalNum } from './numeric'
import { formatNumber, toTex, toText } from './print'
import { MathError, Rational, divisors, extractPower, gcd, lcm } from './rational'
import { simplify } from './simplify'
import type { Answer, Solution, Step } from './types'

const EXACT_FNS = new Set(['factorial', 'gcd', 'lcm', 'mod', 'abs', 'floor', 'ceil', 'round'])

/** Can the whole tree be evaluated exactly with rational arithmetic? */
function isRationalTree(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
      return true
    case 'sym':
      return false
    case 'add':
      return e.terms.every(isRationalTree)
    case 'mul':
      return e.factors.every(isRationalTree)
    case 'pow': {
      if (!isRationalTree(e.base) || !isRationalTree(e.exp)) return false
      const x = simplify(e.exp)
      return x.kind === 'num' && x.value.isInteger()
    }
    case 'fn':
      return EXACT_FNS.has(e.name) && e.args.every(isRationalTree)
  }
}

// ---------------------------------------------------------------------------
// A small tree that mirrors what was typed, so every step can show the whole
// expression the way a person would write it on paper.

type Op = '+' | '-' | '*' | '/'

interface NumNode {
  t: 'n'
  v: Rational
  /** Show as a decimal (typed as 0.5, or the result of decimal arithmetic). */
  dec?: boolean
}

type Node =
  | NumNode
  | { t: 'op'; op: Op; a: Node; b: Node }
  | { t: 'pow'; a: Node; b: Node }
  | { t: 'neg'; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'fn'; name: string; args: Node[] }

const n = (v: Rational, dec = false): NumNode => (dec ? { t: 'n', v, dec } : { t: 'n', v })

const isRecip = (e: Expr): e is Pow => e.kind === 'pow' && e.exp.kind === 'num' && e.exp.value.eq(Rational.MINUS_ONE)

const isMinusOne = (e: Expr) => e.kind === 'num' && e.value.eq(Rational.MINUS_ONE)

/** A whole number typed without a decimal point, possibly with a minus sign. */
function wholeLiteral(e: Expr): bigint | null {
  if (e.kind === 'num' && e.value.isInteger() && !isDecimalLiteral(e)) return e.value.n
  if (e.kind === 'mul' && e.factors.length === 2 && isMinusOne(e.factors[0])) {
    const v = wholeLiteral(e.factors[1])
    return v === null ? null : -v
  }
  return null
}

/** For a term like −5x² inside a sum, the part after the minus sign (5x²). */
function negated(t: Expr): Expr | null {
  if (t.kind !== 'mul' || t.factors[0].kind !== 'num' || t.factors[0].value.sign() >= 0) return null
  const [c, ...rest] = t.factors
  if (isMinusOne(c)) return rest.length === 1 ? rest[0] : mul(...rest)
  const positive = num(c.value.neg())
  return mul(isDecimalLiteral(c) ? markDecimal(positive) : positive, ...rest)
}

function build(e: Expr): Node {
  switch (e.kind) {
    case 'num':
      return n(e.value, isDecimalLiteral(e))
    case 'add': {
      let acc = build(e.terms[0])
      for (const t of e.terms.slice(1)) {
        const inner = negated(t)
        if (inner) acc = { t: 'op', op: '-', a: acc, b: build(inner) }
        else if (t.kind === 'num' && t.value.sign() < 0)
          acc = { t: 'op', op: '-', a: acc, b: n(t.value.neg(), isDecimalLiteral(t)) }
        else acc = { t: 'op', op: '+', a: acc, b: build(t) }
      }
      return acc
    }
    case 'mul': {
      const fs = e.factors
      if (isMinusOne(fs[0]) && fs.length >= 2) {
        const inner = build(fs.length === 2 ? fs[1] : mul(...fs.slice(1)))
        return inner.t === 'n' ? n(inner.v.neg(), inner.dec) : { t: 'neg', a: inner }
      }
      if (fs.length === 2 && isPercentMark(fs[1])) return { t: 'pct', a: build(fs[0]) }
      // "3/4" typed as a fraction in lowest terms is a number, not a division to do.
      if (fs.length === 2 && isRecip(fs[1])) {
        const top = wholeLiteral(fs[0])
        const bottom = wholeLiteral(fs[1].base)
        if (top !== null && bottom !== null && bottom > 1n && gcd(top, bottom) === 1n)
          return n(new Rational(top, bottom))
      }
      // Everything on top, then everything underneath: (1 + 1) ÷ (1 + 2).
      const product = (xs: Node[]): Node => xs.reduce((acc, f) => ({ t: 'op', op: '*', a: acc, b: f }))
      const tops = fs.filter((f) => !isRecip(f)).map(build)
      const bottoms = fs.filter(isRecip).map((f) => build(f.base))
      const top = tops.length ? product(tops) : n(Rational.ONE)
      return bottoms.length ? { t: 'op', op: '/', a: top, b: product(bottoms) } : top
    }
    case 'pow':
      if (e.exp.kind === 'num' && e.exp.value.eq(Rational.MINUS_ONE))
        return { t: 'op', op: '/', a: n(Rational.ONE), b: build(e.base) }
      return { t: 'pow', a: build(e.base), b: build(e.exp) }
    case 'fn':
      return { t: 'fn', name: e.name, args: e.args.map(build) }
    case 'sym':
      throw new MathError('This expression has variables; try "simplify" or "solve"')
  }
}

function kids(node: Node): Node[] {
  switch (node.t) {
    case 'n':
      return []
    case 'op':
    case 'pow':
      return [node.a, node.b]
    case 'neg':
    case 'pct':
      return [node.a]
    case 'fn':
      return node.args
  }
}

function withKids(node: Node, ks: Node[]): Node {
  switch (node.t) {
    case 'n':
      return node
    case 'op':
      return { ...node, a: ks[0], b: ks[1] }
    case 'pow':
      return { ...node, a: ks[0], b: ks[1] }
    case 'neg':
    case 'pct':
      return { ...node, a: ks[0] }
    case 'fn':
      return { ...node, args: ks }
  }
}

// ---------------------------------------------------------------------------
// Decimals

/** Number of decimal places if v has a short exact decimal form, else null. */
function decimalPlaces(v: Rational): number | null {
  let p = 1n
  for (let k = 0; k <= 10; k++) {
    if (p % v.d === 0n) return k
    p *= 10n
  }
  return null
}

function decimalString(v: Rational): string {
  const k = decimalPlaces(v)
  if (k === null || k === 0) return v.toString()
  const scaled = (v.n * 10n ** BigInt(k)) / v.d
  const neg = scaled < 0n
  const digits = (neg ? -scaled : scaled).toString().padStart(k + 1, '0')
  return `${neg ? '-' : ''}${digits.slice(0, -k)}.${digits.slice(-k)}`
}

const showsAsDecimal = (x: NumNode) => !!x.dec && decimalPlaces(x.v) !== null
/** Arithmetic stays in decimals when every number is a decimal or a whole number. */
const decimalFriendly = (x: NumNode) => showsAsDecimal(x) || x.v.isInteger()

// ---------------------------------------------------------------------------
// Printing

const PREC: Record<Op, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

function isNegative(node: Node): boolean {
  return (node.t === 'n' && node.v.sign() < 0) || node.t === 'neg'
}

function isPlainWhole(node: Node): node is NumNode {
  return node.t === 'n' && node.v.isInteger() && node.v.sign() >= 0 && !node.dec
}

/** Draw every division as a stacked fraction (used when showing a value being put into a formula). */
let stackAll = false

/** An integer over an integer is drawn as a stacked fraction. */
const stacked = (node: Node) =>
  node.t === 'op' && node.op === '/' && (stackAll || (isPlainWhole(node.a) && isPlainWhole(node.b)))

function prec(node: Node): number {
  switch (node.t) {
    case 'n':
      return node.v.sign() < 0 ? 1.5 : 5
    case 'op':
      return stacked(node) ? 4 : PREC[node.op]
    case 'neg':
      return 1.5
    case 'pow':
      return 3
    case 'pct':
    case 'fn':
      return 5
  }
}

const isFractionLeaf = (node: Node) => node.t === 'n' && !node.v.isInteger() && !showsAsDecimal(node)

/** Does child i of this node get brackets around it when printed? */
function needsParens(parent: Node, i: number): boolean {
  const child = kids(parent)[i]
  switch (parent.t) {
    case 'op': {
      if (stacked(parent)) return false
      const p = PREC[parent.op]
      const c = prec(child)
      if (i === 0) return c < p
      return isNegative(child) || c < p || (c === p && (parent.op === '-' || parent.op === '/'))
    }
    case 'pow':
      return i === 0 && (prec(child) <= 3 || isFractionLeaf(child) || stacked(child))
    case 'neg':
      return prec(child) < 3
    case 'pct':
      return prec(child) < 5
    default:
      return false
  }
}

function numTex(x: NumNode): string {
  if (x.v.isInteger()) return x.v.n.toString()
  if (showsAsDecimal(x)) return decimalString(x.v)
  return `${x.v.sign() < 0 ? '-' : ''}\\frac{${x.v.abs().n}}{${x.v.d}}`
}

function tex(node: Node): string {
  const k = kids(node)
  const part = (i: number) => (needsParens(node, i) ? `\\left(${tex(k[i])}\\right)` : tex(k[i]))
  switch (node.t) {
    case 'n':
      return numTex(node)
    case 'op':
      if (stacked(node)) return `\\frac{${tex(node.a)}}{${tex(node.b)}}`
      return `${part(0)} ${{ '+': '+', '-': '-', '*': '\\times', '/': '\\div' }[node.op]} ${part(1)}`
    case 'pow':
      return `${part(0)}^{${tex(node.b)}}`
    case 'neg':
      return `-${part(0)}`
    case 'pct':
      return `${part(0)}\\%`
    case 'fn': {
      const args = node.args.map(tex)
      switch (node.name) {
        case 'factorial':
          return `${node.args[0].t === 'n' && node.args[0].v.sign() >= 0 ? args[0] : `\\left(${args[0]}\\right)`}!`
        case 'abs':
          return `\\left|${args[0]}\\right|`
        case 'floor':
          return `\\left\\lfloor ${args[0]} \\right\\rfloor`
        case 'ceil':
          return `\\left\\lceil ${args[0]} \\right\\rceil`
        case 'mod':
          return `${args[0]} \\bmod ${args[1]}`
        case 'gcd':
          return `\\gcd\\left(${args.join(', ')}\\right)`
        default:
          return `\\operatorname{${node.name}}\\left(${args.join(', ')}\\right)`
      }
    }
  }
}

/** Plain text for step titles: −3, 3/4, 0.25, 2³. */
function say(x: Rational | NumNode): string {
  const node = x instanceof Rational ? n(x) : x
  const s = showsAsDecimal(node) ? decimalString(node.v) : node.v.toString()
  return s.replace(/^-/, '−')
}

const SUP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
}

function sayPow(base: NumNode, exp: bigint): string {
  const b = base.v.isInteger() && base.v.sign() >= 0 ? say(base) : `(${say(base)})`
  const e = exp.toString()
  return e.length <= 3 ? b + [...e].map((c) => SUP[c]).join('') : `${b}^${e}`
}

// ---------------------------------------------------------------------------
// The details of each operation, written for someone learning it.

const frac = (top: bigint, bottom: bigint) => (bottom === 1n ? `${top}` : `\\frac{${top}}{${bottom}}`)
const signed = (v: bigint) => (v < 0n ? `\\left(${v}\\right)` : `${v}`)

function simplifyStep(top: bigint, bottom: bigint): Step[] {
  const g = gcd(top, bottom)
  if (g <= 1n) return []
  if (bottom / g === 1n)
    return [{ title: `Simplify: the bottom goes into the top exactly`, tex: `${frac(top, bottom)} = ${top / bottom}` }]
  return [
    {
      title: `Simplify: divide the top and the bottom by ${g}`,
      tex: `${frac(top, bottom)} = \\frac{${top} \\div ${g}}{${bottom} \\div ${g}} = ${frac(top / g, bottom / g)}`,
    },
  ]
}

/** Decimals are turned into fractions when they meet a fraction like 1/3. */
function decimalToFraction(x: NumNode): Step[] {
  if (!showsAsDecimal(x) || x.v.isInteger()) return []
  const k = decimalPlaces(x.v)!
  const p = 10n ** BigInt(k)
  const top = x.v.n * (p / x.v.d)
  const g = gcd(top, p)
  return [
    {
      title: `Write ${say(x)} as a fraction`,
      tex: `${decimalString(x.v)} = ${frac(top, p)}${g > 1n ? ` = ${frac(top / g, p / g)}` : ''}`,
    },
  ]
}

function addDetails(a: NumNode, b: NumNode, subtract: boolean): Step[] {
  if (a.v.isInteger() && b.v.isInteger()) return []
  if (decimalFriendly(a) && decimalFriendly(b)) return []
  const out = [...decimalToFraction(a), ...decimalToFraction(b)]
  const [A, B] = [a.v, b.v]
  const verb = subtract ? 'subtract' : 'add'
  const sym = subtract ? '-' : '+'
  let top: bigint
  let bottom: bigint
  if (A.d === B.d) {
    top = subtract ? A.n - B.n : A.n + B.n
    bottom = A.d
    out.push({
      title: `The bottom numbers are the same, so ${verb} the top numbers and keep the bottom`,
      tex: `${frac(A.n, A.d)} ${sym} ${frac(B.n, B.d)} = \\frac{${A.n} ${sym} ${signed(B.n)}}{${bottom}} = ${frac(top, bottom)}`,
    })
  } else {
    bottom = lcm(A.d, B.d)
    out.push({
      title: `The bottom numbers are different (${A.d} and ${B.d}). Find the smallest number they both go into: ${bottom}`,
    })
    const scaled = [A, B].map((X) => {
      const k = bottom / X.d
      if (k !== 1n)
        out.push({
          title:
            X.d === 1n
              ? `Write ${say(X)} as a fraction with ${bottom} on the bottom`
              : `Change ${say(X)} to have ${bottom} on the bottom: multiply the top and the bottom by ${k}`,
          tex:
            X.d === 1n
              ? `${X.n} = \\frac{${signed(X.n)} \\times ${k}}{${k}} = ${frac(X.n * k, bottom)}`
              : `${frac(X.n, X.d)} = \\frac{${signed(X.n)} \\times ${k}}{${X.d} \\times ${k}} = ${frac(X.n * k, bottom)}`,
        })
      return X.n * k
    })
    top = subtract ? scaled[0] - scaled[1] : scaled[0] + scaled[1]
    out.push({
      title: `Now the bottoms match. ${subtract ? 'Subtract' : 'Add'} the top numbers and keep the bottom`,
      tex: `\\frac{${scaled[0]}}{${bottom}} ${sym} \\frac{${scaled[1]}}{${bottom}} = \\frac{${scaled[0]} ${sym} ${signed(scaled[1])}}{${bottom}} = ${frac(top, bottom)}`,
    })
  }
  return [...out, ...simplifyStep(top, bottom)]
}

function mulDetails(a: NumNode, b: NumNode): Step[] {
  if (a.v.isInteger() && b.v.isInteger()) return []
  if (decimalFriendly(a) && decimalFriendly(b)) return []
  const out = [...decimalToFraction(a), ...decimalToFraction(b)]
  const [A, B] = [a.v, b.v]
  const top = A.n * B.n
  const bottom = A.d * B.d
  if (A.isInteger() || B.isInteger()) {
    const [whole, f] = A.isInteger() ? [A, B] : [B, A]
    out.push({
      title: `Multiply the top number by ${say(whole)}. The bottom stays the same`,
      tex: `${frac(f.n, f.d)} \\times ${signed(whole.n)} = \\frac{${signed(f.n)} \\times ${signed(whole.n)}}{${f.d}} = ${frac(top, bottom)}`,
    })
  } else {
    out.push({
      title: 'Multiply the top numbers together, and the bottom numbers together',
      tex: `${frac(A.n, A.d)} \\times ${frac(B.n, B.d)} = \\frac{${signed(A.n)} \\times ${signed(B.n)}}{${A.d} \\times ${B.d}} = ${frac(top, bottom)}`,
    })
  }
  return [...out, ...simplifyStep(top, bottom)]
}

function divDetails(a: NumNode, b: NumNode): Step[] {
  const [A, B] = [a.v, b.v]
  if (A.isInteger() && B.isInteger()) {
    if (A.n % B.n === 0n) return []
    return [
      {
        title: `${say(A)} ÷ ${say(B)} is not a whole number, so write it as a fraction`,
        tex: `${A.n} \\div ${signed(B.n)} = ${frac(A.n, B.n)}`,
      },
      ...simplifyStep(A.n, B.n),
    ]
  }
  if (decimalFriendly(a) && decimalFriendly(b) && decimalPlaces(A.div(B)) !== null) return []
  const out = [...decimalToFraction(a), ...decimalToFraction(b)]
  const flip = B.inv()
  out.push({
    title: B.isInteger()
      ? `Dividing by ${say(B)} is the same as multiplying by 1/${say(B)}`
      : 'To divide by a fraction, flip it upside down and multiply',
    tex: `${frac(A.n, A.d)} \\div ${frac(B.n, B.d)} = ${frac(A.n, A.d)} \\times ${frac(flip.n, flip.d)}`,
  })
  return [...out, ...mulDetails(n(A), n(flip))]
}

function signNote(a: Rational, b: Rational): string {
  if (a.sign() < 0 && b.sign() < 0) return ' (a negative and a negative make a positive)'
  if (a.sign() * b.sign() < 0) return ' (a negative and a positive make a negative)'
  return ''
}

function listOf(xs: bigint[], max = 12): string {
  return xs.length > max ? `${xs.slice(0, max).join(', ')}, …` : xs.join(', ')
}

function gcdDetails(a: bigint, b: bigint, g: bigint): Step[] {
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b]
  if (x > 0n && y > 0n && x <= 200n && y <= 200n) {
    const dx = divisors(x) ?? []
    const dy = divisors(y) ?? []
    return [
      { title: `List the numbers that divide ${x} exactly`, tex: `${listOf(dx, 20)}` },
      { title: `List the numbers that divide ${y} exactly`, tex: `${listOf(dy, 20)}` },
      { title: `The biggest number in both lists is ${g}` },
    ]
  }
  // Euclid's algorithm: keep dividing and keep the remainder.
  const out: Step[] = []
  let [p, q] = x >= y ? [x, y] : [y, x]
  while (q !== 0n && out.length < 12) {
    const r = p % q
    out.push({ title: `Divide ${p} by ${q}: the remainder is ${r}`, tex: `${p} = ${p / q} \\times ${q} + ${r}` })
    ;[p, q] = [q, r]
  }
  out.push({ title: `The remainder is 0, so the answer is the last number we divided by: ${g}` })
  return out
}

function lcmDetails(a: bigint, b: bigint, l: bigint): Step[] {
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b]
  if (x > 0n && y > 0n && l / x <= 12n && l / y <= 12n) {
    const mult = (k: bigint) => Array.from({ length: Number(l / k) }, (_, i) => k * BigInt(i + 1))
    return [
      { title: `List the multiples of ${x}`, tex: `${mult(x).join(', ')}, \\ldots` },
      { title: `List the multiples of ${y}`, tex: `${mult(y).join(', ')}, \\ldots` },
      { title: `The first number in both lists is ${l}` },
    ]
  }
  const g = gcd(x, y)
  return [
    {
      title: 'Use lcm(a, b) = a × b ÷ gcd(a, b)',
      tex: `\\operatorname{lcm}(${x}, ${y}) = \\frac{${x} \\times ${y}}{${g}} = ${l}`,
    },
  ]
}

function factorialText(k: bigint): string {
  if (k <= 7n) {
    const parts: bigint[] = []
    for (let i = k; i >= 1n; i--) parts.push(i)
    return parts.join(' × ')
  }
  return `${k} × ${k - 1n} × ${k - 2n} × … × 2 × 1`
}

interface Reduction {
  value: NumNode
  title: string
  details: Step[]
}

/** Works out one operation whose inputs are already numbers. */
function compute(node: Node): Reduction {
  const ks = kids(node) as NumNode[]
  switch (node.t) {
    case 'op': {
      const [a, b] = ks
      const [A, B] = [a.v, b.v]
      const keepDecimal = (v: Rational) =>
        (a.dec || b.dec) && decimalFriendly(a) && decimalFriendly(b) && decimalPlaces(v) !== null
      switch (node.op) {
        case '+':
        case '-': {
          const v = node.op === '+' ? A.add(B) : A.sub(B)
          const value = n(v, keepDecimal(v))
          return {
            value,
            title: `${node.op === '+' ? 'Add' : 'Subtract'}: ${say(a)} ${node.op === '+' ? '+' : '−'} ${B.sign() < 0 ? `(${say(b)})` : say(b)} = ${say(value)}`,
            details: addDetails(a, b, node.op === '-'),
          }
        }
        case '*': {
          const v = A.mul(B)
          const value = n(v, keepDecimal(v))
          const show = (x: NumNode) => (x.v.sign() < 0 ? `(${say(x)})` : say(x))
          return {
            value,
            title: `Multiply: ${show(a)} × ${show(b)} = ${say(value)}${signNote(A, B)}`,
            details: mulDetails(a, b),
          }
        }
        case '/': {
          if (B.isZero()) throw new MathError('Division by zero is undefined')
          const v = A.div(B)
          const value = n(v, keepDecimal(v))
          const show = (x: NumNode) => (x.v.sign() < 0 ? `(${say(x)})` : say(x))
          return {
            value,
            title: `Divide: ${show(a)} ÷ ${show(b)} = ${say(value)}${signNote(A, B)}`,
            details: divDetails(a, b),
          }
        }
      }
      break
    }
    case 'pow': {
      const [base, ex] = ks
      if (!ex.v.isInteger()) throw new MathError('Only whole-number powers can be worked out exactly here')
      const k = ex.v.n
      if (base.v.isZero() && k < 0n) throw new MathError('Division by zero is undefined')
      const v = base.v.pow(k)
      const value = n(v, !!base.dec && decimalPlaces(v) !== null)
      const p = sayPow(base, k)
      let title: string
      if (k === 0n) title = `Any number to the power 0 is 1: ${p} = 1`
      else if (k === 1n) title = `A number to the power 1 is just itself: ${p} = ${say(value)}`
      else if (k < 0n)
        title = `A negative power means 1 divided by the positive power: ${p} = 1/${sayPow(base, -k)} = ${say(value)}`
      else if (k <= 6n && v.n.toString().length + v.d.toString().length <= 16) {
        const b = base.v.isInteger() && base.v.sign() >= 0 ? say(base) : `(${say(base)})`
        title = `${p} means ${Array.from({ length: Number(k) }, () => b).join(' × ')}, which is ${say(value)}`
      } else title = `Work out the power: ${p} = ${say(value)}`
      return { value, title, details: [] }
    }
    case 'pct': {
      const [a] = ks
      const v = a.v.div(Rational.of(100))
      const value = n(v, decimalPlaces(v) !== null)
      return {
        value,
        title: `Percent means "out of 100": ${say(a)}% = ${say(a)} ÷ 100 = ${say(value)}`,
        details: [],
      }
    }
    case 'fn': {
      const r = simplify(fn(node.name, ...ks.map((k) => num(k.v))))
      if (r.kind !== 'num') throw new MathError(`I can't work out ${node.name} here`)
      const value = n(r.value)
      const [a, b] = ks
      switch (node.name) {
        case 'factorial': {
          const k = a.v.n
          return {
            value,
            title: k <= 1n ? `${k}! is 1` : `${k}! means ${factorialText(k)}, which is ${say(value)}`,
            details: [],
          }
        }
        case 'gcd':
          return {
            value,
            title: `Greatest common divisor (the biggest number that divides all of them): gcd(${ks.map(say).join(', ')}) = ${say(value)}`,
            details: ks.length === 2 && a.v.isInteger() && b.v.isInteger() ? gcdDetails(a.v.n, b.v.n, r.value.n) : [],
          }
        case 'lcm':
          return {
            value,
            title: `Least common multiple (the smallest number all of them go into): lcm(${ks.map(say).join(', ')}) = ${say(value)}`,
            details: ks.length === 2 && a.v.isInteger() && b.v.isInteger() ? lcmDetails(a.v.n, b.v.n, r.value.n) : [],
          }
        case 'mod': {
          const q = a.v.sub(r.value).div(b.v)
          return {
            value,
            title: `${say(a)} mod ${say(b)} is the remainder after dividing: ${say(a)} = ${say(q)} × ${say(b)} + ${say(value)}, so the remainder is ${say(value)}`,
            details: [],
          }
        }
        case 'abs':
          return {
            value,
            title: `The absolute value is the distance from 0, so it is never negative: |${say(a)}| = ${say(value)}`,
            details: [],
          }
        case 'floor':
          return { value, title: `Round down to a whole number: ⌊${say(a)}⌋ = ${say(value)}`, details: [] }
        case 'ceil':
          return { value, title: `Round up to a whole number: ⌈${say(a)}⌉ = ${say(value)}`, details: [] }
        case 'round':
          return { value, title: `Round to the nearest whole number: round(${say(a)}) = ${say(value)}`, details: [] }
      }
      return { value, title: `Work out ${node.name}(${ks.map(say).join(', ')}) = ${say(value)}`, details: [] }
    }
  }
  throw new MathError('Something went wrong while calculating')
}

// ---------------------------------------------------------------------------
// Order of operations: brackets, powers, × ÷, then + −.

interface Ready {
  path: number[]
  node: Node
  /** How many brackets it sits inside. */
  depth: number
  /** Why it is done now: inside brackets, inside a function, in an exponent. */
  group: 'brackets' | 'function' | 'exponent' | null
}

function rank(node: Node): number {
  switch (node.t) {
    case 'fn':
    case 'pct':
      return 4
    case 'pow':
    case 'neg':
      return 3
    case 'op':
      return node.op === '*' || node.op === '/' ? 2 : 1
    default:
      return 0
  }
}

function collect(node: Node, depth: number, group: Ready['group'], path: number[], out: Ready[]) {
  const ks = kids(node)
  if (!ks.length) return
  if (ks.every((k) => k.t === 'n')) {
    out.push({ path, node, depth, group })
    return
  }
  ks.forEach((k, i) => {
    const g: Ready['group'] =
      node.t === 'fn' ? 'function' : node.t === 'pow' && i === 1 ? 'exponent' : needsParens(node, i) ? 'brackets' : null
    collect(k, depth + (g ? 1 : 0), g ?? group, [...path, i], out)
  })
}

function replaceAt(node: Node, path: number[], value: Node): Node {
  if (!path.length) return value
  const ks = [...kids(node)]
  ks[path[0]] = replaceAt(ks[path[0]], path.slice(1), value)
  // −(5) is just −5
  const next = withKids(node, ks)
  if (next.t === 'neg' && next.a.t === 'n') return n(next.a.v.neg(), next.a.dec)
  return next
}

function countOps(node: Node): { add: number; mul: number; total: number } {
  const c = { add: 0, mul: 0, total: 0 }
  const walk = (x: Node) => {
    if (x.t === 'n') return
    c.total++
    if (x.t === 'op') {
      if (x.op === '+' || x.op === '-') c.add++
      else c.mul++
    }
    kids(x).forEach(walk)
  }
  walk(node)
  return c
}

/** A short reason for doing this operation now, when there is a choice to make. */
function reason(r: Ready, root: Node): string {
  const ops = countOps(root)
  if (ops.total <= 1) return ''
  if (r.group === 'brackets') return 'Brackets first'
  if (r.group === 'exponent') return 'Work out the exponent first'
  if (r.group === 'function') return 'Work out the inside first'
  const k = rank(r.node)
  if (k === 3) return 'Powers come before × ÷ + −'
  if (k === 2 && ops.add > 0) {
    const verb = r.node.t === 'op' && r.node.op === '/' ? 'Divide' : 'Multiply'
    const rest = remainingAdditive(root)
    return `${verb} before you ${rest}`
  }
  if (k === 2 || k === 1) return 'Go from left to right'
  return ''
}

function remainingAdditive(root: Node): string {
  let plus = false
  let minus = false
  const walk = (x: Node) => {
    if (x.t === 'op' && x.op === '+') plus = true
    if (x.t === 'op' && x.op === '-') minus = true
    kids(x).forEach(walk)
  }
  walk(root)
  return plus && minus ? 'add or subtract' : minus ? 'subtract' : 'add'
}

const VERB = /^(Add|Subtract|Multiply|Divide|Work out the power): /

/** "Add: 2 + 12 = 14", or with a reason "Go from left to right: 2 + 12 = 14". */
function stepTitle(why: string, title: string): string {
  if (!why) return title
  const body = title.replace(VERB, '')
  if (body !== title || !/^[A-Z]/.test(body)) return `${why}: ${body}`
  return `${why}. ${body}`
}

function arithmeticSteps(root: Node): { steps: Step[]; result: NumNode } {
  const all: Step[] = []
  let cur = root
  for (let guard = 0; guard < 400 && cur.t !== 'n'; guard++) {
    const ready: Ready[] = []
    collect(cur, 0, null, [], ready)
    if (!ready.length) break
    let best = ready[0]
    for (const r of ready)
      if (r.depth > best.depth || (r.depth === best.depth && rank(r.node) > rank(best.node))) best = r
    if (best.node.t === 'neg') {
      // −(number): nothing to explain, just tidy up.
      cur = replaceAt(cur, best.path, n((best.node.a as NumNode).v.neg(), (best.node.a as NumNode).dec))
      continue
    }
    const why = reason(best, cur)
    const red = compute(best.node)
    cur = replaceAt(cur, best.path, red.value)
    all.push({
      title: stepTitle(why, red.title),
      tex: tex(cur),
      substeps: red.details.length ? red.details : undefined,
    })
  }
  if (cur.t !== 'n') throw new MathError('Something went wrong while calculating')
  return { steps: all, result: cur }
}

/** The expression exactly as written (2 × 3 + 1), or null when it isn't plain arithmetic. */
export function literalTex(e: Expr, options: { stack?: boolean } = {}): string | null {
  if (!isRationalTree(e)) return null
  stackAll = !!options.stack
  try {
    return tex(build(e))
  } finally {
    stackAll = false
  }
}

/** √72 = √36 · √2 = 6√2, explained. */
function squareRootSteps(e: Expr): Step[] | null {
  if (e.kind !== 'pow' || e.exp.kind !== 'num' || !e.exp.value.eq(Rational.HALF)) return null
  if (e.base.kind !== 'num' || !e.base.value.isInteger() || e.base.value.sign() <= 0) return null
  const v = e.base.value.n
  const { outside, inside } = extractPower(v, 2)
  if (inside === 1n)
    return [
      {
        title: `${outside} × ${outside} = ${v}, so the square root of ${v} is ${outside}`,
        tex: `\\sqrt{${v}} = ${outside}`,
      },
    ]
  if (outside === 1n)
    return [
      {
        title: `${v} has no square factor (like 4, 9, 16, 25, …), so √${v} can't be made simpler`,
        tex: `\\sqrt{${v}} \\approx ${formatNumber(Math.sqrt(Number(v)), 8)}`,
      },
    ]
  const sq = outside * outside
  return [
    {
      title: `Find the biggest square number that divides ${v}. Square numbers are 4, 9, 16, 25, 36, …`,
      tex: `${v} = ${sq} \\times ${inside}`,
    },
    {
      title: 'Split the square root into two: √(a × b) = √a × √b',
      tex: `\\sqrt{${v}} = \\sqrt{${sq}} \\times \\sqrt{${inside}}`,
    },
    {
      title: `√${sq} = ${outside}, because ${outside} × ${outside} = ${sq}`,
      tex: `\\sqrt{${v}} = ${outside}\\sqrt{${inside}}`,
    },
  ]
}

export function evaluateProblem(input: Expr): Solution {
  const steps: Step[] = []
  const notes: string[] = []
  let result: Expr
  let problemTex: string
  if (isRationalTree(input)) {
    const root = build(input)
    problemTex = tex(root)
    const { steps: all, result: last } = arithmeticSteps(root)
    result = num(last.v)
    if (all.length > 40)
      steps.push({
        title: `Work through the ${all.length} operations in order (brackets, powers, × ÷, + −)`,
        substeps: all,
      })
    else steps.push(...all)
    if (showsAsDecimal(last) && !last.v.isInteger())
      steps.push({
        title: 'Write the answer as a fraction too',
        tex: `${decimalString(last.v)} = ${toTex(result)}`,
      })
  } else {
    result = simplify(input)
    problemTex = toTex(input)
    if (freeSymbols(result).size) throw new MathError('This expression has variables; try "simplify" or "solve"')
    const roots = squareRootSteps(input)
    steps.push(...(roots ?? [{ title: 'Simplify exactly', tex: `${toTex(input)} = ${toTex(result)}` }]))
  }
  const value = evalNum(result)
  const answers: Answer[] = []
  const isInt = result.kind === 'num' && result.value.isInteger()
  answers.push({
    tex: toTex(result),
    text: toText(result),
    approx: isInt ? undefined : Number.isFinite(value) ? formatNumber(value, 12) : undefined,
  })
  if (result.kind === 'num' && !result.value.isInteger() && result.value.abs().cmp(Rational.ONE) > 0) {
    const v = result.value
    const whole = v.sign() < 0 ? -v.abs().floor() : v.floor()
    const rest = v.sub(new Rational(whole)).abs()
    notes.push(`As a mixed number: ${whole} ${rest.n}/${rest.d}`)
  }
  if (!Number.isFinite(value) && result.kind !== 'num') notes.push('The value is not a real number.')
  return { kind: 'evaluate', title: 'Calculate', problemTex, answers, steps, notes }
}
