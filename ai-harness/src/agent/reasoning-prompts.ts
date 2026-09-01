/**
 * Plantillas de prompt — razonamiento profundo adaptativo (2–10 capas).
 * No es un chat con el usuario: es pensamiento privado de productor.
 */

import type { AgentMode } from './modes'
import {
  isProjectAuditIntent,
  isSongRefineIntent,
  isStyleGapIntent,
  modePromptBlock,
  wantsWebResearch,
} from './modes'

/** Glosario breve usuario → vocabulario app (capa normalize). */
export const APP_VOCAB_GLOSSARY = [
  'construye / construir / arma / armame / monta / produce → crea (daw.musicBuild / midi.clip.*)',
  'hazlo / dale / adelante / ok / sí → crea/aplica (ACTIONS con aplicar)',
  'edita / cambia / modifica / arregla (un tramo) → midi.notes.patch o midi.clip.md.apply con rangeStart/rangeEnd',
  'parte / secciones / pedazos / intro aparte → midi.clip.splitIntoSections o varios midi.clip.create { inicio, duracion }',
  'analizame / analiza / revisa / qué le falta → audit o style_gap (SIN musicBuild, SIN plan de días)',
  'estilo X / como Averill Morillo / worship moderno → style_gap + web.search; compara la pista EXISTENTE',
  'Mesías / Averly batería → doc estilo-mesias-bateria.md + style.profile.search (Firmthm ♩=72: coro kick denso, verso half-time)',
  'antes de inventar groove → style.profile.search; aplicar con style.profile.apply (no copiar MIDI)',
  'investiga en internet / busca online → OBLIGATORIO <<<READ [{"type":"web.search",...}]>>>',
  'más lenta / baja el tempo → project.setBpm (+ refine si pide estilo)',
  'silencia / mute → track.toggleMute',
  'pregunta / explícame / ¿…? → modo consulta (ask), sin mutar',
  'plan / estructura / cómo lo harías → plan.md / modo plan (solo si pide plan, no si pide análisis)',
].join('\n')

export type ReasoningPhase =
  | 'normalize'
  | 'sense'
  | 'frame'
  | 'explore'
  | 'research1'
  | 'critique'
  | 'research2'
  | 'stress'
  | 'synthesize'
  | 'verify'
  | 'commit'

export const REASONING_PHASE_META: Record<
  ReasoningPhase,
  { label: string; maxTokensHint: number; voice: string }
> = {
  normalize: {
    label: 'Traducir pedido',
    maxTokensHint: 1400,
    voice:
      'Amplía y traduce el mensaje del usuario a un prompt canónico compatible con JasWave; elige cuántas capas más hacen falta.',
  },
  sense: {
    label: 'Intuición',
    maxTokensHint: 900,
    voice: 'Primera impresión cruda: qué te pegó del pedido, sin plan todavía.',
  },
  frame: {
    label: 'Encuadre',
    maxTokensHint: 1200,
    voice: 'Desarma el pedido: intención real, restricciones, qué NO pidió.',
  },
  explore: {
    label: 'Explorar',
    maxTokensHint: 1200,
    voice: 'Mapa rápido de 2–3 direcciones creativas o de arreglo antes de anclar datos.',
  },
  research1: {
    label: 'Mirar el proyecto',
    maxTokensHint: 1600,
    voice: 'Ancla al DAW: BPM, pistas, plan.md. Si hace falta dato, <<<READ>>>.',
  },
  critique: {
    label: 'Duda',
    maxTokensHint: 1200,
    voice: 'Cuestiona tu propia idea: qué fallaría, qué es ruido vs crítico.',
  },
  research2: {
    label: 'Cerrar huecos',
    maxTokensHint: 1600,
    voice: 'Solo lo que aún falta para decidir. READ si hace falta; si no, di «tengo bastante».',
  },
  stress: {
    label: 'Estrés',
    maxTokensHint: 1100,
    voice: 'Prueba de fuego: qué se rompe al aplicar (pistas duplicadas, clip entero, tempo malo).',
  },
  synthesize: {
    label: 'Sopesar',
    maxTokensHint: 1400,
    voice: 'Compara caminos con pros/contras breves; elige uno en borrador.',
  },
  verify: {
    label: 'Verificar',
    maxTokensHint: 1000,
    voice: 'Chequeo final de coherencia: ids de pista/clip, rangos de beats, sin overkill.',
  },
  commit: {
    label: 'Compromiso',
    maxTokensHint: 1800,
    voice: 'Cierra: ACTIONS concretas o CLARIFY estructurado. Sin ensayo para el usuario.',
  },
}

