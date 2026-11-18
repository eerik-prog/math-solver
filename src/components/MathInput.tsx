import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { prefersReducedMotion, rise } from '../motion'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy: boolean
}

export interface MathInputHandle {
  focus: () => void
}

/** Snippets inserted at the cursor; "|" marks where the cursor ends up. */
const KEYS: Array<{ label: string; insert: string; title: string }> = [
  { label: 'x²', insert: '^2', title: 'Square' },
  { label: 'xⁿ', insert: '^', title: 'Power' },
  { label: '√', insert: 'sqrt(|)', title: 'Square root' },
  { label: '÷', insert: '/', title: 'Divide' },
  { label: '( )', insert: '(|)', title: 'Parentheses' },
  { label: 'π', insert: 'pi', title: 'Pi' },
  { label: 'e', insert: 'e', title: "Euler's number" },
  { label: '=', insert: ' = ', title: 'Equals' },
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
  { value, onChange, onSubmit, busy },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))
  const placeholder = useTypewriter(!value)

  const insert = (snippet: string) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    const cursorAt = snippet.indexOf('|')
    const text = snippet.replace('|', selected)
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    const pos = start + (cursorAt >= 0 ? cursorAt + selected.length : text.length)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  return (
    <form
      className="input-card card rise"
      style={rise(2)}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
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
          autoFocus
        />
        {value && (
          <button type="button" className="ghost clear" onClick={() => onChange('')} aria-label="Clear input">
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
      {busy && <div className="progress" aria-hidden="true" />}
      <div className="keypad" role="group" aria-label="Insert symbols">
        {KEYS.map((k) => (
          <button key={k.label} type="button" title={k.title} onClick={() => insert(k.insert)}>
            {k.label}
          </button>
        ))}
      </div>
    </form>
  )
})
