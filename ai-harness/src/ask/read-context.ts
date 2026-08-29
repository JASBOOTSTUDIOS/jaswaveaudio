/**
 * Contexto de solo lectura para consultas (modo Ask / Plan / Pensar).
 */

import { ConsultaDAW } from '@jaswave/shared'
import type { DAWState } from '@jaswave/shared'
import { getSelectedTrackId } from './selection'

export function buildReadOnlyProjectContext(state: DAWState): string {
  const q = new ConsultaDAW(state)
  const resumen = q.obtenerResumenProyecto()
  const pistas = q.obtenerPistas()
  const transporte = state.transport
  const grabando = transporte?.grabacion === 'grabando'
  const armado = transporte?.grabacion === 'armada' || grabando
  const selectedId = getSelectedTrackId(state)
  const selected = selectedId ? pistas.find((t) => t.id === selectedId) : undefined

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
      (t.clips ?? []).slice(0, 8).map((c) => {
        const name = (c as { nombre?: string }).nombre || 'Clip'
        return `  - «${name}» id=${c.id} pista=«${t.nombre}» tipo=${(c as { tipo?: string }).tipo ?? '?'}`
      }),
    )
    .slice(0, 30)
    .join('\n')

  return [
    '## Resumen del proyecto (solo lectura)',
    `Nombre: ${resumen.nombre}`,
    `BPM: ${resumen.bpm}`,
    `Compás: ${resumen.compas}/4`,
    `Duración: ${resumen.duracion.toFixed(2)}s`,
    `Sample rate: ${resumen.sampleRate} / ${resumen.bitDepth}-bit`,
    `Pistas: ${resumen.pistas} · Clips: ${resumen.clips} · Modificado: ${resumen.modificado ? 'sí' : 'no'}`,
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
    '## Clips (menciona con @nombre)',
    clipLines || '(sin clips)',
    '',
    selected
      ? `Pista seleccionada: «${selected.nombre}» [${selected.tipo}] id=${selected.id}`
      : 'Ninguna pista seleccionada.',
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
  if (/resumen|estado del proyecto|qu[eé] hay/.test(lower)) {
    return [
      `**${resumen.nombre}** — ${resumen.bpm} BPM, ${resumen.pistas} pistas, ${resumen.clips} clips.`,
      resumen.modificado ? 'Hay cambios sin guardar.' : 'Sin cambios pendientes.',
    ].join(' ')
  }
  if (/lista(r)?\s+pistas|qu[eé] pistas/.test(lower)) {
    if (pistas.length === 0) return 'No hay pistas todavía.'
    return pistas.map((t, i) => `${i + 1}. ${t.nombre} (${t.tipo})`).join('\n')
  }
  return null
}
