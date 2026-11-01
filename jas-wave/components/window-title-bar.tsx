/**
 * Barra de título única para toda ventana sin marco del DAW (principal, Portal, pantalla de error…).
 *
 * Minimizar · maximizar/restaurar · cerrar SIEMPRE visibles en la esquina superior derecha:
 *  - En Windows los dibuja el sistema (Window Controls Overlay, ver electron/window-chrome.ts): quedan por
 *    encima de cualquier diálogo, panel o pantalla de carga y conservan Snap, Win+flechas y el doble clic
 *    para maximizar. Aquí solo se reserva su hueco y se igualan sus colores con la barra.
 *  - Si el overlay no está disponible (pantalla completa, otra plataforma) se dibujan los propios, fijos
 *    arriba a la derecha con el z-index máximo.
 * El resto de la barra es zona de arrastre; lo interactivo que se ponga dentro debe usar `noDrag`.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Minus, Square, X } from 'lucide-react'
import {
  ALTO_BARRA_TITULO,
  ANCHO_BOTON_VENTANA,
  ANCHO_CONTROLES_PROPIOS,
  etiquetaMaximizar,
  modoControlesVentana,
  type ModoControlesVentana,
} from '@/src/lib/window-chrome'

export const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties
const drag = { WebkitAppRegion: 'drag' } as CSSProperties

type Wco = EventTarget & { visible: boolean }

function overlayApi(): Wco | null {
  if (typeof navigator === 'undefined') return null
  return ((navigator as unknown as { windowControlsOverlay?: Wco }).windowControlsOverlay ?? null) as Wco | null
}

function esElectron(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { electron?: unknown }).electron)
}

/** Modo actual de los controles (cambia al entrar/salir de pantalla completa). */
export function useModoControlesVentana(): ModoControlesVentana {
  const [visible, setVisible] = useState(() => Boolean(overlayApi()?.visible))
  useEffect(() => {
    const wco = overlayApi()
    if (!wco) return
    const on = () => setVisible(Boolean(wco.visible))
    on()
    wco.addEventListener('geometrychange', on)
    return () => wco.removeEventListener('geometrychange', on)
  }, [])
  // Las ventanas flotantes (?undock=) tienen marco nativo de Windows: no se dibujan botones propios.
  const marcoNativo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('undock')
  return modoControlesVentana({ esElectron: esElectron(), overlayVisible: visible, marcoNativo })
}

/** Maximizada sí/no de la ventana actual (cualquier ventana, no solo la principal). */
export function useVentanaMaximizada(): boolean {
  const [max, setMax] = useState(false)
  useEffect(() => {
    let vivo = true
    void window.electron?.windowIsMaximized?.()
      .then((m) => {
        if (vivo) setMax(Boolean(m))
      })
      .catch(() => {})
    const off = window.electron?.onWindowMaximizedChanged?.((m) => {
      if (vivo) setMax(Boolean(m))
    })
    return () => {
      vivo = false
      off?.()
    }
  }, [])
  return max
}

const claseBoton =
  'flex h-full items-center justify-center text-muted-foreground outline-none transition-colors focus-visible:bg-panel-raised focus-visible:text-foreground'

/** Botones propios (solo cuando el sistema no los dibuja). Fijos arriba a la derecha, sobre todo. */
export function WindowControls() {
  const maximizada = useVentanaMaximizada()
  const etiqueta = etiquetaMaximizar(maximizada)
  const contenido = (
    <div
      data-testid="window-controls"
      role="group"
      aria-label="Controles de ventana"
      className="fixed right-0 top-0 flex"
      style={{ ...noDrag, height: ALTO_BARRA_TITULO, zIndex: 2147483647 }}
    >
      <button
        type="button"
        aria-label="Minimizar"
        title="Minimizar"
        onClick={() => void window.electron?.windowMinimize?.()}
        className={`${claseBoton} hover:bg-panel-raised hover:text-foreground`}
        style={{ width: ANCHO_BOTON_VENTANA }}
      >
        <Minus className="size-[14px]" />
      </button>
      <button
        type="button"
        aria-label={etiqueta}
        title={etiqueta}
        onClick={() => void window.electron?.windowMaximize?.()}
        className={`${claseBoton} hover:bg-panel-raised hover:text-foreground`}
        style={{ width: ANCHO_BOTON_VENTANA }}
      >
        {maximizada ? <Copy className="size-[13px] -scale-x-100" /> : <Square className="size-[12px]" />}
      </button>
      <button
        type="button"
        aria-label="Cerrar"
        title="Cerrar"
        onClick={() => void window.electron?.windowClose?.()}
        className={`${claseBoton} hover:bg-[#c42b1c] hover:text-white focus-visible:bg-[#c42b1c] focus-visible:text-white`}
        style={{ width: ANCHO_BOTON_VENTANA }}
      >
        <X className="size-[15px]" />
      </button>
    </div>
  )
  return typeof document === 'undefined' ? contenido : createPortal(contenido, document.body)
}

