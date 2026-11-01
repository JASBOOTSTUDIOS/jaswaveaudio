import { useCallback, useRef, useState } from 'react'
import { useDragValue } from '@/hooks/use-drag-value'
import {
  DB_SUPERIOR,
  DB_INFERIOR,
  DB_ESCALA,
  dbAPorcentaje,
  formatearDb,
  linealADb,
} from '@/lib/audio-conversions'
import { picoAPorcentajeVu, UMBRAL_CLIP } from '@/lib/meter-scale'

/**
 * VU tipo DAW: verde (seguro) → amarillo (caliente) → rojo (cerca de 0 dBFS).
 * El degradado está anclado a la altura completa del fader; se recorta por nivel.
 */
const METER_LEVEL_GRADIENT =
  'linear-gradient(to top, #16a34a 0%, #22c55e 55%, #eab308 78%, #ef4444 92%, #dc2626 100%)'

const METER_LEVEL_GRADIENT_H =
  'linear-gradient(to right, #16a34a 0%, #22c55e 55%, #eab308 78%, #ef4444 92%, #dc2626 100%)'

/** Barra de nivel vertical (faders). `level` lineal 0..1. */
export function LevelMeterBar({
  level,
  className = '',
  /** Si true, muestra el riel aunque el nivel sea 0. */
  alwaysShowRail = false,
}: {
  level: number
  className?: string
  alwaysShowRail?: boolean
}) {
  const pct = Math.min(100, Math.max(0, level * 100))
  if (!alwaysShowRail && pct < 0.05) return null
  return (
    <div
      className={`pointer-events-none absolute bottom-0 left-1/2 top-0 w-1.5 -translate-x-1/2 rounded-sm bg-panel-raised/80 ${className}`}
      aria-hidden
    >
      {pct >= 0.05 ? (
        <div
          className="absolute inset-0 rounded-sm"
          style={{
            background: METER_LEVEL_GRADIENT,
            clipPath: `inset(${100 - pct}% 0 0 0)`,
          }}
        />
      ) : null}
    </div>
  )
}

