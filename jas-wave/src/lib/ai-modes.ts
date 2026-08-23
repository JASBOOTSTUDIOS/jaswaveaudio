/**
 * Modos del Asistente Jas: el agente cambia de criterio según la tarea.
 */

export type AgentMode = 'auto' | 'plan' | 'create' | 'think'

export const AGENT_MODE_META: Record<
  Exclude<AgentMode, 'auto'>,
  { label: string; hint: string; insert: string }
> = {
  plan: {
    label: 'Plan',
    hint: 'Propone estructura y VSTs sin mutar el DAW',
    insert: 'haz un plan del proyecto',
  },
  create: {
    label: 'Crear',
    hint: 'Ejecuta pistas, clips y plugins en el proyecto',
    insert: 'crea esto en el DAW',
  },
  think: {
    label: 'Pensar',
    hint: 'Arreglo profundo: género, mapa MIDI, VSTs, dinámica',
    insert: 'piensa el arreglo completo y muéstrame una vista previa',
  },
}

const MODE_KEY = 'jaswave-ai-agent-mode'

export function loadAgentMode(): AgentMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'plan' || v === 'create' || v === 'think' || v === 'auto') return v
  } catch {
    /* ignore */
  }
  return 'auto'
}

export function saveAgentMode(mode: AgentMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function wantsFullProject(text: string): boolean {
  return /proyecto completo|desde cero|todas las pistas|producci[oó]n completa|arreglo completo|canci[oó]n completa|full (song|mix|project)|armame (el |un )?tema|banda completa/i.test(
    text,
  )
}

export function detectAgentMode(text: string, forced: AgentMode = 'auto'): AgentMode {
  if (forced !== 'auto') return forced
  const t = text.toLowerCase()
  if (/\bplan\b|estructura|c[oó]mo lo har|antes de crear|propuesta|vista previa/.test(t) && !/aplica|hazlo ya/.test(t) && !/crea(r|me)? (el |un )?(proyecto|clip|pista)/.test(t)) {
    return 'plan'
  }
  if (wantsFullProject(t) || /piensa|criterio|ingeniero|arreglo|orquest/i.test(t)) return 'think'
  if (/crea|genera|aplica|hazme|inserta|arm[aá]|pon(me)?/.test(t)) return 'create'
  return 'plan'
}

export function modePromptBlock(mode: AgentMode): string {
  if (mode === 'plan') {
    return [
      '## Modo: PLAN',
      'NO mutes el DAW. Devuelve un plan de producción (pistas, VST del catálogo, mapas MIDI, dinámica).',
      'Bloque obligatorio:',
      '<<<PLAN',
      '{"nombre","bpm","tonalidad","minutos","pensamiento","pistas":[{"nombre","rol","pluginNombre","articulacion","notasUso"}]}',
      'PLAN>>>',
      'El cliente mostrará una vista previa y guardará/actualizará plan.md (editable por el usuario).',
      'También puedes emitir <<<DOC plan.md ... DOC>>>. No pises la sección «Notas del usuario».',
    ].join('\n')
  }
  if (mode === 'think') {
    return [
      '## Modo: PENSAMIENTO PROFUNDO',
      'Eres ingeniero de sonido y arreglista. Razona género, instrumentación, rango MIDI de CADA VST (no asumas piano), velocidades, densidad y forma.',
      'Si el usuario pide un proyecto completo: primero PLAN en plan.md (<<<DOC plan.md o <<<PLAN), luego si debes ejecutar usa daw.composeProject { aplicar:true, ... }.',
      'Después de ejecutar, el cliente te pedirá UN turno de revisión: intención vs por implementar vs lo implementado. Actualiza ## Evaluación con tu juicio (no solo checkboxes).',
      'Si un VST no es piano/guitarra (batería, orquesta, keyswitches, kits), consulta el mapa de notas del catálogo / plugin.lookup.',
      'Puedes emitir plugin.lookup { nombre } antes de escribir MIDI para ese instrumento.',
    ].join('\n')
  }
  return [
    '## Modo: CREACIÓN',
    'Ejecuta en el DAW. Si el plan.md existe, síguelo (el usuario puede haberlo editado).',
    'Si es un clip suelto: daw.generateMidiSong con pistaId y aplicar:true.',
    'Si es un proyecto / varias pistas: daw.composeProject { aplicar:true, pistas:[...] } y carga el VST del catálogo por pista.',
    'Al terminar, el cliente evalúa el DAW vs plan.md y te pide un turno de revisión. Actualiza Evaluación (juicio) e Implementado. Puedes usar doc.evaluate o <<<DOC plan.md.',
  ].join('\n')
}
