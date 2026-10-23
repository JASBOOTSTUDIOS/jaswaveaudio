/**
 * Página de activación (`/activar?codigo=XXXX-XXXX`): la abre un VST JasWave desde cualquier DAW.
 * El usuario inicia sesión y aprueba el código; el VST recibe su licencia al consultar el servidor.
 */

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { apiJasWave, useSesion } from '@/src/lib/backend/sesion'
import { FormularioLogin } from './formulario-login'
import { Aviso, Boton, Campo } from './ui'

/** Código de la URL normalizado (XXXX-XXXX) o cadena vacía. */
export function codigoDeUrl(busqueda: string): string {
  const c = new URLSearchParams(busqueda).get('codigo') ?? ''
  const limpio = c.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return limpio.length === 8 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : ''
}

export function esRutaActivacion(loc: { pathname: string; search: string; hash: string }): boolean {
  return /\/activar\/?$/.test(loc.pathname) || loc.hash.startsWith('#/activar')
}

export function PaginaActivar() {
  const sesion = useSesion()
  const [codigo, setCodigo] = useState(() => codigoDeUrl(window.location.search || window.location.hash.split('?')[1] || ''))
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'ok'>('inicial')
  const [error, setError] = useState<string | null>(null)

  const aprobar = async () => {
    setEstado('enviando')
    setError(null)
    try {
      await apiJasWave().aprobarCodigo(codigo)
      setEstado('ok')
    } catch (e) {
      setEstado('inicial')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-panel p-5">
        <h1 className="text-[15px] font-semibold text-foreground">Activar plugin JasWave</h1>
        {sesion.sinConfigurar ? (
          <Aviso tipo="error">Servidor no configurado en este build.</Aviso>
        ) : sesion.cargando ? (
          <Aviso>Cargando…</Aviso>
        ) : !sesion.session ? (
          <>
            <Aviso>Inicia sesión con la cuenta que tiene la licencia.</Aviso>
            <FormularioLogin />
          </>
        ) : estado === 'ok' ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="size-8 text-accent-emerald" />
            <p className="text-[12px] text-foreground">Equipo activado. Vuelve a tu DAW: el plugin se desbloqueará en unos segundos.</p>
          </div>
        ) : (
          <>
            <Aviso>
              Sesión: <span className="text-foreground">{sesion.session.user.email}</span>
            </Aviso>
            <Campo
              etiqueta="Código que muestra el plugin"
              value={codigo}
              maxLength={9}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="ABCD-EF23"
            />
            {error ? <Aviso tipo="error">{error}</Aviso> : null}
            <Boton primario disabled={estado === 'enviando' || codigo.replace('-', '').length !== 8} onClick={() => void aprobar()}>
              {estado === 'enviando' ? 'Activando…' : 'Aprobar este equipo'}
            </Boton>
          </>
        )}
      </div>
    </main>
  )
}
