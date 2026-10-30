import { useState, type FormEvent } from 'react'
import { LogIn, Eye, EyeOff } from 'lucide-react'
import { configBackend } from '@/src/lib/backend/config'
import { iniciarConProveedor, iniciarSesion } from '@/src/lib/backend/sesion'
import { Aviso, Boton, Campo } from './ui'

/** Inicio de sesión con correo/contraseña y, si están configurados, Google/GitHub. */
export function FormularioLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proveedores = configBackend().proveedoresOAuth
  // En escritorio el OAuth requiere volver a la app por enlace profundo (jaswave://); en web es directo.
  const esEscritorio = typeof window !== 'undefined' && Boolean(window.electron?.pluginsListar)

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
    <form onSubmit={enviar} className="flex flex-col gap-3" aria-label="Iniciar sesión en JasWave">
      <Campo etiqueta="Correo" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Contraseña</span>
        <div className="relative">
          <input
            type={mostrarPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-panel-raised pl-2.5 pr-8 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
          <button
            type="button"
            onClick={() => setMostrarPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title={mostrarPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
          >
            {mostrarPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </label>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      <Boton primario type="submit" disabled={enviando} className="flex items-center justify-center gap-1.5">
        <LogIn className="size-3.5" />
        {enviando ? 'Entrando…' : 'Iniciar sesión'}
      </Boton>
      {!esEscritorio && proveedores.length > 0 ? (
        <div className="flex gap-2">
          {proveedores.map((p) => (
            <Boton key={p} className="flex-1" onClick={() => void iniciarConProveedor(p).catch((e) => setError(String(e?.message ?? e)))}>
              Continuar con {p === 'google' ? 'Google' : 'GitHub'}
            </Boton>
          ))}
        </div>
      ) : null}
    </form>
  )
}
