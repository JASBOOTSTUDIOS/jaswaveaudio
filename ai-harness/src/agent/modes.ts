/**
 * Modos del asistente (Plan / Crear / Pensar / Auto) — sin persistencia UI.
 */

export type AgentMode = 'auto' | 'ask' | 'plan' | 'create' | 'think'

export const AGENT_MODE_META: Record<
  Exclude<AgentMode, 'auto'>,
  { label: string; hint: string; insert: string }
> = {
  ask: {
    label: 'Consulta',
    hint: 'Responde sobre el proyecto sin mutar el DAW',
    insert: 'explícame cómo está el proyecto',
  },
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

export function wantsFullProject(text: string): boolean {
  const t = text
  if (
    /proyecto completo|desde cero|todas las pistas|producci[oó]n completa|arreglo completo|canci[oó]n completa|full (song|mix|project)|armame (el |un )?tema|banda completa|music build/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /(crea(r|s|me)?|crees|cr[eé]a(s|me)?|haz(me)?|genera(me)?|produce(me)?|quiero que (me )?(creas|crees|hagas))\s+(una?\s+)?(canci[oó]n|tema|song)\b/i.test(
      t,
    )
  ) {
    return true
  }
  const roleRe =
    /\b(bater[ií]as?|drums?|bfd|bajos?|bass|guitarras?|guitars?|pianos?|pads?|cuerdas|strings|sint[eé]s?|leads?)\b/gi
  const roles = new Set<string>()
  for (const m of t.matchAll(roleRe)) {
    const raw = m[1]!.toLowerCase()
    if (/bater|drum|bfd/.test(raw)) roles.add('drums')
    else if (/bajo|bass/.test(raw)) roles.add('bass')
    else if (/guitar/.test(raw)) roles.add('guitar')
    else if (/piano/.test(raw)) roles.add('piano')
    else if (/pad/.test(raw)) roles.add('pad')
    else if (/cuerda|string/.test(raw)) roles.add('strings')
    else if (/sint|lead/.test(raw)) roles.add('synth')
  }
  const creating = /(crea|crees|cr[eé]a|haz|genera|produce|arm[aá]|quiero|necesito)/i.test(t)
  if (roles.size >= 2 && creating) return true
  return false
}

export function detectAgentMode(text: string, forced: AgentMode = 'auto'): AgentMode {
  if (forced !== 'auto') return forced
  const t = text.toLowerCase()
  const creating = /crea|genera|aplica|hazme|cr[eé]ame|inserta|arm[aá]|pon(me)?|produce/.test(t)
  const asking =
    /\?|^(qu[eé]|c[oó]mo|por qu[eé]|cu[aá]ndo|d[oó]nde|explica|expl[ií]came|cu[eé]ntame|dime|analiza el|revisa el|qu[eé] hay)/i.test(
      text.trim(),
    ) && !creating
  if (asking && !wantsFullProject(t)) return 'ask'
  if (
    /\bplan\b|estructura|c[oó]mo lo har|antes de crear|propuesta|vista previa/.test(t) &&
    !/aplica|hazlo ya/.test(t) &&
    !/crea(r|me)? (el |un )?(proyecto|clip|pista|canci)/.test(t)
  ) {
    return 'plan'
  }
  if (wantsFullProject(t)) return creating ? 'create' : 'think'
  if (/piensa|criterio|ingeniero|arreglo|orquest/i.test(t) && !creating) return 'think'
  if (creating) return 'create'
  return 'plan'
}

export function modeBlocksMutation(mode: AgentMode): boolean {
  return mode === 'ask' || mode === 'plan' || mode === 'think'
}

export function modePromptBlock(mode: AgentMode): string {
  if (mode === 'ask') {
    return [
      '## Modo: CONSULTA',
      'Responde preguntas sobre el proyecto, audio, plugins, plan o producción.',
      'NO mutes el DAW. NO emitas <<<ACTIONS>>> con mutaciones.',
      'Puedes usar herramientas read-only durante el razonamiento interno.',
      'Respuesta clara en español; cita datos reales del contexto (pistas, BPM, presets).',
    ].join('\n')
  }
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
      'plugin.lookup / library.preset.search / plugin.probe permitidos. Prefiere presetId sobre setParameter. NO digas que ya aplicaste cambios.',
    ].join('\n')
  }
  return [
    '## Modo: CREACIÓN',
    'Ejecuta en el DAW. Si plan.md existe, síguelo hasta vaciar «Por implementar».',
    'Persiste: el harness inspecciona el proyecto real (pistas/plugins/notas) y te devolverá errores con debug. No digas "listo" si el plan o el DAW siguen incompletos.',
    'Canciones: daw.musicBuild { aplicar:true, prompt, genero, progresion, secciones, pistas } — spec completo.',
    'NUNCA uses daw.generateMidiSong para una canción multi-pista / con batería+bajo+guitarras+pads: eso solo crea UN clip.',
    'Tras build: mezcla (track.update vol/pan), sends (bus.create/send.set), automatización si hace falta, master.update.',
    'Entrega: daw.masterPass o render.start + analysis.fullReport + analysis.compareTarget. Exige AudioListenReport OK.',
    'VSTs: plugin.probe → library.preset.search/apply (presetId) ANTES de plugin.setParameter. En Music Build usa presetId por pista.',
    'Si falla algo: repara el ítem concreto (clip/plugin/checkbox). No repitas daw.musicBuild completo.',
    'Actualiza plan.md (Implementado / Por implementar / Evaluación) en cada cierre.',
  ].join('\n')
}
