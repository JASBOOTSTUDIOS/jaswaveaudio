/**
 * Campo numérico robusto: parsea, recorta al rango, confirma con Enter o al
 * salir (blur) y revierte con Esc o si el texto no es válido (vacío, NaN,
 * fraccionario en un campo entero, valor no permitido), mostrando el motivo.
 *
 * Nunca llama a `onCommit` con NaN, con un campo vacío ni con el mismo valor
 * que ya tiene (evita entradas de undo vacías).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { parsearNumero, type ReglasNumero } from '@/src/lib/numeric-parse'

export type NumericFieldProps = ReglasNumero & {
  value: number
  onCommit: (valor: number) => void
  /** Esc o valor inválido: el campo vuelve a `value`. */
  onCancel?: () => void
  /** Tras confirmar con Enter (p. ej. cerrar el editor). */
  onEnter?: () => void
  /**
   * Texto inválido (se revierte). Útil cuando el editor se cierra y el mensaje
   * junto al campo no llegaría a verse (p. ej. mostrar un toast).
   */
  onInvalid?: (mensaje: string) => void
  /** Confirmar al perder el foco (por defecto true). */
  commitOnBlur?: boolean
  autoFocus?: boolean
  selectOnFocus?: boolean
  /** Muestra el valor con este formato cuando no se está editando. */
  format?: (valor: number) => string
  id?: string
  name?: string
  className?: string
  /** Clases extra cuando hay error. */
  errorClassName?: string
  title?: string
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
  'data-testid'?: string
  /** Paso para las flechas ↑/↓ (opcional). */
  step?: number
}

export type NumericFieldHandle = {
  focus: () => void
  /** Intenta confirmar el borrador; devuelve el valor resultante o null si es inválido. */
  commit: () => number | null
}

const MS_ERROR = 2500

export const NumericField = forwardRef<NumericFieldHandle, NumericFieldProps>(function NumericField(
  {
    value,
    onCommit,
    onCancel,
    onEnter,
    onInvalid,
    commitOnBlur = true,
    autoFocus,
    selectOnFocus = true,
    format,
    min,
    max,
    entero,
    permitidos,
    recortar,
    step,
    id,
    name,
    className = '',
    errorClassName = 'ring-1 ring-destructive',
    title,
    placeholder,
    disabled,
    'aria-label': ariaLabel,
    'data-testid': testId,
  },
  ref,
) {
  const mostrar = (v: number) => (format ? format(v) : String(v))
  const [draft, setDraft] = useState(() => mostrar(value))
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editando = useRef(false)
  /** Evita confirmar dos veces (Enter y luego blur al desmontar). */
  const sucio = useRef(false)
  const timerError = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Si el valor cambia desde fuera (undo, otra vista) y no se está editando, reflejarlo.
  useEffect(() => {
    if (!editando.current) setDraft(mostrar(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => () => {
    if (timerError.current) clearTimeout(timerError.current)
  }, [])

  useEffect(() => {
    if (!autoFocus) return
    inputRef.current?.focus()
    if (selectOnFocus) inputRef.current?.select()
  }, [autoFocus, selectOnFocus])

  const mostrarError = (msg: string) => {
    setError(msg)
    if (timerError.current) clearTimeout(timerError.current)
    timerError.current = setTimeout(() => setError(null), MS_ERROR)
  }

  const revertir = () => {
    setDraft(mostrar(value))
    sucio.current = false
  }

  const confirmar = (): number | null => {
    if (!sucio.current) return value
    const r = parsearNumero(draft, { min, max, entero, permitidos, recortar })
    sucio.current = false
    if (!r.ok) {
      mostrarError(r.error)
      setDraft(mostrar(value))
      onInvalid?.(r.error)
      onCancel?.()

      return null
    }
    setDraft(mostrar(r.valor))
    setError(null)
    if (r.valor !== value) onCommit(r.valor)
    return r.valor
  }

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), commit: confirmar }))

  return (
    <span className="relative inline-flex flex-col">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode={entero ? 'numeric' : 'decimal'}
        value={draft}
        title={error ?? title}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        data-testid={testId}
        className={`${className} ${error ? errorClassName : ''}`}
        onFocus={(e) => {
          editando.current = true
          if (selectOnFocus) e.currentTarget.select()
        }}
        onChange={(e) => {
          sucio.current = true
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onBlur={() => {
          editando.current = false
          if (commitOnBlur) confirmar()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (confirmar() !== null) onEnter?.()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            revertir()
            onCancel?.()
          } else if (step && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            const base = parsearNumero(draft, { min, max, entero, permitidos, recortar })
            const actual = base.ok ? base.valor : value
            const siguiente = actual + (e.key === 'ArrowUp' ? step : -step)
            const r = parsearNumero(String(Math.round(siguiente * 1000) / 1000), { min, max, entero, permitidos, recortar })
            if (r.ok) {
              sucio.current = true
              setDraft(mostrar(r.valor))
            }
          }
        }}
      />
      {error ? (
        <span
          role="alert"
          className="pointer-events-none absolute left-0 top-full z-50 mt-0.5 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
})
