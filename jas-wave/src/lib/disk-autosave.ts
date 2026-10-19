/**
 * Autosave a disco junto al proyecto: <nombre>.autosave.jaswave cada AUTOSAVE_INTERVAL_MS
 * si hubo cambios. Complementa el snapshot de sesión en IndexedDB (que vive solo en este
 * equipo/perfil) y el .bak del guardado atómico.
 */

import { proyectoParaGuardar } from '../../../shared/src/project/ciclo-vida'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { saveTextOrThrow } from './electron-fs'

const AUTOSAVE_INTERVAL_MS = 2 * 60_000

export function autosavePathFor(ruta: string): string {
  return ruta.replace(/\.jaswave$/i, '') + '.autosave.jaswave'
}

export function attachDiskAutosave(tienda: TiendaDAW): () => void {
  if (typeof window === 'undefined' || !window.electron?.fileSave) return () => undefined
  let dirty = false
  let lastProject = tienda.obtenerEstado().project
  const unsub = tienda.suscribir((estado) => {
    if (estado.project !== lastProject) {
      lastProject = estado.project
      dirty = true
    }
  })

  const tick = async () => {
    const st = tienda.obtenerEstado()
    // Nunca durante reproducción/grabación (evita trabajo en el hilo UI con audio en curso).
    if (!dirty || !st.project?.ruta || st.transport?.reproduciendo) return
    dirty = false
    try {
      await saveTextOrThrow(autosavePathFor(st.project.ruta), JSON.stringify(proyectoParaGuardar(st.project)))
    } catch (e) {
      dirty = true
      window.electron?.logError?.('autosave', e instanceof Error ? e.message : String(e))
    }
  }

  const timer = window.setInterval(() => void tick(), AUTOSAVE_INTERVAL_MS)
  return () => {
    window.clearInterval(timer)
    unsub()
  }
}
