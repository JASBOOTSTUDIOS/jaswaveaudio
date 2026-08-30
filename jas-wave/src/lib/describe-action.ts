/**
 * Descripciones humanas de acciones DAW para UI de aprobación.
 */

import type { DawAction } from './ai-daw-agent'

function shortId(id: unknown, max = 10): string {
  const s = String(id ?? '').trim()
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

function noteStats(notas: unknown): string {
  if (!Array.isArray(notas) || !notas.length) return ''
  const pitches = notas
    .map((n) => (n && typeof n === 'object' ? Number((n as { pitch?: number }).pitch) : NaN))
    .filter((p) => Number.isFinite(p))
  const lo = pitches.length ? Math.min(...pitches) : null
  const hi = pitches.length ? Math.max(...pitches) : null
  const range = lo != null && hi != null ? `, pitches ${lo}–${hi}` : ''
  return `${notas.length} nota${notas.length === 1 ? '' : 's'}${range}`
}

function trackLabel(p: Record<string, unknown>): string {
  const name = p.trackName ?? p.pistaNombre ?? p.nombrePista
  if (typeof name === 'string' && name.trim()) return `«${name.trim()}»`
  const id = p.pistaId ?? p.trackId
  return id ? `pista ${shortId(id)}` : ''
}

function clipRef(p: Record<string, unknown>): string {
  const name = typeof p.clipName === 'string' ? p.clipName.trim() : ''
  if (name) return `«${name}»`
  if (typeof p.nombre === 'string' && p.nombre.trim() && p.clipId) return `«${p.nombre.trim()}»`
  const id = p.clipId
  return id ? `clip ${shortId(id)}` : ''
}

function joinParts(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' · ')
}

export type ActionDescription = {
  label: string
  detail?: string
}

