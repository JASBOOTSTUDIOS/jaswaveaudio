/** Entrada de JasWave Admin (admin.html): app aparte del DAW, sin motor de audio ni plugins. */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './admin.css'
import { AppAdmin } from './app-admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppAdmin />
  </StrictMode>,
)
