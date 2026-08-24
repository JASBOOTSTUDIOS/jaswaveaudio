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
    hint: 'Ejecuta y repara hasta completar el plan',
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
      'Eres ingeniero de sonido y arreglista senior. El arreglo lo defines TÚ (cualquier género), no una plantilla fija.',
      '- Declara genero, tonalidad, BPM, secciones con degrees+density, y pistas con rol/articulación/VST.',
      '- Contraste armónico entre secciones; evita ser muy basico salvo que el género/usuario lo pida.',
      'NO mutes el DAW. OBLIGATORIO: plan.md + <<<PLAN … PLAN>>>.',
      'Vista previa: daw.musicBuild { aplicar:false, prompt, genero, progresion, secciones, pistas }.',
      'plugin.lookup / library.preset.search / plugin.probe permitidos. NO digas que ya aplicaste cambios.',
    ].join('\n')
  }
  return [
    '## Modo: CREACIÓN',
    'Ejecuta en el DAW. Si plan.md existe, síguelo hasta vaciar «Por implementar».',
    'Persiste: el harness inspecciona el proyecto real (pistas/plugins/notas) y te devolverá errores con debug. No digas "listo" si el plan o el DAW siguen incompletos.',
    'Canciones: daw.musicBuild { aplicar:true, prompt, genero, progresion, secciones, pistas } — spec completo.',
    'Tras build: mezcla (track.update vol/pan), sends (bus.create/send.set), automatización si hace falta, master.update.',
    'Entrega: daw.masterPass o render.start + analysis.fullReport + analysis.compareTarget. Exige AudioListenReport OK.',
    'VSTs: plugin.probe → library.preset.apply o plugin.insert. No inventes plugins.',
    'Si falla algo: repara el ítem concreto (clip/plugin/checkbox). No repitas daw.musicBuild completo.',
    'Actualiza plan.md (Implementado / Por implementar / Evaluación) en cada cierre.',
  ].join('\n')
}