export function formatPhaseTitle(
  phase: ReasoningPhase,
  index: number,
  total: number,
): string {
  const label = REASONING_PHASE_META[phase]?.label ?? phase
  return `${index}/${total} · ${label}`
}

const READ_TOOLS_HELP = [
  'Herramientas read-only (solo en capas de investigación), bloque <<<READ … READ>>>:',
  '- doc.list | doc.read { slug }',
  '- library.preset.list | library.preset.search { query?, rol?, genero? }',
  '- plugin.lookup { nombre } | plugin.probe { pluginId? | path? | nombre? }',
  '- analysis.buffer { sampleMs? } | analysis.timing | track.getFxChain { trackId }',
  '- midi.notes.get { clipId, pistaId? } | midi.getClipSummary { clipId }  ← leer notas/resumen de un clip',
  '- midi.clip.md.read | midi.clip.md.upsert | midi.clip.md.apply | midi.notes.compare  ← .md nota-a-nota (preferir para melodía)',
  '- web.search { query }',
  'Si el usuario ancló una selección, las notas YA vienen en el contexto: no digas que no puedes leerlas.',
  'Duplicados (mismo pitch+inicio): en el turno final usa midi.notes.dedupe { pistaId, clipId }.',
  'Máximo 4 por capa. NO mutes el DAW aquí.',
].join('\n')

const INNER_VOICE_RULES = [
  '## Cómo pensar (obligatorio)',
  'Esto es un DIARIO MENTAL privado de un productor/ingeniero, NO un chat con el usuario.',
  '- Escribe en primera persona: «veo…», «me frena…», «si bajo el BPM a 72…».',
  '- Frases cortas, imperfectas, a veces a medias. Puedes dudar y corregirte.',
  '- PROHIBIDO tono de asistente: nada de «¡Perfecto!», «Claro!», «Aquí tienes el plan», «Respuesta visible», «Estimado», saludos, ni markdown de plan completo.',
  '- PROHIBIDO hablarle al usuario («tú deberías…», «por favor dime…», «escribe las 3 opciones»).',
  '- PROHIBIDO inventar un cuestionario en prosa; si hace falta aclarar, anótalo para el compromiso final como CLARIFY.',
  '- PROHIBIDO rellenar la capa con listas de preguntas («¿Qué tipo de…? ¿Qué ritmo…?»). Escribe AFIRMACIONES u observaciones («Kick en 1 y 3; snare floja; falta ghost notes»).',
  '- PROHIBIDO inventar un «Plan de Producción» multi-día o canción nueva si el usuario pidió analizar/comparar una pista existente.',
  '- No repitas el pedido entero ni copies el contexto del proyecto: solo lo que usas.',
  '- Longitud: 4–12 líneas útiles. Mejor denso que ensayo.',
].join('\n')

