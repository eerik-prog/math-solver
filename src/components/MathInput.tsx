import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { prefersReducedMotion, rise } from '../motion'
import { Tex } from './Tex'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  /** Empties the box (the × button and the Esc key). */
  onClear: () => void
  busy: boolean
  /** LaTeX for how the problem was read, shown quietly under the box; null while it can't be read. */
  readAs: string | null
}

export interface MathInputHandle {
  focus: () => void
}

/** Snippets inserted at the cursor; "|" marks where the cursor ends up. */
type Key = { label: string; insert: string; title: string }

/** The keys most problems need; the rest sit behind "More". */
const BASIC_KEYS: Key[] = [
  { label: '+', insert: ' + ', title: 'Plus' },
  { label: '−', insert: ' - ', title: 'Minus' },
  { label: '×', insert: '*', title: 'Times' },
  { label: '÷', insert: '/', title: 'Divide' },
  { label: '=', insert: ' = ', title: 'Equals' },
  { label: 'x²', insert: '^2', title: 'Square' },
  { label: '√', insert: 'sqrt(|)', title: 'Square root' },
  { label: '( )', insert: '(|)', title: 'Parentheses' },
  { label: 'π', insert: 'pi', title: 'Pi' },
]

const MORE_KEYS: Key[] = [
  { label: 'xⁿ', insert: '^', title: 'Power' },
  { label: '≤', insert: ' <= ', title: 'Less than or equal' },
  { label: '≥', insert: ' >= ', title: 'Greater than or equal' },
  { label: 'sin', insert: 'sin(|)', title: 'Sine' },
  { label: 'cos', insert: 'cos(|)', title: 'Cosine' },
  { label: 'ln', insert: 'ln(|)', title: 'Natural logarithm' },
  { label: '|x|', insert: 'abs(|)', title: 'Absolute value' },
  { label: 'd/dx', insert: 'derivative of |', title: 'Derivative' },
  { label: '∫', insert: 'integrate | dx', title: 'Integral' },
  { label: 'lim', insert: 'limit of | as x -> 0', title: 'Limit' },
]

const PLACEHOLDERS = [
  'x^2 - 5x + 6 = 0',
  'integrate x e^x dx',
  'd/dx ln(x^2 + 1)',
  'x + y = 10, x - y = 4',
  'limit of sin(x)/x as x -> 0',
  'factor x^4 - 16',
]
const STATIC_PLACEHOLDER = 'e.g. x^2 - 5x + 6 = 0'

/** Types example problems into the placeholder, one character at a time, while the box is empty. */
function useTypewriter(active: boolean): string {
  const [text, setText] = useState<string | null>(null)
  const enabled = active && !prefersReducedMotion()
  useEffect(() => {
    if (!enabled) return
    let item = 0
    let len = 0
    let deleting = false
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const target = PLACEHOLDERS[item]
      let delay = deleting ? 22 : 55 + Math.random() * 45
      if (!deleting && len === target.length) {
        deleting = true
        delay = 1900
      } else if (deleting && len === 0) {
        deleting = false
        item = (item + 1) % PLACEHOLDERS.length
        delay = 350
      } else {
        len += deleting ? -1 : 1
        setText(target.slice(0, len))
      }
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, 900)
    return () => {
      clearTimeout(timer)
      setText(null)
    }
  }, [enabled])
  return enabled && text !== null ? `Try: ${text}` : STATIC_PLACEHOLDER
}

export const MathInput = forwardRef<MathInputHandle, Props>(function MathInput(
  { value, onChange, onSubmit, onClear, busy, readAs },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const keypadRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))
  const placeholder = useTypewriter(!value)
  const [more, setMore] = useState(false)
  const keys = more ? [...BASIC_KEYS, ...MORE_KEYS] : BASIC_KEYS
  // The keypad is one stop in the Tab order; the arrow keys move between its keys.
  const [activeKey, setActiveKey] = useState(0)
  const active = Math.min(activeKey, keys.length)

  // The box sticks to the top of the screen: keep what Tab moves to from scrolling in underneath it.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const form = formRef.current
    if (!form || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--sticky-space', `${Math.ceil(form.offsetHeight) + 28}px`),
    )
    ro.observe(form)
    return () => ro.disconnect()
  }, [])

  const moveInKeypad = (e: React.KeyboardEvent) => {
    const count = keys.length + 1
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const next =
      e.key in step ? (active + step[e.key] + count) % count : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : -1
    if (next < 0) return
    e.preventDefault()
    setActiveKey(next)
    keypadRef.current?.querySelectorAll('button')[next]?.focus()
  }

  const insert = (snippet: string) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    const cursorAt = snippet.indexOf('|')
    const text = snippet.replace('|', selected)
    const next = value.slice(0, start) + text + value.slice(end)
    // Commit the new value now so the cursor can be placed straight away; a deferred move could
    // land after the next keystroke and send it to the wrong place.
    flushSync(() => onChange(next))
    const pos = start + (cursorAt >= 0 ? cursorAt + selected.length : text.length)
    el?.focus()
    el?.setSelectionRange(pos, pos)
  }

  return (
    <form
      ref={formRef}
      className="input-card card rise"
      style={rise(2)}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.preventDefault()
          onClear()
          inputRef.current?.focus()
        }
      }}
    >
      <label htmlFor="problem" className="sr-only">
        Math problem
      </label>
      <div className="input-row">
        <input
          ref={inputRef}
          id="problem"
          className="problem-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-keyshortcuts="/"
          autoFocus
        />
        {value && (
          <button
            type="button"
            className="ghost clear"
            onClick={() => {
              onClear()
              inputRef.current?.focus()
            }}
            aria-label="Clear input"
          >
            ×
          </button>
        )}
        <button type="submit" className="primary" disabled={!value.trim() || busy}>
          {busy ? 'Solving…' : 'Solve'}
          {!busy && (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="arrow">
              <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.75" />
            </svg>
          )}
        </button>
      </div>
      {/* The line keeps its space while there is input, so the keypad doesn't jump as you type. */}
      {value.trim() && (
        <p className="read-as">
          {readAs && (
            <>
              <span className="read-as-label">We read this as:</span> <Tex tex={readAs} />
            </>
          )}
        </p>
      )}
      {busy && <div className="progress" aria-hidden="true" />}
      <div className="keypad" role="toolbar" aria-label="Insert symbols" ref={keypadRef} onKeyDown={moveInKeypad}>
        {keys.map((k, i) => (
          <button
            key={k.label}
            type="button"
            title={k.title}
            tabIndex={i === active ? 0 : -1}
            onFocus={() => setActiveKey(i)}
            onClick={() => insert(k.insert)}
          >
            {k.label}
          </button>
        ))}
        <button
          type="button"
          className="more-key"
          aria-expanded={more}
          tabIndex={active === keys.length ? 0 : -1}
          onFocus={() => setActiveKey(keys.length)}
          onClick={() => {
            // The button stays focused and moves to the end of the new set of keys.
            setActiveKey(more ? BASIC_KEYS.length : BASIC_KEYS.length + MORE_KEYS.length)
            setMore((m) => !m)
          }}
        >
          {more ? 'Less' : 'More'}
        </button>
      </div>
    </form>
  )
})
