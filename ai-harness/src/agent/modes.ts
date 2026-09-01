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

/**
 * Pedido de refinar/ajustar una canción ya existente (tempo, feel, calidad).
 * Debe ir a modo create + ACTIONS, nunca a cuestionario en prosa.
 */
export function isSongRefineIntent(text: string): boolean {
  const t = text.toLowerCase()
  if (
    /\b(m[aá]s\s+lent[ao]s?|m[aá]s\s+r[aá]pid[ao]s?|demasiado\s+r[aá]pid|muy\s+r[aá]pid|est[aá]\s+muy\s+r[aá]pid|ralentiza|acelera|baja(r)?\s+(el\s+)?(tempo|bpm)|sube(r)?\s+(el\s+)?(tempo|bpm)|tempo\s+m[aá]s)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(m[aá]s\s+sublime|m[aá]s\s+suave|m[aá]s\s+ambiental|m[aá]s\s+emocion|hazla\s+m[aá]s|hazlo\s+m[aá]s|mejor(a|ar)\s+(esta|la|el)\s+(canci|tema)|cambia(r)?\s+(el\s+)?(tempo|estilo|mood|feel)|refina|reescribe\s+(la\s+)?canci)\b/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(esta\s+canci[oó]n|este\s+tema|la\s+canci[oó]n)\b/.test(t) &&
    /\b(necesito|quiero|haz|hagas|hazla|cambia|pon|mejora)\b/.test(t)
  ) {
    return true
  }
  return false
}

/** Solo ajuste de tempo/BPM (sin pedir reescritura musical). */
export function isTempoOnlyRefine(text: string): boolean {
  if (!isSongRefineIntent(text)) return false
  const t = text.toLowerCase()
  const tempo = /\b(lent|r[aá]pid|bpm|tempo|ralentiz|acelera)/i.test(t)
  const musical =
    /\b(sublime|suave|ambiental|emocion|arreglo|reescribe|mejor|instrument|pad|piano|estructura|verso|coro|melod[ií]a|armon[ií]a)\b/.test(
      t,
    )
  return tempo && !musical
}

/** Pedido de partir clips largos en secciones / pedazos. */
export function isClipSectionSplitIntent(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(parte|partir|divide|dividir|secciones|pedazos|trozos|por\s+secciones|clips?\s+por\s+(intro|verso|coro|secci)|intro\s+aparte|un\s+clip\s+por)\b/i.test(
      t,
    ) || /\b(no\s+(quiero|debe)\s+(un\s+)?(solo\s+)?clip\s+(largo|completo|de\s+toda))\b/i.test(t)
  )
}

/**
 * Pedido de editar clips MIDI (intro/groove/suave/pads) sin reconstruir toda la canción.
 * Tiene prioridad sobre musicBuild / refine completo.
 */
export function isMidiClipEditIntent(text: string): boolean {
  const t = text.toLowerCase()
  const editVerb =
    /\b(suav|soft|arregla|modifica|cambia|edita|ajusta|haz que|pon(le|me)?|agrega|a[nñ]ade|mete|quita|reduce|baja(r)?\s+la\s+(intens|dens|veloc)|menos\s+explos|menos\s+agres|m[aá]s\s+ambiental|grove|groove|toms?|platillos?|redoblant|pads?|ghost|humaniz|dinam)\b/i.test(
      t,
    )
  const midiTarget =
    /\b(bater[ií]a|drums?|clip|midi|intro|pads?|toms?|platillos?|redoblant|groove|grove|pista)\b/i.test(
      t,
    ) || /\b(suave|ambiental|explosiv)\b/i.test(t)
  // No tratar “crea canción completa” como edit de clip
  if (/\b(desde cero|canci[oó]n nueva|proyecto completo)\b/i.test(t)) return false
  return editVerb && midiTarget
}

/** BPM sugerido a partir de lenguaje natural (más lenta / más rápida). */
export function inferBpmFromTempoIntent(text: string, currentBpm = 120): number | null {
  const lower = text.toLowerCase()
  const explicit =
    lower.match(/\b(\d{2,3})\s*bpm\b/) ||
    lower.match(/\bbpm\s*(?:a|de|=|:)?\s*(\d{2,3})\b/) ||
    lower.match(/\btempo\s*(?:a|de|=|:)?\s*(\d{2,3})\b/)
  if (explicit) {
    const n = Number(explicit[1])
    if (Number.isFinite(n) && n >= 40 && n <= 240) return Math.round(n)
  }
  const cur = Number.isFinite(currentBpm) && currentBpm > 0 ? currentBpm : 120
  if (/\b(m[aá]s\s+lent|ralentiz|baja(r)?\s+(el\s+)?(tempo|bpm)|muy\s+r[aá]pid|demasiado\s+r[aá]pid|est[aá]\s+muy\s+r[aá]pid)/i.test(lower)) {
    // Ambiental/sublime lento: ~70–80; si ya es lento, baja un poco más
    const target = cur >= 110 ? 72 : Math.max(56, Math.round(cur * 0.82))
    return target
  }
  if (/\b(m[aá]s\s+r[aá]pid|acelera|sube(r)?\s+(el\s+)?(tempo|bpm)|muy\s+lent)/i.test(lower)) {
    return Math.min(180, Math.round(cur * 1.2))
  }
  return null
}

