import {
  Pencil,
  MousePointer2,
  Move,
  Scissors,
  Repeat2,
  Activity,
  Grid3x3,
  Minus,
  Plus,
  BookOpen,
  Trash2,
} from 'lucide-react'
import { useRef, useCallback } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { HerramientaActiva } from '../../shared/src/types/ui'
import { TIMELINE_SNAP_OPTIONS, snapSelectValue, SNAP_BAR } from '@/src/lib/timeline-snap'

const TOOLS: { id: HerramientaActiva | 'loop'; icon: typeof Pencil; label: string; action?: 'loop' }[] = [
  { id: 'select', icon: MousePointer2, label: 'Seleccionar (N)' },
  { id: 'move', icon: Move, label: 'Mover (M)' },
  { id: 'pencil', icon: Pencil, label: 'Dibujar (B)' },
  { id: 'split', icon: Scissors, label: 'Cortar / Split (S)' },
  { id: 'eraser', icon: Trash2, label: 'Borrador (Del)' },
  { id: 'loop', icon: Repeat2, label: 'Alternar bucle (L)', action: 'loop' },
]

function MiniSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange?: (v: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))

  const commitFromX = useCallback((clientX: number) => {
    if (!trackRef.current || !onChange) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = min + ratio * (max - min)
    const snapped = Math.round(raw / step) * step
    onChange(Math.max(min, Math.min(max, snapped)))
  }, [min, max, step, onChange])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    commitFromX(e.clientX)
    const onMove = (ev: PointerEvent) => { if (dragging.current) commitFromX(ev.clientX) }
    const onUp = () => { dragging.current = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [commitFromX])

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Reducir"
        onClick={() => onChange?.(Math.max(min, value - step))}
        className="text-muted-foreground hover:text-foreground"
      >
        <Minus className="size-3.5" />
      </button>
      <div
        ref={trackRef}
        className="relative h-1 w-24 cursor-pointer rounded-full bg-panel-raised"
        onPointerDown={handlePointerDown}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground" style={{ width: `${percent}%` }} />
        <div
          className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-foreground shadow-sm"
          style={{ left: `calc(${percent}% - 5px)` }}
        />
      </div>
      <button
        type="button"
        aria-label="Aumentar"
        onClick={() => onChange?.(Math.min(max, value + step))}
        className="text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

/** Convierte zoom logarítmico 0.15–256 ↔ slider 0–100 */
const ZOOM_MIN = 0.15
const ZOOM_MAX = 256
const ZOOM_V_MIN = 0.5
const ZOOM_V_MAX = 3

function zoomToSlider(z: number) {
  const t = Math.log(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)
  return Math.round(t * 100)
}
function sliderToZoom(v: number) {
  const t = Math.max(0, Math.min(100, v)) / 100
  return ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t)
}
function verticalToSlider(z: number) {
  return Math.round(((Math.max(ZOOM_V_MIN, Math.min(ZOOM_V_MAX, z)) - ZOOM_V_MIN) / (ZOOM_V_MAX - ZOOM_V_MIN)) * 100)
}
function sliderToVertical(v: number) {
  return ZOOM_V_MIN + (Math.max(0, Math.min(100, v)) / 100) * (ZOOM_V_MAX - ZOOM_V_MIN)
}

export function EditToolbar() {
  const tienda = useDAW()
  const activeTool = useDAWState((s) => s.ui?.herramientaActiva || 'select')
  const snapValor = useDAWState((s) => s.project?.timeline?.snapValor ?? 1)
  const snapEnabled = useDAWState((s) => s.project?.timeline?.snap ?? true)
  const zoomH = useDAWState((s) => s.ui?.zoomHorizontal ?? 1)
  const zoomV = useDAWState((s) => s.ui?.zoomVertical ?? 1)
  const loopOn = useDAWState((s) => Boolean(s.transport?.loop?.activo))

  const handleToolChange = (tool: (typeof TOOLS)[number]) => {
    if (tool.action === 'loop') {
      void tienda.executor.execute('transport.toggleLoop', {})
      return
    }
    void tienda.executor.execute('ui.setTool', { herramienta: tool.id })
  }

  const handleSnapChange = (val: number) => {
    void tienda.executor.execute('timeline.setSnap', {
      snap: val === SNAP_BAR || val > 0,
      snapValor: val,
    })
  }

  return (
    <div className="flex h-11 items-center gap-4 border-b border-border bg-panel px-4">
      <div className="ml-0 flex items-center gap-0.5">
        {TOOLS.map((tool) => {
          const { id, icon: Icon, label } = tool
          const pressed = tool.action === 'loop' ? loopOn : activeTool === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleToolChange(tool)}
              title={label}
              aria-label={label}
              aria-pressed={pressed}
              className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                pressed
                  ? 'bg-accent-amber text-background font-bold shadow-sm'
                  : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
            </button>
          )
        })}
      </div>

      <div
        className="ml-auto flex items-center gap-1.5 rounded-md bg-panel-raised px-2 py-1 text-[12px] text-foreground ring-1 ring-border"
        title="Profundidad de encaje: playhead (línea amarilla) y edición en timelines"
      >
        <Grid3x3 className="size-3.5 text-accent-amber" />
        <select
          value={snapSelectValue(snapEnabled, snapValor)}
          onChange={(e) => handleSnapChange(Number(e.target.value))}
          className="cursor-pointer bg-transparent font-medium text-foreground outline-none"
          aria-label="Profundidad de encaje de la línea de tiempo"
        >
          {TIMELINE_SNAP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-panel text-foreground">
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 border-l border-border pl-4" title="Zoom vertical (Ctrl+rueda sobre el arrange)">
        <Activity className="size-4 text-muted-foreground" />
        <MiniSlider
          value={verticalToSlider(zoomV)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => void tienda.executor.execute('ui.setZoom', { vertical: sliderToVertical(v) })}
        />
      </div>

      <div
        className="flex items-center gap-2 border-l border-border pl-4"
        title="Zoom horizontal (rueda sobre los clips)"
      >
        <BookOpen className="size-4 text-muted-foreground" />
        <MiniSlider
          value={zoomToSlider(zoomH)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => {
            const next = sliderToZoom(v)
            window.dispatchEvent(
              new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: next } }),
            )
          }}
        />
        <span className="w-10 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
          {zoomH >= 10 ? zoomH.toFixed(0) : zoomH.toFixed(1)}×
        </span>
      </div>
    </div>
  )
}
