import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './globals.css'
import { initUiZoom } from './lib/docs-editor-store'
import { AppErrorBoundary, reportRendererError } from '@/components/app-error-boundary'
import { getSharedStore } from './context/daw-context'

initUiZoom()

window.addEventListener('error', (e) => reportRendererError('window.onerror', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => reportRendererError('unhandledrejection', e.reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary area="app" getProject={() => getSharedStore().obtenerEstado().project}>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