export function reasoningSystemPreamble(mode: AgentMode, depthHint?: number): string {
  const depthLine =
    depthHint != null
      ? `En ESTE turno el plan tiene ${depthHint} capas (2–10). La 1ª traduce el pedido; tú ya elegiste o se fijó la profundidad.`
      : 'La 1ª capa SIEMPRE traduce el mensaje del usuario a un prompt canónico JasWave y elige profundidad (2–10). Luego vienen las capas restantes.'
  return [
    'Eres el coproductor de JasWave.',
    depthLine,
    'El usuario NO ve estas capas como conversación contigo: son notas mentales.',
    'Responde siempre en español.',
    INNER_VOICE_RULES,
    '',
    'Criterio de productor: BPM, grid, inicio/duración de clips en beats, notas dentro del clip, duplicados, densidad, arrastre rítmico.',
    'Si el pedido es AUDITAR/ANALIZAR lo existente: NO inventes una canción nueva ni «base en G mayor»; mira el Timeline MIDI del contexto.',
    '',
    modePromptBlock(mode === 'auto' ? 'create' : mode),
    '',
    READ_TOOLS_HELP,
  ].join('\n')
}

function isRefine(userText: string): boolean {
  return isSongRefineIntent(userText) || /m[aá]s\s+lent|m[aá]s\s+r[aá]pid|m[aá]s\s+sublime|est[aá]\s+muy\s+r[aá]pid|hazla\s+m[aá]s|cambia(r)?\s+(el\s+)?tempo/i.test(
    userText,
  )
}

function isAudit(userText: string): boolean {
  return isProjectAuditIntent(userText) || isStyleGapIntent(userText)
}

function isStyleGap(userText: string): boolean {
  return isStyleGapIntent(userText)
}

function needsWeb(userText: string): boolean {
  return wantsWebResearch(userText) || isStyleGapIntent(userText)
}

/** Mensaje inicial: pedido + proyecto (una sola vez en el hilo). */
export function reasoningSeedUserMessage(opts: {
  userText: string
  projectContext: string
}): string {
  return [
    '## Pedido del usuario (no le respondas aún — solo piensa)',
    opts.userText,
    '',
    '## Estado del proyecto (solo lectura; no lo recopies entero)',
    opts.projectContext.slice(0, 14000),
  ].join('\n')
}

