/**
 * Menú contextual de pista (⋮ y clic derecho): mute, solo, duplicar, eliminar, etc.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { MidiClip, Track } from '@jaswave/shared'
import { requestOpenTool } from '@/src/workspace/types'
import { freezeTrack, unfreezeTrack } from '@/src/lib/track-freeze'

export type TrackMenuState = {
  trackId: string
  x: number
  y: number
}

type Props = {
  menu: TrackMenuState | null
  onClose: () => void
  tienda: TiendaDAW
  onRequestDelete: (trackId: string) => void
  onImportAudio?: (trackId: string) => void
  onShowTakeLanes?: (trackId: string) => void
  trackIndex: number
  trackCount: number
}

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16']

function MenuItem({
  label,
  shortcut,
  danger,
  checked,
  disabled,
  onClick,
}: {
  label: string
  shortcut?: string
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] disabled:opacity-40 ${
        danger
          ? 'text-destructive hover:bg-destructive/15'
          : 'text-foreground hover:bg-panel-raised'
      }`}
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        onClick()
      }}
    >
      <span className="flex items-center gap-2">
        {checked != null ? (
          <span className="w-3 text-[10px] text-muted-foreground">{checked ? '✓' : ''}</span>
        ) : null}
        {label}
      </span>
      {shortcut ? <span className="text-[10px] text-muted-foreground">{shortcut}</span> : null}
    </button>
  )
}

function Sep() {
  return <div className="my-1 border-t border-border" />
}

export async function duplicateTrack(tienda: TiendaDAW, trackId: string): Promise<string | null> {
  const before = tienda.obtenerEstado()
  const src = before.project?.tracks?.find((t) => t.id === trackId) as Track | undefined
  if (!src) return null
  const tipo = (src.tipo === 'bus' || src.tipo === 'carpeta' ? 'midi' : src.tipo) as
    | 'audio'
    | 'midi'
    | 'instrumento'
  const nombre = `${src.nombre || 'Pista'} copia`
  await tienda.executor.execute('track.create', {
    nombre,
    tipo,
    color: src.color,
  })
  const after = tienda.obtenerEstado()
  const created = [...(after.project?.tracks ?? [])]
    .reverse()
    .find((t) => t.nombre === nombre && t.id !== trackId)
  if (!created) return null

  await tienda.executor.execute('track.update', {
    trackId: created.id,
    datos: {
      volumen: src.volumen,
      paneo: src.paneo,
      armada: src.armada,
      color: src.color,
    },
  })
  if (src.silenciada) {
    await tienda.executor.execute('track.toggleMute', { trackId: created.id })
  }
  if (src.soloActiva) {
    await tienda.executor.execute('track.toggleSolo', { trackId: created.id })
  }
  if (src.configuracion?.monitorizarEntrada) {
    await tienda.executor.execute('track.toggleMonitor', { trackId: created.id })
  }

  for (const c of src.clips ?? []) {
    if ((c as MidiClip).tipo === 'midi') {
      const mc = c as MidiClip
      await tienda.executor.execute('midi.clip.create', {
        pistaId: created.id,
        nombre: mc.nombre,
        inicio: mc.inicio,
        duracion: mc.duracion,
        color: mc.color,
        notas: (mc.notas ?? []).map((n) => ({
          pitch: n.pitch,
          inicio: n.inicio,
          duracion: n.duracion,
          velocidad: n.velocidad,
        })),
      })
    } else if ((c as { tipo?: string }).tipo === 'audio') {
      const ac = c as {
        nombre: string
        inicio: number
        duracion: number
        color?: string
        waveform?: number[]
        source?: { ruta?: string }
      }
      await tienda.executor.execute('clip.create', {
        pistaId: created.id,
        nombre: ac.nombre,
        inicio: ac.inicio,
        duracion: ac.duracion,
        color: ac.color,
        sourceId: ac.source?.ruta,
        waveform: ac.waveform,
      })
    }
  }

  const idx = (before.project?.tracks ?? []).findIndex((t) => t.id === trackId)
  if (idx >= 0) {
    await tienda.executor.execute('track.move', { trackId: created.id, toIndex: idx + 1 })
  }
  return created.id
}

export function TrackContextMenu({
  menu,
  onClose,
  tienda,
  onRequestDelete,
  onImportAudio,
  onShowTakeLanes,
  trackIndex,
  trackCount,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const track = menu
    ? (tienda.obtenerEstado().project?.tracks?.find((t) => t.id === menu.trackId) as Track | undefined)
    : undefined

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = menu.x
    let y = menu.y
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad)
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad)
    setPos({ x, y })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu || !track) return null

  const muted = Boolean(track.silenciada)
  const solo = Boolean(track.soloActiva)
  const armed = Boolean(track.armada)
  const monitor = Boolean(track.configuracion?.monitorizarEntrada)
  const frozen = Boolean(track.frozen)

  const run = (fn: () => unknown | Promise<unknown>) => {
    void Promise.resolve(fn()).finally(() => onClose())
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[200] min-w-[200px] rounded-md border border-border bg-panel py-1 shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {track.nombre}
      </div>
      <Sep />
      <MenuItem
        label="Renombrar…"
        onClick={() =>
          run(async () => {
            const next = window.prompt('Nombre de la pista:', track.nombre)
            if (!next?.trim() || next.trim() === track.nombre) return
            await tienda.executor.execute('track.update', {
              trackId: track.id,
              datos: { nombre: next.trim() },
            })
          })
        }
      />
      <MenuItem
        label="Duplicar"
        shortcut="Ctrl+D"
        onClick={() => run(() => duplicateTrack(tienda, track.id))}
      />
      <MenuItem
        label="Copiar nombre"
        onClick={() =>
          run(async () => {
            try {
              await navigator.clipboard.writeText(track.nombre)
            } catch {
              /* ignore */
            }
          })
        }
      />
      <Sep />
      <MenuItem
        label={muted ? 'Activar audio (unmute)' : 'Silenciar'}
        checked={muted}
        shortcut="M"
        onClick={() => run(() => tienda.executor.execute('track.toggleMute', { trackId: track.id }))}
      />
      <MenuItem
        label={solo ? 'Quitar solo' : 'Solo'}
        checked={solo}
        shortcut="S"
        onClick={() => run(() => tienda.executor.execute('track.toggleSolo', { trackId: track.id }))}
      />
      <MenuItem
        label={armed ? 'Desarmar' : 'Armar grabación'}
        checked={armed}
        onClick={() => run(() => tienda.executor.execute('track.toggleArm', { trackId: track.id }))}
      />
      <MenuItem
        label={monitor ? 'Monitor off' : 'Monitor de entrada'}
        checked={monitor}
        onClick={() => run(() => tienda.executor.execute('track.toggleMonitor', { trackId: track.id }))}
      />
      <Sep />
      <MenuItem
        label={frozen ? 'Descongelar (unfreeze)' : 'Congelar (freeze)'}
        checked={frozen}
        onClick={() =>
          run(async () => {
            if (frozen) await unfreezeTrack(tienda, track.id)
            else await freezeTrack(tienda, track.id)
          })
        }
      />
      <MenuItem
        label="Abrir detalle de pista"
        onClick={() =>
          run(() => {
            requestOpenTool('track-detail')
          })
        }
      />
      {onImportAudio ? (
        <MenuItem label="Importar audio…" onClick={() => run(() => onImportAudio(track.id))} />
      ) : null}
      {onShowTakeLanes && track.tipo === 'audio' ? (
        <MenuItem label="Tomas / Comp…" onClick={() => run(() => onShowTakeLanes(track.id))} />
      ) : null}
      <Sep />
      <div className="px-3 py-1 text-[10px] text-muted-foreground">Color</div>
      <div className="flex flex-wrap gap-1 px-3 pb-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            className={`size-4 rounded-sm ring-1 ring-border ${track.color === c ? 'ring-2 ring-accent-amber' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() =>
              run(() =>
                tienda.executor.execute('track.update', {
                  trackId: track.id,
                  datos: { color: c },
                }),
              )
            }
          />
        ))}
      </div>
      <Sep />
      <MenuItem
        label="Mover arriba"
        disabled={trackIndex <= 0}
        onClick={() =>
          run(() => tienda.executor.execute('track.move', { trackId: track.id, toIndex: trackIndex - 1 }))
        }
      />
      <MenuItem
        label="Mover abajo"
        disabled={trackIndex >= trackCount - 1}
        onClick={() =>
          run(() => tienda.executor.execute('track.move', { trackId: track.id, toIndex: trackIndex + 1 }))
        }
      />
      <Sep />
      <MenuItem
        label="Eliminar pista…"
        danger
        onClick={() =>
          run(() => {
            onRequestDelete(track.id)
          })
        }
      />
    </div>
  )
}