export function wantsFullProject(text: string): boolean {
  const t = text
  // Edición de clip/intro/groove: NO reconstruir proyecto
  if (isMidiClipEditIntent(t) && !/\b(desde cero|canci[oó]n nueva|proyecto completo)\b/i.test(t)) {
    return false
  }
  if (isSongRefineIntent(t) && !isTempoOnlyRefine(t) && !isMidiClipEditIntent(t)) return true
  if (
    /proyecto completo|desde cero|todas las pistas|producci[oó]n completa|arreglo completo|canci[oó]n completa|full (song|mix|project)|armame (el |un )?tema|banda completa|music build/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /(crea(r|s|me)?|crees|cr[eé]a(s|me)?|haz(me|la)?|hagas|genera(me)?|produce(me)?|construy[ea]|construir|monta(me)?|arm[aá](me)?|quiero que (me )?(creas|crees|hagas|construyas)|necesito que (me )?(creas|crees|hagas|construyas))\s+(una?\s+|esta\s+|la\s+)?(canci[oó]n|tema|song)\b/i.test(
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
  const creating = /(crea|crees|cr[eé]a|haz|genera|produce|arm[aá]|construy|construir|monta|quiero|necesito)/i.test(t)
  if (roles.size >= 2 && creating) return true
  return false
}

/** Pedido de auditar/diagnosticar el proyecto o una pista (sin crear canción). */
export function isProjectAuditIntent(text: string): boolean {
  const t = text.toLowerCase()
  // analiza / analizame / analizar / revisame / etc. (sin exigir \b tras la raíz)
  const analyzeVerb =
    /\b(analiz[aá](r|me|mos|ndo)?|revis[aá](r|me|mos|ndo)?|audit[aá](r|me|mos|ndo)?|diagn[oó]stic(a|ar|ame)?|inspeccion[aá](r|me)?|eval[uú](a|ar|ame)?)\b/.test(
      t,
    )
  const target =
    /\b(proyecto|clip|clips|midi|pista|pistas|bater[ií]a|drums?|bajo|bass|arreglo|notas|todo|loop|patr[oó]n)\b/.test(
      t,
    )
  if (analyzeVerb && target) return true
  if (
    /\b(qu[eé]\s+(le\s+)?falta|qu[eé]\s+hay\s+que\s+arreglar|qu[eé]\s+arreglar|qu[eé]\s+fall|qu[eé]\s+est[aá]\s+mal|problemas?\s+(del|en|de)\s+(el\s+|la\s+)?(proyecto|midi|clip|pista|bater)|dime\s+(lo\s+que|qu[eé])\s+(hay\s+que|le\s+falta))\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(auditor[ií]a|health\s*check|midi\s*audit|revisi[oó]n\s+musical)\b/.test(t)) {
    return true
  }
  return false
}

/** Referencia de estilo / artista (worship, Averly, Hillsong…). */
export function hasStyleReference(text: string): boolean {
  return (
    /\b(estilo|como|tipo|worship|aver+y|averill|morillo|hillsong|elevation|maverick|bethel|planetshakers)\b/i.test(
      text,
    ) || /\b(artista|referenci[ao]|sound\s+like)\b/i.test(text)
  )
}

/**
 * Pedido de APLICAR / adecuar estilo (mutación), no solo gap analysis.
 * Ej.: «haz que la batería tenga esa sensación», «adecua el proyecto al estilo…».
 */
export function isStyleApplyIntent(text: string): boolean {
  const t = text.toLowerCase()
  if (!hasStyleReference(t) && !/\besa sensaci[oó]n|ese estilo|ese feel|ese groove\b/i.test(t)) {
    return false
  }
  const applyVerb =
    /\b(haz que|hazla|hazlo|adecua|adecu[aá]|aplica|apl[ií]ca(lo|los|las)?|cambia|modifica|ajusta|arregla|pon(le|me|la)?|dale|adapta|transforma|convierte|mejora)\b/i.test(
      t,
    ) || /\b(quiero que|necesito que)\b.*\b(suene|tenga|quede|est[eé])\b/i.test(t)
  // «dime qué le falta» / «analizame» = consulta, no apply
  if (isProjectAuditIntent(text) && !applyVerb) return false
  if (/\b(dime|expl[ií]ca|qu[eé]\s+(le\s+)?falta|analiz|revis|audit|investiga)\b/i.test(t) && !applyVerb) {
    return false
  }
  return applyVerb
}

/** Comparar pista/proyecto con un estilo o artista de referencia (gap analysis, solo lectura). */
export function isStyleGapIntent(text: string): boolean {
  if (isStyleApplyIntent(text)) return false
  const t = text.toLowerCase()
  const wantsGap =
    /\b(qu[eé]\s+(le\s+)?falta|c[oó]mo\s+(hacerlo|dejarlo|ponerlo)|para\s+que\s+(est[eé]|suene|quede)|estilo|como\s+[aá]ver|tipo\s+[aá]ver|suene\s+(a|como)|worship|referenci)/i.test(
      t,
    )
  return (isProjectAuditIntent(text) || wantsGap) && hasStyleReference(text)
}

/** El usuario pide investigar en internet / web. */
export function wantsWebResearch(text: string): boolean {
  return /\b(investiga(r|me)?|busca(r|me)?\s+(en\s+)?(internet|la\s+web|google|online)|web\.?search|en\s+internet|research)\b/i.test(
    text,
  )
}

export function detectAgentMode(text: string, forced: AgentMode = 'auto'): AgentMode {
  // Edición MIDI de clips existentes → mutación (create)
  if (isMidiClipEditIntent(text) && forced !== 'ask') return 'create'
  if (isClipSectionSplitIntent(text) && forced !== 'ask') return 'create'
  // Aplicar estilo (batería / proyecto) → mutación
  if (isStyleApplyIntent(text) && forced !== 'ask') return 'create'
  // Auditoría / gap de estilo / análisis de pista → consulta (no musicBuild)
  if (isProjectAuditIntent(text) || isStyleGapIntent(text)) return 'ask'
  // Refinar tempo/estilo siempre muta (salvo Consulta explícita)
  if (isSongRefineIntent(text) && forced !== 'ask') return 'create'
  if (forced !== 'auto') return forced
  const t = text.toLowerCase()
  if (
    /^(s[ií]|ok|vale|dale|hazlo|cr[eé]alo|aplica|construir|construye|adelante|go)[\s!.]*$/i.test(text.trim()) ||
    /\b(hazlo|cr[eé]alo|aplica(lo)? ya|construir ahora|construye ahora|si hazlo|sí hazlo)\b/i.test(t)
  ) {
    return 'create'
  }
  const creating =
    /crea|genera|aplica|hazme|hazla|hagas|cr[eé]ame|inserta|arm[aá]|pon(me)?|produce|construy|construir|monta|necesito que|quiero que/.test(
      t,
    ) &&
    !isProjectAuditIntent(text) &&
    !isStyleGapIntent(text)
  const asking =
    (/\?|^(qu[eé]|c[oó]mo|por qu[eé]|cu[aá]ndo|d[oó]nde|explica|expl[ií]came|cu[eé]ntame|dime|analiz|revis|audit|qu[eé] hay)/i.test(
      text.trim(),
    ) ||
      isProjectAuditIntent(text) ||
      isStyleGapIntent(text)) &&
    !creating
  if (asking && !wantsFullProject(t)) return 'ask'
  if (
    /\bplan\b|estructura|c[oó]mo lo har|antes de crear|propuesta|vista previa/.test(t) &&
    !/aplica|hazlo ya|cr[eé]alo|m[aá]s\s+lent|m[aá]s\s+sublime/.test(t) &&
    !/crea(r|me)? (el |un )?(proyecto|clip|pista|canci)/.test(t)
  ) {
    return 'plan'
  }
  if (wantsFullProject(t)) return creating || isSongRefineIntent(text) ? 'create' : 'think'
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
      'Responde preguntas o auditorías sobre el proyecto, audio, plugins, plan o producción.',
      'NO mutes el DAW. NO emitas <<<ACTIONS>>> con mutaciones (salvo que el usuario pida explícitamente aplicar un arreglo después).',
      'Puedes usar herramientas read-only durante el razonamiento interno (midi.notes.get, midi.getClipSummary, doc.read).',
      'Criterio de productor: mira BPM, compás, inicio/duración de cada clip en beats, densidad de notas, solapes/duplicados, notas fuera del clip, vacíos, y si el timing rítmico cuadra con el grid.',
      'Si pide «analiza / qué arreglar / qué le falta»: lista problemas o gaps concretos con pista/clip/beats (datos del contexto), prioridad, y qué harías — sin inventar una canción nueva ni melodiar desde cero.',
      'Si pide comparar con un artista/estilo (worship, Averill/Averly Morillo, etc.): usa <<<READ web.search>>> en razonamiento; responde gap analysis (qué tiene YA la pista vs qué falta), NO un plan de producción de varios días ni musicBuild.',
      'Si pide investigar en internet: OBLIGATORIO web.search antes de concluir.',
      'Respuesta clara en español; cita datos reales (pistas, BPM, clips, tiempos) y hallazgos web si aplica.',
      'PROHIBIDO spamear ¡¡¡, «¡Entendido!» vacío, o cronogramas «Fase 1 (1-2 días)».',
    ].join('\n')
  }
  if (mode === 'plan') {
    return [
      '## Modo: PLAN',
      'NO mutes el DAW (no crees/borres pistas, clips ni plugins).',
      'Si faltan datos críticos: emite <<<CLARIFY[{"id","question","options":["…","…","…"],"allowCustom":true,"multi":false}]CLARIFY>>>.',
      'TÚ inventas question y options para ESTE pedido (no plantillas fijas). ≥3 options por pregunta. NUNCA listas 1.2.3 en prosa.',
      'Si ya hay suficiente, cierra el plan.',
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
      'Puedes usar doc.write { slug:"plan.md", content }. ACTIONS de DAW solo como borrador (aplicar:false); el usuario pulsará Aplicar.',
    ].join('\n')
  }
  if (mode === 'think') {
    return [
      '## Modo: PENSAMIENTO PROFUNDO',
      'Eres ingeniero de sonido y arreglista senior. El arreglo y las notas las defines TÚ (cualquier género).',
      '- Declara genero, tonalidad, BPM, secciones con degrees+density, y pistas con rol/articulación/VST.',
      '- Planifica MIDI nota-a-nota por pista/clip (no generador procedural) en turnos posteriores.',
      '- Contraste armónico entre secciones; evita ser muy basico salvo que el género/usuario lo pida.',
      'Si faltan datos críticos: <<<CLARIFY … CLARIFY>>> con question+options (≥3) que TÚ inventas para este arreglo. Nunca cuestionario en prosa.',
      'NO mutes el DAW. OBLIGATORIO: plan.md + <<<PLAN … PLAN>>>.',
      'Vista previa: daw.musicBuild { aplicar:false, prompt, genero, progresion, secciones, pistas }.',
      'plugin.lookup / library.preset.search / plugin.probe permitidos. Prefiere presetId sobre setParameter. NO digas que ya aplicaste cambios.',
    ].join('\n')
  }
  return [
    '## Modo: CREACIÓN',
    'Propón cambios en <<<ACTIONS>>>; el usuario confirma Aplicar en el chat (diff + preview). No digas "listo aplicado" hasta que el usuario acepte.',
    'Si plan.md existe, síguelo hasta vaciar «Por implementar».',
    'Si el usuario dijo créalo/hazlo/aplica: emite ACTIONS de inmediato (daw.musicBuild o midi…), NO preguntes otra vez.',
    'REFINAR canción existente (más lenta, más sublime, cambia tempo, hazla más…): PROHIBIDO <<<CLARIFY>>> y PROHIBIDO pedir al usuario que escriba opciones.',
    '  → Tempo: <<<ACTIONS [{"type":"project.setBpm","payload":{"bpm":72}}] ACTIONS>>> (baja si pide lenta; NUNCA dejes 120 si dijo que está rápida).',
    '  → Sublime/calidad/estilo: además daw.musicBuild { aplicar:true, midiSource:"ai", bpm:<lento>, prompt:"…" }.',
    'Si faltan 1–3 datos críticos SOLO en pedidos nuevos ambiguos: <<<CLARIFY>>> — TÚ escribes question y options[] (≥3). Nunca preguntas sueltas en el texto.',
    'PROHIBIDO: «escribe las 3 opciones», «proporciona las opciones», cuestionarios en markdown.',
    'Canciones nuevas: (1) daw.musicBuild { aplicar:true, midiSource:"ai", … }. (2) Luego 1 pista/turno con midi.clip.create + notas[].',
    'NUNCA uses daw.generateMidiSong ni midiSource:"procedural" para multi-pista.',
    'Tras MIDI de todas las pistas: mezcla, sends, master. Entrega con listen OK.',
    'VSTs: plugin.probe → library.preset.search/apply. Actualiza plan.md en cada cierre.',
  ].join('\n')
}
