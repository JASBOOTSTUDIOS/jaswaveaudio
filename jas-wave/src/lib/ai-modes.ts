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
    hint: 'Razona el arreglo; no muta hasta Construir',
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
  return /proyecto completo|desde cero|todas las pistas|producci[oó]n completa|arreglo completo|canci[oó]n completa|full (song|mix|project)|armame (el |un )?tema|banda completa|hazme (una |un )?(canci[oó]n|tema)|cr[eé]ame (una |un )?(canci[oó]n|tema)|crea(me)? (una |un )?(canci[oó]n|tema)|produce(me)? (una |un )?(canci[oó]n|tema)|music build/i.test(
    text,
  )
}

export function detectAgentMode(text: string, forced: AgentMode = 'auto'): AgentMode {
  if (forced !== 'auto') return forced
  const t = text.toLowerCase()
  if (/\bplan\b|estructura|c[oó]mo lo har|antes de crear|propuesta|vista previa/.test(t) && !/aplica|hazlo ya/.test(t) && !/crea(r|me)? (el |un )?(proyecto|clip|pista|canci)/.test(t)) {
    return 'plan'
  }
  const creating = /crea|genera|aplica|hazme|cr[eé]ame|inserta|arm[aá]|pon(me)?|produce/.test(t)
  if (wantsFullProject(t)) return creating ? 'create' : 'think'
  if (/piensa|criterio|ingeniero|arreglo|orquest/i.test(t) && !creating) return 'think'
  if (creating) return 'create'
  return 'plan'
}

export function modePromptBlock(mode: AgentMode): string {
  if (mode === 'plan') {
    return [
      '## Modo: PLAN',
      'NO mutes el DAW (no crees/borres pistas, clips ni plugins).',
      'Si faltan datos (BPM, tonalidad, género, duración), PREGUNTA; si ya hay suficiente, cierra el plan.',
      'OBLIGATORIO: escribe el plan en plan.md con este bloque (markdown completo):',
      '<<<DOC plan.md',
      '# Plan: …',
      '## Intención',
      '…',
      '## Por implementar',
      '- [ ] Pista «…» (rol · VST …)',
      '## En curso',
      '## Implementado',
      '## Evaluación',
      '## Notas del usuario',
      'DOC>>>',
      'También emite <<<PLAN {json} PLAN>>> con nombre, bpm, tonalidad, minutos, pensamiento, pistas[].',
      'Puedes usar doc.write { slug:"plan.md", content }. ACTIONS de DAW solo como borrador (aplicar:false); el usuario pulsará Construir.',
    ].join('\n')
  }
  if (mode === 'think') {
    return [
      '## Modo: PENSAMIENTO PROFUNDO',
      'Eres ingeniero de sonido y arreglista. Razona género, instrumentación, rango MIDI de CADA VST, velocidades, densidad y forma.',
      'NO mutes el DAW. Pregunta solo lo imprescindible; si el usuario ya pidió una canción, redacta el plan.',
      'OBLIGATORIO al cerrar el razonamiento: actualizar plan.md con <<<DOC plan.md … DOC>>> (Intención + Por implementar con checkboxes por pista/VST/BPM).',
      'También emite <<<PLAN {"nombre","bpm","tonalidad","minutos","pensamiento","pistas":[…]} PLAN>>>.',
      'Si propones ACTIONS de DAW, usar aplicar:false. Si propones tempo, ponlo en el PLAN y en plan.md (ej. 72 BPM).',
      'Proyecto completo: daw.musicBuild { prompt, aplicar:false }. plugin.lookup y doc.write están permitidos.',
      'NO digas que ya aplicaste cambios en el arrange: el cliente bloquea mutaciones hasta Construir.',
    ].join('\n')
  }
  return [
    '## Modo: CREACIÓN',
    'Ejecuta en el DAW. Si el plan.md existe, síguelo (el usuario puede haberlo editado).',
    'Si es un clip suelto: daw.generateMidiSong con pistaId y aplicar:true. Si mencionas BPM, incluye también project.setBpm.',
    'Si es una canción / proyecto completo: daw.musicBuild { aplicar:true, prompt }. Orquesta pistas, VSTs del catálogo, MIDI validado y mezcla por rol. No inventes plugins.',
    'Si es un arreglo corto ya planeado: daw.composeProject { aplicar:true, pistas:[...] }.',
    'Acciones destructivas (borrar pistas/clips/todo) requerirán confirmación del usuario en el chat.',
    'Al terminar, el harness verifica el DAW y puede pedir reparaciones. No repitas daw.musicBuild. Actualiza Evaluación e Implementado.',
  ].join('\n')
}
