import { useState } from 'react'
import type { Answer, Solution, Step } from '../engine/types'
import { Plot } from './Plot'
import { Tex } from './Tex'

function StepItem({ step, depth }: { step: Step; depth: number }) {
  return (
    <li className="step">
      <p className="step-title">{step.title}</p>
      {step.tex && (
        <div className="step-math">
          <Tex tex={step.tex} display />
        </div>
      )}
      {step.substeps && step.substeps.length > 0 && (
        <details className="substeps" open={depth === 0 && step.substeps.length <= 4}>
          <summary>{depth === 0 ? 'How?' : 'More detail'}</summary>
          <ol>
            {step.substeps.map((s, i) => (
              <StepItem key={i} step={s} depth={depth + 1} />
            ))}
          </ol>
        </details>
      )}
    </li>
  )
}

function AnswerRow({ answer }: { answer: Answer }) {
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
    <li className={`answer${answer.complex ? ' complex' : ''}`}>
      <div className="answer-math">
        <Tex tex={answer.tex} display />
        {answer.approx && <span className="approx">≈ {answer.approx}</span>}
      </div>
      <button type="button" className="ghost small" onClick={copy} aria-label={`Copy ${answer.text}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </li>
  )
}

export function SolutionView({ solution, ms }: { solution: Solution; ms: number }) {
  const [showSteps, setShowSteps] = useState(true)
  const real = solution.answers.filter((a) => !a.complex)
  const complex = solution.answers.filter((a) => a.complex)
  return (
    <article className="solution" aria-labelledby="solution-title">
      <header className="card">
        <p className="eyebrow" id="solution-title">
          {solution.title}
        </p>
        <div className="problem">
          <Tex tex={solution.problemTex} display />
        </div>
        <h2 className="answers-heading">{solution.answers.length > 1 ? 'Answers' : 'Answer'}</h2>
        <ul className="answers">
          {real.map((a, i) => (
            <AnswerRow key={i} answer={a} />
          ))}
        </ul>
        {complex.length > 0 && (
          <>
            <h3 className="complex-heading">Complex solutions</h3>
            <ul className="answers">
              {complex.map((a, i) => (
                <AnswerRow key={i} answer={a} />
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
        <p className="timing">Solved in {ms < 1 ? '<1' : Math.round(ms)} ms</p>
      </header>

      {solution.steps.length > 0 && (
        <section className="card" aria-labelledby="steps-title">
          <div className="section-head">
            <h2 id="steps-title">Step-by-step</h2>
            <button type="button" className="ghost small" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps}>
              {showSteps ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSteps && (
            <ol className="steps">
              {solution.steps.map((s, i) => (
                <StepItem key={i} step={s} depth={0} />
              ))}
            </ol>
          )}
        </section>
      )}

      {solution.plot && (
        <section className="card" aria-labelledby="graph-title">
          <h2 id="graph-title">Graph</h2>
          <Plot spec={solution.plot} />
        </section>
      )}
    </article>
  )
}
