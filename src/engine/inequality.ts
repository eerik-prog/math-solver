import { type Expr, add, freeSymbols, mul, num, sub, sym } from './expr'
import { identify } from './identify'
import { bisect, compile } from './numeric'
import { type Poly, polyFromExpr, ratFromExpr } from './poly'
import type { RelOp } from './parser'
import { formatNumber, texNumber, toTex, toText } from './print'
import { simplify } from './simplify'
import { type Root, solvePolynomial } from './solve'
import type { Answer, Solution, Step } from './types'

/** An endpoint: numeric value for ordering plus an exact form when known. */
interface Pt {
  value: number
  exact: Expr | null
}

export interface Interval {
  lo: Pt | null // null = −∞
  hi: Pt | null // null = +∞
  loClosed: boolean
  hiClosed: boolean
}

const OP_TEX: Record<string, string> = { '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '!=': '\\ne', '=': '=' }

function ptTex(p: Pt): string {
  return p.exact ? toTex(p.exact) : texNumber(p.value)
}
function ptText(p: Pt): string {
  return p.exact ? toText(p.exact) : formatNumber(p.value)
}

export function intervalsTex(ivs: Interval[]): string {
  if (ivs.length === 0) return '\\varnothing'
  return ivs
    .map((iv) => {
      if (iv.lo && iv.hi && iv.lo.value === iv.hi.value) return `\\left\\{${ptTex(iv.lo)}\\right\\}`
      const l = iv.lo ? `${iv.loClosed ? '[' : '('}${ptTex(iv.lo)}` : '(-\\infty'
      const r = iv.hi ? `${ptTex(iv.hi)}${iv.hiClosed ? ']' : ')'}` : '\\infty)'
      return `${l}, ${r}`
    })
    .join(' \\cup ')
}

function intervalsText(ivs: Interval[]): string {
  if (ivs.length === 0) return '∅'
  return ivs
    .map((iv) => {
      if (iv.lo && iv.hi && iv.lo.value === iv.hi.value) return `{${ptText(iv.lo)}}`
      const l = iv.lo ? `${iv.loClosed ? '[' : '('}${ptText(iv.lo)}` : '(-∞'
      const r = iv.hi ? `${ptText(iv.hi)}${iv.hiClosed ? ']' : ')'}` : '∞)'
      return `${l}, ${r}`
    })
    .join(' ∪ ')
}

/** "x > 2", "−1 ≤ x < 3" for a single interval. */
function inequalityForm(iv: Interval, x: string): string | null {
  if (!iv.lo && !iv.hi) return null
  if (iv.lo && iv.hi && iv.lo.value === iv.hi.value) return `${x} = ${ptTex(iv.lo)}`
  if (!iv.lo) return `${x} ${iv.hiClosed ? '\\le' : '<'} ${ptTex(iv.hi!)}`
  if (!iv.hi) return `${x} ${iv.loClosed ? '\\ge' : '>'} ${ptTex(iv.lo)}`
  return `${ptTex(iv.lo)} ${iv.loClosed ? '\\le' : '<'} ${x} ${iv.hiClosed ? '\\le' : '<'} ${ptTex(iv.hi)}`
}

function holds(v: number, op: RelOp): boolean {
  switch (op) {
    case '<':
      return v < 0
    case '>':
      return v > 0
    case '<=':
      return v <= 0
    case '>=':
      return v >= 0
    case '!=':
      return v !== 0
    default:
      return v === 0
  }
}

/** Builds the solution set from sorted critical points by testing each piece. */
function buildIntervals(points: Array<Pt & { pole: boolean }>, f: (v: number) => number, op: RelOp): Interval[] {
  const pts = [...points].sort((a, b) => a.value - b.value)
  const out: Interval[] = []
  const strict = op === '<' || op === '>' || op === '!='
  const testAt = (v: number) => {
    const y = f(v)
    return Number.isFinite(y) && holds(y, op)
  }
  // pieces: (-inf, p0), p0, (p0, p1), p1, ..., (pn, inf)
  const pieces: Array<
    { kind: 'open'; lo: Pt | null; hi: Pt | null; ok: boolean } | { kind: 'pt'; p: Pt; ok: boolean }
  > = []
  for (let i = 0; i <= pts.length; i++) {
    const lo = i > 0 ? pts[i - 1] : null
    const hi = i < pts.length ? pts[i] : null
    const t =
      !lo && !hi
        ? 0
        : !lo
          ? hi!.value - Math.max(1, Math.abs(hi!.value))
          : !hi
            ? lo.value + Math.max(1, Math.abs(lo.value))
            : (lo.value + hi.value) / 2
    pieces.push({ kind: 'open', lo, hi, ok: testAt(t) })
    if (hi) pieces.push({ kind: 'pt', p: hi, ok: !hi.pole && !strict && testAt(hi.value) })
  }
  for (const piece of pieces) {
    if (!piece.ok) continue
    const last = out[out.length - 1]
    if (piece.kind === 'open') {
      if (last && last.hi && piece.lo && last.hi.value === piece.lo.value && last.hiClosed) {
        last.hi = piece.hi
        last.hiClosed = false
      } else out.push({ lo: piece.lo, hi: piece.hi, loClosed: false, hiClosed: false })
    } else {
      if (last && last.hi && last.hi.value === piece.p.value) last.hiClosed = true
      else out.push({ lo: piece.p, hi: piece.p, loClosed: true, hiClosed: true })
    }
  }
  return out
}

function polyRealRoots(p: Poly, x: string, steps: Step[]): Root[] {
  if (p.degree < 1) return []
  if (p.degree === 1) {
    const r = p.coef(0).neg().div(p.coef(1))
    return [{ exact: num(r), value: r.toNumber() }]
  }
  return solvePolynomial(p, x, steps).real
}

export function solveInequality(L: Expr, op: RelOp, R: Expr, x: string): Solution {
  const steps: Step[] = []
  const notes: string[] = []
  const ivs = inequalityIntervals(L, op, R, x, steps, notes)
  return inequalitySolution(L, op, R, x, ivs, steps, notes)
}

export function inequalitySolution(
  L: Expr,
  op: RelOp,
  R: Expr,
  x: string,
  ivs: Interval[],
  steps: Step[],
  notes: string[],
  problemTex = `${toTex(L)} ${OP_TEX[op]} ${toTex(R)}`,
): Solution {
  const answers: Answer[] = []
  if (ivs.length === 1 && !ivs[0].lo && !ivs[0].hi)
    answers.push({ tex: `\\text{All real numbers}`, text: 'All real numbers' })
  else if (ivs.length === 0) answers.push({ tex: '\\text{No solution}', text: 'No solution' })
  else {
    const form = ivs.length === 1 ? inequalityForm(ivs[0], x) : null
    answers.push({
      tex: form ?? `${x} \\in ${intervalsTex(ivs)}`,
      text: `${x} ∈ ${intervalsText(ivs)}`,
    })
    if (form) notes.push(`In interval notation: ${intervalsText(ivs)}`)
  }
  const ranges: [number, number][] = ivs.map((iv) => [iv.lo ? iv.lo.value : -Infinity, iv.hi ? iv.hi.value : Infinity])
  const finite = ivs.flatMap((iv) => [iv.lo?.value, iv.hi?.value]).filter((v): v is number => v !== undefined)
  const span = finite.length ? Math.max(4, (Math.max(...finite) - Math.min(...finite)) * 0.8) : 10
  const mid = finite.length ? (Math.max(...finite) + Math.min(...finite)) / 2 : 0
  const plain = freeSymbols(add(L, R))
  plain.delete(x)
  return {
    kind: 'inequality',
    title: `Solve the inequality for ${x}`,
    problemTex,
    answers,
    steps,
    notes,
    plot: plain.size
      ? undefined
      : {
          variable: x,
          fns: [{ expr: toText(simplify(sub(L, R))), label: 'left − right' }],
          ranges,
          xRange: [mid - span, mid + span],
        },
  }
}

export function inequalityIntervals(
  L0: Expr,
  op: RelOp,
  R0: Expr,
  x: string,
  steps: Step[],
  notes: string[],
): Interval[] {
  const L = simplify(L0)
  const R = simplify(R0)
  const diff = simplify(sub(L, R))
  const f = compile(diff, x)
  const X = sym(x)

  // Linear: textbook steps, flipping the sign when dividing by a negative number.
  const pl = polyFromExpr(L, x)
  const pr = polyFromExpr(R, x)
  if (pl && pr && pl.sub(pr).degree === 1) {
    const p = pl.sub(pr)
    const a = p.coef(1)
    const b = p.coef(0)
    steps.push({
      title: `Move the ${x} terms to the left and the numbers to the right`,
      tex: `${toTex(simplify(mul(num(a), X)))} ${OP_TEX[op]} ${toTex(num(b.neg()))}`,
    })
    const flip = a.sign() < 0
    const flipped: Record<string, RelOp> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' }
    const nop = flip ? (flipped[op] ?? op) : op
    const r = b.neg().div(a)
    if (!a.isOne())
      steps.push({
        title: flip
          ? `Divide both sides by ${a.toString()}. Dividing by a negative number flips the inequality sign`
          : `Divide both sides by ${a.toString()}`,
        tex: `${x} ${OP_TEX[nop]} ${toTex(num(r))}`,
      })
    const pt: Pt = { value: r.toNumber(), exact: num(r) }
    switch (nop) {
      case '<':
        return [{ lo: null, hi: pt, loClosed: false, hiClosed: false }]
      case '<=':
        return [{ lo: null, hi: pt, loClosed: false, hiClosed: true }]
      case '>':
        return [{ lo: pt, hi: null, loClosed: false, hiClosed: false }]
      case '>=':
        return [{ lo: pt, hi: null, loClosed: true, hiClosed: false }]
      default:
        return [
          { lo: null, hi: pt, loClosed: false, hiClosed: false },
          { lo: pt, hi: null, loClosed: false, hiClosed: false },
        ]
    }
  }

  // Rational functions: critical points from numerator and denominator.
  const rf = ratFromExpr(diff, x)
  if (rf) {
    steps.push({
      title: 'Move everything to one side',
      tex: rf.den.isConstant()
        ? `${toTex(rf.num.scale(rf.den.lead.inv()).toExpr(x))} ${OP_TEX[op]} 0`
        : `\\frac{${toTex(rf.num.toExpr(x))}}{${toTex(rf.den.toExpr(x))}} ${OP_TEX[op]} 0`,
    })
    const sub1: Step[] = []
    const zeros = polyRealRoots(rf.num, x, sub1)
    const poles = polyRealRoots(rf.den, x, sub1)
    const pts: Array<Pt & { pole: boolean }> = []
    for (const z of zeros) pts.push({ value: z.value, exact: z.exact, pole: false })
    for (const p of poles) {
      const existing = pts.find((q) => Math.abs(q.value - p.value) < 1e-12)
      if (existing) existing.pole = true
      else pts.push({ value: p.value, exact: p.exact, pole: true })
    }
    pts.sort((a, b) => a.value - b.value)
    steps.push({
      title: rf.den.isConstant()
        ? 'Find the critical points, where the expression equals zero'
        : 'Find the critical points: zeros of the numerator and of the denominator (where it is undefined)',
      tex: pts.length
        ? pts.map((p) => `${x} = ${ptTex(p)}${p.pole ? '\\ (\\text{undefined})' : ''}`).join(',\\quad ')
        : '\\text{none}',
      substeps: sub1.length ? sub1 : undefined,
    })
    const ivs = buildIntervals(pts, f, op)
    steps.push({
      title: 'Test one point in each interval to see where the inequality holds',
      substeps: signChart(pts, f, x, op),
    })
    return ivs
  }

  // Anything else: scan numerically for where the predicate switches.
  steps.push({
    title: 'Move everything to one side and study the sign of the result numerically',
    tex: `${toTex(diff)} ${OP_TEX[op]} 0`,
  })
  notes.push('Boundaries were located numerically in the range −100 ≤ x ≤ 100.')
  const pred = (v: number) => {
    const y = f(v)
    return Number.isFinite(y) && holds(y, op)
  }
  const lo = -100
  const hi = 100
  const n = 20000
  const h = (hi - lo) / n
  const edges: Array<Pt & { pole: boolean }> = []
  let prev = pred(lo)
  let prevX = lo
  for (let i = 1; i <= n; i++) {
    const v = lo + i * h
    const cur = pred(v)
    if (cur !== prev) {
      const before = prev
      const g = (t: number) => (pred(t) === before ? -1 : 1)
      const e = bisect(g, prevX, v) ?? v
      const exact = identify(e)
      edges.push({ value: exact ? Number(evalExact(exact)) : e, exact, pole: !Number.isFinite(f(e)) })
    }
    prev = cur
    prevX = v
  }
  return buildIntervals(edges, f, op)
}

function evalExact(e: Expr): number {
  return compile(e, '_')(0)
}

function signChart(pts: Pt[], f: (v: number) => number, x: string, op: RelOp): Step[] {
  const out: Step[] = []
  const sorted = [...pts].sort((a, b) => a.value - b.value)
  for (let i = 0; i <= sorted.length; i++) {
    const lo = i > 0 ? sorted[i - 1] : null
    const hi = i < sorted.length ? sorted[i] : null
    const t =
      !lo && !hi ? 0 : !lo ? Math.floor(hi!.value) - 1 : !hi ? Math.ceil(lo.value) + 1 : (lo.value + hi.value) / 2
    const y = f(t)
    const ok = Number.isFinite(y) && holds(y, op)
    const range = `${lo ? ptText(lo) : '−∞'} < ${x} < ${hi ? ptText(hi) : '∞'}`
    out.push({
      title: `${range}: test ${x} = ${formatNumber(t, 4)} → ${formatNumber(y, 4)} ${y > 0 ? '(positive)' : y < 0 ? '(negative)' : ''} ${ok ? '✓' : '✗'}`,
    })
  }
  return out
}

/** Intersection of two interval unions (for compound inequalities). */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = []
  const lv = (p: Pt | null) => (p ? p.value : -Infinity)
  const hv = (p: Pt | null) => (p ? p.value : Infinity)
  for (const i of a)
    for (const j of b) {
      let lo: Pt | null, loClosed: boolean
      if (lv(i.lo) > lv(j.lo)) [lo, loClosed] = [i.lo, i.loClosed]
      else if (lv(i.lo) < lv(j.lo)) [lo, loClosed] = [j.lo, j.loClosed]
      else [lo, loClosed] = [i.lo, i.loClosed && j.loClosed]
      let hi: Pt | null, hiClosed: boolean
      if (hv(i.hi) < hv(j.hi)) [hi, hiClosed] = [i.hi, i.hiClosed]
      else if (hv(i.hi) > hv(j.hi)) [hi, hiClosed] = [j.hi, j.hiClosed]
      else [hi, hiClosed] = [i.hi, i.hiClosed && j.hiClosed]
      const l = lv(lo)
      const h = hv(hi)
      if (l < h || (l === h && loClosed && hiClosed)) out.push({ lo, hi, loClosed, hiClosed })
    }
  return out.sort((p, q) => lv(p.lo) - lv(q.lo))
}

export { OP_TEX }
