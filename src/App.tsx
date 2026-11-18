import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Examples } from './components/Examples'
import { MathInput, type MathInputHandle } from './components/MathInput'
import { SolutionView } from './components/SolutionView'
import type { SolveResponse } from './engine/types'
import { SolverClient } from './solverClient'
import { addToHistory, loadHistory, saveHistory } from './storage'

const DEBOUNCE_MS = 450

type Theme = 'light' | 'dark' | 'system'

function initialQuery(): string {
  try {
    return new URLSearchParams(window.location.search).get('q') ?? ''
  } catch {
    return ''
  }
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem('math-solver:theme')
      return t === 'light' || t === 'dark' ? t : 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('math-solver:theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, setTheme]
}

export default function App() {
  const client = useMemo(() => new SolverClient(), [])
  const [input, setInput] = useState(initialQuery)
  const [response, setResponse] = useState<SolveResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [theme, setTheme] = useTheme()
  const requestId = useRef(0)
  const inputRef = useRef<MathInputHandle>(null)

  const run = useCallback(
    async (q: string, record: boolean) => {
      const text = q.trim()
      if (!text) {
        setResponse(null)
        return
      }
      const id = ++requestId.current
      setBusy(true)
      const res = await client.solve(text)
      if (id !== requestId.current) return
      setBusy(false)
      setResponse(res)
      if (record && res.ok) {
        setHistory((h) => {
          const next = addToHistory(h, text)
          saveHistory(next)
          return next
        })
      }
      if (record) {
        const url = new URL(window.location.href)
        url.searchParams.set('q', text)
        window.history.replaceState(null, '', url)
      }
    },
    [client],
  )

  // Solve as you type (debounced).
  useEffect(() => {
    const t = setTimeout(() => void run(input, false), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input, run])

  const pick = (q: string) => {
    setInput(q)
    void run(q, true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    inputRef.current?.focus()
  }

  const cycleTheme = () => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Math Solver home">
          <span className="logo" aria-hidden="true">
            ∑
          </span>
          Math Solver
        </a>
        <button type="button" className="ghost small" onClick={cycleTheme} aria-label={`Theme: ${theme}. Click to change.`}>
          {theme === 'system' ? 'Auto theme' : theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </header>

      <main>
        <h1 className="sr-only">Math Solver</h1>
        <MathInput ref={inputRef} value={input} onChange={setInput} onSubmit={() => void run(input, true)} busy={busy} />

        <div aria-live="polite" className="result-region">
          {response && !response.ok && input.trim() && (
            <div className="card error" role="alert">
              <strong>Can't solve that yet.</strong> {response.error}
            </div>
          )}
          {response?.ok && <SolutionView solution={response.solution} ms={response.ms} />}
        </div>

        {history.length > 0 && (
          <section className="card history" aria-labelledby="history-title">
            <div className="section-head">
              <h2 id="history-title">Recent</h2>
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  setHistory([])
                  saveHistory([])
                }}
              >
                Clear
              </button>
            </div>
            <div className="chips">
              {history.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => pick(q)}>
                  {q}
                </button>
              ))}
            </div>
          </section>
        )}

        <Examples onPick={pick} />

        <section className="card help" aria-labelledby="help-title">
          <details>
            <summary>
              <h2 id="help-title">How to type problems</h2>
            </summary>
            <ul>
              <li>
                Powers with <code>^</code>: <code>x^2</code>, <code>2^(x+1)</code>. Multiplication can be implied: <code>3x</code>, <code>2(x+1)</code>, <code>x sin x</code>.
              </li>
              <li>
                Functions: <code>sqrt</code>, <code>sin cos tan</code>, <code>asin acos atan</code>, <code>ln</code> (natural log), <code>log</code> (base 10), <code>log_2(x)</code>, <code>abs</code> or <code>|x|</code>, <code>n!</code>.
              </li>
              <li>
                Constants: <code>pi</code>, <code>e</code>, <code>infinity</code>. Degrees: <code>sin(30°)</code>. Percent: <code>15% * 80</code>.
              </li>
              <li>
                Commands: <code>solve …</code>, <code>simplify …</code>, <code>expand …</code>, <code>factor …</code>, <code>derivative of …</code>, <code>d/dx …</code>, <code>integrate … dx</code>, <code>integrate … from a to b</code>, <code>limit of … as x -&gt; a</code>.
              </li>
              <li>
                Systems: separate equations with a comma, semicolon or “and”: <code>x + y = 5, x - y = 1</code>.
              </li>
              <li>Use a dot for decimals: <code>2.5</code>.</li>
            </ul>
          </details>
        </section>
      </main>

      <footer className="footer">Everything runs in your browser. Exact answers where possible, decimals when not.</footer>
    </div>
  )
}
