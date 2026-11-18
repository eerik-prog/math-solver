import { memo, useEffect, useState } from 'react'
import { katexIfLoaded, loadKatex } from '../katex'

interface Props {
  tex: string
  display?: boolean
  className?: string
}

function render(tex: string, display: boolean): string | null {
  const k = katexIfLoaded()
  if (!k) return null
  try {
    return k.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    })
  } catch {
    return null
  }
}

/** Renders LaTeX with KaTeX; shows the source text until KaTeX has loaded. */
export const Tex = memo(function Tex({ tex, display = false, className }: Props) {
  const [ready, setReady] = useState(() => katexIfLoaded() !== null)
  useEffect(() => {
    if (ready) return
    let alive = true
    void loadKatex().then(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [ready])
  const html = ready ? render(tex, display) : null
  if (html === null) return <code className={`tex-fallback ${className ?? ''}`}>{tex}</code>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
