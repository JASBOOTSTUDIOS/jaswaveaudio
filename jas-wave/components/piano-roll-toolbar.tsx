import type { LucideIcon } from 'lucide-react'
import {
  MousePointer2,
  Pencil,
  Eraser,
  Magnet,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Copy,
  Grid3x3,
  Activity,
  Waves,
  Keyboard,
  Layers2,
  Sparkles,
  FileDown,
  FileCode2,
} from 'lucide-react'
import { TIMELINE_SNAP_OPTIONS, snapSelectValue } from '@/src/lib/timeline-snap'

export type PianoRollTool = 'seleccionar' | 'dibujar' | 'borrar'

export type SnapDivision = number

export const SNAP_LABELS: Record<number, string> = Object.fromEntries(
  TIMELINE_SNAP_OPTIONS.map((o) => [o.value, o.label]),
)

export const PIANO_ROLL_ATAJOS: { teclas: string; accion: string }[] = [
  { teclas: 'V', accion: 'Herramienta seleccionar' },
  { teclas: 'D / B', accion: 'Herramienta dibujar' },
  { teclas: 'E / X', accion: 'Herramienta borrar' },
  { teclas: 'S', accion: 'Activar / desactivar imán (snap de notas)' },
  { teclas: '1–8 / 0', accion: 'Profundidad de encaje (compás … 1/128 / Off)' },
  { teclas: 'Magnet', accion: 'Imán del seek/playhead (transporte)' },
  { teclas: 'Supr / Retroceso', accion: 'Eliminar selección' },
  { teclas: 'Clic derecho en nota', accion: 'Borrar nota (o selección si la nota está seleccionada)' },
  { teclas: 'Ctrl+A', accion: 'Seleccionar todas las notas' },
  { teclas: 'Ctrl+D', accion: 'Duplicar selección' },
  { teclas: 'Ctrl+arrastrar nota', accion: 'Duplicar al arrastrar (estilo Reaper); clic sin mover = toggle' },
  { teclas: 'Ctrl+C / Ctrl+V', accion: 'Copiar / pegar notas' },
  { teclas: '↑ / ↓', accion: 'Trasponer ±1 semitono (con selección)' },
  { teclas: 'Shift+↑ / ↓', accion: 'Trasponer ±1 octava' },
  { teclas: '← / →', accion: 'Con selección: mover notas · sin selección: pan temporal' },
  { teclas: 'Alt+← / →', accion: 'Pan ~1 compás (sin selección)' },
  { teclas: 'Shift+← / →', accion: 'Con selección: ±1 negra · sin selección: pan 1 negra' },
  { teclas: 'Q', accion: 'Cuantizar selección (o todo)' },
  { teclas: '—', accion: 'Quitar notas duplicadas (mismo pitch+inicio)' },
  { teclas: 'G', accion: 'Mostrar / ocultar velocidad' },
  { teclas: 'F', accion: 'Mostrar / ocultar expresión (CC)' },
  { teclas: '+ / −', accion: 'Zoom horizontal (anclado al playhead)' },
  { teclas: 'Rueda', accion: 'Zoom horizontal (anclado al playhead)' },
  { teclas: 'Shift + rueda', accion: 'Pan horizontal' },
  { teclas: 'Ctrl + rueda', accion: 'Zoom horizontal (anclado al playhead)' },
  { teclas: 'Ctrl+Shift + rueda', accion: 'Zoom vertical (altura de teclas)' },
  { teclas: 'H', accion: 'Zoom vertical (altura de teclas)' },
  { teclas: '?', accion: 'Mostrar / ocultar atajos' },
  { teclas: 'Regla / arrastrar', accion: 'Seek (playhead); arrastrar línea de tiempo' },
  { teclas: 'Clic vacío', accion: 'Seek (modo seleccionar)' },
  { teclas: 'Alt+arrastrar nota', accion: 'Mover / redimensionar sin imán (preciso)' },
  { teclas: 'Shift+arrastrar', accion: 'Movimiento fino (¼ del imán)' },
  { teclas: 'Bordes de la nota', accion: 'Cambiar duración (inicio / final)' },
  { teclas: 'Carril Velocidad', accion: 'Arrastrar barras = velocity 1–127' },
  { teclas: 'Clic / teclado', accion: 'Audicionar nota en el VST de la pista' },
  { teclas: 'Doble clic', accion: 'Crear nota (modo dibujar o seleccionar)' },
  { teclas: 'Alt+arrastrar vacío', accion: 'Crear nota con duración del arrastre' },
  { teclas: 'Alt+Ctrl+arrastrar vacío', accion: 'Crear nota con duración (mismo gesto que clip en arrange)' },
]

type ToolBtnProps = {
  activo?: boolean
  titulo: string
  atajo?: string
  icon: LucideIcon
  onClick: () => void
  peligro?: boolean
}

