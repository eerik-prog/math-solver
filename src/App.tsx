import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Examples } from './components/Examples'
import { MathInput, type MathInputHandle } from './components/MathInput'
import { SolutionView } from './components/SolutionView'
import type { SolveResponse } from './engine/types'
import { prefersReducedMotion, rise } from './motion'
import { SolverClient } from './solverClient'
import { addToHistory, loadHistory, saveHistory } from './storage'

const DEBOUNCE_MS = 450
/** Errors from solve-as-you-type wait this much longer, so half-typed input isn't flagged. */
const TYPING_ERROR_DELAY_MS = 1200
/** Only show "Solving…" for solves slow enough to notice. */
const BUSY_DELAY_MS = 200

const THEME_COLOR = { light: '#fafafa', dark: '#000000' }

type Theme = 'light' | 'dark' | 'system'

const THEME_LABEL: Record<Theme, string> = { system: 'Auto', dark: 'Dark', light: 'Light' }

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
  // Layout effect so the attribute is in place before the theme-change transition captures the new view.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    // Browser UI colour (address bar on phones) follows the chosen theme, or the system one on Auto.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const mode = theme !== 'system' ? theme : meta.media.includes('dark') ? 'dark' : 'light'
      meta.content = THEME_COLOR[mode]
    }
    try {
      localStorage.setItem('math-solver:theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, setTheme]
}

function effectiveTheme(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="theme-icon">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {theme === 'system' && <path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor" />}
      {theme === 'dark' && <circle cx="10" cy="10" r="7.25" fill="currentColor" />}
    </svg>
  )
}

export default function App() {
  const client = useMemo(() => new SolverClient(), [])
  const [input, setInput] = useState(initialQuery)
  const [response, setResponse] = useState<SolveResponse | null>(null)
  // `reveal` changes when a solution should animate in (submit, example, first load), not on every keystroke.
  const [reveal, setReveal] = useState({ id: 0, animate: true })
  const [errorVisible, setErrorVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [theme, setTheme] = useTheme()
  const requestId = useRef(0)
  const inputRef = useRef<MathInputHandle>(null)
  const themeButton = useRef<HTMLButtonElement>(null)
  const shownFirst = useRef(false)

  const run = useCallback(
    async (q: string, record: boolean) => {
      const text = q.trim()
      if (!text) {
        setResponse(null)
        return
      }
      const id = ++requestId.current
      const busyTimer = setTimeout(() => setBusy(true), BUSY_DELAY_MS)
      const res = await client.solve(text)
      clearTimeout(busyTimer)
      if (id !== requestId.current) return
      setBusy(false)
      setResponse(res)
      if (res.ok && (record || !shownFirst.current)) setReveal({ id, animate: true })
      else if (res.ok) setReveal((r) => (r.animate ? { id: r.id, animate: false } : r))
      if (res.ok) shownFirst.current = true
      if (!res.ok) {
        setErrorVisible(record)
        if (!record) setTimeout(() => id === requestId.current && setErrorVisible(true), TYPING_ERROR_DELAY_MS)
      }
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
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    inputRef.current?.focus()
  }

  /** Switches theme with a circular reveal that grows out of the toggle button, where supported. */
  const cycleTheme = () => {
    const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system'
    if (
      !('startViewTransition' in document) ||
      prefersReducedMotion() ||
      effectiveTheme(next) === effectiveTheme(theme)
    ) {
      setTheme(next)
      return
    }
    const r = themeButton.current?.getBoundingClientRect()
    const x = r ? r.left + r.width / 2 : window.innerWidth - 40
    const y = r ? r.top + r.height / 2 : 40
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const root = document.documentElement
    // Freeze CSS colour transitions so the new view is captured in its final colours.
    root.classList.add('switching')
    const transition = document.startViewTransition(() => flushSync(() => setTheme(next)))
    void transition.finished.finally(() => root.classList.remove('switching'))
    transition.ready
      .then(() =>
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => {})
  }

  const solution = response?.ok ? response.solution : null

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Math Solver home">
          <span className="logo" aria-hidden="true">
            ∑
          </span>
          <span className="wordmark">Math Solver</span>
        </a>
        <button
          ref={themeButton}
          type="button"
          className="theme-toggle"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABEL[theme].toLowerCase()}. Click to change.`}
        >
          <ThemeIcon theme={theme} />
          {THEME_LABEL[theme]}
        </button>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <h1 id="hero-title" className="hero-title rise" style={rise(0)}>
            Type a problem. <em>See every step.</em>
          </h1>
          <p className="hero-sub rise" style={rise(1)}>
            Type any math problem below. You get the answer and every step explained.
          </p>
        </section>

        <MathInput
          ref={inputRef}
          value={input}
          onChange={(v) => {
            setInput(v)
            setErrorVisible(false)
          }}
          onSubmit={() => void run(input, true)}
          busy={busy}
        />

        <div aria-live="polite" className="result-region">
          {response && !response.ok && errorVisible && input.trim() && (
            <div className="card error rise" role="alert">
              <span className="error-icon" aria-hidden="true">
                !
              </span>
              <p>
                <strong>Can't solve that yet.</strong> {response.error}
              </p>
            </div>
          )}
          {solution && <SolutionView key={reveal.id} solution={solution} quiet={!reveal.animate} />}
        </div>

        {history.length > 0 && (
          <section className="card history rise" style={rise(3)} aria-labelledby="history-title">
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

        <section className="card help rise" style={rise(5)} aria-labelledby="help-title">
          <details>
            <summary>
              <h2 id="help-title">How to type problems</h2>
              <span className="chevron" aria-hidden="true" />
            </summary>
            <ul>
              <li>
                Powers with <code>^</code>: <code>x^2</code>, <code>2^(x+1)</code>. Multiplication can be implied:{' '}
                <code>3x</code>, <code>2(x+1)</code>, <code>x sin x</code>.
              </li>
              <li>
                Functions: <code>sqrt</code>, <code>sin cos tan</code>, <code>asin acos atan</code>, <code>ln</code>{' '}
                (natural log), <code>log</code> (base 10), <code>log_2(x)</code>, <code>abs</code> or <code>|x|</code>,{' '}
                <code>n!</code>.
              </li>
              <li>
                Constants: <code>pi</code>, <code>e</code>, <code>infinity</code>. Degrees: <code>sin(30°)</code>.
                Percent: <code>15% * 80</code>.
              </li>
              <li>
                Commands: <code>solve …</code>, <code>simplify …</code>, <code>expand …</code>, <code>factor …</code>,{' '}
                <code>derivative of …</code>, <code>d/dx …</code>, <code>integrate … dx</code>,{' '}
                <code>integrate … from a to b</code>, <code>limit of … as x -&gt; a</code>.
              </li>
              <li>
                Systems: separate equations with a comma, semicolon or “and”: <code>x + y = 5, x - y = 1</code>.
              </li>
              <li>
                Use a dot for decimals: <code>2.5</code>.
              </li>
            </ul>
          </details>
        </section>
      </main>

      <footer className="footer">
        <span>Runs entirely in your browser.</span>
        <span>Exact answers where possible, decimals when not.</span>
      </footer>
    </div>
  )
}
