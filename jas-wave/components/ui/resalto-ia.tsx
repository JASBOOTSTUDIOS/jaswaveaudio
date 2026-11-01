import type { ReactNode } from 'react'
import { CLASE_RESALTADO_IA, useResaltadoIAAlguno } from '@/src/lib/ia-resaltado'

/** Campos que ilumina cada control del mixer (los nombres que usa la IA en track.update / master.update). */
export const CAMPOS_IA = {
  volumen: ['volumen', 'db'],
  paneo: ['paneo', 'pan'],
  mute: ['mute', 'muted', 'silenciada', 'silenciado'],
  solo: ['solo'],
  fx: ['fx'],
  envios: ['envios'],
} as const

/** Cabecera de pista en el Arrange: brilla cuando la IA graba notas o toca la pista. */
export const CAMPOS_BRILLO_PISTA = ['notas', '*'] as const

/** Brillo superpuesto (no cambia la maquetación): el contenedor debe ser `relative`. */
export function BrilloIA({ trackId, campos }: { trackId: string; campos: readonly string[] }) {
  const activo = useResaltadoIAAlguno(trackId, campos)
  if (!activo) return null
  return <span aria-hidden data-ia-resaltado="si" className={`pointer-events-none absolute inset-0 z-10 rounded-sm ${CLASE_RESALTADO_IA}`} />
}

/** Envoltorio que brilla un momento cuando la IA cambia lo que contiene. */
export function ResaltoIA({
  trackId,
  campos,
  className = '',
  children,
}: {
  trackId: string
  campos: readonly string[]
  className?: string
  children: ReactNode
}) {
  const activo = useResaltadoIAAlguno(trackId, campos)
  return (
    <div
      className={`rounded-md ${className} ${activo ? CLASE_RESALTADO_IA : ''}`}
      data-ia-resaltado={activo ? 'si' : undefined}
      title={activo ? 'La IA acaba de cambiar esto' : undefined}
    >
      {children}
    </div>
  )
}
