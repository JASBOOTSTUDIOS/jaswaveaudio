/**
 * Menú contextual de clip (clic derecho en el arrange).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Clip, MidiClip, Track } from '@jaswave/shared'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { requestOpenTool } from '@/src/workspace/types'
import { dawClipboard, type ClipboardClip } from '@/src/lib/daw-clipboard'
import { exportClipScorePdfDialog } from '@/src/lib/midi-score-export'
import { styleSaveFromClip } from '@/src/lib/styles/ops'

export type ClipMenuState = {
  trackId: string
  clipIds: string[]
  x: number
  y: number
  beatAtClick?: number
}

type Props = {
  menu: ClipMenuState | null
  onClose: () => void
  tienda: TiendaDAW
}

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16']

function MenuItem({
  label,
  shortcut,
  danger,
  disabled,
  onClick,
}: {
  label: string
  shortcut?: string
  danger?: boolean
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
      <span>{label}</span>
      {shortcut ? <span className="text-[10px] text-muted-foreground">{shortcut}</span> : null}
    </button>
  )
}

function Sep() {
  return <div className="my-1 border-t border-border" />
}

function findClip(tienda: TiendaDAW, trackId: string, clipId: string) {
  const track = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === trackId) as Track | undefined
  const clip = track?.clips?.find((c) => c.id === clipId)
  return { track, clip }
}

function clipIsMidi(clip: Clip): boolean {
  if (clip.tipo === 'midi') return true
  return Array.isArray((clip as { notas?: unknown }).notas)
}

function asMidiClip(clip: Clip): MidiClip | null {
  return clipIsMidi(clip) ? (clip as MidiClip) : null
}

function toClipboardClip(trackId: string, clip: Clip): ClipboardClip {
  const midi = clipIsMidi(clip)
  const midiClip = asMidiClip(clip)
  const audio = clip as Clip & {
    source?: { ruta?: string }
    sourceId?: string
    waveform?: number[]
    clipInicio?: number
  }
  return {
    pistaOrigenId: trackId,
    nombre: clip.nombre || 'Clip',
    inicio: clip.inicio,
    duracion: clip.duracion,
    tipo: midi ? 'midi' : 'audio',
    color: clip.color,
    notas: midiClip
      ? midiClip.notas?.map((n) => ({
          pitch: n.pitch,
          inicio: n.inicio,
          duracion: n.duracion,
          velocidad: n.velocidad,
          canal: n.canal,
        }))
      : undefined,
    sourceId: audio.sourceId || audio.source?.ruta,
    waveform: audio.waveform,
    clipInicio: audio.clipInicio,
  }
}

async function duplicateClip(tienda: TiendaDAW, trackId: string, clip: Clip): Promise<void> {
  const inicio = clip.inicio + clip.duracion
  const midiClip = asMidiClip(clip)
  if (midiClip) {
    await tienda.executor.execute('midi.clip.create', {
      pistaId: trackId,
      nombre: `${clip.nombre || 'Clip'} (Copia)`,
      inicio,
      duracion: clip.duracion,
      color: clip.color,
      notas: (midiClip.notas ?? []).map((n) => ({
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
        canal: n.canal,
      })),
    })
    return
  }
  const audio = clip as Clip & { source?: { ruta?: string }; sourceId?: string; waveform?: number[] }
  await tienda.executor.execute('clip.create', {
    pistaId: trackId,
    nombre: `${clip.nombre || 'Clip'} (Copia)`,
    inicio,
    duracion: clip.duracion,
    color: clip.color,
    sourceId: audio.sourceId || audio.source?.ruta,
    waveform: audio.waveform,
  })
}

async function updateClipField(
  tienda: TiendaDAW,
  trackId: string,
  clipId: string,
  patch: Partial<Clip>,
): Promise<void> {
  const { track, clip } = findClip(tienda, trackId, clipId)
  if (!track || !clip) return
  const clips = (track.clips ?? []).map((c) => (c.id === clipId ? ({ ...c, ...patch } as Clip) : c))
  await tienda.executor.execute('track.update', { trackId, datos: { clips } })
}

export function ClipContextMenu({ menu, onClose, tienda }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const track = menu
    ? (tienda.obtenerEstado().project?.tracks?.find((t) => t.id === menu.trackId) as Track | undefined)
    : undefined

  const menuClips =
    menu && track
      ? menu.clipIds
          .map((id) => track.clips?.find((c) => c.id === id))
          .filter((c): c is Clip => Boolean(c))
      : []
  const clip = menuClips[0]

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

  if (!menu || !track || !clip || menuClips.length === 0) return null

  const multi = menuClips.length > 1
  const midi = clipIsMidi(clip)
  const allMidi = menuClips.every((c) => clipIsMidi(c))
  const beat = menu.beatAtClick
  const canSplit =
    !multi &&
    beat != null &&
    beat > clip.inicio + 0.01 &&
    beat < clip.inicio + clip.duracion - 0.01
  const canMerge = menuClips.length >= 2
  const hasClipboard = dawClipboard.hasClips()

  const run = (fn: () => unknown | Promise<unknown>) => {
    void Promise.resolve(fn()).finally(() => onClose())
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[210] min-w-[220px] rounded-md border border-border bg-panel py-1 shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {multi ? `${menuClips.length} clips` : clip.nombre || 'Clip'}
        {!multi && midi ? ' · MIDI' : !multi ? ' · Audio' : ''}
      </div>
      <Sep />
      {canMerge ? (
        <MenuItem
          label="Unir clips seleccionados"
          onClick={() =>
            run(() =>
              tienda.executor.execute('clip.merge', {
                pistaId: track.id,
                clipIds: menu.clipIds,
              }),
            )
          }
        />
      ) : null}
      {canMerge ? <Sep /> : null}
      {!multi ? (
      <MenuItem
        label={midi ? 'Abrir en piano roll' : 'Abrir detalle de clip'}
        onClick={() =>
          run(() => {
            void tienda.executor.execute('selection.set', {
              idsClips: menu.clipIds,
              idsPistas: [track.id],
              tipo: 'clip',
              idPrincipal: track.id,
            })
            requestOpenTool(midi ? 'piano-roll' : 'track-detail', {
              zone: midi ? 'bottom' : 'right',
            })
          })
        }
      />
      ) : null}
      {!multi ? (
      <MenuItem
        label="Renombrar…"
        onClick={() =>
          run(async () => {
            const next = window.prompt('Nombre del clip:', clip.nombre || 'Clip')
            if (!next?.trim() || next.trim() === clip.nombre) return
            await updateClipField(tienda, track.id, clip.id, { nombre: next.trim() })
          })
        }
      />
      ) : null}
      <Sep />
      <MenuItem
        label={multi ? 'Copiar selección' : 'Copiar'}
        shortcut="Ctrl+C"
        onClick={() =>
          run(() => {
            dawClipboard.setClips(menuClips.map((c) => toClipboardClip(track.id, c)))
            tienda.busEventos.emit('portapapeles.copiado', { cantidad: menuClips.length })
          })
        }
      />
      <MenuItem
        label={multi ? 'Cortar selección' : 'Cortar'}
        shortcut="Ctrl+X"
        onClick={() =>
          run(async () => {
            dawClipboard.setClips(menuClips.map((c) => toClipboardClip(track.id, c)))
            tienda.busEventos.emit('portapapeles.copiado', { cantidad: menuClips.length })
            for (const c of menuClips) {
              await tienda.executor.execute('clip.delete', { pistaId: track.id, clipId: c.id })
            }
          })
        }
      />
      <MenuItem
        label="Pegar"
        shortcut="Ctrl+V"
        disabled={!hasClipboard}
        onClick={() =>
          run(async () => {
            const clips = dawClipboard.getClips()
            if (clips.length === 0) return
            const pasteAt = clip.inicio + clip.duracion
            for (const c of clips) {
              const inicio = pasteAt
              if (c.tipo === 'midi' || (c.notas?.length ?? 0) > 0) {
                await tienda.executor.execute('midi.clip.create', {
                  pistaId: track.id,
                  nombre: c.nombre,
                  inicio,
                  duracion: c.duracion,
                  color: c.color,
                  notas: (c.notas ?? []).map((n) => ({
                    pitch: n.pitch,
                    inicio: n.inicio,
                    duracion: n.duracion,
                    velocidad: n.velocidad,
                    canal: n.canal,
                  })),
                })
              } else {
                await tienda.executor.execute('clip.create', {
                  pistaId: track.id,
                  nombre: c.nombre,
                  inicio,
                  duracion: c.duracion,
                  color: c.color,
                  sourceId: c.sourceId,
                  waveform: c.waveform,
                })
              }
            }
          })
        }
      />
      {!multi ? (
      <MenuItem
        label="Duplicar"
        shortcut="Ctrl+D"
        onClick={() => run(() => duplicateClip(tienda, track.id, clip))}
      />
      ) : null}
      {!multi ? (
      <MenuItem
        label="Dividir aquí"
        shortcut="S"
        disabled={!canSplit}
        onClick={() =>
          run(() =>
            tienda.executor.execute('clip.split', {
              pistaId: track.id,
              clipId: clip.id,
              tiempo: beat!,
            }),
          )
        }
      />
      ) : null}
      {!multi && midi ? (
        <>
          <Sep />
      <MenuItem
        label="Abrir editor de partitura"
        onClick={() =>
          run(() => {
            void tienda.executor.execute('selection.set', {
              idsClips: menu.clipIds,
              idsPistas: [track.id],
              tipo: 'clip',
              idPrincipal: track.id,
            })
            requestOpenTool('score-editor', { zone: 'bottom' })
          })
        }
      />
      <MenuItem
        label="Vista previa / exportar partitura PDF…"
            onClick={() => run(() => exportClipScorePdfDialog(tienda, track.id, clip.id))}
          />
          <MenuItem
            label="Guardar como estilo…"
            onClick={() =>
              run(async () => {
                const nombre = window.prompt('Nombre del estilo:', clip.nombre || 'Estilo')
                if (!nombre?.trim()) return
                const tagsRaw = window.prompt('Tags (coma), opcional:', '') ?? ''
                const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
                const global = window.confirm('¿Guardar también en biblioteca global?')
                const r = await styleSaveFromClip(tienda, {
                  pistaId: track.id,
                  clipId: clip.id,
                  nombre: nombre.trim(),
                  tags,
                  global,
                })
                if (!r.ok) window.alert(r.message)
              })
            }
          />
        </>
      ) : null}
      {!multi ? (
      <>
      <div className="px-3 py-1 text-[10px] text-muted-foreground">Color</div>
      <div className="flex flex-wrap gap-1 px-3 pb-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            className={`size-4 rounded-sm ring-1 ring-border ${clip.color === c ? 'ring-2 ring-accent-amber' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => run(() => updateClipField(tienda, track.id, clip.id, { color: c }))}
          />
        ))}
      </div>
      <Sep />
      </>
      ) : null}
      <MenuItem
        label={multi ? `Eliminar ${menuClips.length} clips` : 'Eliminar clip'}
        danger
        shortcut="Del"
        onClick={() =>
          run(async () => {
            for (const c of menuClips) {
              await tienda.executor.execute('clip.delete', { pistaId: track.id, clipId: c.id })
            }
          })
        }
      />
    </div>
  )
}
