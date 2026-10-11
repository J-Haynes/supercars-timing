import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// The switch in the header remembers the series: opening / goes to the F1 app if that was the last one used.
try {
  if (window.location.pathname === '/' && localStorage.getItem('supercars-timing:series') === 'f1') window.location.replace('/f1')
} catch { /* storage blocked: stay on Supercars */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
