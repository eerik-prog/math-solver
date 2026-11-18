import { forwardRef, useImperativeHandle, useRef } from 'react'

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

export const MathInput = forwardRef<MathInputHandle, Props>(function MathInput(
  { value, onChange, onSubmit, busy },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

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
      className="input-card card"
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
          placeholder="Type a problem, e.g. x^2 - 5x + 6 = 0"
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
        </button>
      </div>
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
