/**
 * Contexto de solo lectura para consultas (modo Ask / Plan / Pensar).
 */

import { ConsultaDAW } from '@jaswave/shared'
import type { DAWState } from '@jaswave/shared'
import { getProjectKey, getProjectKeyRegions, resolveKeyAtBeat } from '../../../shared/src/music/project-key'
import type { MidiClip, MidiNote } from '@jaswave/shared'
import { getSelectedTrackId } from './selection'
import { isProjectAuditIntent, isStyleGapIntent } from '../agent/modes'
import { buildStyleGapReport } from './style-gap-report'

const START_EPS = 1e-3

function beatsToBarBeat(
  beats: number,
  numerador: number,
): { bar: number; beat: number; label: string } {
  const bpb = Math.max(1, numerador)
  const bar = Math.floor(beats / bpb) + 1
  const beat = (beats % bpb) + 1
  return { bar, beat, label: `${bar}.${beat.toFixed(2).replace(/\.?0+$/, '')}` }
}

function noteKey(n: { pitch: number; inicio: number }): string {
  const start = Math.round(n.inicio / START_EPS) * START_EPS
  return `${Math.round(n.pitch)}@${start.toFixed(4)}`
}

function countDuplicateNotes(notes: MidiNote[]): number {
  const seen = new Set<string>()
  let dupes = 0
  for (const n of notes) {
    const k = noteKey(n)
    if (seen.has(k)) dupes += 1
    else seen.add(k)
  }
  return dupes
}

function notesOutsideClip(notes: MidiNote[], clipDur: number): number {
  let n = 0
  for (const note of notes) {
    if (note.inicio < -START_EPS || note.inicio + note.duracion > clipDur + START_EPS) n += 1
  }
  return n
}

function formatMidiClipLine(
  trackName: string,
  clip: MidiClip,
  numerador: number,
): string {
  const notes = clip.notas ?? []
  const inicio = Number(clip.inicio ?? 0)
  const dur = Number(clip.duracion ?? 0)
  const fin = inicio + dur
  const startL = beatsToBarBeat(inicio, numerador).label
  const endL = beatsToBarBeat(fin, numerador).label
  const pitches = notes.map((n) => n.pitch)
  const lo = pitches.length ? Math.min(...pitches) : null
  const hi = pitches.length ? Math.max(...pitches) : null
  const dens = dur > 0.001 ? notes.length / dur : notes.length
  const dupes = countDuplicateNotes(notes)
  const outside = notesOutsideClip(notes, dur)
  const flags: string[] = []
  if (notes.length === 0) flags.push('VACÍO')
  if (dupes > 0) flags.push(`~${dupes} duplicados`)
  if (outside > 0) flags.push(`${outside} notas fuera del clip`)
  if (dur <= 0) flags.push('duración 0')
  const flagTxt = flags.length ? ` ⚠ ${flags.join(', ')}` : ''
  const pitchTxt = lo != null && hi != null ? ` pitch=${lo}–${hi}` : ''
  return [
    `  - «${clip.nombre || 'Clip'}» id=${clip.id} pista=«${trackName}»`,
    `inicio=${inicio.toFixed(3)}b (compás ${startL}) dur=${dur.toFixed(3)}b fin=${fin.toFixed(3)}b (compás ${endL})`,
    `notas=${notes.length}${pitchTxt} dens=${dens.toFixed(2)}/beat${flagTxt}`,
  ].join(' ')
}