/** Descripción legible para aprobar/rechazar en chat. */
export function describeActionForUser(a: DawAction): ActionDescription {
  const p = (a.payload ?? {}) as Record<string, unknown>
  const track = trackLabel(p)
  const clip = clipRef(p)
  const notes = noteStats(p.notas)
  const tech = (() => {
    const bits: string[] = [a.type]
    if (p.pistaId || p.trackId) bits.push(`pistaId=${shortId(p.pistaId ?? p.trackId)}`)
    if (p.clipId) bits.push(`clipId=${shortId(p.clipId)}`)
    if (p.aplicar === false || p.apply === false) bits.push('preview')
    return bits.join(' ')
  })()

  switch (a.type) {
    case 'project.setBpm':
      return { label: `Cambiar tempo a ${p.bpm ?? '?'} BPM`, detail: tech }
    case 'daw.musicBuild':
      return {
        label: `Music Build: ${String(p.prompt ?? p.nombre ?? 'arreglo').slice(0, 56)}`,
        detail: tech,
      }
    case 'daw.composeProject':
      return {
        label: `Componer proyecto «${String(p.nombre ?? 'sin nombre').slice(0, 40)}»`,
        detail: tech,
      }
    case 'daw.generateMidiSong':
      return {
        label: joinParts([
          `Generar MIDI «${String(p.nombre ?? 'clip').slice(0, 40)}»`,
          notes || undefined,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.clip.create':
      return {
        label: joinParts([
          `Crear clip MIDI «${String(p.nombre ?? 'clip').slice(0, 40)}»`,
          notes || undefined,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.notes.set':
      return {
        label: joinParts([
          notes ? `Reemplazar notas (${notes})` : 'Reemplazar notas MIDI',
          clip || track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.notes.dedupe':
      return {
        label: joinParts(['Quitar notas duplicadas', clip || undefined, track || undefined]),
        detail: tech,
      }
    case 'midi.clip.md.read':
      return {
        label: joinParts(['Leer .md del clip', clip || undefined]),
        detail: tech,
      }
    case 'midi.clip.md.upsert':
      return {
        label: joinParts(['Proponer notas vía .md (preview)', clip || undefined, track || undefined]),
        detail: tech,
      }
    case 'midi.clip.md.apply':
      return {
        label: joinParts(['Aplicar .md del clip a la timeline', clip || undefined]),
        detail: tech,
      }
    case 'midi.notes.compare':
      return {
        label: joinParts(['Comparar notas (diff por id)', clip || undefined]),
        detail: tech,
      }
    case 'midi.notes.get':
    case 'midi.getNotes':
      return {
        label: joinParts(['Leer notas del clip', clip || undefined, track || undefined]),
        detail: tech,
      }
    case 'midi.getClipSummary':
      return {
        label: joinParts(['Resumen del clip MIDI', clip || undefined]),
        detail: tech,
      }
    case 'midi.transpose':
      return {
        label: joinParts([
          `Trasponer ${Number(p.semitonos ?? 0) >= 0 ? '+' : ''}${p.semitonos ?? '?'} semitonos`,
          clip || track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.quantize':
      return {
        label: joinParts([
          `Cuantizar (grid ${p.gridBeats ?? '?'} beats)`,
          clip || track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.humanize':
      return { label: joinParts(['Humanizar notas', clip || track || undefined]), detail: tech }
    case 'midi.setVelocity':
      return {
        label: joinParts([
          p.velocity != null
            ? `Velocidad → ${p.velocity}`
            : p.relativeFactor != null
              ? `Velocidad ×${p.relativeFactor}`
              : 'Ajustar velocidad',
          clip || track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.deleteNotes':
      return {
        label: joinParts([
          Array.isArray(p.noteIds) ? `Borrar ${p.noteIds.length} nota(s)` : 'Borrar notas',
          clip || track || undefined,
        ]),
        detail: tech,
      }
    case 'midi.createNotes':
      return {
        label: joinParts([notes ? `Añadir ${notes}` : 'Añadir notas', clip || track || undefined]),
        detail: tech,
      }
    case 'clip.create':
      return {
        label: joinParts([
          `Crear clip audio «${String(p.nombre ?? 'clip').slice(0, 40)}»`,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'clip.delete':
      return {
        label: joinParts(['Eliminar clip', clip || undefined, track || undefined]),
        detail: tech,
      }
    case 'clip.move':
      return {
        label: joinParts([`Mover clip a beat ${p.inicio ?? '?'}`, track || undefined]),
        detail: tech,
      }
    case 'clip.split':
      return {
        label: joinParts([`Dividir clip en beat ${p.tiempo ?? '?'}`, track || undefined]),
        detail: tech,
      }
    case 'track.create':
      return {
        label: `Crear pista «${String(p.nombre ?? p.name ?? 'pista').slice(0, 40)}»`,
        detail: tech,
      }
    case 'track.delete':
      return {
        label: joinParts(['Eliminar pista', track || shortId(p.pistaId ?? p.trackId) || undefined]),
        detail: tech,
      }
    case 'track.update':
      return {
        label: joinParts(['Actualizar pista', track || undefined]),
        detail: tech,
      }
    case 'plugin.insert':
      return {
        label: joinParts([
          `Insertar plugin ${String(p.nombre ?? p.pluginId ?? 'VST').slice(0, 40)}`,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'plugin.remove':
      return {
        label: joinParts(['Quitar plugin', track || undefined]),
        detail: tech,
      }
    case 'plugin.bypass':
      return {
        label: joinParts([
          p.bypass === false ? 'Activar plugin' : 'Bypass plugin',
          track || undefined,
        ]),
        detail: tech,
      }
    case 'plugin.setParameter':
      return {
        label: joinParts([
          `Parámetro ${String(p.parameterId ?? p.name ?? '?')} → ${
            p.normalizedValue != null ? Number(p.normalizedValue).toFixed(2) : '?'
          }`,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'library.preset.apply':
      return {
        label: joinParts([
          `Aplicar preset ${String(p.nombre ?? p.presetId ?? '').slice(0, 40)}`,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'doc.write':
    case 'doc.append':
    case 'doc.create':
      return {
        label: `${a.type === 'doc.append' ? 'Añadir a' : 'Actualizar'} ${String(p.slug ?? 'doc')}`,
        detail: tech,
      }
    case 'doc.read':
    case 'doc.list':
      return {
        label: a.type === 'doc.list' ? 'Listar documentos' : `Leer ${String(p.slug ?? 'doc')}`,
        detail: tech,
      }
    case 'audio.import':
      return {
        label: joinParts([
          `Importar audio ${String(p.filePath ?? p.nombre ?? '').split(/[/\\]/).pop() || ''}`,
          track || undefined,
        ]),
        detail: tech,
      }
    case 'ui.setZoom':
      return {
        label: `Zoom horizontal ${p.horizontal ?? '?'}`,
        detail: tech,
      }
    default:
      return {
        label: a.type,
        detail: p && Object.keys(p).length ? JSON.stringify(p).slice(0, 120) : undefined,
      }
  }
}

export function labelForAction(a: DawAction): string {
  return describeActionForUser(a).label
}
