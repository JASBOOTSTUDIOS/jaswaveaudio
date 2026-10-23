import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './globals.css'
import { initUiZoom } from './lib/docs-editor-store'
import { AppErrorBoundary, reportRendererError } from '@/components/app-error-boundary'
import { getSharedStore } from './context/daw-context'
import { PaginaActivar, esRutaActivacion } from '@/components/cuenta/pagina-activar'
import { registrarModulosIntegrados } from './modulos/integrados'

initUiZoom()
registrarModulosIntegrados()

window.addEventListener('error', (e) => reportRendererError('window.onerror', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => reportRendererError('unhandledrejection', e.reason))

// /activar?codigo=… la abre un VST JasWave (desde cualquier DAW) para aprobar su equipo: no carga el DAW.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esRutaActivacion(window.location) ? (
      <AppErrorBoundary area="activar">
        <PaginaActivar />
      </AppErrorBoundary>
    ) : (
      <AppErrorBoundary area="app" getProject={() => getSharedStore().obtenerEstado().project}>
        <App />
      </AppErrorBoundary>
    )}
  </StrictMode>,
)