/** Timeline de clips MIDI con tiempos en beats/compases — para criterio de productor. */
export function formatMidiTimelineForPrompt(state: DAWState, maxClips = 48): string {
  const numerador = state.project?.timeSignature?.numerador ?? 4
  const bpm = state.project?.bpm?.valor ?? 120
  const lines: string[] = [
    `## Timeline MIDI (beats / compases · ${bpm} BPM · ${numerador}/4 → 1 compás = ${numerador} beats)`,
    'Usa estos tiempos reales. No inventes posiciones. Un productor mira inicio/fin del clip vs notas.',
  ]
  let count = 0
  for (const t of state.project?.tracks ?? []) {
    const midiClips = (t.clips ?? []).filter((c): c is MidiClip => c.tipo === 'midi')
    if (!midiClips.length) continue
    lines.push(`- pista «${t.nombre}» [${t.tipo}] id=${t.id}`)
    for (const c of midiClips) {
      if (count >= maxClips) {
        lines.push('  … (más clips omitidos)')
        return lines.join('\n')
      }
      lines.push(formatMidiClipLine(t.nombre, c as MidiClip, numerador))
      count += 1
    }
  }
  if (count === 0) lines.push('(sin clips MIDI)')
  return lines.join('\n')
}

export type MidiAuditIssue = {
  priority: 1 | 2 | 3
  kind: 'empty' | 'duplicate' | 'outside' | 'zero_dur' | 'long' | 'dense' | 'sparse'
  trackId: string
  trackName: string
  clipName: string
  clipId: string
  message: string
}

/** Diagnóstico determinista (productor) — no depende del LLM. */
export function collectMidiAuditIssues(state: DAWState): MidiAuditIssue[] {
  const issues: MidiAuditIssue[] = []
  const numerador = state.project?.timeSignature?.numerador ?? 4
  for (const t of state.project?.tracks ?? []) {
    for (const c of t.clips ?? []) {
      if ((c as MidiClip).tipo !== 'midi') continue
      const clip = c as MidiClip
      const notes = clip.notas ?? []
      const inicio = Number(clip.inicio ?? 0)
      const dur = Number(clip.duracion ?? 0)
      const bars = Math.max(1, Math.round(dur / Math.max(1, numerador)))
      const name = clip.nombre || 'Clip'
      const base = { trackId: t.id, trackName: t.nombre, clipName: name, clipId: clip.id }

      if (notes.length === 0) {
        issues.push({
          ...base,
          kind: 'empty',
          priority: 1,
          message: `El clip está vacío (sin notas). Empieza en el compás ~${Math.floor(inicio / numerador) + 1}.`,
        })
        continue
      }
      const dupes = countDuplicateNotes(notes)
      if (dupes > 0) {
        issues.push({
          ...base,
          kind: 'duplicate',
          priority: 1,
          message: `Hay unas ${dupes} notas repetidas encima de sí mismas (mismo golpe, mismo instante). Suele sonar raro o “doble”. Se pueden limpiar con un solo paso.`,
        })
      }
      const outside = notesOutsideClip(notes, dur)
      if (outside > 0) {
        issues.push({
          ...base,
          kind: 'outside',
          priority: 1,
          message: `${outside} nota(s) se salen del borde del clip (empiezan o terminan fuera). Acorta esas notas o alarga el clip.`,
        })
      }
      if (dur <= 0) {
        issues.push({
          ...base,
          kind: 'zero_dur',
          priority: 1,
          message: 'El clip no tiene duración válida (longitud 0).',
        })
      } else if (dur > 64) {
        issues.push({
          ...base,
          kind: 'long',
          priority: 2,
          message: `Es un bloque muy largo (~${bars} compases en un solo clip). En el arrange suele ir mejor partido por secciones (verso, coro, puente) para editar y mezclar con claridad.`,
        })
      }
      const dens = dur > 0.001 ? notes.length / dur : notes.length
      if (dens > 12) {
        issues.push({
          ...base,
          kind: 'dense',
          priority: 2,
          message: `Hay muchas notas amontonadas (${notes.length} en ~${bars} compases). Puede ser stack/duplicado o un patrón demasiado denso.`,
        })
      }
      if (dens < 0.05 && notes.length > 0 && dur > 8) {
        issues.push({
          ...base,
          kind: 'sparse',
          priority: 3,
          message: `Hay pocas notas para un clip tan largo (${notes.length} notas en ~${bars} compases): se oyen huecos largos.`,
        })
      }
    }
  }
  issues.sort((a, b) => a.priority - b.priority || a.trackName.localeCompare(b.trackName))
  return issues
}

