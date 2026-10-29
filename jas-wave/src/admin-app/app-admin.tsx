/**
 * JasWave Admin: app independiente del DAW (admin.html). Reutiliza la sesión de Supabase del DAW
 * (mismo origen ⇒ misma sesión guardada) y el backend vuelve a validar que el usuario es administrador
 * en cada petición.
 */

import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, LogIn, LogOut, ShieldAlert } from 'lucide-react'
import { JASWAVE_APP_ICON_SRC } from '@/components/brand'
import { cerrarSesion, iniciarSesion, useSesion } from '@/src/lib/backend/sesion'
import { ProveedorAvisos } from './datos'
import { useRuta, type IdSeccion } from './navegacion'
import { MarcoAdmin } from './shell'
import { Boton, Cargando, Campo, MensajeError } from './ui'
import { SeccionResumen } from './secciones/resumen'
import { SeccionUsuarios } from './secciones/usuarios'
import { SeccionModelos } from './secciones/ia-modelos'
import { SeccionPlanes } from './secciones/ia-planes'
import { SeccionConexiones } from './secciones/ia-conexiones'
import { SeccionConsumo } from './secciones/consumo'
import { SeccionPlugins } from './secciones/plugins'
import { SeccionAuditoria } from './secciones/auditoria'

function Contenido({ seccion, onIr }: { seccion: IdSeccion; onIr: (s: IdSeccion) => void }) {
  switch (seccion) {
    case 'usuarios':
      return <SeccionUsuarios />
    case 'ia-modelos':
    case 'ia-planes':
    case 'ia-conexiones':
      return seccion === 'ia-modelos' ? <SeccionModelos onIr={onIr} /> : seccion === 'ia-planes' ? <SeccionPlanes onIr={onIr} /> : <SeccionConexiones onIr={onIr} />
    case 'consumo':
      return <SeccionConsumo />
    case 'plugins':
      return <SeccionPlugins />
    case 'auditoria':
      return <SeccionAuditoria />
    default:
      return <SeccionResumen onIr={onIr} />
  }
}

function PantallaCentrada({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cy-violeta/12 blur-[130px]" />
        <div className="absolute bottom-0 right-0 size-[420px] rounded-full bg-cy-cian/[0.07] blur-[120px]" />
      </div>
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl border border-cy-cian/40 bg-cy-negro shadow-[0_0_24px_rgba(25,217,255,0.3)]">
            <img src={JASWAVE_APP_ICON_SRC} alt="" className="size-9 object-contain" draggable={false} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold uppercase tracking-[0.25em] text-cy-texto">
              Jas<span className="cy-marca">Wave</span>
            </h1>
            <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-cy-cian/80">Admin</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function InicioSesion() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      await iniciarSesion(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <PantallaCentrada>
      <form onSubmit={(e) => void enviar(e)} className="cy-panel cy-panel-activo flex flex-col gap-4 p-6">
        <div>
          <p className="cy-rotulo">Acceso de administración</p>
          <p className="mt-1 text-[13px] text-cy-tenue">Inicia sesión con tu cuenta de JasWave.</p>
        </div>
        <Campo etiqueta="Correo" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="relative">
          <Campo etiqueta="Contraseña" type={ver ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute bottom-0 right-0 grid size-11 place-items-center text-cy-apagado hover:text-cy-cian md:size-9"
          >
            {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {error ? <MensajeError>{error}</MensajeError> : null}
        <Boton type="submit" variante="primario" cargando={enviando} icono={<LogIn className="size-4" />} className="w-full">
          Entrar
        </Boton>
      </form>
    </PantallaCentrada>
  )
}

function Panel({ email }: { email: string }) {
  const [seccion, ir] = useRuta()
  return (
    <ProveedorAvisos>
      <MarcoAdmin seccion={seccion} onIr={ir} email={email} onSalir={() => void cerrarSesion()}>
        <div key={seccion} className="cy-entrar">
          <Contenido seccion={seccion} onIr={ir} />
        </div>
      </MarcoAdmin>
    </ProveedorAvisos>
  )
}

export function AppAdmin() {
  const sesion = useSesion()
  if (sesion.sinConfigurar) {
    return (
      <PantallaCentrada>
        <div className="cy-panel p-6 text-center text-[13px] text-cy-tenue">Este build no tiene configurado el servidor de JasWave (VITE_API_URL / VITE_SUPABASE_*).</div>
      </PantallaCentrada>
    )
  }
  if (sesion.cargando) {
    return (
      <PantallaCentrada>
        <div className="flex justify-center">
          <Cargando texto="Comprobando sesión…" />
        </div>
      </PantallaCentrada>
    )
  }
  if (!sesion.session) return <InicioSesion />
  if (!sesion.identidad?.esAdmin) {
    return (
      <PantallaCentrada>
        <div className="cy-panel flex flex-col items-center gap-3 p-6 text-center">
          <span className="grid size-12 place-items-center rounded-full border border-cy-alerta/40 bg-cy-alerta/10">
            <ShieldAlert className="size-6 text-cy-alerta" />
          </span>
          <p className="cy-rotulo text-cy-texto">Acceso solo para administradores</p>
          <p className="text-[13px] text-cy-tenue">
            {sesion.error ? `No se pudo comprobar tu cuenta: ${sesion.error}` : `La cuenta ${sesion.session.user.email ?? ''} no tiene permisos de administración.`}
          </p>
          <Boton icono={<LogOut className="size-4" />} onClick={() => void cerrarSesion()}>
            Cambiar de cuenta
          </Boton>
        </div>
      </PantallaCentrada>
    )
  }
  return <Panel email={sesion.identidad.email || sesion.session.user.email || ''} />
}
