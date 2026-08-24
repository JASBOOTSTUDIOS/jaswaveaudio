import { useDragValue } from '@/hooks/use-drag-value'
import {
  DB_SUPERIOR,
  DB_INFERIOR,
  DB_ESCALA,
  formatearDb,
  dbAPorcentaje,
} from '@/lib/audio-conversions'

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
}: {
  level: number
  className?: string
}) {
  const pct = Math.min(100, Math.max(0, level * 100))
  if (pct < 0.05) return null
  return (
    <div
      className={`pointer-events-none absolute bottom-0 left-1/2 top-0 w-1.5 -translate-x-1/2 rounded-sm ${className}`}
      style={{
        background: METER_LEVEL_GRADIENT,
        clipPath: `inset(${100 - pct}% 0 0 0)`,
      }}
      aria-hidden
    />
  )
}

/** Barra horizontal (entrada / strips compactos). */
export function LevelMeterBarHorizontal({
  level,
  className = '',
}: {
  level: number
  className?: string
}) {
  const pct = Math.min(100, Math.max(0, level * 100))
  if (pct < 0.05) return null
  return (
    <div
      className={`pointer-events-none h-full w-full rounded-sm ${className}`}
      style={{
        background: METER_LEVEL_GRADIENT_H,
        clipPath: `inset(0 ${100 - pct}% 0 0)`,
      }}
      aria-hidden
    />
  )
}

interface FaderProps {
  db: number
  color: string
  onChange: (v: number) => void
  showScale?: boolean
  height?: string
  handleSize?: string
  /** Pico lineal 0..1 para el VU junto al fader. */
  meter?: number
}

export function FaderControl({
  db,
  color,
  onChange,
  showScale = false,
  height = 'h-full',
  handleSize = 'size-4',
  meter,
}: FaderProps) {
  const top = dbAPorcentaje(db)
  const drag = useDragValue({
    value: db,
    min: DB_INFERIOR,
    max: DB_SUPERIOR,
    sensitivity: 0.25,
    onChange,
    resetTo: 0,
  })

  return (
    <div className={`relative flex ${height} flex-1 items-stretch gap-1`}>
      {showScale && (
        <div className="relative w-4 py-1">
          {DB_ESCALA.map((d) => (
            <span
              key={d}
              className="absolute right-0 -translate-y-1/2 text-right text-[8px] leading-none text-muted-foreground"
              style={{ top: `${dbAPorcentaje(d)}%` }}
            >
              {d > 0 ? `+${d}` : d}
            </span>
          ))}
        </div>
      )}
      <div
        role="slider"
        aria-label="Ganancia"
        aria-valuenow={Math.round(db)}
        aria-valuemin={DB_INFERIOR}
        aria-valuemax={DB_SUPERIOR}
        tabIndex={0}
        onPointerDown={drag.onPointerDown}
        onDoubleClick={drag.onDoubleClick}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') onChange(Math.min(DB_SUPERIOR, db + 1))
          if (e.key === 'ArrowDown') onChange(Math.max(DB_INFERIOR, db - 1))
        }}
        className="relative w-4 cursor-ns-resize touch-none focus:outline-none"
      >
        <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rounded-full bg-panel-raised" />
        {typeof meter === 'number' && meter > 0.0005 && <LevelMeterBar level={meter} />}
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
  onChange: (v: number) => void
  size?: string
  formatValue?: (v: number) => string
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
}: KnobProps) {
  const normalized = ((value - min) / (max - min)) * 270 - 135
  const drag = useDragValue({
    value,
    min,
    max,
    sensitivity: 0.8,
    onChange,
    resetTo: min === -100 ? 0 : (min + max) / 2,
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
        onDoubleClick={drag.onDoubleClick}
        onKeyDown={(e) => {
          const step = (max - min) / 100
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(Math.min(max, value + step * 2))
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(Math.max(min, value - step * 2))
        }}
        className={`relative ${size} cursor-pointer touch-none rounded-full bg-panel-raised ring-1 ring-border transition-shadow hover:ring-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber`}
        title={label ? `${label}: ${displayValue}` : displayValue}
      >
        <div
          className="absolute inset-0 flex justify-center"
          style={{ transform: `rotate(${normalized}deg)` }}
        >
          <span className="mt-1 h-3 w-0.5 rounded-full" style={{ backgroundColor: color }} />
        </div>
      </div>
      {label && <span className="text-[9px] text-muted-foreground">{label}</span>}
      <span className="font-mono text-[10px] tabular-nums text-foreground">
        {displayValue}
      </span>
    </div>
  )
}
