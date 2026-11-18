import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadKatex } from './components/Tex'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Warm up the math renderer once the page is interactive.
const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb) : setTimeout(cb, 200))
idle(() => void loadKatex())
