import { rise } from '../motion'

/** A short, varied set: one example of each kind of problem. */
const EXAMPLES = [
  '2x + 3 = 11',
  'x^2 - 5x + 6 = 0',
  '3 - 2x > 7',
  'x + y = 10, x - y = 4',
  '(3/4 + 5/6) * 12 - 2^3',
  'factor x^4 - 16',
  'derivative of x^2 sin(x)',
  'integrate x^2 from 0 to 3',
  'limit of sin(x)/x as x -> 0',
]

export function Examples({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="card examples rise" style={rise(4)} aria-labelledby="examples-title">
      <h2 id="examples-title">Try an example</h2>
      <div className="chips">
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>
    </section>
  )
}