export type WindowTitleBarProps = {
  children?: ReactNode
  /** Fondo de la barra y de los botones nativos (hex). */
  color?: string
  /** Color de los símbolos de los botones nativos (hex). */
  colorSimbolos?: string
  className?: string
  /** Se llama con el ancho libre para el contenido (sin los botones de ventana). */
  onAnchoLibre?: (px: number) => void
  /** Solo en la app de escritorio (en el navegador no hay ventana que controlar): no se pinta en la web. */
  soloEscritorio?: boolean
}

export const COLOR_BARRA_POR_DEFECTO = '#0a0d23'
export const COLOR_SIMBOLOS_POR_DEFECTO = '#c9cde6'

export function WindowTitleBar({
  children,
  color = COLOR_BARRA_POR_DEFECTO,
  colorSimbolos = COLOR_SIMBOLOS_POR_DEFECTO,
  className = '',
  onAnchoLibre,
  soloEscritorio = false,
}: WindowTitleBarProps) {
  const modo = useModoControlesVentana()
  const [contenedor, setContenedor] = useState<HTMLDivElement | null>(null)

  // Los botones nativos toman el color de esta barra (el Portal tiene otro fondo que el DAW).
  useEffect(() => {
    if (modo !== 'nativos') return
    void window.electron?.windowSetTitleBarOverlay?.({ color, symbolColor: colorSimbolos })?.catch?.(() => {})
  }, [modo, color, colorSimbolos])

  useEffect(() => {
    if (!contenedor || !onAnchoLibre || typeof ResizeObserver === 'undefined') return
    onAnchoLibre(contenedor.clientWidth)
    const ro = new ResizeObserver((e) => onAnchoLibre(Math.round(e[0]?.contentRect.width ?? contenedor.clientWidth)))
    ro.observe(contenedor)
    return () => ro.disconnect()
  }, [contenedor, onAnchoLibre])

  if (soloEscritorio && modo === 'ninguno') return null

  return (
    <div
      data-testid="window-title-bar"
      data-controles-ventana={modo}
      className={`relative flex w-full shrink-0 select-none items-stretch border-b border-border ${className}`}
      style={{ ...drag, height: ALTO_BARRA_TITULO, minHeight: ALTO_BARRA_TITULO, background: color }}
      onDoubleClick={(e) => {
        // El doble clic sobre la zona de arrastre lo resuelve Windows; esto cubre los huecos no-drag vacíos.
        if (modo === 'propios' && e.target === e.currentTarget) void window.electron?.windowMaximize?.()
      }}
    >
      {modo === 'nativos' ? (
        // macOS/overlay a la izquierda: deja libre la zona de los semáforos si la hubiera
        <div aria-hidden className="shrink-0" style={{ width: 'env(titlebar-area-x, 0px)' }} />
      ) : null}
      <div ref={setContenedor} className="flex min-w-0 flex-1 items-center overflow-hidden">
        {children}
      </div>
      {modo === 'nativos' ? (
        <div
          aria-hidden
          data-testid="window-controls-reserva"
          className="shrink-0"
          style={{ width: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' }}
        />
      ) : null}
      {modo === 'propios' ? (
        <>
          <div aria-hidden className="shrink-0" style={{ width: ANCHO_CONTROLES_PROPIOS }} />
          <WindowControls />
        </>
      ) : null}
    </div>
  )
}
