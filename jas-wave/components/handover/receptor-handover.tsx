/**
 * Receptor del handover web → escritorio (H1): recibe `jaswave://abrir?token=…`, respeta la guarda
 * de cambios sin guardar y restaura proyecto, cursor, selección, reproducción y sesión.
 */

import { useEffect } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { aplicarHandover } from '@/src/lib/backend/handover'
import { apiJasWave, clienteSupabase } from '@/src/lib/backend/sesion'
import { backendConfigurado } from '@/src/lib/backend/config'
import { confirmarCambiosIO } from '@/src/lib/project-io'

export function ReceptorHandover() {
  const tienda = useDAW()

  useEffect(() => {
    const e = window.electron
    if (!e?.onHandover || !backendConfigurado()) return
    let ocupado = false
    const recibir = async (token: string) => {
      if (ocupado) return
      ocupado = true
      try {
        const confirmado = await confirmarCambiosIO(tienda, 'abrir')
        if (!confirmado.continuar) return
        const r = await aplicarHandover(token, {
          api: apiJasWave(),
          tienda,
          adoptarSesion: async (s) => {
            const { error } = await clienteSupabase().auth.setSession(s)
            if (error) throw new Error(`No se pudo continuar la sesión: ${error.message}`)
          },
        })
        tienda.busEventos.emit('handover.recibido', { ms: Math.round(r.ms), reproduciendo: r.reproduciendo })
      } catch (err) {
        tienda.busEventos.emit('sistema.error', { mensaje: err instanceof Error ? err.message : String(err) })
      } finally {
        ocupado = false
      }
    }
    void e.handoverTakePending?.().then((t) => {
      if (t) void recibir(t)
    })
    return e.onHandover((t) => void recibir(t))
  }, [tienda])

  return null
}
