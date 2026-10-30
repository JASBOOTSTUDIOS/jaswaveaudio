/**
 * Editor de compás (numerador / denominador) con dos `NumericField`.
 *
 * Se confirma al salir del GRUPO (o con Enter en cualquiera de los dos
 * campos), no al salir del numerador: así se puede pasar con Tab al
 * denominador y escribirlo. Numerador entero 1–32; denominador ∈ {1,2,4,8,16,32}.
 */

import { useRef } from 'react'
import { NumericField, type NumericFieldHandle } from './numeric-field'

export const DENOMINADORES_COMPAS = [1, 2, 4, 8, 16, 32] as const

export type TimeSignatureFieldProps = {
  numerador: number
  denominador: number
  /** Solo se llama si el compás cambió y ambos valores son válidos. */
  onCommit: (numerador: number, denominador: number) => void
  /** Esc, o el grupo se confirmó (haya cambios o no): p. ej. cerrar el editor. */
  onDone?: () => void
  onInvalid?: (mensaje: string) => void
  autoFocus?: boolean
  inputClassName?: string
  className?: string
  separatorClassName?: string
  testIdPrefix?: string
}

export function TimeSignatureField({
  numerador,
  denominador,
  onCommit,
  onDone,
  onInvalid,
  autoFocus,
  inputClassName = '',
  className = 'flex items-center gap-1',
  separatorClassName = 'text-muted-foreground',
  testIdPrefix = 'timesig',
}: TimeSignatureFieldProps) {
  const numRef = useRef<NumericFieldHandle>(null)
  const denRef = useRef<NumericFieldHandle>(null)

  const confirmarGrupo = () => {
    // `commit()` valida el borrador de cada campo; null = inválido (ya revertido).
    const n = numRef.current ? numRef.current.commit() : numerador
    const d = denRef.current ? denRef.current.commit() : denominador
    if (n === null || d === null) return
    if (n !== numerador || d !== denominador) onCommit(n, d)
    onDone?.()
  }

  return (
    <div
      className={className}
      data-testid={`${testIdPrefix}-editor`}
      onBlur={(e) => {
        const destino = e.relatedTarget as Node | null
        if (destino && e.currentTarget.contains(destino)) return
        confirmarGrupo()
      }}
    >
      <NumericField
        ref={numRef}
        value={numerador}
        entero
        min={1}
        max={32}
        recortar={false}
        commitOnBlur={false}
        autoFocus={autoFocus}
        aria-label="Numerador del compás"
        data-testid={`${testIdPrefix}-num`}
        // El grupo decide cuándo confirmar: los campos solo validan.
        onCommit={() => undefined}
        onEnter={confirmarGrupo}
        onCancel={onDone}
        onInvalid={(m) => onInvalid?.(`Numerador del compás: ${m}`)}
        className={inputClassName}
      />
      <span className={separatorClassName}>/</span>
      <NumericField
        ref={denRef}
        value={denominador}
        entero
        permitidos={DENOMINADORES_COMPAS}
        commitOnBlur={false}
        aria-label="Denominador del compás"
        data-testid={`${testIdPrefix}-den`}
        onCommit={() => undefined}
        onEnter={confirmarGrupo}
        onCancel={onDone}
        onInvalid={(m) => onInvalid?.(`Denominador del compás: ${m}`)}
        className={inputClassName}
      />
    </div>
  )
}
