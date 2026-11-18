import { memo, useEffect, useState } from 'react'

type Katex = typeof import('katex').default

let katex: Katex | null = null
let loading: Promise<Katex> | null = null

/** KaTeX is ~270 kB, so it is loaded on demand (and preloaded when the browser is idle). */
export function loadKatex(): Promise<Katex> {
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
      katex = m.default
      return katex
    })
  }
  return loading
}

interface Props {
  tex: string
  display?: boolean
  className?: string
}

function render(k: Katex, tex: string, display: boolean): string | null {
  try {
    return k.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' })
  } catch {
    return null
  }
}

/** Renders LaTeX with KaTeX; shows the source text until KaTeX has loaded. */
export const Tex = memo(function Tex({ tex, display = false, className }: Props) {
  const [ready, setReady] = useState(katex !== null)
  useEffect(() => {
    if (ready) return
    let alive = true
    void loadKatex().then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [ready])
  const html = ready && katex ? render(katex, tex, display) : null
  if (html === null) return <code className={`tex-fallback ${className ?? ''}`}>{tex}</code>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