export type MidiAuditFixAction = {
  type: string
  payload: Record<string, unknown>
}

/** ACTIONS seguras para remediar hallazgos (dedupe). */
export function buildMidiAuditFixActions(state: DAWState): MidiAuditFixAction[] {
  const seen = new Set<string>()
  const actions: MidiAuditFixAction[] = []
  for (const issue of collectMidiAuditIssues(state)) {
    if (issue.kind !== 'duplicate') continue
    const key = `${issue.trackId}:${issue.clipId}`
    if (seen.has(key)) continue
    seen.add(key)
    actions.push({
      type: 'midi.notes.dedupe',
      payload: {
        pistaId: issue.trackId,
        clipId: issue.clipId,
        trackName: issue.trackName,
        clipName: issue.clipName,
      },
    })
  }
  return actions
}

/** Formulario de clarificación para la UI tras una auditoría. */
export function buildMidiAuditClarifications(state: DAWState): Array<{
  id: string
  question: string
  options: string[]
  allowCustom?: boolean
  multi?: boolean
}> {
  const n = buildMidiAuditFixActions(state).length
  if (n === 0) return []
  return [
    {
      id: 'midi_audit_fix',
      question: `Hay ${n} clip(s) con notas duplicadas (golpes repetidos encima). ¿Qué hacemos?`,
      options: [
        'Aplicar: quitar todos los duplicados',
        'Solo el informe (no tocar el DAW)',
        'Arréglalo todo lo posible ahora',
      ],
      allowCustom: true,
      multi: false,
    },
  ]
}

function urgencyLabel(priority: 1 | 2 | 3): string {
  if (priority === 1) return 'Urgente'
  if (priority === 2) return 'Revisar'
  return 'Detalle'
}

/** Informe en español claro para un productor de DAW (sin jerga P1/beats crudos). */
export function buildMidiAuditReport(state: DAWState): string {
  const bpm = state.project?.bpm?.valor ?? 120
  const numerador = state.project?.timeSignature?.numerador ?? 4
  const nombre = state.project?.nombre ?? 'Proyecto'
  const issues = collectMidiAuditIssues(state)
  let midiClips = 0
  let noteTotal = 0
  for (const t of state.project?.tracks ?? []) {
    for (const c of t.clips ?? []) {
      if ((c as MidiClip).tipo !== 'midi') continue
      midiClips += 1
      noteTotal += ((c as MidiClip).notas ?? []).length
    }
  }

  const lines: string[] = [
    `## Revisión rápida del proyecto`,
    `«${nombre}» · **${bpm} BPM** · ${numerador}/4 · ${midiClips} clip(s) MIDI · ${noteTotal.toLocaleString('es')} notas en total.`,
    '',
  ]

  if (midiClips === 0) {
    lines.push('No hay clips MIDI todavía. Crea o importa MIDI a una pista para poder revisarlo.')
    return lines.join('\n')
  }

  if (issues.length === 0) {
    lines.push(
      'No veo problemas graves (clips vacíos, notas duplicadas ni notas fuera del clip). El siguiente paso es escucharlo a oído: groove, dinámica y balance entre pistas.',
    )
    lines.push('')
    lines.push(formatMidiTimelineForPrompt(state, 16))
    return lines.join('\n')
  }

  const urgent = issues.filter((i) => i.priority === 1)
  const review = issues.filter((i) => i.priority === 2)
  const detail = issues.filter((i) => i.priority === 3)

  lines.push(`Encontré **${issues.length}** cosa(s) a mirar:`)
  if (urgent.length) lines.push(`- **${urgent.length}** urgente(s) (suelen notarse al instante)`)
  if (review.length) lines.push(`- **${review.length}** para revisar (organización / densidad)`)
  if (detail.length) lines.push(`- **${detail.length}** detalle(s) menores`)
  lines.push('')

  const maxShow = 12
  const shown = issues.slice(0, maxShow)
  for (let i = 0; i < shown.length; i++) {
    const it = shown[i]!
    const clipBit =
      it.clipName && it.clipName !== it.trackName ? ` · clip «${it.clipName}»` : ''
    lines.push(`${i + 1}. **${urgencyLabel(it.priority)}** — pista **«${it.trackName}»**${clipBit}`)
    lines.push(`   ${it.message}`)
  }
  if (issues.length > maxShow) {
    lines.push('')
    lines.push(`…y ${issues.length - maxShow} más (mismo tipo de avisos).`)
  }

  const hasDupes = issues.some((i) => i.kind === 'duplicate')
  lines.push('')
  if (hasDupes) {
    lines.push(
      'Si quieres, abajo puedes **aplicar la limpieza de notas duplicadas** con un clic (sin reescribir el pedido).',
    )
  } else {
    lines.push(
      'Nada de esto es un “error fatal”: son avisos de arrange. Puedes partir clips, limpiar notas o pedirme que lo haga por pista.',
    )
  }
  return lines.join('\n')
}