/** Cue corto de la capa actual — no una «tarea de usuario». */
export function promptForPhase(
  phase: ReasoningPhase,
  opts: {
    userText: string
    mode: AgentMode
    projectContext: string
    priorSteps: string
    toolResults?: string
    /** Si true, el contexto ya está en el hilo (modo monólogo). */
    continuum?: boolean
    /** Índice 1-based y total del plan adaptativo. */
    phaseIndex?: number
    phaseTotal?: number
  },
): string {
  const meta = REASONING_PHASE_META[phase]
  const idx = opts.phaseIndex ?? 1
  const total = opts.phaseTotal ?? 7
  const refine = isRefine(opts.userText)
  const audit = isAudit(opts.userText) || opts.mode === 'ask'
  const styleGap = isStyleGap(opts.userText)
  const web = needsWeb(opts.userText)
  const lines: string[] = [
    `## Capa ${idx}/${total} — ${meta.label}`,
    meta.voice,
    '',
  ]

  if (!opts.continuum) {
    lines.push(
      '## Pedido',
      opts.userText,
      '',
      '## Proyecto (extracto)',
      opts.projectContext.slice(0, 8000),
      '',
    )
    if (opts.priorSteps) {
      lines.push('## Notas mentales anteriores', opts.priorSteps.slice(0, 4000), '')
    }
  }

  if (opts.toolResults) {
    lines.push('## Lo que acabas de consultar', opts.toolResults.slice(0, 4000), '')
  }

  switch (phase) {
    case 'normalize':
      lines.push(
        'Tu ÚNICA tarea en esta capa: tratar el mensaje del usuario como borrador de un prompt de sistema.',
        '1) Amplía lo implícito (qué quiere en el DAW) sin inventar canciones si solo pide editar/consultar/analizar.',
        '2) Traduce jerga informal al vocabulario que JasWave entiende (ver glosario).',
        '3) Elige profundidad total de este turno: entero depth entre 2 y 10 (tú decides).',
        '   · 2–3: mute/BPM/confirmación',
        '   · 5–6: edición acotada',
        '   · 8–10: auditoría de pista, gap de estilo vs artista, o «investiga en internet»',
        '',
        '## Glosario usuario → app',
        APP_VOCAB_GLOSSARY,
        '',
        'Si el usuario dice «analizame la batería… qué le falta… estilo Averill/Averly Morillo… investiga en internet»:',
        '  intent=style_gap, modeHint=ask, depth≥8, promptCanonico debe incluir auditar pista batería + gap vs worship moderno + web.search.',
        '  PROHIBIDO intent=create_song / plan de producción.',
        '',
        'OBLIGATORIO al final (además de 3–8 líneas de pensamiento en afirmaciones, NO listas de ¿preguntas?):',
        '<<<INTENT',
        '{',
        '  "promptCanonico": "pedido reescrito con verbos canónicos (crea, edita, audita, style_gap, setBpm…)",',
        '  "intent": "create_song|edit_clip|edit_partial|audit|style_gap|ask|transport|refine|plan|other",',
        '  "depth": 2,',
        '  "depthReason": "por qué esa profundidad",',
        '  "aliasesMapped": [{"from":"analizame","to":"audita"}],',
        '  "modeHint": "create|ask|plan|think|auto",',
        '  "entities": {"trackHint":null,"clipHint":null,"styleRef":null,"bpm":null,"rangeBeats":null,"needsWeb":false}',
        '}',
        'INTENT>>>',
        'Sin INTENT no podemos continuar bien. No emitas ACTIONS ni CLARIFY aquí.',
      )
      break
    case 'sense':
      lines.push(
        audit
          ? 'Pista: huele a AUDITORÍA del proyecto existente (clips/notas/tiempos), no a crear canción. Anota qué mirarías primero.'
          : refine
            ? 'Pista: huele a refinamiento (tempo/feel), no a canción desde cero. Anota el impulso («está rápida → quiero aire»).'
            : total <= 3
              ? 'Impulso en 2–4 líneas y pasa al cierre mental. Pedido simple: no inventes complejidad.'
              : '¿Qué es lo primero que te viene? Crear, editar, mezcla, duda… Sin solución todavía.',
      )
      break
    case 'frame':
      lines.push(
        styleGap
          ? 'Objetivo: gap analysis. (1) Qué hay YA en la pista/clip de batería. (2) Qué define el estilo pedido (worship moderno / Averill Morillo). (3) Qué FALTA. NO crear canción nueva. NO plan de días.'
          : audit
            ? 'Objetivo: listar qué está mal o flojo en clips MIDI (timing, duplicados, vacíos, densidades). NO crear melodía nueva. NO «base en G mayor» salvo que el usuario lo pida.'
            : 'Lista mental: (1) lo que pidió de verdad, (2) lo implícito, (3) lo que NO pidió, (4) defaults que asumirías.',
        'Escribe en afirmaciones. PROHIBIDO lista de «¿Qué tipo de…?».',
        audit || styleGap
          ? 'Si el contexto trae Timeline MIDI, úsalo. Si falta detalle de notas: <<<READ midi.notes.get / midi.getClipSummary>>>.'
          : opts.mode === 'create' || opts.mode === 'auto' || refine
            ? 'Si ya hay género/estilo o «hazlo/más lenta», no inventes preguntas — asume y sigue.'
            : 'Si falta algo crítico, anótalo como duda (no preguntes al usuario aquí).',
      )
      break
    case 'explore':
      lines.push(
        styleGap
          ? 'Ejes de comparación (una línea c/u): groove kick/snare, hi-hat 16ths, ghost notes, fills, crashes, half-time vs four-on-floor, room/verb feel. Descarta ejes irrelevantes.'
          : 'Bosqueja 2–3 direcciones (una línea cada una). Qué descartas ya y por qué.',
        audit || styleGap
          ? 'Direcciones = ejes de diagnóstico, no canciones nuevas.'
          : 'No te enamores aún: solo mapa.',
      )
      break
    case 'research1':
      lines.push(
        styleGap || audit
          ? 'OBLIGATORIO anclar al DAW: mira Timeline MIDI / pista batería. Hechos con beats, densidades, pitches típicos de kit. <<<READ midi.notes.get o midi.getClipSummary>>> si falta detalle.'
          : refine
            ? 'Mira BPM actual y pistas. Si el contexto ya lo tiene, no hace falta READ. Si no, <<<READ>>>.'
            : '¿Qué del proyecto confirma o choca con tu intuición? Usa <<<READ>>> solo si te falta un dato concreto.',
        web && (styleGap || audit)
          ? 'Si esta capa es la única de research y el usuario pidió internet, también <<<READ [{"type":"web.search","payload":{"query":"Averill Morillo worship drums groove modern"}}]>>> (ajusta el query al artista/estilo).'
          : '',
        'Termina con 2–4 HECHOS (no preguntas, no plan de producción).',
      )
      break
    case 'critique':
      lines.push(
        styleGap
          ? '¿Estás inventando un plan pop genérico? ¿Ignoraste la pista real? ¿Confundiste Averill/Averly Morillo con otra cosa? Sé duro: solo gaps respaldados por datos + estilo.'
          : audit
            ? '¿Estás inventando problemas? ¿Ignoraste tiempos de clip? Sé duro: solo issues respaldados por datos.'
            : refine
              ? '¿Bajar BPM basta o hay que regenerar? ¿El modelo se iría a 120 otra vez? Sé duro contigo.'
              : 'Ataca tu idea: riesgo, overkill, dato que falte de verdad vs vanidad. Descarta ruido.',
      )
      break
    case 'research2':
      lines.push(
        web
          ? 'OBLIGATORIO ahora: <<<READ [{"type":"web.search","payload":{"query":"<artista/estilo> worship modern drums characteristics ghost notes hi-hat"}}] READ>>>. Resume 3–5 rasgos del estilo (no copies párrafos enteros).'
          : styleGap || audit
            ? 'Cierra huecos de timing/notas. Si el timeline basta: «tengo bastante para diagnosticar».'
            : 'Solo cierra huecos que la duda dejó abiertos. Si no hay ninguno: «tengo bastante para decidir».',
        '<<<READ>>> si hace falta. Nada de ACTIONS ni CLARIFY todavía. Nada de planes multi-día.',
      )
      break
    case 'stress':
      lines.push(
        styleGap || audit
          ? 'Fallos fatales a evitar: inventar musicBuild, spamear ¡¡¡, plan de 7 días, ignorar la pista real, no usar web si lo pidieron.'
          : '¿Qué se rompe si aplicas ya? Pistas duplicadas, borrar el clip entero, BPM absurdo, mal trackId.',
        'Nombra 1–3 fallos fatales a evitar en el compromiso.',
      )
      break
    case 'synthesize':
      lines.push(
        styleGap
          ? 'Tabla mental: rasgo del estilo → presente/ausente/débil en ESTA batería (cita beats si puedes). Prioriza 5–8 gaps P1/P2/P3. NO musicBuild.'
          : audit
            ? 'Prioriza 3–8 problemas (P1/P2/P3) con pista+clip+beats. Camino = informe de arreglo, no musicBuild.'
            : 'Dos o tres caminos en una línea cada uno + por qué gana el que eliges (borrador).',
        'No escribas «¡Listo!» vacío ni ¡¡¡. Sé concreto. PROHIBIDO listas de preguntas.',
        !audit && !styleGap && refine
          ? 'Camino esperado: setBpm bajo (~70–80) ± musicBuild si pide sublime/estilo. Nunca 120 si dijo rápida.'
          : !audit && !styleGap
            ? 'No escribas el mensaje al usuario. Solo el razonamiento de elección.'
            : '',
      )
      break
    case 'verify':
      lines.push(
        styleGap || audit
          ? '¿Citaste la pista/clip real? ¿Usaste web.search si lo pedían? ¿Evitas plan de producción inventado?'
          : 'Antes del compromiso: ¿tienes pistaId/clipId (o nombre inequívoco)? ¿rango de beats si es edición parcial?',
        styleGap || audit
          ? 'Si falta dato de notas, dilo; no inventes. Confirma «listo para informe de gaps».'
          : 'Si algo falta y es crítico, anótalo para CLARIFY; si no, confirma «listo para ACTIONS».',
      )
      break
    case 'commit':
      lines.push(
        'Compromiso final (para el turno de ejecución, no para charlar):',
        styleGap
          ? [
              '- ESCRIBE YA 5–10 bullets: qué hay / qué falta vs el estilo (pista «Batería», beats, rasgo).',
              '- Incluye 2–4 rasgos del estilo sacados de la web (si hubo search).',
              '- PROHIBIDO musicBuild, plan de días, ¡¡¡, «¡Entendido! Aquí tienes un plan de producción pop».',
              '- Opcional: ACTIONS candidatas con aplicar:false (midi.notes.patch en un tramo), no mutar ahora.',
            ].join('\n')
          : audit
            ? [
                '- ESCRIBE YA 4–10 bullets de diagnóstico con datos (pista «…» / clip «…» / beats / notas).',
                '- Ejemplo: «P1 · Batería / loop · snare solo en 2·4, sin ghosts — típico worship moderno lleva ghosts en 2e/4e».',
                '- PROHIBIDO describir cómo debes escribir; PROHIBIDO musicBuild; PROHIBIDO ¡¡¡ o «¡Listo!».',
                '- Si no hay datos en el contexto, di exactamente qué clip falta inspeccionar.',
              ].join('\n')
            : refine
              ? [
                  '- Lista ACTIONS: project.setBpm y/o daw.musicBuild con bpm lento si aplica.',
                  '- PROHIBIDO CLARIFY / pedir opciones al usuario.',
                ].join('\n')
              : total <= 3
                ? [
                    '- Pedido simple: lista ACTIONS concretas (tipos + payloads clave) en 2–4 bullets.',
                    '- PROHIBIDO inventar CLARIFY si ya está claro.',
                  ].join('\n')
                : [
                    '- Si faltan datos críticos: anota que el turno final usará <<<CLARIFY>>> (tú inventas options).',
                    '- Si hay suficiente: lista tipos de ACTIONS y un orden de tareas (checklist mental).',
                    '- 3–6 bullets. Cero «¡vamos a ello!» de asistente.',
                  ].join('\n'),
        styleGap || audit
          ? 'El turno final mostrará el diagnóstico/gaps; aquí YA debes tener los bullets escritos (no vacío).'
          : 'Si ya está claro qué hacer: el cliente convertirá ACTIONS en checklist paso a paso (Continuar).',
      )
      break
  }

  lines.push(
    '',
    audit || styleGap
      ? 'Escribe solo el pensamiento de ESTA capa en AFIRMACIONES/bullets con datos. No firmes. No uses ¡¡¡. No preguntes en lista.'
      : 'Escribe solo el pensamiento de ESTA capa. No firmes. No saludes. No uses ¡¡¡ ni «¡Listo!» vacío.',
  )
  return lines.join('\n')
}

