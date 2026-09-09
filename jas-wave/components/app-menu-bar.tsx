import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export type MenuActionId =
  | 'proyecto.nuevo'
  | 'proyecto.abrir'
  | 'proyecto.guardar'
  | 'proyecto.guardarComo'
  | 'proyecto.cerrar'
  | 'app.salir'
  | 'edicion.deshacer'
  | 'edicion.rehacer'
  | 'edicion.cortar'
  | 'edicion.copiar'
  | 'edicion.pegar'
  | 'edicion.duplicar'
  | 'edicion.eliminar'
  | 'edicion.seleccionarTodo'
  | 'vista.zoomIn'
  | 'vista.zoomOut'
  | 'vista.zoomTodo'
  | 'ventana.barraLateral'
  | 'ventana.panelInferior'
  | 'ventana.panelDerecho'
  | 'ventana.paletaComandos'
  | 'ventana.atajos'
  | 'ventana.midiMap'
  | 'ventana.terminal'
  | 'transporte.reproducir'
  | 'transporte.detener'
  | 'transporte.grabar'
  | 'transporte.loop'
  | 'transporte.metronomo'
  | 'transporte.inicio'
  | 'pista.nueva'
  | 'pista.nuevaMidi'
  | 'ventana.ajustes'
  | 'archivo.exportarBounce'
  | 'archivo.exportarPartituras'
  | 'archivo.exportarProyectoConPartituras'

type MenuItem =
  | { type: 'action'; id: MenuActionId; label: string; shortcut?: string }
  | { type: 'separator' }

type MenuGroup = { id: string; label: string; items: MenuItem[] }

const MENUS: MenuGroup[] = [
  {
    id: 'archivo',
    label: 'Archivo',
    items: [
      { type: 'action', id: 'proyecto.nuevo', label: 'Nuevo proyecto', shortcut: 'Ctrl+N' },
      { type: 'action', id: 'proyecto.abrir', label: 'Abrir…', shortcut: 'Ctrl+O' },
      { type: 'separator' },
      { type: 'action', id: 'proyecto.guardar', label: 'Guardar', shortcut: 'Ctrl+S' },
      { type: 'action', id: 'proyecto.guardarComo', label: 'Guardar como…', shortcut: 'Ctrl+Shift+S' },
      { type: 'action', id: 'archivo.exportarBounce', label: 'Exportar bounce WAV…' },
      { type: 'action', id: 'archivo.exportarPartituras', label: 'Exportar partituras PDF…' },
      {
        type: 'action',
        id: 'archivo.exportarProyectoConPartituras',
        label: 'Exportar proyecto + partituras…',
      },
      { type: 'separator' },
      { type: 'action', id: 'proyecto.cerrar', label: 'Cerrar proyecto' },
      { type: 'action', id: 'app.salir', label: 'Salir', shortcut: 'Alt+F4' },
    ],
  },
  {
    id: 'editar',
    label: 'Editar',
    items: [
      { type: 'action', id: 'edicion.deshacer', label: 'Deshacer', shortcut: 'Ctrl+Z' },
      { type: 'action', id: 'edicion.rehacer', label: 'Rehacer', shortcut: 'Ctrl+Y' },
      { type: 'separator' },
      { type: 'action', id: 'edicion.cortar', label: 'Cortar', shortcut: 'Ctrl+X' },
      { type: 'action', id: 'edicion.copiar', label: 'Copiar', shortcut: 'Ctrl+C' },
      { type: 'action', id: 'edicion.pegar', label: 'Pegar', shortcut: 'Ctrl+V' },
      { type: 'action', id: 'edicion.duplicar', label: 'Duplicar', shortcut: 'Ctrl+D' },
      { type: 'action', id: 'edicion.eliminar', label: 'Eliminar', shortcut: 'Del' },
      { type: 'separator' },
      { type: 'action', id: 'edicion.seleccionarTodo', label: 'Seleccionar todo', shortcut: 'Ctrl+A' },
    ],
  },
  {
    id: 'ver',
    label: 'Ver',
    items: [
      { type: 'action', id: 'vista.zoomIn', label: 'Acercar', shortcut: 'Ctrl+=' },
      { type: 'action', id: 'vista.zoomOut', label: 'Alejar', shortcut: 'Ctrl+-' },
      { type: 'action', id: 'vista.zoomTodo', label: 'Zoom predeterminado' },
      { type: 'separator' },
      { type: 'action', id: 'ventana.barraLateral', label: 'Panel izquierdo' },
      { type: 'action', id: 'ventana.panelDerecho', label: 'Panel derecho' },
      { type: 'action', id: 'ventana.panelInferior', label: 'Panel inferior / Mixer' },
      { type: 'separator' },
      { type: 'action', id: 'ventana.paletaComandos', label: 'Paleta de comandos', shortcut: 'Ctrl+K' },
      { type: 'action', id: 'ventana.atajos', label: 'Atajos de teclado…' },
      { type: 'action', id: 'ventana.midiMap', label: 'Control MIDI / MIDI Learn…' },
      { type: 'action', id: 'ventana.terminal', label: 'Terminal', shortcut: 'Ctrl+`' },
    ],
  },
  {
    id: 'transporte',
    label: 'Transporte',
    items: [
      { type: 'action', id: 'transporte.reproducir', label: 'Reproducir / Pausar', shortcut: 'Espacio' },
      { type: 'action', id: 'transporte.detener', label: 'Detener' },
      { type: 'action', id: 'transporte.grabar', label: 'Grabar', shortcut: 'R' },
      { type: 'separator' },
      { type: 'action', id: 'transporte.inicio', label: 'Ir al inicio', shortcut: 'Home' },
      { type: 'action', id: 'transporte.loop', label: 'Bucle' },
      { type: 'action', id: 'transporte.metronomo', label: 'Metrónomo' },
    ],
  },
  {
    id: 'acciones',
    label: 'Acciones',
    items: [
      { type: 'action', id: 'pista.nueva', label: 'Nueva pista de audio' },
      { type: 'action', id: 'pista.nuevaMidi', label: 'Nueva pista MIDI' },
      { type: 'separator' },
      { type: 'action', id: 'ventana.ajustes', label: 'Ajustes del proyecto…' },
    ],
  },
]

