type Katex = typeof import('katex').default

let instance: Katex | null = null
let loading: Promise<Katex> | null = null

export function katexIfLoaded(): Katex | null {
  return instance
}

/** KaTeX is ~260 kB, so it is loaded on demand (and preloaded when the browser is idle). */
export function loadKatex(): Promise<Katex> {
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
      instance = m.default
      return instance
    })
  }
  return loading
}
