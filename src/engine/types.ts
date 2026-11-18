/** One line of working. `substeps` hold the details of how a step was done. */
export interface Step {
  title: string
  tex?: string
  substeps?: Step[]
}

export interface Answer {
  /** LaTeX of the answer, e.g. "x = \\frac{1}{2}". */
  tex: string
  /** Plain-text version for copying. */
  text: string
  /** Decimal approximation when the exact form is not a plain number. */
  approx?: string
  /** Marks complex (non-real) solutions so the UI can group them. */
  complex?: boolean
}

export interface PlotFn {
  /** Expression in our input syntax; the UI re-parses it to draw. */
  expr: string
  label: string
}

export interface PlotSpec {
  variable: string
  fns: PlotFn[]
  points?: { x: number; y: number; label: string }[]
  /** Shade the area under fns[0] between these x-values. */
  shade?: [number, number]
  /** Highlight x-ranges (inequality solutions). */
  ranges?: [number, number][]
  xRange?: [number, number]
}

export type ProblemKind =
  | 'evaluate'
  | 'simplify'
  | 'expand'
  | 'factor'
  | 'solve'
  | 'inequality'
  | 'system'
  | 'derivative'
  | 'integral'
  | 'limit'

export interface Solution {
  kind: ProblemKind
  /** Short heading, e.g. "Solve for x". */
  title: string
  /** The problem as understood, in LaTeX. */
  problemTex: string
  answers: Answer[]
  steps: Step[]
  notes: string[]
  plot?: PlotSpec
}

export type SolveResponse = { ok: true; solution: Solution; ms: number } | { ok: false; error: string; ms: number }
