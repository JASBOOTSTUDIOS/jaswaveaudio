import { useEffect, useRef } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { confirmarCambiosIO } from '@/src/lib/project-io'
import { flushSessionForClose } from '@/src/lib/session-persist'

/** Tope para el flush de sesión antes de cerrar (main tiene su propio timeout de acuse). */
const FLUSH_SESION_MAX_MS = 3000

/**
 * Cierre de la ventana principal (X, Alt+F4, menú Salir): main lo retiene y pregunta aquí.
 * Con cambios sin guardar se muestra el diálogo (Guardar / No guardar / Cancelar).
 * Antes de confirmar se vuelca la sesión a IndexedDB sin RPC al plugin host.
 */
export function AppCloseGuard() {
  const tienda = useDAW()
  const enCurso = useRef(false)

  useEffect(() => {
    const api = window.electron
    if (!api?.onAppCloseRequested) return
    return api.onAppCloseRequested(() => {
      if (enCurso.current) return // ya preguntando: el diálogo abierto sirve para ambos clics
      enCurso.current = true
      void (async () => {
        try {
          const r = await confirmarCambiosIO(tienda, 'cerrar-app')
          if (!r.continuar) {
            await api.cancelAppClose?.()
            return
          }
          await Promise.race([
            flushSessionForClose(tienda).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, FLUSH_SESION_MAX_MS)),
          ])
          await api.confirmAppClose?.()
        } catch (err) {
          // Fallo inesperado (p. ej. al guardar): no cerrar y perder trabajo; el usuario reintenta.
          tienda.busEventos.emit('comando.fallido', {
            type: 'app.close',
            error: err instanceof Error ? err.message : String(err),
          })
          await api.cancelAppClose?.()
        } finally {
          enCurso.current = false
        }
      })()
    })
  }, [tienda])

  return null
}
