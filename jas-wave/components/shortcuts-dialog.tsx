import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Keyboard, X, Search, RotateCcw } from 'lucide-react'
import { ACCIONES_ATAJO, ATAJOS_POR_DEFECTO } from '../../shared/src'
import type { DespachadorTeclado } from '../../shared/src'
import { useDAW } from '../src/context/daw-context'
import type { AccionAtajo } from '../../shared/src'
import { requestOpenTool } from '../src/workspace/types'

interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
  dispatcher: DespachadorTeclado
}

type CategoriaFiltro = 'todas' | AccionAtajo['categoria']

const CATEGORIAS: { id: CategoriaFiltro; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'transporte', label: 'Transport' },
  { id: 'proyecto', label: 'Project' },
  { id: 'edicion', label: 'Editing' },
  { id: 'daw', label: 'Track / Nav' },
  { id: 'ui', label: 'View / Tools' },
  { id: 'ventana', label: 'Window' },
  { id: 'global', label: 'System' },
]

export function ShortcutsDialog({ open, onClose, dispatcher }: ShortcutsDialogProps) {
  const tienda = useDAW()
  const [busqueda, setBusqueda] = useState('')
  const [filtroCat, setFiltroCat] = useState<CategoriaFiltro>('todas')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [capturando, setCapturando] = useState(false)
  const [conflicto, setConflicto] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escuchar evento para abrir
  useEffect(() => {
    if (!open) return
    const handler = () => {
      /* open prop controls this */
    }
    window.addEventListener('open-shortcuts-dialog', handler)
    return () => window.removeEventListener('open-shortcuts-dialog', handler)
  }, [open])

  const atajosActuales = useMemo(() => {
    return tienda.obtenerEstado().atajos.mapa
  }, [tienda])

  const filtradas = useMemo(() => {
    return ACCIONES_ATAJO.filter((a) => {
      const matchCat = filtroCat === 'todas' || a.categoria === filtroCat
      const matchBusqueda =
        !busqueda ||
        a.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
        a.id.toLowerCase().includes(busqueda.toLowerCase()) ||
        (atajosActuales[a.id] ?? '').toLowerCase().includes(busqueda.toLowerCase())
      return matchCat && matchBusqueda
    })
  }, [filtroCat, busqueda, atajosActuales])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleCapture = useCallback(
    (accionId: string) => {
      setEditandoId(accionId)
      setCapturando(true)
      setConflicto(null)

      const keyHandler = (e: KeyboardEvent) => {
        e.preventDefault()
        e.stopPropagation()

        if (e.key === 'Escape') {
          setCapturando(false)
          setEditandoId(null)
          window.removeEventListener('keydown', keyHandler, true)
          return
        }

        const partes: string[] = []
        if (e.ctrlKey || e.metaKey) partes.push('Ctrl')
        if (e.altKey) partes.push('Alt')
        if (e.shiftKey) partes.push('Shift')

        const tecla = e.key.trim()
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(tecla)) {
          let nombre = tecla
          if (tecla === ' ') nombre = 'Space'
          else if (tecla.length === 1) nombre = tecla.toUpperCase()
          partes.push(nombre)
        }

        if (partes.length < 2 && !['Space', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(partes[0])) {
          // Need at least one modifier for non-special keys
          window.removeEventListener('keydown', keyHandler, true)
          setCapturando(false)
          setEditandoId(null)
          return
        }

        const combo = partes.join('+')

        // Check conflicts
        const conflictos = dispatcher.buscarConflictos(combo, accionId)
        if (conflictos.length > 0) {
          const accionConflicto = ACCIONES_ATAJO.find((a) => a.id === conflictos[0])
          setConflicto(accionConflicto?.descripcion ?? conflictos[0])
          // Still assign but warn
        }

        // Update in dispatcher
        dispatcher.actualizarCombo(accionId, combo)

        // Persist to store
        tienda.executor.execute('atajos.actualizar', {
          accionId,
          combinacion: combo,
        })

        setCapturando(false)
        setEditandoId(null)
        window.removeEventListener('keydown', keyHandler, true)
      }

      window.addEventListener('keydown', keyHandler, true)
    },
    [dispatcher, tienda],
  )

  const handleRestaurar = useCallback(
    (accionId: string) => {
      const defecto = ATAJOS_POR_DEFECTO[accionId]
      if (defecto) {
        dispatcher.actualizarCombo(accionId, defecto)
        tienda.executor.execute('atajos.restaurarUno', { accionId })
      }
    },
    [dispatcher, tienda],
  )

  const handleRestaurarTodos = useCallback(() => {
    dispatcher.restaurarDefaults(ATAJOS_POR_DEFECTO)
    tienda.executor.execute('atajos.restaurar', {})
  }, [dispatcher, tienda])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />

      <div
        ref={dialogRef}
        className="relative z-10 flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Keyboard className="size-4 text-accent-amber" />
          <h2 className="text-sm font-semibold text-foreground">Atajos de Teclado</h2>
          <div className="flex-1" />
          <button
            onClick={handleRestaurarTodos}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
            title="Restaurar todos los atajos por defecto"
          >
            <RotateCcw className="size-3" />
            Restaurar todo
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <div className="flex flex-1 items-center gap-2 rounded-md bg-panel-raised px-2 py-1">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar atajo..."
              className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-1.5">
          {CATEGORIAS.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFiltroCat(cat.id)}
              className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                filtroCat === cat.id
                  ? 'bg-accent-amber text-background'
                  : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Conflicto warning */}
        {conflicto && (
          <div className="border-b border-orange-500/30 bg-orange-500/10 px-4 py-2 text-[11px] text-orange-400">
            Conflicto: este atajo ya está asignado a &ldquo;{conflicto}&rdquo;. Se ha reasignado.
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtradas.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
              No se encontraron atajos.
            </div>
          )}
          {filtradas.map((accion) => {
            const combo = atajosActuales[accion.id] ?? accion.comandoPorDefecto
            const esDefault = combo === accion.comandoPorDefecto
            const estaEditando = editandoId === accion.id

            return (
              <div
                key={accion.id}
                className={`flex items-center gap-3 border-b border-border/50 px-4 py-2 transition-colors ${
                  estaEditando ? 'bg-accent-amber/10' : 'hover:bg-panel-raised/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-foreground">{accion.descripcion}</div>
                  <div className="text-[10px] text-muted-foreground">{accion.id}</div>
                </div>

                {/* Shortcut display / edit */}
                <button
                  onClick={() => handleCapture(accion.id)}
                  disabled={capturando && !estaEditando}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                    estaEditando
                      ? 'border-accent-amber bg-accent-amber/20 text-accent-amber animate-pulse'
                      : esDefault
                        ? 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground'
                        : 'border-accent-amber/50 text-accent-amber hover:bg-accent-amber/10'
                  }`}
                >
                  {estaEditando ? (
                    <span>Presiona teclas...</span>
                  ) : (
                    <>
                      <span>{combo || 'Sin atajo'}</span>
                      {!esDefault && (
                        <span className="text-[8px] text-accent-amber/60">*</span>
                      )}
                    </>
                  )}
                </button>

                {/* Restore default */}
                {!esDefault && !estaEditando && (
                  <button
                    onClick={() => handleRestaurar(accion.id)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Restaurar atajo por defecto"
                  >
                    <RotateCcw className="size-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <kbd className="rounded border border-border px-1 py-0.5 font-mono">Ctrl+Shift+,</kbd>
          {' '}para abrir · Los atajos de teclado se guardan con el proyecto ·{' '}
          <button
            type="button"
            className="text-accent-amber hover:underline"
            onClick={() => {
              onClose()
              requestOpenTool('midi-map')
            }}
          >
            Control MIDI / MIDI Learn
          </button>
        </div>
      </div>
    </div>
  )
}