function dispatchMenuAction(id: MenuActionId) {
  if (id === 'app.salir') {
    void window.electron?.windowClose?.()
    return
  }
  window.dispatchEvent(new CustomEvent('jaswave-menu-action', { detail: { id } }))
}

export function AppMenuBar() {
  const [openId, setOpenId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openId) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [openId])

  return (
    <div
      ref={rootRef}
      className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border bg-panel px-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="menubar"
      aria-label="Menú principal"
    >
      {MENUS.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={openId === menu.id}
            onClick={() => setOpenId((v) => (v === menu.id ? null : menu.id))}
            onMouseEnter={() => {
              if (openId) setOpenId(menu.id)
            }}
            className={`rounded px-2.5 py-1 text-[12px] ${
              openId === menu.id
                ? 'bg-panel-raised text-foreground'
                : 'text-muted-foreground hover:bg-panel-raised/70 hover:text-foreground'
            }`}
          >
            {menu.label}
          </button>
          {openId === menu.id && (
            <div
              role="menu"
              className="absolute left-0 top-full z-[90] mt-0.5 min-w-[220px] rounded-md border border-border bg-panel py-1 shadow-xl"
            >
              {menu.items.map((item, idx) => {
                if (item.type === 'separator') {
                  return <div key={`sep-${idx}`} className="my-1 border-t border-border" />
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      dispatchMenuAction(item.id)
                      setOpenId(null)
                    }}
                    className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-panel-raised"
                  >
                    <span>{item.label}</span>
                    {item.shortcut ? (
                      <span className="font-mono text-[10px] text-muted-foreground">{item.shortcut}</span>
                    ) : (
                      <ChevronRight className="size-3 opacity-0" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
