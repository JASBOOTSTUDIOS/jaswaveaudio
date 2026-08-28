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
} from 'lucide-react'
export type PianoRollTool = 'seleccionar' | 'dibujar' | 'borrar'

export type SnapDivision = 1 | 0.5 | 0.25 | 0.125 | 0.0625

const SNAP_LABELS: Record<number, string> = {
  1: 'Negra (1/4)',
  0.5: 'Corchea (1/8)',
  0.25: 'Semicorchea (1/16)',
  0.125: 'Fusa (1/32)',
  0.0625: 'Semifusa (1/64)',
}

export const PIANO_ROLL_ATAJOS: { teclas: string; accion: string }[] = [
  { teclas: 'V', accion: 'Herramienta seleccionar' },
  { teclas: 'D / B', accion: 'Herramienta dibujar' },
  { teclas: 'E / X', accion: 'Herramienta borrar' },
  { teclas: 'S', accion: 'Activar / desactivar imán (snap)' },
  { teclas: '1–5', accion: 'División del imán (1/4 … 1/64)' },
  { teclas: 'Supr / Retroceso', accion: 'Eliminar selección' },
  { teclas: 'Ctrl+A', accion: 'Seleccionar todas las notas' },
  { teclas: 'Ctrl+D', accion: 'Duplicar selección' },
  { teclas: 'Ctrl+C / Ctrl+V', accion: 'Copiar / pegar notas' },
  { teclas: '↑ / ↓', accion: 'Trasponer ±1 semitono' },
  { teclas: 'Shift+↑ / ↓', accion: 'Trasponer ±1 octava' },
  { teclas: '← / →', accion: 'Mover ±1 división de imán' },
  { teclas: 'Shift+← / →', accion: 'Mover ±1 negra' },
  { teclas: 'Q', accion: 'Cuantizar selección (o todo)' },
  { teclas: 'G', accion: 'Mostrar / ocultar velocidad' },
  { teclas: 'F', accion: 'Mostrar / ocultar expresión (CC)' },
  { teclas: '+ / −', accion: 'Zoom horizontal' },
  { teclas: 'Ctrl + rueda', accion: 'Zoom horizontal (hacia el cursor)' },
  { teclas: 'Ctrl+Shift + rueda', accion: 'Zoom vertical (altura de teclas)' },
  { teclas: 'H', accion: 'Zoom vertical (altura de teclas)' },
  { teclas: '?', accion: 'Mostrar / ocultar atajos' },
  { teclas: 'Alt+arrastrar nota', accion: 'Mover / redimensionar sin imán (preciso)' },
  { teclas: 'Shift+arrastrar', accion: 'Movimiento fino (¼ del imán)' },
  { teclas: 'Bordes de la nota', accion: 'Cambiar duración (inicio / final)' },
  { teclas: 'Carril Velocidad', accion: 'Arrastrar barras = velocity 1–127' },
  { teclas: 'Clic / teclado', accion: 'Audicionar nota en el VST de la pista' },
  { teclas: 'Doble clic', accion: 'Crear nota (modo dibujar o seleccionar)' },
  { teclas: 'Alt+arrastrar vacío', accion: 'Crear nota con duración' },
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
  dirty,
  nombreClip,
}: {
  herramienta: PianoRollTool
  onHerramienta: (t: PianoRollTool) => void
  snapOn: boolean
  onSnapToggle: () => void
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
  dirty: boolean
  nombreClip: string
}) {
  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      <div className="flex h-8 items-center gap-2 border-b border-border/60 px-2">
        <span className="truncate text-[12px] font-semibold text-foreground">{nombreClip}</span>
        <span className="text-[10px] text-muted-foreground">
          {notasCount} notas
          {seleccionCount > 0 ? ` · ${seleccionCount} seleccionadas` : ''}
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
          value={snapDiv}
          onChange={(e) => onSnapDiv(Number(e.target.value))}
          className="h-6 max-w-[130px] rounded border border-border bg-background px-1 text-[10px] text-foreground"
          title="División del imán"
          aria-label="División del imán"
        >
          {([1, 0.5, 0.25, 0.125, 0.0625] as const).map((d) => (
            <option key={d} value={d}>
              {SNAP_LABELS[d]}
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

export { SNAP_LABELS }
