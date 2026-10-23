/**
 * Panel "Cuenta" (L3): inicio de sesión, licencia de este equipo (la que usan los VST JasWave en
 * cualquier DAW) y acceso al panel de administración para administradores.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiJasWave, cerrarSesion, useSesion } from '@/src/lib/backend/sesion'
import { msHastaRenovar, puertoEscritorio, renovarLicenciaEquipo, type EstadoLicenciaEquipo } from '@/src/lib/backend/licencia-equipo'
import { requestOpenTool } from '@/src/workspace/types'
import { pluginsActivos } from '@/src/lib/plugins/registro-plugins'
import { FormularioLogin } from './formulario-login'
import { CatalogoPluginsCuenta } from './catalogo-plugins'
import { Aviso, Boton, Seccion } from './ui'

/** Mantiene la licencia del equipo renovada mientras haya sesión. */
export function useLicenciaEquipo(conSesion: boolean) {
  const [estado, setEstado] = useState<EstadoLicenciaEquipo | null>(null)
  const [renovando, setRenovando] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const renovar = useCallback(async () => {
    setRenovando(true)
    const r = await renovarLicenciaEquipo(apiJasWave(), puertoEscritorio())
    setEstado(r)
    setRenovando(false)
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => void renovar(), msHastaRenovar(r))
  }, [])

  useEffect(() => {
    if (!conSesion) {
      setEstado(null)
      return
    }
    void renovar()
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [conSesion, renovar])

  return { estado, renovando, renovar }
}

function nombreProducto(id: string): string {
  return pluginsActivos().find((p) => p.manifiesto.id === id)?.manifiesto.name ?? id
}

export function PanelCuenta() {
  const sesion = useSesion()
  const { estado, renovando, renovar } = useLicenciaEquipo(Boolean(sesion.session))

  if (sesion.sinConfigurar) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <h2 className="text-[13px] font-semibold text-foreground">Cuenta JasWave</h2>
        <Aviso>
          Este build no tiene servidor configurado. Define VITE_API_URL, VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver backend/README.md).
        </Aviso>
      </div>
    )
  }
  if (sesion.cargando) return <div className="p-4 text-[12px] text-muted-foreground">Cargando sesión…</div>

  if (!sesion.session) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-[13px] font-semibold text-foreground">Cuenta JasWave</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">Inicia sesión para activar tus plugins JasWave en este equipo y colaborar en tiempo real.</p>
        </div>
        <FormularioLogin />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-foreground">{sesion.identidad?.email ?? sesion.session.user.email}</h2>
          {sesion.identidad?.esAdmin ? (
            <span className="flex items-center gap-1 text-[10px] text-accent-amber">
              <ShieldCheck className="size-3" /> Administrador
            </span>
          ) : null}
        </div>
        <Boton className="flex items-center gap-1" onClick={() => void cerrarSesion()}>
          <LogOut className="size-3.5" /> Salir
        </Boton>
      </header>
      {sesion.error ? <Aviso tipo="error">{sesion.error}</Aviso> : null}

      <Seccion
        titulo="Licencia de este equipo"
        acciones={
          <Boton className="flex items-center gap-1" disabled={renovando} onClick={() => void renovar()}>
            <RefreshCw className={`size-3.5 ${renovando ? 'animate-spin' : ''}`} /> Renovar
          </Boton>
        }
      >
        {!estado ? (
          <Aviso>Comprobando…</Aviso>
        ) : estado.estado === 'sin-licencia' ? (
          <Aviso>Tu cuenta no tiene plugins concedidos. Pide acceso a un administrador.</Aviso>
        ) : estado.estado === 'error' ? (
          <Aviso tipo="error">No se pudo renovar: {estado.mensaje}. Se reintentará en unos minutos.</Aviso>
        ) : (
          <>
            <Aviso tipo="ok">
              Activa hasta {estado.expiraEn.toLocaleString()} · se renueva sola. Los VST JasWave de este equipo la usan también en otros DAW.
            </Aviso>
            <ul className="flex flex-col gap-1">
              {Object.entries(estado.productos).map(([id, acciones]) => (
                <li key={id} className="flex items-start gap-2 text-[11px]">
                  <KeyRound className="mt-0.5 size-3 shrink-0 text-accent-amber" />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground">{nombreProducto(id)}</span>
                    <span className="block text-[10px] text-muted-foreground">{acciones.join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Seccion>

      <CatalogoPluginsCuenta />

      {sesion.identidad?.esAdmin ? (
        <Boton primario onClick={() => requestOpenTool('admin')}>
          Abrir panel de administración
        </Boton>
      ) : null}
    </div>
  )
}
