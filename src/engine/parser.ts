import { type Expr, E, INF, PI, div, fn, frac, mul, neg, num, pow, sym } from './expr'
import { MathError, Rational } from './rational'

/**
 * A forgiving parser for typed math: implicit multiplication ("2x", "3(x+1)",
 * "x sin x"), function application without parentheses ("sin 2x"), powers on
 * functions ("sin^2 x"), absolute value bars, unicode symbols and degrees.
 */

const FUNCTIONS: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  tg: 'tan',
  cot: 'cot',
  ctg: 'cot',
  sec: 'sec',
  csc: 'csc',
  cosec: 'csc',
  asin: 'asin',
  arcsin: 'asin',
  acos: 'acos',
  arccos: 'acos',
  atan: 'atan',
  arctan: 'atan',
  arctg: 'atan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  ln: 'ln',
  log: 'log',
  lg: 'log10',
  log10: 'log10',
  log2: 'log2',
  exp: 'exp',
  sqrt: 'sqrt',
  cbrt: 'cbrt',
  root: 'root',
  abs: 'abs',
  floor: 'floor',
  ceil: 'ceil',
  round: 'round',
  gcd: 'gcd',
  lcm: 'lcm',
  mod: 'mod',
  sign: 'sign',
  sgn: 'sign',
}

const CONSTANT_NAMES: Record<string, Expr> = { pi: PI, e: E, infinity: INF, inf: INF, oo: INF }

const GREEK = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'theta',
  'lambda',
  'mu',
  'phi',
  'omega',
  'sigma',
  'tau',
  'rho',
]

const KNOWN_WORDS = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANT_NAMES), ...GREEK].sort(
  (a, b) => b.length - a.length,
)

const INVERSE_TRIG: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan' }

type Token =
  { t: 'num'; v: string; pos: number } | { t: 'id'; v: string; pos: number } | { t: 'op'; v: string; pos: number }

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
}

/** Normalises unicode and common alternative spellings to ASCII. */
export function normalizeInput(s: string): string {
  let out = s
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/∞/g, 'infinity')
    .replace(/θ/g, 'theta')
    .replace(/α/g, 'alpha')
    .replace(/β/g, 'beta')
    .replace(/≤|=</g, '<=')
    .replace(/≥|=>/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/\*\*/g, '^')
    .replace(/√/g, ' sqrt ')
    .replace(/∛/g, ' cbrt ')
  out = out.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => '^(' + [...m].map((c) => SUPERSCRIPTS[c]).join('') + ')')
  return out
}

function tokenize(src: string): Token[] {
  const s = normalizeInput(src)
  const tokens: Token[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i))
      if (!m) throw new MathError(`Unexpected "${c}"`)
      tokens.push({ t: 'num', v: m[0], pos: i })
      i += m[0].length
      continue
    }
    if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z]+[0-9]*/.exec(s.slice(i))!
      let word = m[0]
      // keep log10 / log2 together, otherwise digits are a separate number
      if (!/^(log10|log2)$/i.test(word)) word = /^[a-zA-Z]+/.exec(word)![0]
      splitWord(word, i).forEach((tk) => tokens.push(tk))
      i += word.length
      continue
    }
    if ('+-*/^()[]{},|!_°%'.includes(c)) {
      const v = c === '[' || c === '{' ? '(' : c === ']' || c === '}' ? ')' : c
      tokens.push({ t: 'op', v, pos: i })
      i++
      continue
    }
    throw new MathError(`I don't understand the symbol "${c}"`)
  }
  return tokens
}

/** "xsin" -> x, sin; "pix" -> pi, x; "abc" -> a, b, c. */
function splitWord(word: string, pos: number): Token[] {
  const lower = word.toLowerCase()
  if (word.length >= 3 && !KNOWN_WORDS.some((w) => w.length >= 2 && lower.includes(w))) {
    throw new MathError(`I don't know the word "${word}". To multiply variables, write ${word.split('').join('*')}`)
  }
  const out: Token[] = []
  let i = 0
  while (i < word.length) {
    const rest = lower.slice(i)
    const known = KNOWN_WORDS.find((w) => rest.startsWith(w))
    if (known) {
      out.push({ t: 'id', v: known, pos: pos + i })
      i += known.length
    } else {
      out.push({ t: 'id', v: word[i], pos: pos + i })
      i++
    }
  }
  return out
}

