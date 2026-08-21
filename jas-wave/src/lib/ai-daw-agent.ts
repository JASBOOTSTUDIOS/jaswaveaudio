/**
 * Agente DAW: interpreta ACTIONS del modelo y ejecuta comandos reales en JasWave.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DAWState } from '../../../shared/src/types/state'
import {
  generateSoftPianoSong,
  inferKeyFromText,
  inferMinutesFromText,
  wantsDawCreation,
  type GeneratedNote,
} from './midi-song-generator'
import { buildReadOnlyProjectContext } from './ai-read-context'

const ZOOM_MIN = 0.15
const ZOOM_MAX = 256

export type DawAction = {
  type: string
  payload?: Record<string, unknown>
}

export type ActionResult = {
  type: string
  success: boolean
  message: string
  data?: unknown
}

const ACTIONS_RE = /<<<ACTIONS\s*([\s\S]*?)\s*ACTIONS>>>/gi

export function buildAgentSystemPrompt(state: DAWState): string {
  const context = buildReadOnlyProjectContext(state)
  const tracks = state.project.tracks
    .slice(0, 20)
    .map((t) => `  - id=${t.id} «${t.nombre}» tipo=${t.tipo}`)
    .join('\n')

  return [
    context,
    '',
    '## Pistas (ids para acciones)',
    tracks || '  (ninguna)',
    '',
    '## Rol: Agente del DAW JasWave',
    'Controlas el proyecto REAL. Puedes cambiar BPM, zoom, crear/borrar pistas, mute/solo/arm, clips MIDI.',
    'NUNCA digas que uses Ableton/Logic. NUNCA digas que no puedes generar MIDI.',
    'Responde al usuario SOLO en español natural (1-3 frases). NO pegues JSON ni bloques ACTIONS en el texto visible.',
    'Las acciones van SOLO dentro del bloque delimitado (el cliente las ejecuta y las oculta).',
    '',
    'Formato obligatorio cuando debas mutar el DAW:',
    '<<<ACTIONS',
    '[{"type":"ACCION","payload":{...}}]',
    'ACTIONS>>>',
    '',
    'Acciones (type):',
    '- project.setBpm { bpm: number }',
    '- project.setTimeSignature { numerador, denominador }',
    '- ui.setZoom { horizontal?: 0.15-256, vertical?: 0.5-3, scrollX? }',
    '- track.create { nombre?, tipo: "midi"|"audio"|"instrumento"|"bus" }',
    '- track.delete { trackId }',
    '- track.update { trackId, datos: { nombre?, color?, volumen? } }',
    '- track.toggleMute|track.toggleSolo|track.toggleArm { trackId }',
    '- transport.toggle | transport.stop | transport.toggleLoop | transport.toggleMetronome | transport.toggleRecord',
    '- transport.seek { segundos }',
    '- daw.generateMidiSong { nombre?, minutos?, tonalidad? }  ← canciones piano/MIDI',
    '- midi.clip.create { pistaId?, nombre?, inicio?, duracion?, notas:[{pitch,inicio,duracion,velocidad}] }',
    '- midi.notes.set { pistaId, clipId, notas:[...] }',
    '- midi.transpose { pistaId, clipId, semitonos, noteIds? }',
    '- midi.quantize { pistaId, clipId, gridBeats, strength? }',
    '- midi.humanize { pistaId, clipId, seed, timingAmount?, velocityAmount? }',
    '- midi.setVelocity { pistaId, clipId, velocity? | relativeFactor?, noteIds? }',
    '- midi.makeStaccato | midi.makeLegato { pistaId, clipId, noteIds?, ratio? }',
    '- midi.constrainScale { pistaId, clipId, root, scale }',
    '- midi.generatePattern { pistaId, kind: "bass_funk"|"arp"|"drums"|"pad_chords", bars?, root?, scale?, seed?, clipId?, replace? }',
    '- midi.applyGroove { pistaId, clipId, grooveId, strength?, seed? }',
    '- midi.setCC { pistaId, clipId, cc, puntos:[{tiempo,valor}] }',
    '- midi.setPitchBend { pistaId, clipId, puntos:[{tiempo,valor:-1..1}] }',
    '- clip.delete { pistaId, clipId }',
    '- clip.move { pistaId, clipId, inicio, pistaDestinoId? }',
    '- master.update { datos: { volumen?, paneo?, muted? } }',
    '',
    'Para pedir canción/pista MIDI usa daw.generateMidiSong (no inventes miles de notas a mano).',
  ].join('\n')
}

/** Quita bloques ACTIONS y basura de tool-calls del texto visible. */
export function stripActionsBlock(text: string): string {
  return text
    .replace(ACTIONS_RE, '')
    .replace(/<<<ACTIONS[\s\S]*$/gi, '')
    .replace(/##\s*Cambios en el proyecto[\s\S]*$/gi, '')
    .replace(/^\s*\[?\s*\{\s*"type"\s*:[\s\S]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseActionsFromText(text: string): DawAction[] {
  const match = /<<<ACTIONS\s*([\s\S]*?)\s*ACTIONS>>>/i.exec(text)
  if (!match) return []
  try {
    let raw = match[1].trim()
    // A veces el modelo envuelve en markdown
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is DawAction =>
        !!a && typeof a === 'object' && typeof (a as DawAction).type === 'string',
    )
  } catch {
    return []
  }
}

export function fallbackActionsFromUserIntent(userText: string): DawAction[] {
  const actions: DawAction[] = []
  const lower = userText.toLowerCase()

  const bpmMatch = lower.match(/bpm\s*(?:a|de|=|:)?\s*(\d{2,3})/) || lower.match(/tempo\s*(?:a|de|=|:)?\s*(\d{2,3})/)
  if (bpmMatch) {
    actions.push({ type: 'project.setBpm', payload: { bpm: Number(bpmMatch[1]) } })
  }

  const zoomMatch = lower.match(/zoom\s*(?:a|de|=|:|horizontal)?\s*(\d+(?:[.,]\d+)?)/)
  if (zoomMatch || /acercar|alejar|zoom\s+in|zoom\s+out/i.test(lower)) {
    let z = zoomMatch ? parseFloat(zoomMatch[1].replace(',', '.')) : undefined
    if (z == null) {
      if (/alejar|zoom\s+out|menos zoom/i.test(lower)) z = 0.5
      else z = 2
    }
    // Si el usuario dijo "256" o "100x" etc.
    if (z > 10 && z <= 256) {
      /* keep as absolute zoom */
    } else if (z <= 10) {
      /* relative-ish values like 2x */
    }
    actions.push({
      type: 'ui.setZoom',
      payload: { horizontal: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) },
    })
  }

  if (wantsDawCreation(userText)) {
    const key = inferKeyFromText(userText)
    const minutes = inferMinutesFromText(userText, 3)
    const nombre = /piano/i.test(userText)
      ? `Piano ${key.label}`
      : `MIDI ${key.label}`
    actions.push({
      type: 'daw.generateMidiSong',
      payload: {
        nombre,
        minutos: minutes,
        tonalidad: key.label,
        keyRoot: key.root,
        scale: key.scale,
      },
    })
  }

  return actions
}

async function findOrCreateMidiTrack(
  tienda: TiendaDAW,
  nombre = 'Piano',
): Promise<{ trackId: string; created: boolean; error?: string }> {
  const state = tienda.obtenerEstado()
  const existing = state.project.tracks.find((t) => {
    const n = (t.nombre || '').toLowerCase()
    return (t.tipo === 'midi' || t.tipo === 'instrumento') && (n.includes('piano') || n.includes('midi'))
  })
  if (existing) return { trackId: existing.id, created: false }

  const anyMidi = state.project.tracks.find((t) => t.tipo === 'midi' || t.tipo === 'instrumento')
  // Prefer crear pista nueva con el nombre pedido
  const result = await tienda.executor.execute('track.create', {
    nombre,
    tipo: 'midi',
    color: '#a78bfa',
  })
  if (!result.success) {
    if (anyMidi) return { trackId: anyMidi.id, created: false }
    return {
      trackId: '',
      created: false,
      error: result.error?.message ?? 'No se pudo crear la pista MIDI',
    }
  }
  const after = tienda.obtenerEstado()
  const created = after.project.tracks[after.project.tracks.length - 1]
  if (!created) return { trackId: '', created: false, error: 'Pista creada pero no encontrada' }
  return { trackId: created.id, created: true }
}

function payloadOf(action: DawAction): Record<string, unknown> {
  return (action.payload ?? {}) as Record<string, unknown>
}

export async function executeDawActions(
  tienda: TiendaDAW,
  actions: DawAction[],
): Promise<ActionResult[]> {
  const results: ActionResult[] = []

  for (const action of actions) {
    const p = payloadOf(action)
    try {
      switch (action.type) {
        case 'project.setBpm': {
          const bpm = Number(p.bpm)
          const r = await tienda.executor.execute('project.setBpm', { bpm })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `BPM → ${bpm}` : r.error?.message ?? 'Error BPM',
          })
          break
        }
        case 'project.setTimeSignature': {
          const r = await tienda.executor.execute('project.setTimeSignature', {
            numerador: Number(p.numerador ?? 4),
            denominador: Number(p.denominador ?? 4),
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Compás → ${p.numerador ?? 4}/${p.denominador ?? 4}`
              : r.error?.message ?? 'Error compás',
          })
          break
        }
        case 'ui.setZoom': {
          const horizontal =
            p.horizontal != null
              ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(p.horizontal)))
              : undefined
          const r = await tienda.executor.execute('ui.setZoom', {
            horizontal,
            vertical: p.vertical != null ? Number(p.vertical) : undefined,
            scrollX: p.scrollX != null ? Number(p.scrollX) : undefined,
          })
          if (horizontal != null) {
            window.dispatchEvent(
              new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: horizontal } }),
            )
          }
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Zoom horizontal → ${horizontal ?? '—'}x`
              : r.error?.message ?? 'Error zoom',
          })
          break
        }
        case 'track.create': {
          const nombre = String(p.nombre ?? 'Pista')
          const tipo = (p.tipo as string) || 'midi'
          const r = await tienda.executor.execute('track.create', {
            nombre,
            tipo,
            color: p.color as string | undefined,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `Pista «${nombre}» (${tipo}) creada` : r.error?.message ?? 'Error pista',
          })
          break
        }
        case 'track.delete': {
          const r = await tienda.executor.execute('track.delete', { trackId: String(p.trackId) })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Pista eliminada' : r.error?.message ?? 'Error al eliminar',
          })
          break
        }
        case 'track.update': {
          const r = await tienda.executor.execute('track.update', {
            trackId: String(p.trackId),
            datos: p.datos ?? p,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Pista actualizada' : r.error?.message ?? 'Error update',
          })
          break
        }
        case 'track.toggleMute':
        case 'track.toggleSolo':
        case 'track.toggleArm': {
          const r = await tienda.executor.execute(action.type, { trackId: String(p.trackId) })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `${action.type} OK` : r.error?.message ?? 'Error toggle',
          })
          break
        }
        case 'transport.toggle':
        case 'transport.stop':
        case 'transport.toggleLoop':
        case 'transport.toggleMetronome':
        case 'transport.toggleRecord': {
          const r = await tienda.executor.execute(action.type, {})
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `${action.type} OK` : r.error?.message ?? 'Error transporte',
          })
          break
        }
        case 'transport.seek': {
          const r = await tienda.executor.execute('transport.seek', {
            segundos: Number(p.segundos ?? 0),
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `Seek → ${p.segundos}s` : r.error?.message ?? 'Error seek',
          })
          break
        }
        case 'master.update': {
          const r = await tienda.executor.execute('master.update', { datos: p.datos ?? p })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Master actualizado' : r.error?.message ?? 'Error master',
          })
          break
        }
        case 'clip.delete': {
          const r = await tienda.executor.execute('clip.delete', {
            pistaId: String(p.pistaId),
            clipId: String(p.clipId),
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Clip eliminado' : r.error?.message ?? 'Error clip',
          })
          break
        }
        case 'clip.move': {
          const r = await tienda.executor.execute('clip.move', {
            pistaId: String(p.pistaId),
            clipId: String(p.clipId),
            inicio: Number(p.inicio),
            pistaDestinoId: p.pistaDestinoId as string | undefined,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Clip movido' : r.error?.message ?? 'Error move',
          })
          break
        }
        case 'midi.notes.set': {
          const r = await tienda.executor.execute('midi.notes.set', {
            pistaId: String(p.pistaId),
            clipId: String(p.clipId),
            notas: p.notas,
            duracion: p.duracion != null ? Number(p.duracion) : undefined,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Notas MIDI actualizadas' : r.error?.message ?? 'Error notas',
          })
          break
        }
        case 'daw.generateMidiSong': {
          const state = tienda.obtenerEstado()
          const bpm = state.project.bpm?.valor ?? state.transport?.bpm ?? 120
          const tonalidad = String(p.tonalidad ?? '')
          const key = tonalidad
            ? inferKeyFromText(tonalidad)
            : {
                root: Number(p.keyRoot ?? 48),
                scale: (p.scale as 'major' | 'minor') ?? 'major',
                label: 'C mayor',
              }
          const minutes = Number(p.minutos ?? 3)
          const song = generateSoftPianoSong({
            keyRoot: Number(p.keyRoot ?? key.root),
            scale: (p.scale as 'major' | 'minor') ?? key.scale,
            bpm,
            minutes,
          })
          const nombre = String(p.nombre ?? `Piano ${key.label}`)
          const track = await findOrCreateMidiTrack(tienda, nombre)
          if (!track.trackId) {
            results.push({ type: action.type, success: false, message: track.error ?? 'Sin pista MIDI' })
            break
          }
          const clipRes = await tienda.executor.execute('midi.clip.create', {
            pistaId: track.trackId,
            nombre,
            inicio: 0,
            duracion: song.durationBeats,
            color: '#a78bfa',
            notas: song.notes,
          })
          const mins = (song.durationBeats / bpm).toFixed(1)
          results.push({
            type: action.type,
            success: clipRes.success,
            message: clipRes.success
              ? `Clip MIDI «${nombre}» en ${key.label}: ${song.notes.length} notas · ${mins} min · ${song.structureLabel}${track.created ? ' · pista creada' : ''}`
              : clipRes.error?.message ?? 'Error clip MIDI',
            data: { trackId: track.trackId, notes: song.notes.length, durationBeats: song.durationBeats },
          })
          break
        }
        case 'midi.clip.create': {
          let pistaId = p.pistaId ? String(p.pistaId) : ''
          if (!pistaId) {
            const track = await findOrCreateMidiTrack(tienda, String(p.nombre ?? 'MIDI'))
            if (!track.trackId) {
              results.push({ type: action.type, success: false, message: track.error ?? 'Sin pista' })
              break
            }
            pistaId = track.trackId
          }
          const notas = (p.notas as GeneratedNote[]) ?? []
          const r = await tienda.executor.execute('midi.clip.create', {
            pistaId,
            nombre: String(p.nombre ?? 'Clip MIDI'),
            inicio: Number(p.inicio ?? 0),
            duracion: p.duracion != null ? Number(p.duracion) : undefined,
            notas,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Clip MIDI con ${notas.length} notas`
              : r.error?.message ?? 'Error clip MIDI',
          })
          break
        }
        default:
          results.push({
            type: action.type,
            success: false,
            message: `Acción no soportada: ${action.type}`,
          })
      }
    } catch (err) {
      results.push({
        type: action.type,
        success: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}

export function formatActionResultsForUser(results: ActionResult[]): string {
  if (results.length === 0) return ''
  return results.map((r) => `${r.success ? '✓' : '✗'} ${r.message}`).join('\n')
}
