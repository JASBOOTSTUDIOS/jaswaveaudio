/**
 * Detalles técnicos (tipos internos, parámetros, JSON) ocultos para el usuario normal.
 * Solo se muestran con el modo desarrollador activo:
 *   localStorage.setItem('jaswave-modo-desarrollador', '1')
 */
import type { ReactNode } from 'react'

export function modoDesarrollador(): boolean {
  try {
    return globalThis.localStorage?.getItem('jaswave-modo-desarrollador') === '1'
  } catch {
    return false
  }
}

/** Convierte cualquier valor en texto para soporte (nunca lanza). */
export function textoTecnico(v: unknown, max = 1200): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return (s ?? '').slice(0, max)
  } catch {
    return ''
  }
}

/**
 * Devuelve el mensaje solo si es apto para un usuario normal; si parece técnico
 * (JSON, ids, rutas, trazas, nombres internos) devuelve ''.
 */
export function textoLegible(msg: unknown, max = 220): string {
  const t = typeof msg === 'string' ? msg.trim() : ''
  if (!t) return ''
  if (
    /[{}[\]<>]|[0-9a-f]{8}-[0-9a-f]{4}-|\b[a-z]+\.[a-z]+[A-Z]\w*|\b[a-z]+\.[a-z]+\.[a-z]+|[/\\][\w.-]+[/\\]|\bError:|\bat \w+ \(|\w+_\w+|\b(undefined|null|NaN|stack|payload|fetch failed|ECONN\w*|HTTP \d{3})\b/.test(t)
  ) {
    return ''
  }
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** `<details>` cerrado «Detalles técnicos»; no renderiza nada fuera del modo desarrollador. */
export function DetallesTecnicos({ children, className }: { children: ReactNode; className?: string }) {
  if (!modoDesarrollador()) return null
  return (
    <details className={className ?? 'mt-0.5 text-[10px] text-muted-foreground/60'}>
      <summary className="cursor-pointer select-none">Detalles técnicos</summary>
      <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">
        {children}
      </pre>
    </details>
  )
}
