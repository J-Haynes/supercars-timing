import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import '@fontsource/barlow-condensed/latin-700-italic.css'
import '@fontsource/titillium-web/latin-700.css'
import App from './App'
import { SERIES } from './series'
import './styles.css'

// Each series has its own neutrals, header type and brand colour (styles.css, :root[data-series]).
document.documentElement.dataset.series = SERIES

// The switch in the header remembers the series: opening / goes to the F1 app if that was the last one used.
try {
  if (window.location.pathname === '/' && localStorage.getItem('supercars-timing:series') === 'f1') window.location.replace('/f1')
} catch { /* storage blocked: stay on Supercars */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