function ToolBtn({ activo, titulo, atajo, icon: Icon, onClick, peligro }: ToolBtnProps) {
  return (
    <button
      type="button"
      title={atajo ? `${titulo} (${atajo})` : titulo}
      aria-label={titulo}
      aria-pressed={activo}
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors ${
        activo
          ? 'bg-accent-amber/20 text-accent-amber'
          : peligro
            ? 'text-muted-foreground hover:bg-destructive/15 hover:text-destructive'
            : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="hidden sm:inline">{titulo}</span>
    </button>
  )
}

export function PianoRollToolbar({
  herramienta,
  onHerramienta,
  snapOn,
  onSnapToggle,
  snapValor,
  snapDiv,
  onSnapDiv,
  onZoomIn,
  onZoomOut,
  onZoomVertical,
  showVelocity,
  onToggleVelocity,
  showExpression,
  onToggleExpression,
  onQuantize,
  quantizeMode,
  onQuantizeMode,
  quantizeStrength,
  onQuantizeStrength,
  onDuplicate,
  onDelete,
  onDedupe,
  onTranspose,
  onNudge,
  onVelocitySet,
  onVelocityScale,
  showShortcuts,
  onToggleShortcuts,
  grooves,
  onGroove,
  notasCount,
  seleccionCount,
  duplicadosCount,
  dirty,
  nombreClip,
  onSaveStyle,
  onExportScorePdf,
  onOpenMidiMd,
}: {
  herramienta: PianoRollTool
  onHerramienta: (t: PianoRollTool) => void
  snapOn: boolean
  onSnapToggle: () => void
  /** Valor crudo del toolbar (SNAP_BAR / 0 / beats). */
  snapValor: number
  /** División resuelta en beats (para nudge / cuantizar). */
  snapDiv: number
  onSnapDiv: (d: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomVertical: () => void
  showVelocity: boolean
  onToggleVelocity: () => void
  showExpression: boolean
  onToggleExpression: () => void
  onQuantize: () => void
  quantizeMode?: 'start' | 'end' | 'both'
  onQuantizeMode?: (m: 'start' | 'end' | 'both') => void
  quantizeStrength?: number
  onQuantizeStrength?: (s: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onDedupe?: () => void
  onTranspose: (semi: number) => void
  onNudge: (beats: number) => void
  onVelocitySet?: (v: number) => void
  onVelocityScale?: (factor: number) => void
  showShortcuts: boolean
  onToggleShortcuts: () => void
  grooves: { id: string; nombre: string }[]
  onGroove: (id: string) => void
  notasCount: number
  seleccionCount: number
  duplicadosCount?: number
  dirty: boolean
  nombreClip: string
  onSaveStyle?: () => void
  onExportScorePdf?: () => void
  onOpenMidiMd?: () => void
}) {
  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      <div className="flex h-8 items-center gap-2 border-b border-border/60 px-2">
        <span className="truncate text-[12px] font-semibold text-foreground">{nombreClip}</span>
        <span className="text-[10px] text-muted-foreground">
          {notasCount} notas
          {seleccionCount > 0 ? ` · ${seleccionCount} seleccionadas` : ''}
          {duplicadosCount && duplicadosCount > 0 ? ` · ${duplicadosCount} duplicadas` : ''}
          {dirty ? ' · guardando…' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1">
        <div className="mr-1 flex items-center gap-0.5 rounded-md bg-panel-raised/80 p-0.5">
          <ToolBtn
            activo={herramienta === 'seleccionar'}
            titulo="Seleccionar"
            atajo="V"
            icon={MousePointer2}
            onClick={() => onHerramienta('seleccionar')}
          />
          <ToolBtn
            activo={herramienta === 'dibujar'}
            titulo="Dibujar"
            atajo="D"
            icon={Pencil}
            onClick={() => onHerramienta('dibujar')}
          />
          <ToolBtn
            activo={herramienta === 'borrar'}
            titulo="Borrar"
            atajo="E"
            icon={Eraser}
            onClick={() => onHerramienta('borrar')}
          />
        </div>

        <div className="mx-0.5 h-5 w-px bg-border" />

        <ToolBtn
          activo={snapOn}
          titulo="Imán"
          atajo="S"
          icon={Magnet}
          onClick={onSnapToggle}
        />
        <select
          value={snapSelectValue(snapOn, snapValor)}
          onChange={(e) => onSnapDiv(Number(e.target.value))}
          className="h-6 max-w-[160px] rounded border border-border bg-background px-1 text-[10px] text-foreground"
          title="Profundidad de encaje (misma que arrange / playhead)"
          aria-label="Profundidad de encaje"
        >
          {TIMELINE_SNAP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="mx-0.5 h-5 w-px bg-border" />

        <ToolBtn titulo="Cuantizar" atajo="Q" icon={Grid3x3} onClick={onQuantize} />
        {onQuantizeMode && (
          <select
            value={quantizeMode ?? 'start'}
            onChange={(e) => onQuantizeMode(e.target.value as 'start' | 'end' | 'both')}
            className="h-6 rounded border border-border bg-background px-1 text-[10px]"
            title="Modo cuantización"
            aria-label="Modo cuantización"
          >
            <option value="start">Inicio</option>
            <option value="end">Fin</option>
            <option value="both">Ambos</option>
          </select>
        )}
        {onQuantizeStrength && (
          <select
            value={quantizeStrength ?? 1}
            onChange={(e) => onQuantizeStrength(Number(e.target.value))}
            className="h-6 rounded border border-border bg-background px-1 text-[10px]"
            title="Fuerza cuantización"
            aria-label="Fuerza cuantización"
          >
            <option value={1}>100%</option>
            <option value={0.75}>75%</option>
            <option value={0.5}>50%</option>
            <option value={0.25}>25%</option>
          </select>
        )}
        <ToolBtn titulo="Duplicar" atajo="Ctrl+D" icon={Copy} onClick={onDuplicate} />
        {onDedupe && (
          <ToolBtn
            titulo={
              duplicadosCount && duplicadosCount > 0
                ? `Quitar duplicados (${duplicadosCount})`
                : 'Quitar duplicados'
            }
            icon={Layers2}
            onClick={onDedupe}
          />
        )}
        <ToolBtn titulo="Eliminar" atajo="Supr" icon={Trash2} onClick={onDelete} peligro />

        {onVelocitySet && (
          <>
            <div className="mx-0.5 h-5 w-px bg-border" />
            <button
              type="button"
              className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-panel-raised"
              title="Velocidad fija 100"
              onClick={() => onVelocitySet(100)}
            >
              Vel 100
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-panel-raised"
              title="Escalar velocity ×0.85"
              onClick={() => onVelocityScale?.(0.85)}
            >
              Vel −
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-panel-raised"
              title="Escalar velocity ×1.15"
              onClick={() => onVelocityScale?.(1.15)}
            >
              Vel +
            </button>
          </>
        )}

        <div className="mx-0.5 h-5 w-px bg-border" />

        <ToolBtn titulo="Semitono +" atajo="↑" icon={ArrowUp} onClick={() => onTranspose(1)} />
        <ToolBtn titulo="Semitono −" atajo="↓" icon={ArrowDown} onClick={() => onTranspose(-1)} />
        <ToolBtn titulo="Mover ←" atajo="←" icon={ArrowLeft} onClick={() => onNudge(-snapDiv)} />
        <ToolBtn titulo="Mover →" atajo="→" icon={ArrowRight} onClick={() => onNudge(snapDiv)} />

        <div className="mx-0.5 h-5 w-px bg-border" />

        <ToolBtn titulo="Alejar" atajo="−" icon={ZoomOut} onClick={onZoomOut} />
        <ToolBtn titulo="Acercar" atajo="+" icon={ZoomIn} onClick={onZoomIn} />
        <button
          type="button"
          title="Zoom vertical (H)"
          onClick={onZoomVertical}
          className="rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-panel-raised hover:text-foreground"
        >
          Altura
        </button>

        <div className="mx-0.5 h-5 w-px bg-border" />

        <ToolBtn
          activo={showVelocity}
          titulo="Velocidad"
          atajo="G"
          icon={Activity}
          onClick={onToggleVelocity}
        />
        <ToolBtn
          activo={showExpression}
          titulo="Expresión"
          atajo="F"
          icon={Waves}
          onClick={onToggleExpression}
        />

        {onSaveStyle ? (
          <>
            <div className="mx-0.5 h-5 w-px bg-border" />
            <ToolBtn titulo="Guardar como estilo" icon={Sparkles} onClick={onSaveStyle} />
          </>
        ) : null}
        {onExportScorePdf ? (
          <ToolBtn titulo="Vista previa / exportar partitura PDF" icon={FileDown} onClick={onExportScorePdf} />
        ) : null}
        {onOpenMidiMd ? (
          <ToolBtn titulo="Abrir MIDI · MD (sync en vivo)" icon={FileCode2} onClick={onOpenMidiMd} />
        ) : null}

        <select
          className="h-6 max-w-[140px] rounded border border-border bg-background px-1 text-[10px]"
          defaultValue=""
          title="Aplicar groove a la selección o a todo"
          aria-label="Aplicar groove"
          onChange={(e) => {
            const id = e.target.value
            if (id) onGroove(id)
            e.target.value = ''
          }}
        >
          <option value="">Groove…</option>
          {grooves.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
        </select>

        <div className="ml-auto">
          <ToolBtn
            activo={showShortcuts}
            titulo="Atajos"
            atajo="?"
            icon={Keyboard}
            onClick={onToggleShortcuts}
          />
        </div>
      </div>

      {showShortcuts && (
        <div className="max-h-40 overflow-y-auto border-t border-border bg-panel-raised/50 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Atajos del piano roll
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {PIANO_ROLL_ATAJOS.map((a) => (
              <div key={a.teclas} className="flex justify-between gap-2 text-[10px]">
                <kbd className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-foreground ring-1 ring-border">
                  {a.teclas}
                </kbd>
                <span className="text-right text-muted-foreground">{a.accion}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
