import { Rational } from './rational'

export type Matrix = Rational[][]

export interface RowOp {
  desc: string
  matrix: Matrix
}

const clone = (m: Matrix): Matrix => m.map((r) => [...r])

function fmt(r: Rational): string {
  return r.isInteger() ? r.toString() : `(${r.toString()})`
}

/**
 * Reduced row echelon form by Gauss–Jordan elimination on exact rationals.
 * `cols` limits pivoting to the coefficient part of an augmented matrix.
 */
export function rref(input: Matrix, cols = input[0]?.length ?? 0, record = false) {
  const m = clone(input)
  const ops: RowOp[] = []
  const pivots: number[] = []
  const rows = m.length
  let r = 0
  const log = (desc: string) => record && ops.push({ desc, matrix: clone(m) })
  for (let c = 0; c < cols && r < rows; c++) {
    let p = -1
    for (let i = r; i < rows; i++) if (!m[i][c].isZero()) {
      p = i
      break
    }
    if (p < 0) continue
    if (p !== r) {
      ;[m[p], m[r]] = [m[r], m[p]]
      log(`Swap R${r + 1} and R${p + 1}`)
    }
    const pv = m[r][c]
    if (!pv.isOne()) {
      m[r] = m[r].map((v) => v.div(pv))
      log(`R${r + 1} → R${r + 1} ÷ ${fmt(pv)}`)
    }
    for (let i = 0; i < rows; i++) {
      if (i === r || m[i][c].isZero()) continue
      const f = m[i][c]
      m[i] = m[i].map((v, j) => v.sub(f.mul(m[r][j])))
      const sign = f.sign() > 0 ? '−' : '+'
      const k = f.abs()
      log(`R${i + 1} → R${i + 1} ${sign} ${k.isOne() ? '' : fmt(k) + '·'}R${r + 1}`)
    }
    pivots.push(c)
    r++
  }
  return { matrix: m, pivots, ops }
}

/** Solves A·v = b; returns null unless the solution is unique. */
export function solveLinear(A: Matrix, b: Rational[]): Rational[] | null {
  const n = A[0]?.length ?? 0
  const aug = A.map((row, i) => [...row, b[i]])
  const { matrix, pivots } = rref(aug, n)
  if (pivots.length !== n) return null
  for (let i = n; i < matrix.length; i++) if (!matrix[i][n].isZero()) return null
  return Array.from({ length: n }, (_, i) => matrix[i][n])
}

export function matrixTex(m: Matrix, augmented = 0): string {
  const cols = m[0]?.length ?? 0
  const spec = augmented ? 'c'.repeat(cols - augmented) + '|' + 'c'.repeat(augmented) : 'c'.repeat(cols)
  const cell = (r: Rational) => (r.isInteger() ? r.toString() : `${r.sign() < 0 ? '-' : ''}\\frac{${r.abs().n}}{${r.d}}`)
  return `\\left[\\begin{array}{${spec}}${m.map((row) => row.map(cell).join(' & ')).join(' \\\\ ')}\\end{array}\\right]`
}
