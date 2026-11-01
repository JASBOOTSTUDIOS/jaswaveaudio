/**
 * Carril de marcadores / secciones en la cabecera del arreglo. Sincronizado con el scroll y el zoom de
 * las pistas (misma proyección). Doble clic renombra, arrastre mueve (snap), menú contextual «Quitar».
 */
import { useRef, useState } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../../shared/src'
import type { Marcador } from '../../../shared/src/types/entidades'
import { arrastreHorizontal, useLaneScrollFollow } from './lane-scroll'
import { LaneContextMenu, LaneInlineInput } from './TimelineLyricChordLane'

export const MARKERS_LANE_H = 18

export function TimelineMarkersLane({
  pixelsPerBeat,
  getScrollX,
  contentWidth,
  snapBeat,
  onSeek,
}: {
  pixelsPerBeat: number
  getScrollX: () => number
  contentWidth: number
  snapBeat: (beat: number) => number
  onSeek?: (beat: number) => void
}) {
  const tienda = useDAW()
  const marcadores = useDAWState((s: DAWState) => s.project?.marcadores ?? [])
  const innerRef = useRef<HTMLDivElement>(null)
  useLaneScrollFollow(innerRef, getScrollX)
  const [editando, setEditando] = useState<string | null>(null)
  const [arrastre, setArrastre] = useState<{ id: string; beat: number } | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const ordenados = [...marcadores].filter((m) => m.tipo === 'marcador').sort((a, b) => a.tiempo - b.tiempo)

  const renombrar = (m: Marcador, nombre: string) => {
    setEditando(null)
    const limpio = nombre.trim()
    if (limpio && limpio !== m.nombre) void tienda.executor.execute('marker.update', { id: m.id, nombre: limpio })
  }

  return (
    <div data-testid="carril-marcadores" className="relative h-full w-full overflow-hidden select-none">
      <div ref={innerRef} className="absolute left-0 top-0 h-full will-change-transform" style={{ width: contentWidth }}>
        {ordenados.map((m, i) => {
          const beat = arrastre?.id === m.id ? arrastre.beat : m.tiempo
          const siguiente = ordenados[i + 1]
          const ancho = siguiente ? Math.max(24, (siguiente.tiempo - m.tiempo) * pixelsPerBeat - 2) : undefined
          return (
            <div
              key={m.id}
              data-testid="marcador-bandera"
              className="absolute top-0 flex h-full cursor-grab items-center overflow-hidden whitespace-nowrap rounded-r px-1.5 text-[10px] font-semibold leading-none active:cursor-grabbing"
              style={{
                left: beat * pixelsPerBeat,
                width: ancho,
                maxWidth: ancho,
                borderLeft: `2px solid ${m.color || '#f59e0b'}`,
                color: m.color || '#f59e0b',
                background: `linear-gradient(90deg, ${m.color || '#f59e0b'}33, transparent)`,
              }}
              title={`${m.nombre} · doble clic: renombrar · arrastrar: mover`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                const inicio = m.tiempo
                arrastreHorizontal(
                  e,
                  (dx) => setArrastre({ id: m.id, beat: Math.max(0, snapBeat(inicio + dx / pixelsPerBeat)) }),
                  (dx, movido) => {
                    setArrastre(null)
                    if (!movido) return
                    const destino = Math.max(0, snapBeat(inicio + dx / pixelsPerBeat))
                    if (Math.abs(destino - inicio) > 1e-6) void tienda.executor.execute('marker.update', { id: m.id, tiempo: destino })
                  },
                )
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSeek?.(m.tiempo)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditando(m.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ id: m.id, x: e.clientX, y: e.clientY })
              }}
            >
              {editando === m.id ? (
                <LaneInlineInput valor={m.nombre} onCommit={(v) => renombrar(m, v)} onCancel={() => setEditando(null)} />
              ) : (
                <span className="truncate">{m.nombre}</span>
              )}
            </div>
          )
        })}
      </div>
      {menu ? (
        <LaneContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Renombrar', onClick: () => setEditando(menu.id) },
            { label: 'Quitar', onClick: () => void tienda.executor.execute('marker.remove', { id: menu.id }), peligroso: true },
          ]}
        />
      ) : null}
    </div>
  )
}