class Parser {
  private i = 0
  private absDepth = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token | undefined {
    return this.tokens[this.i]
  }
  private isOp(v: string, tk = this.peek()): boolean {
    return tk?.t === 'op' && tk.v === v
  }
  private expectOp(v: string, what: string) {
    if (!this.isOp(v)) throw new MathError(`Missing ${what}`)
    this.i++
  }

  parse(): Expr {
    if (this.tokens.length === 0) throw new MathError('Type a math problem to get started')
    const e = this.parseAdd()
    const tk = this.peek()
    if (tk) {
      if (tk.t === 'op' && tk.v === ')') throw new MathError('Too many closing parentheses')
      throw new MathError(`Unexpected "${tk.v}"`)
    }
    return e
  }

  private parseAdd(): Expr {
    let left = this.parseMul()
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.tokens[this.i++].v
      const right = this.parseMul()
      left = { kind: 'add', terms: [left, op === '+' ? right : neg(right)] }
    }
    return left
  }

  private startsOperand(tk: Token | undefined): boolean {
    if (!tk) return false
    if (tk.t === 'num' || tk.t === 'id') return true
    if (tk.t === 'op' && tk.v === '(') return true
    if (tk.t === 'op' && tk.v === '|' && this.absDepth === 0) return true
    return false
  }

  private parseMul(): Expr {
    let left = this.parseUnary()
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = this.tokens[this.i++].v
        if (!this.peek()) throw new MathError(`Missing a value after "${op}"`)
        const right = this.parseUnary()
        left = op === '*' ? mul(left, right) : div(left, right)
      } else if (this.startsOperand(this.peek())) {
        left = mul(left, this.parsePower())
      } else return left
    }
  }

  private parseUnary(): Expr {
    if (this.isOp('-')) {
      this.i++
      return neg(this.parseUnary())
    }
    if (this.isOp('+')) {
      this.i++
      return this.parseUnary()
    }
    return this.parsePower()
  }

  private parsePower(): Expr {
    const base = this.parsePostfix()
    if (this.isOp('^')) {
      this.i++
      if (!this.peek()) throw new MathError('Missing exponent after "^"')
      return pow(base, this.parseUnary())
    }
    return base
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    for (;;) {
      if (this.isOp('!')) {
        this.i++
        e = fn('factorial', e)
      } else if (this.isOp('°')) {
        this.i++
        e = mul(e, PI, pow(num(180), -1))
      } else if (this.isOp('%')) {
        this.i++
        e = mul(e, frac(1, 100))
      } else return e
    }
  }

  private parsePrimary(): Expr {
    const tk = this.peek()
    if (!tk) throw new MathError('The expression ends too early')
    if (tk.t === 'num') {
      this.i++
      return num(Rational.parse(tk.v))
    }
    if (tk.t === 'op') {
      if (tk.v === '(') {
        this.i++
        if (this.isOp(')')) throw new MathError('Empty parentheses')
        const saved = this.absDepth
        this.absDepth = 0
        const e = this.parseAdd()
        this.absDepth = saved
        this.expectOp(')', 'closing parenthesis ")"')
        return e
      }
      if (tk.v === '|') {
        this.i++
        this.absDepth++
        const e = this.parseAdd()
        this.absDepth--
        this.expectOp('|', 'closing "|"')
        return fn('abs', e)
      }
      throw new MathError(`Unexpected "${tk.v}"`)
    }
    this.i++
    const name = tk.v
    const lower = name.toLowerCase()
    if (CONSTANT_NAMES[lower]) return CONSTANT_NAMES[lower]
    if (FUNCTIONS[lower]) return this.parseCall(FUNCTIONS[lower])
    return sym(name)
  }

  private parseCall(name: string): Expr {
    let power: Expr | null = null
    let base: Expr | null = null
    if (this.isOp('^')) {
      this.i++
      power = this.isOp('-') ? (this.i++, neg(this.parsePostfix())) : this.parsePostfix()
      if (power.kind === 'mul' && power.factors.length === 2 && INVERSE_TRIG[name]) {
        // sin^-1 x means arcsin x
        const [a, b] = power.factors
        if (a.kind === 'num' && a.value.n === -1n && b.kind === 'num' && b.value.isOne()) {
          name = INVERSE_TRIG[name]
          power = null
        }
      }
    }
    if (this.isOp('_') && (name === 'log' || name === 'log10' || name === 'log2')) {
      this.i++
      base = this.parsePrimary()
      name = 'log'
    }
    let args: Expr[]
    if (this.isOp('(')) {
      this.i++
      const saved = this.absDepth
      this.absDepth = 0
      args = [this.parseAdd()]
      while (this.isOp(',')) {
        this.i++
        args.push(this.parseAdd())
      }
      this.absDepth = saved
      this.expectOp(')', `closing parenthesis for ${name}(`)
      // "sin(x)^2" is handled by parsePower of the caller.
    } else {
      if (!this.startsOperand(this.peek())) throw new MathError(`${name} needs an argument, e.g. ${name}(x)`)
      let arg = this.parsePower()
      while (this.startsOperand(this.peek())) {
        const nx = this.peek()!
        if (nx.t === 'id' && FUNCTIONS[nx.v.toLowerCase()]) break
        arg = mul(arg, this.parsePower())
      }
      args = [arg]
    }
    let result = buildFunction(name, args, base)
    if (power) result = pow(result, power)
    return result
  }
}

