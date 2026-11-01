/**
 * Sincronización automática de la biblioteca de grooves (renderer): al iniciar sesión, al volver la conexión y
 * cada 6 horas (configurable). Con reintento y espera creciente cuando falla; nunca bloquea la app: todo corre en
 * segundo plano y los errores solo se anotan. El trabajo real (descarga, verificación, escritura) lo hace el main.
 */

import { useEffect, useRef, useState } from 'react'
import { configBackend } from '../backend/config'
import { tokenSesion, useSesion } from '../backend/sesion'
import { apiGrooves, cargarGrooves, invalidarGrooves, type EstadoSyncUi, type EventoSyncUi, type ResultadoSyncUi } from './cliente'
import { proponerPendientes } from './propuestas'
import { crearProgramadorSync } from './sync-programador'

export { INTERVALO_SYNC_MS, crearProgramadorSync, esperaReintentoSync } from './sync-programador'

/** Una sincronización completa con la sesión actual. Refresca la biblioteca y propone lo pendiente si el usuario lo permitió. */
export async function sincronizarGroovesAhora(): Promise<ResultadoSyncUi> {
  const api = apiGrooves()
  const ahora = new Date().toISOString()
  const vacio = (error: string): ResultadoSyncUi => ({ ok: false, sinConexion: true, error, descargados: 0, actualizados: 0, retirados: 0, conservados: [], errores: [], fecha: ahora })
  if (!api) return vacio('La sincronización solo está disponible en la app de escritorio')
  const token = await tokenSesion().catch(() => null)
  if (!token) return vacio('Inicia sesión para actualizar los grooves')
  const r = await api.syncAhora(configBackend().apiUrl, token)
  invalidarGrooves()
  if (r.ok) {
    try {
      const estado = (await api.syncEstado()).estado
      if (estado?.compartir) await proponerPendientes((await cargarGrooves(true)).lista, estado.propuestos)
    } catch {
      /* compartir es opcional */
    }
  }
  return r
}

/** Estado reactivo para el panel: ajustes, progreso y último resultado. */
export function useEstadoSyncGrooves() {
  const [estado, setEstado] = useState<EstadoSyncUi | null>(null)
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoSyncUi | null>(null)

  const recargar = async () => {
    const r = await apiGrooves()?.syncEstado()
    if (r?.ok && r.estado) setEstado(r.estado)
  }
  useEffect(() => {
    void recargar()
    return apiGrooves()?.onSync((e: EventoSyncUi) => {
      if (e.tipo === 'inicio') {
        setSincronizando(true)
        setProgreso(null)
      } else if (e.tipo === 'progreso') setProgreso({ hecho: e.hecho ?? 0, total: e.total ?? 0 })
      else if (e.tipo === 'fin') {
        setSincronizando(false)
        setProgreso(null)
        if (e.resultado) setResultado(e.resultado)
        void recargar()
      }
    })
  }, [])

  const ajustar = async (a: { auto?: boolean; compartir?: boolean }) => {
    const r = await apiGrooves()?.syncAjustes(a)
    if (r?.ok && r.estado) setEstado(r.estado)
  }
  return { estado, progreso, sincronizando, resultado, ajustar, recargar }
}

/** Componente sin interfaz: mantiene la sincronización automática mientras haya sesión. Va una vez en la app. */
export function GroovesSyncBootstrap() {
  const sesion = useSesion()
  const hayApi = typeof window !== 'undefined' && !!apiGrooves()
  const programador = useRef<ReturnType<typeof crearProgramadorSync> | null>(null)
  const conSesion = Boolean(sesion.session)

  useEffect(() => {
    if (!hayApi || !conSesion) return
    let auto = true
    const leerAuto = async () => {
      const r = await apiGrooves()?.syncEstado()
      if (r?.ok && r.estado) auto = r.estado.auto
    }
    void leerAuto()
    const p = crearProgramadorSync({
      tarea: async () => {
        await leerAuto()
        return auto ? sincronizarGroovesAhora() : { ok: true }
      },
      activo: () => navigator.onLine !== false,
    })
    programador.current = p
    p.iniciar()
    const alVolver = () => p.pedir()
    window.addEventListener('online', alVolver)
    return () => {
      window.removeEventListener('online', alVolver)
      p.parar()
      programador.current = null
    }
  }, [hayApi, conSesion])

  return null
}
