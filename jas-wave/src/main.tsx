import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './globals.css'
import { initUiZoom } from './lib/docs-editor-store'

initUiZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
