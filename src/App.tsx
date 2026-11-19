import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Examples } from './components/Examples'
import { MathInput, type MathInputHandle } from './components/MathInput'
import type { Solution, SolveResponse } from './engine/types'
import { loadKatex } from './katex'
import { prefersReducedMotion, rise } from './motion'
import { SolverClient } from './solverClient'
import { addToHistory, loadHistory, saveHistory } from './storage'

// The solution view (with the graph) is only needed once there is an answer, so it loads separately.
const loadSolutionView = () => import('./components/SolutionView')
const SolutionView = lazy(() => loadSolutionView().then((m) => ({ default: m.SolutionView })))

const SOURCE_URL = 'https://github.com/eerik-prog/math-solver'

/** Why a problem is being solved: typed (as you type), submitted (Enter, Solve, an example) or opened from a link. */
type How = 'typing' | 'submit' | 'open'

const DEBOUNCE_MS = 450
/** Errors from solve-as-you-type wait this much longer, so half-typed input isn't flagged. */
const TYPING_ERROR_DELAY_MS = 1200
/** Only show "Solving…" for solves slow enough to notice. */
const BUSY_DELAY_MS = 200

const THEME_COLOR = { light: '#fafafa', dark: '#000000' }

type Theme = 'light' | 'dark' | 'system'

const THEME_LABEL: Record<Theme, string> = { system: 'Auto', dark: 'Dark', light: 'Light' }

/** What a screen reader says when an answer appears. */
function answerSummary(solution: Solution): string {
  const texts = solution.answers.map((a) => a.text)
  return `${texts.length > 1 ? 'Answers' : 'Answer'}: ${texts.join('; ')}`
}

function whenIdle(cb: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(cb, { timeout: 3000 })
    return () => window.cancelIdleCallback(handle)
  }
  const timer = setTimeout(cb, 300)
  return () => clearTimeout(timer)
}

function setQueryInUrl(q: string | null) {
  const url = new URL(window.location.href)
  if (q === null) url.searchParams.delete('q')
  else url.searchParams.set('q', q)
  if (url.href !== window.location.href) window.history.replaceState(null, '', url)
}

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
  // `reveal` changes when a solution should animate in (submit, example, opened link), not while typing.
  const [reveal, setReveal] = useState({ id: 0, animate: true })
  // Errors found while typing show up late and quietly; errors on submit are announced (role="alert").
  const [error, setError] = useState<{ id: number; alert: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [readAs, setReadAs] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [theme, setTheme] = useTheme()
  const requestId = useRef(0)
  /** The text of the latest solve request, so the same problem isn't solved twice in a row. */
  const requested = useRef('')
  const opened = useRef(false)
  const inputRef = useRef<MathInputHandle>(null)
  const themeButton = useRef<HTMLButtonElement>(null)

  const run = useCallback(
    async (q: string, how: How) => {
      const text = q.trim()
      if (!text) return
      requested.current = text
      const id = ++requestId.current
      const busyTimer = setTimeout(() => setBusy(true), BUSY_DELAY_MS)
      const res = await client.solve(text)
      // Wait for the maths renderer and the view, so raw LaTeX never flashes up and nothing jumps.
      if (res.ok) await Promise.all([loadKatex(), loadSolutionView()]).catch(() => undefined)
      clearTimeout(busyTimer)
      if (id !== requestId.current) return
      setBusy(false)
      setResponse(res)
      if (res.ok) {
        setError(null)
        if (how === 'typing') setReveal((r) => (r.animate ? { id: r.id, animate: false } : r))
        else {
          setReveal({ id, animate: true })
          const summary = answerSummary(res.solution)
          // The same text twice in a row wouldn't be read again, so make it differ.
          setAnnouncement((prev) => (prev === summary ? `${summary}\u00a0` : summary))
        }
      } else if (how === 'typing') {
        setError(null)
        setTimeout(() => id === requestId.current && setError({ id, alert: false }), TYPING_ERROR_DELAY_MS)
      } else setError({ id, alert: true })
      if (how === 'submit' && res.ok) {
        setHistory((h) => {
          const next = addToHistory(h, text)
          saveHistory(next)
          return next
        })
      }
      if (how === 'submit') setQueryInUrl(text)
    },
    [client],
  )

  // Solve as you type (debounced). A problem opened from a link is solved straight away.
  useEffect(() => {
    const text = input.trim()
    if (!text || text === requested.current) return
    const t = setTimeout(
      () => {
        // Enter may have been pressed in the meantime.
        if (text === requested.current) return
        const how: How = opened.current ? 'typing' : 'open'
        opened.current = true
        void run(text, how)
      },
      opened.current ? DEBOUNCE_MS : 0,
    )
    return () => clearTimeout(t)
  }, [input, run])

  // "We read this as": how the problem was understood, updated on every keystroke.
  useEffect(() => {
    const text = input.trim()
    if (!text) return
    let alive = true
    void client.readAs(text).then((tex) => alive && setReadAs(tex))
    return () => {
      alive = false
    }
  }, [input, client])

  // Get the solver, the maths renderer and the solution view ready while the browser is idle.
  useEffect(
    () =>
      whenIdle(() => {
        client.warm()
        void loadKatex()
        void loadSolutionView()
      }),
    [client],
  )

  // "/" jumps to the problem box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const edit = (v: string) => {
    setInput(v)
    setError(null)
    if (!v.trim()) {
      // An empty box shows nothing, and any solve still running is ignored.
      requested.current = ''
      requestId.current++
      setResponse(null)
      setBusy(false)
      setReadAs(null)
    }
  }

  const clear = () => {
    edit('')
    setQueryInUrl(null)
  }

  const pick = (q: string) => {
    setInput(q)
    void run(q, 'submit')
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
          onChange={edit}
          onClear={clear}
          onSubmit={() => void run(input, 'submit')}
          busy={busy}
          readAs={input.trim() ? readAs : null}
        />

        {/* Read out new answers once, when they are asked for, rather than on every keystroke. */}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {response && !response.ok && error && input.trim() && (
          <div key={error.id} className="card error rise" role={error.alert ? 'alert' : undefined}>
            <span className="error-icon" aria-hidden="true">
              !
            </span>
            <p>
              <strong>Can't solve that yet.</strong> {response.error}
            </p>
          </div>
        )}
        {solution && (
          <Suspense fallback={null}>
            <SolutionView key={reveal.id} solution={solution} quiet={!reveal.animate} />
          </Suspense>
        )}

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
              <li>
                Keyboard: press <kbd>/</kbd> to jump to the box and <kbd>Esc</kbd> to clear it.
              </li>
            </ul>
          </details>
        </section>
      </main>

      <footer className="footer" aria-labelledby="about-title">
        <h2 id="about-title" className="footer-title">
          About
        </h2>
        <p>
          Math Solver is free. It runs entirely in your browser, so nothing you type is sent anywhere, and it keeps
          working offline once it has loaded.
        </p>
        <a className="footer-link" href={SOURCE_URL}>
          Source code on GitHub
        </a>
      </footer>
    </div>
  )
}
