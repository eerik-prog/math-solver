import { useState } from 'react'
import type { Answer, Solution, Step } from '../engine/types'
import { Plot } from './Plot'
import { Tex } from './Tex'
import { rise } from '../motion'

function StepItem({ step, depth, index }: { step: Step; depth: number; index: number }) {
  return (
    <li className={depth === 0 ? 'step rise' : 'step'} style={depth === 0 ? rise(2 + Math.min(index, 10)) : undefined}>
      <p className="step-title">{step.title}</p>
      {step.tex && (
        <div className="step-math">
          <Tex tex={step.tex} display />
        </div>
      )}
      {step.substeps && step.substeps.length > 0 && (
        <details className="substeps" open={depth === 0 && step.substeps.length <= 6}>
          <summary>{depth === 0 ? 'How?' : 'More detail'}</summary>
          <ol>
            {step.substeps.map((s, i) => (
              <StepItem key={i} step={s} depth={depth + 1} index={i} />
            ))}
          </ol>
        </details>
      )}
    </li>
  )
}

function AnswerRow({ answer, index }: { answer: Answer; index: number }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <li className={`answer rise${answer.complex ? ' complex' : ''}`} style={rise(1 + Math.min(index, 8))}>
      <div className="answer-math">
        <Tex tex={answer.tex} display />
        {answer.approx && <span className="approx">≈ {answer.approx}</span>}
      </div>
      <button
        type="button"
        className={`copy${copied ? ' done' : ''}`}
        onClick={copy}
        aria-label={`Copy ${answer.text}`}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </li>
  )
}

/** `quiet` turns off entrance animations, for updates made while the person is still typing. */
export function SolutionView({ solution, quiet = false }: { solution: Solution; quiet?: boolean }) {
  const real = solution.answers.filter((a) => !a.complex)
  const complex = solution.answers.filter((a) => a.complex)
  return (
    <article className={quiet ? 'solution quiet' : 'solution'} aria-labelledby="solution-title">
      <header className="card solution-head rise" style={rise(0)}>
        <p className="eyebrow" id="solution-title">
          {solution.title}
        </p>
        <div className="problem">
          <Tex tex={solution.problemTex} display />
        </div>
        <h2 className="answers-heading">{solution.answers.length > 1 ? 'Answers' : 'Answer'}</h2>
        <ul className="answers">
          {real.map((a, i) => (
            <AnswerRow key={i} answer={a} index={i} />
          ))}
        </ul>
        {complex.length > 0 && (
          <>
            <h3 className="complex-heading">Complex solutions</h3>
            <ul className="answers">
              {complex.map((a, i) => (
                <AnswerRow key={i} answer={a} index={real.length + i} />
              ))}
            </ul>
          </>
        )}
        {solution.notes.length > 0 && (
          <ul className="notes">
            {solution.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </header>

      {solution.steps.length > 0 && (
        <section className="card rise" style={rise(1)} aria-labelledby="steps-title">
          <h2 id="steps-title">Step-by-step</h2>
          <ol className="steps">
            {solution.steps.map((s, i) => (
              <StepItem key={i} step={s} depth={0} index={i} />
            ))}
          </ol>
        </section>
      )}

      {solution.plot && (
        <section className="card rise" style={rise(2)} aria-labelledby="graph-title">
          <h2 id="graph-title">Graph</h2>
          <Plot key={JSON.stringify(solution.plot)} spec={solution.plot} />
        </section>
      )}
    </article>
  )
}
