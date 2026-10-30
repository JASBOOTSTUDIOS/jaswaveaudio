/**
 * Carriles de acordes y de letra en la cabecera del arreglo.
 *
 * - Misma proyección que la regla (px/beat) y siguen el scroll de las pistas con un RAF (sin re-render).
 * - Acordes: insignias flotantes; doble clic edita (input inline), arrastre mueve con snap, menú «Quitar»,
 *   doble clic en hueco crea uno.
 * - Letra: sílabas con guion de palabra; la activa brilla con el playhead (RAF + atributo `data-activa`,
 *   igual que el PlayheadOverlay: nada de estado React por frame). Doble clic edita la sílaba, arrastre
 *   la mueve, menú contextual «Quitar frase».
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../../shared/src'
import type { AcordeCarril, FraseLetra } from '../../../shared/src/types/lyrics'
import { silabaEn } from '../../../shared/src/music/letra'
import { intentarParsearAcorde } from '../../../shared/src/music/acordes'
import { arrastreHorizontal, clientXToLaneBeat, useLaneScrollFollow } from './lane-scroll'

export const CHORD_LANE_H = 22
export const LYRIC_LANE_H = 22

const SIN_LETRA: FraseLetra[] = []
const SIN_ACORDES: AcordeCarril[] = []

// ---------------------------------------------------------------------------
// Piezas compartidas con el carril de marcadores
// ---------------------------------------------------------------------------

export function LaneInlineInput({
  valor,
  onCommit,
  onCancel,
  ancho,
  invalido,
}: {
  valor: string
  onCommit: (v: string) => void
  onCancel: () => void
  ancho?: number
  invalido?: (v: string) => boolean
}) {
  const [v, setV] = useState(valor)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const malo = invalido ? invalido(v) : false
  return (
    <input
      ref={ref}
      data-testid="carril-input"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !malo) onCommit(v)
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => (malo ? onCancel() : onCommit(v))}
      className={`h-[16px] rounded border bg-panel px-1 font-mono text-[10px] leading-none text-foreground outline-none ${malo ? 'border-red-500' : 'border-accent-amber'}`}
      style={{ width: Math.max(44, ancho ?? 0) }}
      aria-invalid={malo || undefined}
    />
  )
}

export function LaneContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: Array<{ label: string; onClick: () => void; peligroso?: boolean }>
  onClose: () => void
}) {
  useEffect(() => {
    const cerrar = () => onClose()
    window.addEventListener('pointerdown', cerrar, { once: true })
    window.addEventListener('keydown', cerrar, { once: true })
    return () => {
      window.removeEventListener('pointerdown', cerrar)
      window.removeEventListener('keydown', cerrar)
    }
  }, [onClose])
  return (
    <div
      data-testid="carril-menu"
      className="fixed z-[200] min-w-[120px] rounded-md border border-border bg-panel py-1 text-[12px] shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className={`block w-full px-3 py-1 text-left hover:bg-panel-raised ${it.peligroso ? 'text-red-400' : 'text-foreground'}`}
          onClick={() => {
            onClose()
            it.onClick()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

interface LaneProps {
  pixelsPerBeat: number
  getScrollX: () => number
  contentWidth: number
  snapBeat: (beat: number) => number
  beatsPerBar: number
}

// ---------------------------------------------------------------------------
// Acordes
// ---------------------------------------------------------------------------

export function TimelineChordLane({ pixelsPerBeat, getScrollX, contentWidth, snapBeat, beatsPerBar }: LaneProps) {
  const tienda = useDAW()
  const acordes = useDAWState((s: DAWState) => s.project?.letra?.acordes ?? SIN_ACORDES)
  const innerRef = useRef<HTMLDivElement>(null)
  useLaneScrollFollow(innerRef, getScrollX)
  const [editando, setEditando] = useState<{ id: string | null; beat: number } | null>(null)
  const [arrastre, setArrastre] = useState<{ id: string; beat: number } | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const commit = (id: string | null, beat: number, nombre: string) => {
    setEditando(null)
    const limpio = nombre.trim()
    if (!limpio) return
    const previo = id ? acordes.find((a) => a.id === id) : undefined
    if (previo && previo.nombre === limpio) return
    void tienda.executor.execute('chords.upsert', id ? { id, nombre: limpio } : { nombre: limpio, beat, duracion: beatsPerBar })
  }

  return (
    <div
      data-testid="carril-acordes"
      className="relative h-full w-full select-none overflow-hidden"
      onDoubleClick={(e) => {
        const lane = innerRef.current
        if (!lane) return
        const beat = snapBeat(clientXToLaneBeat(e.clientX, lane, pixelsPerBeat, 0))
        setEditando({ id: null, beat })
      }}
    >
      <div ref={innerRef} className="absolute left-0 top-0 h-full will-change-transform" style={{ width: contentWidth }}>
        {acordes.map((a) => {
          const beat = arrastre?.id === a.id ? arrastre.beat : a.beat
          const ancho = Math.max(26, a.duracion * pixelsPerBeat - 3)
          return (
            <div
              key={a.id}
              data-testid="acorde-insignia"
              data-acorde-id={a.id}
              data-nombre={a.nombre}
              className="absolute top-[2px] flex h-[18px] cursor-grab items-center overflow-hidden whitespace-nowrap rounded-md border border-accent-cyan/50 bg-accent-cyan/15 px-1.5 font-mono text-[11px] font-semibold leading-none text-accent-cyan shadow-[0_0_6px_rgba(34,211,238,0.25)] hover:bg-accent-cyan/25 active:cursor-grabbing"
              style={{ left: beat * pixelsPerBeat, width: ancho }}
              title={`${a.nombre} · doble clic: editar · arrastrar: mover · clic derecho: quitar`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                const inicio = a.beat
                arrastreHorizontal(
                  e,
                  (dx) => setArrastre({ id: a.id, beat: Math.max(0, snapBeat(inicio + dx / pixelsPerBeat)) }),
                  (dx, movido) => {
                    setArrastre(null)
                    if (!movido) return
                    const destino = Math.max(0, snapBeat(inicio + dx / pixelsPerBeat))
                    if (Math.abs(destino - inicio) > 1e-6) void tienda.executor.execute('chords.move', { id: a.id, beat: destino })
                  },
                )
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditando({ id: a.id, beat: a.beat })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ id: a.id, x: e.clientX, y: e.clientY })
              }}
            >
              {editando?.id === a.id ? (
                <LaneInlineInput
                  valor={a.nombre}
                  ancho={ancho - 8}
                  invalido={(v) => intentarParsearAcorde(v) === null}
                  onCommit={(v) => commit(a.id, a.beat, v)}
                  onCancel={() => setEditando(null)}
                />
              ) : (
                <span className="truncate">{a.nombre}</span>
              )}
            </div>
          )
        })}
        {editando && editando.id === null ? (
          <div className="absolute top-[2px] h-[18px]" style={{ left: editando.beat * pixelsPerBeat }}>
            <LaneInlineInput
              valor=""
              ancho={60}
              invalido={(v) => v.trim().length > 0 && intentarParsearAcorde(v) === null}
              onCommit={(v) => commit(null, editando.beat, v)}
              onCancel={() => setEditando(null)}
            />
          </div>
        ) : null}
      </div>
      {menu ? (
        <LaneContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Editar', onClick: () => setEditando({ id: menu.id, beat: acordes.find((a) => a.id === menu.id)?.beat ?? 0 }) },
            { label: 'Quitar', onClick: () => void tienda.executor.execute('chords.remove', { id: menu.id }), peligroso: true },
          ]}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Letra
// ---------------------------------------------------------------------------

const claveSilaba = (fraseId: string, indice: number) => `${fraseId}:${indice}`

export function TimelineLyricLane({
  pixelsPerBeat,
  getScrollX,
  contentWidth,
  snapBeat,
  bpm,
  getSeconds,
}: LaneProps & { bpm: number; getSeconds: () => number }) {
  const tienda = useDAW()
  const frases = useDAWState((s: DAWState) => s.project?.letra?.frases ?? SIN_LETRA)
  const innerRef = useRef<HTMLDivElement>(null)
  useLaneScrollFollow(innerRef, getScrollX)
  const [editando, setEditando] = useState<string | null>(null)
  const [arrastre, setArrastre] = useState<{ clave: string; beat: number } | null>(null)
  const [menu, setMenu] = useState<{ fraseId: string; indice: number; x: number; y: number } | null>(null)

  // Glow de la sílaba activa: RAF que lee el transporte y conmuta un atributo (sin estado React por frame).
  const elementos = useRef(new Map<string, HTMLElement>())
  const datos = useRef({ frases, bpm, getSeconds })
  datos.current = { frases, bpm, getSeconds }
  useEffect(() => {
    let raf = 0
    let activa: string | null = null
    const tick = () => {
      const d = datos.current
      const beat = Math.max(0, (d.getSeconds() * d.bpm) / 60)
      const s = silabaEn(d.frases, beat)
      const clave = s ? claveSilaba(s.fraseId, s.indice) : null
      if (clave !== activa) {
        if (activa) elementos.current.get(activa)?.removeAttribute('data-activa')
        if (clave) elementos.current.get(clave)?.setAttribute('data-activa', 'true')
        activa = clave
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const registrar = useCallback((clave: string, el: HTMLElement | null) => {
    if (el) elementos.current.set(clave, el)
    else elementos.current.delete(clave)
  }, [])

  /** Reescribe todas las frases conservando ids y tiempos (edición de una sílaba o borrado de una frase). */
  const guardarFrases = (nuevas: FraseLetra[]) => {
    void tienda.executor.execute('lyrics.setPhrases', {
      frases: nuevas.map((f) => ({ id: f.id, texto: f.texto, seccion: f.seccion, silabas: f.silabas })),
    })
  }

  const editarSilaba = (f: FraseLetra, indice: number, texto: string) => {
    setEditando(null)
    const limpio = texto.trim()
    if (!limpio || limpio === f.silabas[indice]?.texto) return
    const silabas = f.silabas.map((s, i) => (i === indice ? { ...s, texto: limpio } : s))
    const textoFrase = silabas.map((s, i) => s.texto + (s.finPalabra !== false && i < silabas.length - 1 ? ' ' : '')).join('')
    guardarFrases(frases.map((x) => (x.id === f.id ? { ...x, texto: textoFrase, silabas } : x)))
  }

  const quitarFrase = (fraseId: string) => {
    const restantes = frases.filter((f) => f.id !== fraseId)
    if (restantes.length === 0) void tienda.executor.execute('lyrics.clear', { que: 'letra' })
    else guardarFrases(restantes)
  }

  return (
    <div data-testid="carril-letra" className="relative h-full w-full select-none overflow-hidden">
      <div ref={innerRef} className="absolute left-0 top-0 h-full will-change-transform" style={{ width: contentWidth }}>
        {frases.map((f) =>
          f.silabas.map((s, i) => {
            const clave = claveSilaba(f.id, i)
            const beat = arrastre?.clave === clave ? arrastre.beat : s.beat
            const siguiente = f.silabas[i + 1]
            const ancho = siguiente ? Math.max(8, (siguiente.beat - s.beat) * pixelsPerBeat - 1) : Math.max(8, s.duracion * pixelsPerBeat)
            const guion = s.finPalabra === false ? '-' : ''
            return (
              <div
                key={clave}
                ref={(el) => registrar(clave, el)}
                data-testid="letra-silaba"
                data-frase-id={f.id}
                data-indice={i}
                className="absolute top-0 flex h-full cursor-grab items-center overflow-hidden whitespace-nowrap pl-0.5 text-[11px] leading-none text-foreground/85 transition-[color,text-shadow] duration-100 data-[activa=true]:font-semibold data-[activa=true]:text-accent-amber data-[activa=true]:[text-shadow:0_0_8px_rgba(251,191,36,0.95),0_0_2px_rgba(251,191,36,1)] active:cursor-grabbing"
                style={{ left: beat * pixelsPerBeat, width: ancho }}
                title={`${f.texto}${f.seccion ? ` · ${f.seccion}` : ''} · doble clic: editar · arrastrar: mover`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  const inicio = s.beat
                  arrastreHorizontal(
                    e,
                    (dx) => setArrastre({ clave, beat: Math.max(0, snapBeat(inicio + dx / pixelsPerBeat)) }),
                    (dx, movido) => {
                      setArrastre(null)
                      if (!movido) return
                      const destino = Math.max(0, snapBeat(inicio + dx / pixelsPerBeat))
                      if (Math.abs(destino - inicio) > 1e-6) {
                        void tienda.executor.execute('lyrics.alignTiming', { cambios: [{ fraseId: f.id, indice: i, beat: destino }] })
                      }
                    },
                  )
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditando(clave)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ fraseId: f.id, indice: i, x: e.clientX, y: e.clientY })
                }}
              >
                {editando === clave ? (
                  <LaneInlineInput valor={s.texto} ancho={Math.max(40, ancho - 4)} onCommit={(v) => editarSilaba(f, i, v)} onCancel={() => setEditando(null)} />
                ) : (
                  <span className="truncate">
                    {s.texto}
                    {guion}
                  </span>
                )}
              </div>
            )
          }),
        )}
      </div>
      {menu ? (
        <LaneContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Editar sílaba', onClick: () => setEditando(claveSilaba(menu.fraseId, menu.indice)) },
            { label: 'Quitar frase', onClick: () => quitarFrase(menu.fraseId), peligroso: true },
          ]}
        />
      ) : null}
    </div>
  )
}

/** Fila de la cabecera apilada (regla + carriles). */
export interface HeaderLaneRow {
  id: string
  label: string
  height: number
  content: ReactNode
  collapsed?: boolean
  onToggle?: () => void
  testId?: string
}
