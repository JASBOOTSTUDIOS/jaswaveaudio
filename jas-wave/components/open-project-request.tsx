import { useCallback, useEffect, useRef } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { cargarProyectoDesdeRutaIO, confirmarCambiosIO } from '@/src/lib/project-io'
import { waitUntilProjectReady } from '@/src/lib/project-ready'

/**
 * Apertura de proyectos solicitada por el proceso main (U7): segunda instancia de
 * JasWave o doble clic en un `.jaswave` (asociación de archivos).
 *
 * El renderer decide: si hay cambios sin guardar pregunta al usuario (guarda de U1)
 * y solo entonces carga el proyecto.
 */
export function OpenProjectRequest() {
  const tienda = useDAW()
  const enCurso = useRef(false)

  const abrir = useCallback(
    async (ruta: string) => {
      if (!ruta) return
      if (enCurso.current) return
      enCurso.current = true
      try {
        // La sesión se restaura antes de tocar el proyecto.
        await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
        const confirmado = await confirmarCambiosIO(tienda, 'abrir')
        if (!confirmado.continuar) return
        const res = await cargarProyectoDesdeRutaIO(tienda, ruta)
        if (!res.success) {
          tienda.busEventos.emit('comando.fallido', {
            type: 'project.load',
            error: typeof res.error === 'string' ? res.error : 'No se pudo abrir el proyecto',
          })
        }
      } finally {
        enCurso.current = false
      }
    },
    [tienda],
  )

  useEffect(() => {
    const api = window.electron
    if (!api?.onOpenProjectRequested) return
    const off = api.onOpenProjectRequested((ruta) => {
      void abrir(ruta)
    })
    // Proyecto que llegó antes de que el renderer estuviera listo.
    void api.projectTakePending?.().then((ruta) => {
      if (ruta) void abrir(ruta)
    })
    return off
  }, [abrir])

  return null
}