/** Barra horizontal (entrada / strips compactos). */
export function LevelMeterBarHorizontal({
  level,
  className = '',
  alwaysShowRail = false,
}: {
  level: number
  className?: string
  alwaysShowRail?: boolean
}) {
  const pct = Math.min(100, Math.max(0, level * 100))
  if (!alwaysShowRail && pct < 0.05) return null
  return (
    <div
      className={`pointer-events-none h-full w-full rounded-sm bg-panel-raised/80 ${className}`}
      aria-hidden
    >
      {pct >= 0.05 ? (
        <div
          className="h-full w-full rounded-sm"
          style={{
            background: METER_LEVEL_GRADIENT_H,
            clipPath: `inset(0 ${100 - pct}% 0 0)`,
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Degradado del VU en escala de dB (misma escala que el fader, +12…−60): verde hasta −12 dB, amarillo hasta
 * −3 dB, naranja hasta 0 dBFS y rojo por encima. Los cortes están en % desde abajo de `dbAPorcentaje`.
 */
const METER_DB_GRADIENT =
  'linear-gradient(to top, #16a34a 0%, #22c55e 62%, #eab308 70%, #f97316 79%, #ef4444 83.3%, #dc2626 100%)'

/**
 * Retiene el pico máximo L/R desde el último reset (lineal). `clip` queda encendido hasta que se resetea.
 * Se alimenta con los picos de cada fotograma del medidor: quien lo usa ya se re-renderiza en cada lectura,
 * así que basta un ref (actualizar al máximo es idempotente aunque React repita el render).
 */
export function usePeakHold(l: number, r: number) {
  const ref = useRef(0)
  const [, forzar] = useState(0)
  const actual = Math.max(l || 0, r || 0)
  if (actual > ref.current) ref.current = actual
  const reset = useCallback(() => {
    ref.current = 0
    forzar((n) => n + 1)
  }, [])
  return { pico: ref.current, clip: ref.current >= UMBRAL_CLIP, reset }
}

/** VU estéreo: dos barras L/R con escala en dB (picos lineales 0..1, sin curva). */
export function StereoVuMeter({ l, r, className = '' }: { l: number; r: number; className?: string }) {
  return (
    <div className={`pointer-events-none flex h-full gap-px ${className}`} aria-hidden>
      {[l, r].map((p, i) => {
        const pct = picoAPorcentajeVu(p)
        return (
          <div key={i} className="relative h-full w-[3px] rounded-[1px] bg-panel-raised/80">
            {pct > 0.05 ? (
              <div
                className="absolute inset-0 rounded-[1px]"
                style={{ background: METER_DB_GRADIENT, clipPath: `inset(${100 - pct}% 0 0 0)` }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** Insignia de pico retenido (dBFS); roja si hubo clip. Clic = reset del pico. */
export function PeakBadge({ pico, clip, onReset }: { pico: number; clip: boolean; onReset: () => void }) {
  const db = pico > 0 ? linealADb(pico) : DB_INFERIOR
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onReset()
      }}
      title={clip ? 'Clip: el pico llegó a 0 dBFS · clic para resetear' : 'Pico máximo · clic para resetear'}
      aria-label={clip ? 'Clip, resetear pico' : 'Resetear pico'}
      className={`h-4 w-9 shrink-0 rounded-sm px-0.5 text-center font-mono text-[9px] leading-4 tabular-nums ${
        clip
          ? 'bg-red-600 font-bold text-white'
          : 'bg-panel-raised text-muted-foreground ring-1 ring-border hover:text-foreground'
      }`}
    >
      {clip ? 'CLIP' : formatearDb(db)}
    </button>
  )
}

/** Alto del recorrido del fader del mixer y del inspector (px): idéntico en todas las tiras y el master. */
export const FADER_ALTO_PX = 160

interface FaderProps {
  db: number
  color: string
  /** `gestureId` agrupa un arrastre (o flechas seguidas) en una sola entrada de undo. */
  onChange: (v: number, gestureId?: string) => void
  showScale?: boolean
  height?: string
  handleSize?: string
  /** Pico lineal 0..1 para el VU junto al fader. */
  meter?: number
  /** Picos L/R lineales (0..1): VU estéreo en escala de dB junto al fader (sustituye a `meter`). */
  stereo?: { l: number; r: number }
  /** Valor al que vuelve con doble clic o clic central (por defecto 0 dB). */
  defaultValue?: number
}

export function FaderControl({
  db,
  color,
  onChange,
  showScale = false,
  height = 'h-full',
  handleSize = 'size-4',
  meter,
  stereo,
  defaultValue = 0,
}: FaderProps) {
  const top = dbAPorcentaje(db)
  const drag = useDragValue({
    value: db,
    min: DB_INFERIOR,
    max: DB_SUPERIOR,
    sensitivity: 0.25,
    onChange,
    resetTo: defaultValue,
  })

  return (
    <div className={`relative flex ${height} flex-1 items-stretch gap-1`}>
      {showScale && (
        // Sin padding vertical: las marcas caen en el mismo % que el VU y el centro del tirador.
        <div className="relative w-4">
          {DB_ESCALA.map((d) => (
            <span
              key={d}
              className={`absolute right-0 -translate-y-1/2 text-right font-mono text-[8px] leading-none tabular-nums ${
                d === 0 ? 'text-foreground' : 'text-muted-foreground'
              }`}
              style={{ top: `${dbAPorcentaje(d)}%` }}
            >
              {d > 0 ? `+${d}` : d}
            </span>
          ))}
        </div>
      )}
      {stereo ? <StereoVuMeter l={stereo.l} r={stereo.r} /> : null}
      <div
        role="slider"
        aria-label="Ganancia"
        aria-valuenow={Math.round(db)}
        aria-valuemin={DB_INFERIOR}
        aria-valuemax={DB_SUPERIOR}
        tabIndex={0}
        onPointerDown={drag.onPointerDown}
        onMouseDown={drag.onMouseDown}
        onDoubleClick={drag.onDoubleClick}
        onAuxClick={drag.onAuxClick}
        ref={drag.wheelRef}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') drag.onKeyStep(db + 1)
          if (e.key === 'ArrowDown') drag.onKeyStep(db - 1)
        }}
        className="relative w-4 cursor-ns-resize touch-none focus:outline-none"
      >
        <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rounded-full bg-panel-raised" />
        {!stereo && typeof meter === 'number' && (
          <LevelMeterBar level={meter} alwaysShowRail />
        )}
        <div
          className="absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full"
          style={{ top: `calc(${top}% - 8px)`, bottom: 0, backgroundColor: color, opacity: 0.6 }}
        />
        <div
          className={`absolute left-1/2 ${handleSize} -translate-x-1/2 rounded-sm bg-foreground shadow-md ring-1 ring-border transition-transform hover:scale-110 active:scale-105`}
          style={{ top: `calc(${top}% - 8px)` }}
        >
          <span className="absolute left-1/2 top-1/2 h-px w-2.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground" />
        </div>
      </div>
    </div>
  )
}

interface KnobProps {
  value: number
  min?: number
  max?: number
  label?: string
  color: string
  /** `gestureId` agrupa un arrastre (o flechas seguidas) en una sola entrada de undo. */
  onChange: (v: number, gestureId?: string) => void
  size?: string
  formatValue?: (v: number) => string
  /** Valor al que vuelve con doble clic o clic central; sin él, 0 si está en el rango o el centro. */
  defaultValue?: number
}

export function KnobControl({
  value,
  min = -100,
  max = 100,
  label,
  color,
  onChange,
  size = 'size-10',
  formatValue,
  defaultValue,
}: KnobProps) {
  const normalized = ((value - min) / (max - min)) * 270 - 135
  const drag = useDragValue({
    value,
    min,
    max,
    sensitivity: 0.8,
    onChange,
    resetTo: defaultValue ?? (min <= 0 && max >= 0 ? 0 : (min + max) / 2),
  })

  const displayValue = formatValue
    ? formatValue(value)
    : Math.round(value) > 0
      ? `+${Math.round(value)}`
      : String(Math.round(value))

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        role="slider"
        aria-label={label ?? 'Control'}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={drag.onPointerDown}
        onMouseDown={drag.onMouseDown}
        onDoubleClick={drag.onDoubleClick}
        onAuxClick={drag.onAuxClick}
        ref={drag.wheelRef}
        onKeyDown={(e) => {
          const step = (max - min) / 100
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') drag.onKeyStep(value + step * 2)
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') drag.onKeyStep(value - step * 2)

        }}
        className={`relative ${size} cursor-pointer touch-none rounded-full bg-panel-raised ring-1 ring-border transition-shadow hover:ring-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber`}
        title={`${label ? `${label}: ${displayValue}` : displayValue} · doble clic o clic central: valor inicial`}
      >
        <div
          className="absolute inset-0 flex justify-center"
          style={{ transform: `rotate(${normalized}deg)` }}
        >
          <span className="mt-1 h-3 w-0.5 rounded-full" style={{ backgroundColor: color }} />
        </div>
      </div>
      {label && <span className="text-[9px] text-muted-foreground">{label}</span>}
      {/* Caja de ancho y alto reservados: el valor no hace saltar la tira al cambiar de dígitos. */}
      <span className="inline-block h-3.5 min-w-[4ch] text-center font-mono text-[10px] leading-3.5 tabular-nums text-foreground">
        {displayValue}
      </span>
    </div>
  )
}
