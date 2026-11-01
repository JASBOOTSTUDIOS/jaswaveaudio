/**
 * Utilidades de datos de JasWave Admin: carga con protección contra respuestas viejas, avisos
 * (toasts) y formatos de cifras.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'

export const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Carga un recurso y lo recarga a demanda. Si dos recargas se solapan, solo se aplica la respuesta de la
 * última (no se muestran datos viejos).
 */
export function useRecurso<T>(cargar: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const contador = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(cargar, deps)
  const recargar = useCallback(async () => {
    const id = ++contador.current
    setCargando(true)
    try {
      const d = await fn()
      if (id !== contador.current) return
      setDatos(d)
      setError(null)
    } catch (e) {
      if (id === contador.current) setError(mensaje(e))
    } finally {
      if (id === contador.current) setCargando(false)
    }
  }, [fn])
  useEffect(() => {
    void recargar()
  }, [recargar])
  return { datos, error, cargando, recargar, setDatos }
}

// ───────────────────────────── Avisos ─────────────────────────────

type Aviso = { id: number; tipo: 'ok' | 'error'; texto: string }
type Avisar = (tipo: 'ok' | 'error', texto: string) => void
const ContextoAvisos = createContext<Avisar>(() => {})

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const siguiente = useRef(0)
  const avisar = useCallback<Avisar>((tipo, texto) => {
    const id = ++siguiente.current
    setAvisos((a) => [...a.slice(-2), { id, tipo, texto }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 6500 : 3200)
  }, [])
  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:left-auto md:right-6 md:items-end">
        {avisos.map((a) => (
          <div
            key={a.id}
            role={a.tipo === 'error' ? 'alert' : 'status'}
            className={`cy-entrar pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-[13px] shadow-2xl backdrop-blur-md ${
              a.tipo === 'error' ? 'border-cy-alerta/50 bg-[#1a0820]/95 text-[#ffc1ea]' : 'border-cy-cian/40 bg-cy-panel/95 text-cy-texto'
            }`}
          >
            {a.tipo === 'error' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-cy-alerta" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-cy-ok" />}
            <span className="min-w-0 break-words">{a.texto}</span>
          </div>
        ))}
      </div>
    </ContextoAvisos.Provider>
  )
}

export const useAvisos = () => useContext(ContextoAvisos)

/**
 * Ejecuta una operación y avisa del resultado. Devuelve true si salió bien (los errores se muestran como
 * aviso, no se relanzan).
 */
export function useEjecutar() {
  const avisar = useAvisos()
  return useCallback(
    async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
      try {
        await fn()
        if (ok) avisar('ok', ok)
        return true
      } catch (e) {
        avisar('error', mensaje(e))
        return false
      }
    },
    [avisar],
  )
}

// ───────────────────────────── Formatos ─────────────────────────────

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const nfEntero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

export function cifra(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${nf.format(n / 1_000_000)} M`
  if (Math.abs(n) >= 10_000) return `${nf.format(n / 1000)} k`
  return Math.abs(n) >= 100 ? nfEntero.format(n) : nf.format(n)
}

export function milisegundos(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  return ms >= 1000 ? `${nf.format(ms / 1000)} s` : `${nfEntero.format(ms)} ms`
}

export function porcentaje(parte: number, total: number): string {
  if (!total) return '0 %'
  return `${nf.format((parte / total) * 100)} %`
}

export function fechaHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

/** Texto de un cupo: «12 / 100» o «12 / ∞». */
export function cupo(usados: number, limite: number | null): string {
  return `${cifra(usados)} / ${limite == null ? '∞' : cifra(limite)}`
}

/** «1 rol», «3 roles»… */
export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}
