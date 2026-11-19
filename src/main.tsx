import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD) {
  // Works offline after the first visit (see src/worker/service-worker.ts).
  if ('serviceWorker' in navigator)
    window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined))
  // A page left open across a deploy may ask for a file the new version no longer has: reload to get the new one
  // (but not over and over, if the file is really missing).
  window.addEventListener('vite:preloadError', (event) => {
    const key = 'math-solver:reloaded-at'
    try {
      if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 30_000) return
      sessionStorage.setItem(key, String(Date.now()))
    } catch {
      return
    }
    event.preventDefault()
    window.location.reload()
  })
}
