/**
 * Contexto de solo lectura para Asistente Jas (MVP 017).
 * No muta DAWState.
 */

import { ConsultaDAW } from '../../../shared/src/state/consulta'
import type { DAWState } from '../../../shared/src'

export function buildReadOnlyProjectContext(state: DAWState): string {
  const q = new ConsultaDAW(state)
  const resumen = q.obtenerResumenProyecto()
  const pistas = q.obtenerPistas()
  const transporte = state.transport
  const grabando = transporte?.grabacion === 'grabando'
  const armado = transporte?.grabacion === 'armada' || grabando

  const lineasPistas = pistas
    .slice(0, 24)
    .map((t) => {
      const clips = Array.isArray(t.clips) ? t.clips.length : 0
      return `- ${t.nombre} [${t.tipo}] mute=${t.silenciada ? 'sí' : 'no'} solo=${t.soloActiva ? 'sí' : 'no'} armada=${t.armada ? 'sí' : 'no'} clips=${clips}`
    })
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
    'Responde en español, de forma concisa. Eres el Asistente Jas de JasWave.',
    'En este modo MVP solo puedes INFORMAR sobre el proyecto (lectura).',
    'No digas que vas a cambiar el proyecto; sugiere comandos/atajos si el usuario quiere mutar.',
    'No inventes pistas, clips ni valores que no aparezcan arriba.',
  ].join('\n')
}

/** Respuestas locales sin LLM para consultas frecuentes. */
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
