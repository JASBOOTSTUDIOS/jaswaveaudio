/**
 * Web → escritorio (H1): lleva el proyecto, la posición, la selección, la reproducción y la sesión a
 * JasWave Desktop con un enlace de un solo uso (60 s). Solo en el cliente web.
 */

import { useState } from 'react'
import { MonitorUp } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { getSharedStore } from '@/src/context/daw-context'
import { configBackend } from '@/src/lib/backend/config'
import { crearEnlaceHandover } from '@/src/lib/backend/handover'
import { apiJasWave } from '@/src/lib/backend/sesion'
import { Aviso, Boton, Seccion } from './ui'

export function ContinuarEnEscritorio({ session }: { session: Session }) {
  const [estado, setEstado] = useState<'inicial' | 'abriendo' | 'abierto'>('inicial')
  const [error, setError] = useState<string | null>(null)
  if (window.electron) return null
  const descarga = configBackend().descargaUrl

  const continuar = async () => {
    setEstado('abriendo')
    setError(null)
    try {
      const url = await crearEnlaceHandover(apiJasWave(), getSharedStore().obtenerEstado(), {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      })
      window.location.href = url
      setEstado('abierto')
    } catch (e) {
      setEstado('inicial')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Seccion titulo="JasWave Desktop">
      <Aviso>Para VST3, ASIO y render multipista, continúa este proyecto en la app de escritorio.</Aviso>
      <Boton primario disabled={estado === 'abriendo'} className="flex items-center justify-center gap-1.5" onClick={() => void continuar()}>
        <MonitorUp className="size-3.5" />
        {estado === 'abriendo' ? 'Preparando…' : 'Abrir en JasWave Desktop'}
      </Boton>
      {estado === 'abierto' ? <Aviso tipo="ok">Si la app no se abrió, instálala y vuelve a pulsar (el enlace dura 60 s).</Aviso> : null}
      {descarga ? (
        <a href={descarga} className="text-[11px] text-accent-amber underline" target="_blank" rel="noreferrer">
          Descargar JasWave Desktop (instalador ligero)
        </a>
      ) : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
    </Seccion>
  )
}
