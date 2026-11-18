import { type Expr, add, contains, div, freeSymbols, mul, neg, num, sub, substitute, sym } from './expr'
import { matrixTex, rref } from './linalg'
import { evalNum } from './numeric'
import type { Relation } from './parser'
import { formatNumber, toTex, toText } from './print'
import { MathError, Rational } from './rational'
import { expand, simplify, splitCoef } from './simplify'
import { solveEq } from './solve'
import type { Answer, Solution, Step } from './types'

function linearRow(e: Expr, vars: string[]): Rational[] | null {
  const ex = expand(e)
  const terms = ex.kind === 'add' ? ex.terms : [ex]
  const row = vars.map(() => Rational.ZERO)
  let constant = Rational.ZERO
  for (const t of terms) {
    const [c, rest] = splitCoef(t)
    if (!rest) {
      constant = constant.add(c)
      continue
    }
    if (rest.kind !== 'sym') return null
    const i = vars.indexOf(rest.name)
    if (i < 0) return null
    row[i] = row[i].add(c)
  }
  return [...row, constant.neg()]
}

export function solveSystem(eqs: Relation[]): Solution {
  if (eqs.some((e) => e.op !== '=')) throw new MathError('Systems can only contain equations (=)')
  const allVars = new Set<string>()
  for (const e of eqs) for (const v of freeSymbols(add(e.lhs, e.rhs))) allVars.add(v)
  const vars = [...allVars].sort()
  if (vars.length === 0) throw new MathError('The system has no variables to solve for')
  const problemTex = `\\begin{cases} ${eqs.map((e) => `${toTex(e.lhs)} = ${toTex(e.rhs)}`).join(' \\\\ ')} \\end{cases}`
  const diffs = eqs.map((e) => simplify(sub(e.lhs, e.rhs)))
  const rows = diffs.map((d) => linearRow(d, vars))
  if (rows.every((r): r is Rational[] => r !== null)) return linearSystem(rows, vars, problemTex)
  return substitutionSystem(diffs, vars, problemTex)
}

function linearSystem(rows: Rational[][], vars: string[], problemTex: string): Solution {
  const steps: Step[] = []
  const n = vars.length
  const standard = rows.map((r) => {
    const lhs = simplify(add(...r.slice(0, n).map((c, i) => mul(num(c), sym(vars[i])))))
    return `${toTex(lhs)} = ${toTex(num(r[n]))}`
  })
  steps.push({
    title: 'Write every equation in standard form (variables on the left, numbers on the right)',
    tex: `\\begin{aligned} ${standard.join(' \\\\ ')} \\end{aligned}`,
  })
  steps.push({ title: 'Write the augmented matrix', tex: matrixTex(rows, 1) })
  const { matrix, pivots, ops } = rref(rows, n, true)
  if (ops.length)
    steps.push({
      title: 'Row-reduce (Gauss–Jordan elimination) until each variable stands alone',
      substeps: ops.map((o) => ({ title: o.desc, tex: matrixTex(o.matrix, 1) })),
    })
  const inconsistent = matrix.some((r) => r.slice(0, n).every((c) => c.isZero()) && !r[n].isZero())
  const answers: Answer[] = []
  const notes: string[] = []
  if (inconsistent) {
    steps.push({ title: 'A row reads 0 = (nonzero number), which is impossible, so the system has no solution' })
    answers.push({ tex: '\\text{No solution (the equations are inconsistent)}', text: 'No solution' })
  } else if (pivots.length === n) {
    steps.push({
      title: 'Read off the solution',
      tex: vars.map((v, i) => `${v} = ${toTex(num(matrix[i][n]))}`).join(',\\quad '),
    })
    vars.forEach((v, i) => {
      const val = matrix[i][n]
      answers.push({
        tex: `${v} = ${toTex(num(val))}`,
        text: `${v} = ${val.toString()}`,
        approx: val.isInteger() ? undefined : formatNumber(val.toNumber()),
      })
    })
  } else {
    const free = vars.filter((_, i) => !pivots.includes(i))
    const params = free.map((v) => sym(v))
    steps.push({
      title: `There are fewer independent equations than unknowns, so ${free.join(', ')} ${free.length > 1 ? 'are' : 'is'} free`,
    })
    pivots.forEach((c, r) => {
      const e = simplify(
        sub(num(matrix[r][n]), add(...free.map((fv) => mul(num(matrix[r][vars.indexOf(fv)]), sym(fv))))),
      )
      answers.push({ tex: `${vars[c]} = ${toTex(e)}`, text: `${vars[c]} = ${toText(e)}` })
    })
    for (const p of params)
      answers.push({ tex: `${p.name} \\in \\mathbb{R}\\ \\text{(free)}`, text: `${p.name} is any real number` })
    notes.push('The system has infinitely many solutions.')
  }
  return { kind: 'system', title: `Solve the system for ${vars.join(', ')}`, problemTex, answers, steps, notes }
}

