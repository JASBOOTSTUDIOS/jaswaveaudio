'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { abrirPantalla } from '@/src/lib/abrir-pantalla'
import {
  configurarGuia,
  descartarGuia,
  evaluarEstadoPaso,
  expirarResaltado,
  limpiarResaltado,
  localizarElemento,
  notificarSenal,
  obtenerEstadoGuia,
  resolverIdAyuda,
  siguientePaso,
  suscribirGuia,
} from '@/src/lib/guia-ui'

interface Caja { x: number; y: number; w: number; h: number }

const REINTENTO_MS = 150
const MAX_ESPERA_MS = 2000

/**
 * Halo + globo sobre el elemento resaltado por la guía de interfaz. No bloquea clics (pointer-events:none
 * salvo el propio globo), se descarta con Esc o con el botón, y solo cambia la interfaz.
 */
export function CapaGuia() {
  const estado = useSyncExternalStore(suscribirGuia, obtenerEstadoGuia, obtenerEstadoGuia)
  const [caja, setCaja] = useState<Caja | null>(null)
  const resaltado = estado.resaltado
  const idResaltado = resaltado?.id
  const desde = resaltado?.desdeMs
  const ref = useRef<HTMLElement | null>(null)

  // Conecta los pasos con la apertura de pantallas (solo UI).
  useEffect(() => {
    configurarGuia({ abrir: (id) => { abrirPantalla(id) } })
    return () => configurarGuia({ abrir: undefined })
  }, [])

  // Localiza el destino (reintenta hasta 2 s si el panel aún monta) y lo sigue con ResizeObserver.
  useEffect(() => {
    setCaja(null)
    ref.current = null
    const destino = resolverIdAyuda(idResaltado)
    if (!destino) return
    let vivo = true
    let ro: ResizeObserver | null = null
    const inicio = Date.now()

    const medir = () => {
      const el = ref.current
      if (!el || !el.isConnected) return false
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return false
      setCaja({ x: r.left, y: r.top, w: r.width, h: r.height })
      return true
    }
    const buscar = () => {
      if (!vivo) return
      const el = localizarElemento(destino, (s) => document.querySelector<HTMLElement>(s))
      if (el) {
        ref.current = el
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
        ro = new ResizeObserver(() => medir())
        ro.observe(el)
        medir()
      } else if (Date.now() - inicio < MAX_ESPERA_MS) {
        setTimeout(buscar, REINTENTO_MS)
      } else {
        limpiarResaltado()
      }
    }
    buscar()

    const repintar = () => { if (ref.current && !medir()) { setCaja(null); ref.current = null; limpiarResaltado() } }
    window.addEventListener('resize', repintar)
    window.addEventListener('scroll', repintar, true)
    return () => {
      vivo = false
      ro?.disconnect()
      window.removeEventListener('resize', repintar)
      window.removeEventListener('scroll', repintar, true)
    }
  }, [idResaltado, desde])

  // Esc descarta; aperturas de herramienta y clics sobre el destino cuentan como señales de paso.
  const activo = resaltado != null || estado.paso >= 0
  useEffect(() => {
    if (!activo) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') descartarGuia() }
    const onTool = (e: Event) => {
      const id = (e as CustomEvent<{ toolId?: string }>).detail?.toolId
      if (id) notificarSenal({ tipo: 'tool-abierta', id })
    }
    const onClick = (e: MouseEvent) => {
      const h = obtenerEstadoGuia().pasos[obtenerEstadoGuia().paso]?.hastaQue
      if (!h || !('clic' in h)) return
      const d = resolverIdAyuda(h.clic)
      const t = e.target as Element | null
      if (d && t?.closest && d.selectores.some((s) => t.closest(s))) notificarSenal({ tipo: 'clic', id: h.clic })
    }
    const timer = setInterval(() => { expirarResaltado(); evaluarEstadoPaso() }, 500)
    window.addEventListener('keydown', onKey)
    window.addEventListener('jaswave-open-tool', onTool)
    document.addEventListener('click', onClick, true)
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('jaswave-open-tool', onTool)
      document.removeEventListener('click', onClick, true)
    }
  }, [activo])

  if (!resaltado && estado.paso < 0) return null

  const conPasos = estado.paso >= 0 && estado.pasos.length > 0
  const hayHalo = resaltado != null && caja != null
  const globoArriba = hayHalo && caja.y + caja.h + 120 > window.innerHeight
  const GLOBO_W = 260
  const left = hayHalo ? Math.min(Math.max(8, caja.x), Math.max(8, window.innerWidth - GLOBO_W - 8)) : 0
  const top = hayHalo ? (globoArriba ? Math.max(8, caja.y - 8) : caja.y + caja.h + 8) : 0

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]" data-ayuda-capa>
      {hayHalo && (
        <div
          data-ayuda-halo={resaltado.id}
          aria-hidden="true"
          className="absolute rounded-md border-2 border-ring shadow-[0_0_0_4px_color-mix(in_oklch,var(--ring)_35%,transparent)] motion-safe:animate-pulse"
          style={{ left: caja.x - 4, top: caja.y - 4, width: caja.w + 8, height: caja.h + 8 }}
        />
      )}
      {hayHalo && (
        <div
          role="status"
          aria-live="polite"
          data-ayuda-globo
          className="pointer-events-auto absolute flex items-start gap-2 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          style={{ left, top, width: GLOBO_W, transform: globoArriba ? 'translateY(-100%)' : undefined }}
        >
          <span className="flex-1 leading-snug">
            {conPasos && <span className="mr-1 font-medium text-muted-foreground">Paso {estado.paso + 1}/{estado.pasos.length}.</span>}
            {resaltado.texto}
          </span>
          {conPasos && !estado.terminada && estado.paso < estado.pasos.length - 1 && (
            <button type="button" onClick={siguientePaso} className="shrink-0 rounded px-1.5 py-0.5 text-primary hover:bg-accent">
              Siguiente
            </button>
          )}
          <button
            type="button"
            aria-label="Cerrar la guía (Esc)"
            title="Cerrar (Esc)"
            onClick={descartarGuia}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
