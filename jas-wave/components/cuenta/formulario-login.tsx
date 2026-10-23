import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { configBackend } from '@/src/lib/backend/config'
import { iniciarConProveedor, iniciarSesion } from '@/src/lib/backend/sesion'
import { Aviso, Boton, Campo } from './ui'

/** Inicio de sesión con correo/contraseña y, si están configurados, Google/GitHub. */
export function FormularioLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      <Campo
        etiqueta="Contraseña"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
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