function buildFunction(name: string, args: Expr[], base: Expr | null): Expr {
  const arity = (n: number) => {
    if (args.length !== n) throw new MathError(`${name} takes ${n} argument${n > 1 ? 's' : ''}`)
  }
  switch (name) {
    case 'sqrt':
      arity(1)
      return pow(args[0], frac(1, 2))
    case 'cbrt':
      arity(1)
      return pow(args[0], frac(1, 3))
    case 'root':
      arity(2)
      return pow(args[0], pow(args[1], -1))
    case 'exp':
      arity(1)
      return pow(E, args[0])
    case 'log':
      if (base) {
        arity(1)
        return fn('log', args[0], base)
      }
      if (args.length === 2) return fn('log', args[0], args[1])
      arity(1)
      return fn('log', args[0], num(10))
    case 'log10':
      arity(1)
      return fn('log', args[0], num(10))
    case 'log2':
      arity(1)
      return fn('log', args[0], num(2))
    case 'gcd':
    case 'lcm':
      if (args.length < 2) throw new MathError(`${name} needs at least two numbers`)
      return fn(name, ...args)
    case 'mod':
      arity(2)
      return fn(name, ...args)
    default:
      arity(1)
      return fn(name, args[0])
  }
}

export function parseExpression(src: string): Expr {
  return new Parser(tokenize(src)).parse()
}

export type RelOp = '=' | '<' | '>' | '<=' | '>=' | '!='

export interface Relation {
  lhs: Expr
  op: RelOp
  rhs: Expr
}

/** Splits "a = b" / "a < b" at the top level; returns null if there is no relation. */
export function splitRelation(src: string): { lhs: string; op: RelOp; rhs: string }[] | null {
  const s = normalizeInput(src)
  const parts: string[] = []
  const ops: RelOp[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (depth !== 0) continue
    const two = s.slice(i, i + 2)
    let op: RelOp | null = null
    if (two === '<=' || two === '>=' || two === '!=' || two === '==') op = (two === '==' ? '=' : two) as RelOp
    else if (c === '<' || c === '>' || c === '=') op = c as RelOp
    if (op) {
      parts.push(s.slice(start, i))
      ops.push(op)
      const len = two === '<=' || two === '>=' || two === '!=' || two === '==' ? 2 : 1
      i += len - 1
      start = i + 1
    }
  }
  if (depth > 0) throw new MathError('Missing closing parenthesis ")"')
  if (ops.length === 0) return null
  parts.push(s.slice(start))
  if (parts.some((p) => p.trim() === '')) throw new MathError('Each side of the equation needs something on it')
  return ops.map((op, k) => ({ lhs: parts[k], op, rhs: parts[k + 1] }))
}

export function parseRelation(src: string): Relation | null {
  const split = splitRelation(src)
  if (!split) return null
  if (split.length > 1) throw new MathError('Chained relations are only supported for inequalities like 1 < x < 3')
  const [{ lhs, op, rhs }] = split
  return { lhs: parseExpression(lhs), op, rhs: parseExpression(rhs) }
}