/** Solves one equation for a variable that appears linearly, then substitutes. */
function substitutionSystem(diffs: Expr[], vars: string[], problemTex: string): Solution {
  if (diffs.length !== 2 || vars.length !== 2) {
    throw new MathError('Non-linear systems are supported for two equations in two unknowns')
  }
  const steps: Step[] = []
  for (let ei = 0; ei < 2; ei++) {
    for (const v of vars) {
      const d = expand(diffs[ei])
      const terms = d.kind === 'add' ? d.terms : [d]
      const withV = terms.filter((t) => contains(t, v))
      if (withV.length !== 1) continue
      const [c, rest] = splitCoef(withV[0])
      if (!rest || rest.kind !== 'sym' || rest.name !== v) continue
      const others = simplify(add(...terms.filter((t) => t !== withV[0])))
      const expr = simplify(div(neg(others), num(c))) // v = expr
      const w = vars.find((u) => u !== v)!
      const other = diffs[1 - ei]
      const substituted = simplify(substitute(other, v, expr))
      steps.push({ title: `Solve equation ${ei + 1} for ${v}`, tex: `${v} = ${toTex(expr)}` })
      steps.push({ title: `Substitute into equation ${2 - ei}`, tex: `${toTex(substituted)} = 0` })
      const sub1: Step[] = []
      const res = solveEq(substituted, num(0), w, sub1)
      steps.push({ title: `Solve for ${w}`, substeps: sub1 })
      const answers: Answer[] = []
      const pairs: string[] = []
      for (const r of res.real) {
        const wv = r.exact ?? num(Rational.approximate(r.value, 1e9, 1e-14) ?? Rational.ZERO)
        const vv = simplify(substitute(expr, w, wv))
        const sol = `${v} = ${toTex(vv)},\\ ${w} = ${toTex(wv)}`
        pairs.push(sol)
        const ordered =
          vars[0] === v ? `${v} = ${toTex(vv)},\\ ${w} = ${toTex(wv)}` : `${w} = ${toTex(wv)},\\ ${v} = ${toTex(vv)}`
        const approxV = evalNum(vv)
        answers.push({
          tex: ordered,
          text:
            vars[0] === v ? `${v} = ${toText(vv)}, ${w} = ${toText(wv)}` : `${w} = ${toText(wv)}, ${v} = ${toText(vv)}`,
          approx:
            vv.kind === 'num' && wv.kind === 'num'
              ? undefined
              : `${v} ≈ ${formatNumber(approxV)}, ${w} ≈ ${formatNumber(r.value)}`,
        })
      }
      if (pairs.length)
        steps.push({ title: `Substitute each value back to find ${v}`, tex: pairs.join(' \\quad\\text{and}\\quad ') })
      if (!answers.length) answers.push({ tex: '\\text{No real solution}', text: 'No real solution' })
      return {
        kind: 'system',
        title: `Solve the system for ${vars.join(', ')}`,
        problemTex,
        answers,
        steps,
        notes: res.notes,
      }
    }
  }
  throw new MathError('I could not isolate a variable in either equation to solve this system')
}
