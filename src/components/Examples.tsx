const GROUPS: Array<{ name: string; items: string[] }> = [
  {
    name: 'Equations',
    items: [
      '2x + 3 = 11',
      'x^2 - 5x + 6 = 0',
      'x^3 - 6x^2 + 11x - 6 = 0',
      'sqrt(x + 3) = x - 3',
      '2^(x+1) = 32',
      'sin(x) = 1/2',
    ],
  },
  {
    name: 'Inequalities & systems',
    items: ['3 - 2x > 7', 'x^2 - x - 6 <= 0', '1 < 2x + 3 <= 9', 'x + y = 10, x - y = 4', 'x + y = 5 and xy = 6'],
  },
  {
    name: 'Calculus',
    items: [
      'derivative of x^2 sin(x)',
      'd/dx ln(x^2 + 1)',
      'integrate x e^x dx',
      'integrate x^2 from 0 to 3',
      'limit of sin(x)/x as x -> 0',
    ],
  },
  {
    name: 'Algebra & arithmetic',
    items: [
      'factor x^4 - 16',
      'expand (2x - 3)^3',
      'simplify (x^2 - 9)/(x - 3)',
      '(3/4 + 5/6) * 12 - 2^3',
      'factor 360',
      'sqrt(72)',
    ],
  },
]

export function Examples({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="card examples" aria-labelledby="examples-title">
      <h2 id="examples-title">Try an example</h2>
      {GROUPS.map((g) => (
        <div key={g.name} className="example-group">
          <h3>{g.name}</h3>
          <div className="chips">
            {g.items.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => onPick(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