export function buildFinalTurnUserMessage(opts: {
  userText: string
  /** Pedido ya traducido por normalize (si existe). */
  canonicalPrompt?: string
  decisionBrief: string
  stepsSummary: string
  mode?: AgentMode
  depth?: number
}): string {
  const mode = opts.mode ?? 'create'
  const createish = mode === 'create' || mode === 'auto'
  const workingText = opts.canonicalPrompt?.trim() || opts.userText
  const refine = isRefine(workingText) || isRefine(opts.userText)
  const styleGap = isStyleGap(workingText) || isStyleGap(opts.userText)
  const audit = isAudit(workingText) || isAudit(opts.userText) || mode === 'ask' || styleGap
  const web = needsWeb(workingText) || needsWeb(opts.userText)
  const depth = opts.depth ?? 7
  const pedidoBlock =
    opts.canonicalPrompt?.trim() && opts.canonicalPrompt.trim() !== opts.userText.trim()
      ? [
          '## Pedido original del usuario',
          opts.userText,
          '',
          '## Pedido canónico (traducido para JasWave — úsalo como fuente de verdad)',
          opts.canonicalPrompt.trim(),
        ]
      : ['## Pedido original', opts.userText]
  return [
    `## Pensamiento privado (${depth} capas) — ya cerrado`,
    'Usa estas notas mentales; NO las copies al usuario ni digas «según mi razonamiento».',
    opts.stepsSummary.slice(0, 6000),
    '',
    '## Compromiso (última capa)',
    opts.decisionBrief.slice(0, 3000),
    '',
    ...pedidoBlock,
    '',
    '## Ahora sí: salida al usuario',
    styleGap
      ? [
          'Eres productor de worship moderno: haz GAP ANALYSIS de la pista/clip existente vs el estilo pedido (p. ej. Averill/Averly Morillo).',
          'Estructura: (1) qué hay YA en la batería con datos (pista, beats, densidades), (2) 3–6 rasgos del estilo (cita lo investigado en web si hubo search), (3) qué LE FALTA priorizado P1/P2/P3, (4) sugerencias concretas de arreglo MIDI (ghost notes, hi-hat, fills…) sin reescribir toda la canción.',
          'PROHIBIDO: plan de producción multi-día, musicBuild, «¡Entendido!», spamear ¡¡¡, inventar pistas de bajo/keys/pad si no las pidió.',
          web ? 'Debes reflejar hallazgos de internet (web.search); si no hubo resultados, dilo y razona con conocimiento de worship moderno con honestidad.' : '',
        ]
          .filter(Boolean)
          .join('\n')
      : audit
        ? [
            'Eres productor: diagnostica el proyecto con datos (pista, clip, beats/compás, notas).',
            '1–3 frases + lista priorizada de lo que hay que arreglar. Cita tiempos reales del Timeline MIDI.',
            'PROHIBIDO inventar canción nueva, «base en G mayor», musicBuild, plan de días o ¡¡¡¡ / «¡Listo!» vacío.',
            'Si propones arreglos concretos opcionales, puedes listar ACTIONS candidatas con aplicar:false; no mutes.',
          ].join('\n')
        : '1–2 frases naturales en español (como productor, no como chatbot) Y el bloque técnico.',
    !audit && !styleGap && createish && refine
      ? [
          'REFINAR → <<<ACTIONS>>> obligatorio (sin CLARIFY).',
          'Ej.: <<<ACTIONS [{"type":"project.setBpm","payload":{"bpm":72}},{"type":"daw.musicBuild","payload":{"aplicar":true,"prompt":"más sublime y lenta","bpm":72,"midiSource":"ai"}}] ACTIONS>>>',
          'PROHIBIDO BPM 120 si pidió más lenta; PROHIBIDO «escribe las opciones».',
        ].join('\n')
      : !audit && !styleGap && createish
        ? [
            'A) Datos críticos faltantes → solo <<<CLARIFY … CLARIFY>>> (tú inventas question+options ≥3).',
            'B) Suficiente / créalo / respuestas → <<<ACTIONS [{"type":"daw.musicBuild",…}] ACTIONS>>>',
            'PROHIBIDO cuestionario en prosa o pedir que el usuario invente las opciones.',
          ].join('\n')
        : !audit && !styleGap
          ? 'Según modo: <<<PLAN>>> / <<<DOC>>> / <<<CLARIFY>>> o ACTIONS con aplicar:false.'
          : '',
  ]
    .filter(Boolean)
    .join('\n')
}