/** Respuesta del modelo vacía o basura (¡¡¡, solo puntuación, plan inventado fuera de lugar). */
export function isGarbageAssistantReply(text: string): boolean {
  const t = text.replace(/```[\s\S]*?```/g, '').trim()
  if (!t) return true
  if (/^[¡!]{3,}$/.test(t)) return true
  if (/[¡!]{8,}/.test(t) && t.replace(/[¡!\s]/g, '').length < 40) return true
  if (
    /Escribe solo el pensamiento de ESTA capa|##\s*Capa\s+\d+\s*\/\s*\d+|<<<READY_FOR_GAP_REPORT>>>/i.test(
      t,
    ) &&
    t.replace(/Escribe solo el pensamiento[\s\S]{0,80}/gi, '').trim().length < 40
  ) {
    return true
  }
  // Solo meta-instrucciones sin datos de clips
  if (
    t.length < 80 &&
    /priorizaci[oó]n|lista de (prioridades|acciones)|sin acciones|cierre final/i.test(t) &&
    !/\b(pista|clip|beats?|notas?|BPM|duplicad)\b/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * Plan de producción multi-día / musicBuild cuando el usuario pidió análisis o gap de estilo.
 * Usado para invalidar respuestas off-topic en el chat.
 */
export function isOffTopicCreatePlanReply(userText: string, assistantText: string): boolean {
  const auditish =
    isProjectAuditIntent(userText) ||
    isStyleGapIntent(userText) ||
    /\b(analiz|qu[eé]\s+le\s+falta|investiga)/i.test(userText)
  if (!auditish) return false
  const a = assistantText
  if (/Plan de Producci[oó]n|Fase\s*1\s*:\s*.*\(\s*\d+\s*[-–]\s*\d+\s*d[ií]as?\)/i.test(a)) return true
  if (/daw\.musicBuild|musicBuild/i.test(a) && !/aplicar\s*:\s*false/i.test(a)) return true
  if (/¡Entendido!.*plan de producci/i.test(a)) return true
  return false
}

export function buildReadOnlyProjectContext(state: DAWState): string {
  const q = new ConsultaDAW(state)
  let resumen: {
    nombre: string
    bpm: number
    compas: number
    duracion: number
    sampleRate: number
    bitDepth: number
    pistas: number
    clips: number
    modificado: boolean
  }
  try {
    resumen = q.obtenerResumenProyecto()
  } catch {
    const p = state.project
    const clips = (p?.tracks ?? []).flatMap((t) => t.clips ?? [])
    resumen = {
      nombre: p?.nombre ?? 'Proyecto',
      bpm: p?.bpm?.valor ?? 120,
      compas: p?.timeSignature?.numerador ?? 4,
      duracion: Number(p?.timeline?.duracion?.segundos ?? 0),
      sampleRate: p?.sampleRate ?? 48000,
      bitDepth: p?.bitDepth ?? 24,
      pistas: p?.tracks?.length ?? 0,
      clips: clips.length,
      modificado: Boolean(p?.modificado),
    }
  }
  const pistas = q.obtenerPistas()
  const transporte = state.transport
  const grabando = transporte?.grabacion === 'grabando'
  const armado = transporte?.grabacion === 'armada' || grabando
  const selectedId = getSelectedTrackId(state)
  const selected = selectedId ? pistas.find((t) => t.id === selectedId) : undefined
  const numerador = state.project?.timeSignature?.numerador ?? 4

  const lineasPistas = pistas
    .slice(0, 24)
    .map((t) => {
      const clips = Array.isArray(t.clips) ? t.clips.length : 0
      const mark = t.id === selectedId ? ' ← SELECCIONADA' : ''
      const plugs = (t.plugins ?? [])
        .slice(0, 6)
        .map((p) => `${p.nombre}(${p.id})`)
        .join(', ')
      const plugTxt = plugs ? ` plugins=[${plugs}]` : ''
      return `- ${t.nombre} [${t.tipo}] id=${t.id} mute=${t.silenciada ? 'sí' : 'no'} solo=${t.soloActiva ? 'sí' : 'no'} armada=${t.armada ? 'sí' : 'no'} clips=${clips}${plugTxt}${mark}`
    })
    .join('\n')

  const clipLines = pistas
    .flatMap((t) =>
      (t.clips ?? []).slice(0, 12).map((c) => {
        const name = (c as { nombre?: string }).nombre || 'Clip'
        const inicio = Number((c as { inicio?: number }).inicio ?? 0)
        const dur = Number((c as { duracion?: number }).duracion ?? 0)
        const tipo = (c as { tipo?: string }).tipo ?? '?'
        const startL = beatsToBarBeat(inicio, numerador).label
        return `  - «${name}» id=${c.id} pista=«${t.nombre}» tipo=${tipo} inicio=${inicio.toFixed(3)}b (${startL}) dur=${dur.toFixed(3)}b`
      }),
    )
    .slice(0, 40)
    .join('\n')

  return [
    '## Resumen del proyecto (solo lectura)',
    `Nombre: ${resumen.nombre}`,
    `BPM: ${resumen.bpm}`,
    `Compás: ${resumen.compas}/4`,
    (() => {
      const pk = getProjectKey(state.project?.metadata)
      const regions = getProjectKeyRegions(state.project?.metadata)
      if (!pk && regions.length === 0) return 'Tonalidad: (no configurada)'
      const lines = [`Tonalidad base: ${pk?.label ?? '(sin base)'}`]
      if (regions.length) {
        lines.push(
          ...regions.map(
            (r) =>
              `  - ${r.inicioBeats.toFixed(1)}–${r.finBeats.toFixed(1)} beats → ${r.label}`,
          ),
        )
      }
      const atPlayhead = resolveKeyAtBeat(state.project?.metadata, (transporte?.posicion?.segundos ?? 0) * (resumen.bpm / 60))
      if (atPlayhead) lines.push(`Tono en playhead: ${atPlayhead.label}`)
      return lines.join('\n')
    })(),
    `Duración: ${resumen.duracion.toFixed(2)}s`,
    `Sample rate: ${resumen.sampleRate} / ${resumen.bitDepth}-bit`,
    `Pistas: ${resumen.pistas} · Clips: ${resumen.clips} · Modificado: ${resumen.modificado ? 'sí' : 'no'}`,
    (() => {
      const folders = state.project?.takeFolders ?? []
      if (!folders.length) return ''
      const lines = folders.map((f) => {
        const segs = f.segments.length
        return `- pista ${f.pistaId}: ${f.takes.length} toma(s), ${segs} segmento(s) comp`
      })
      return `\n## Tomas / Comp\n${lines.join('\n')}`
    })(),
    '',
    '## Transporte',
    `Reproduciendo: ${transporte?.reproduciendo ? 'sí' : 'no'}`,
    `Grabación: ${grabando ? 'sí (grabando)' : armado ? 'armada (no grabando aún)' : 'no'}`,
    `Estado grabación: ${transporte?.grabacion ?? 'inactiva'}`,
    `Loop: ${transporte?.loop?.activo ? 'sí' : 'no'}`,
    `Posición: ${(transporte?.posicion?.segundos ?? 0).toFixed(3)}s`,
    '',
    '## Pistas',
    lineasPistas || '(sin pistas)',
    '',
    '## Clips (inicio/duración en beats)',
    clipLines || '(sin clips)',
    '',
    formatMidiTimelineForPrompt(state),
    '',
    selected
      ? `Pista seleccionada: «${selected.nombre}» [${selected.tipo}] id=${selected.id}`
      : 'Ninguna pista seleccionada.',
    '',
    '## Criterio de productor (obligatorio al opinar / auditar)',
    '- Mira tiempos de clip (inicio/duración/fin en beats y compás) y si las notas caben dentro.',
    '- Señala duplicados (mismo pitch+inicio), vacíos, densidades absurdas, solapes rítmicos raros.',
    '- Autoría precisa: Docs `clip-<clipId>.md` (tabla nota a nota). Preferir midi.clip.md.upsert → preview → apply.',
    '- No inventes melodías ni «empezar en G mayor» si el usuario pidió analizar lo que YA hay.',
    '',
    'Responde en español, de forma concisa. Eres el Asistente Jas de JasWave.',
    'Usa los ids reales de arriba. No inventes pistas ni clips que no existan.',
  ].join('\n')
}

export function answerLocalReadQuery(state: DAWState, question: string): string | null {
  const q = new ConsultaDAW(state)
  const lower = question.toLowerCase()
  const resumen = q.obtenerResumenProyecto()
  const pistas = q.obtenerPistas()

  if (/cu[aá]ntas?\s+pistas|n[uú]mero de pistas|how many tracks/.test(lower)) {
    return `El proyecto tiene **${pistas.length}** pista(s).`
  }
  if (/bpm|tempo/.test(lower) && !/\d+/.test(lower)) {
    return `El tempo actual es **${resumen.bpm} BPM**.`
  }
  if (/nombre del proyecto|c[oó]mo se llama/.test(lower)) {
    return `El proyecto se llama **${resumen.nombre}**.`
  }
  if (/clips|cu[aá]ntos clips/.test(lower)) {
    return `Hay **${resumen.clips}** clip(s) en total.`
  }
  if (/resumen|estado (del|de (este|el))? proyecto|qu[eé] hay/.test(lower)) {
    return [
      `**${resumen.nombre}** — ${resumen.bpm} BPM, ${resumen.pistas} pistas, ${resumen.clips} clips.`,
      resumen.modificado ? 'Hay cambios sin guardar.' : 'Sin cambios pendientes.',
    ].join(' ')
  }
  if (/lista(r)?\s+pistas|qu[eé] pistas/.test(lower)) {
    if (pistas.length === 0) return 'No hay pistas todavía.'
    return pistas.map((t, i) => `${i + 1}. ${t.nombre} (${t.tipo})`).join('\n')
  }
  if (isStyleGapIntent(question)) {
    return buildStyleGapReport(state, { userText: question })
  }
  if (isProjectAuditIntent(question) || /\b(audita|arreglar|timeline|clips?\s+midi)\b/.test(lower)) {
    return buildMidiAuditReport(state)
  }
  return null
}
