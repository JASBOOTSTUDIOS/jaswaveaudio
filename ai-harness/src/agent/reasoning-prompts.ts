/**
 * Plantillas de prompt — razonamiento profundo en 7 capas (monólogo interno).
 * No es un chat con el usuario: es pensamiento privado de productor.
 */

import type { AgentMode } from './modes'
import { isProjectAuditIntent, isSongRefineIntent, modePromptBlock } from './modes'

export type ReasoningPhase =
  | 'sense'
  | 'frame'
  | 'research1'
  | 'critique'
  | 'research2'
  | 'synthesize'
  | 'commit'

export const REASONING_PHASE_META: Record<
  ReasoningPhase,
  { title: string; layer: number; maxTokensHint: number; voice: string }
> = {
  sense: {
    title: '1/7 · Intuición',
    layer: 1,
    maxTokensHint: 900,
    voice: 'Primera impresión cruda: qué te pegó del pedido, sin plan todavía.',
  },
  frame: {
    title: '2/7 · Encuadre',
    layer: 2,
    maxTokensHint: 1200,
    voice: 'Desarma el pedido: intención real, restricciones, qué NO pidió.',
  },
  research1: {
    title: '3/7 · Mirar el proyecto',
    layer: 3,
    maxTokensHint: 1600,
    voice: 'Ancla al DAW: BPM, pistas, plan.md. Si hace falta dato, <<<READ>>>.',
  },
  critique: {
    title: '4/7 · Duda',
    layer: 4,
    maxTokensHint: 1200,
    voice: 'Cuestiona tu propia idea: qué fallaría, qué es ruido vs crítico.',
  },
  research2: {
    title: '5/7 · Cerrar huecos',
    layer: 5,
    maxTokensHint: 1600,
    voice: 'Solo lo que aún falta para decidir. READ si hace falta; si no, di «tengo bastante».',
  },
  synthesize: {
    title: '6/7 · Sopesar',
    layer: 6,
    maxTokensHint: 1400,
    voice: 'Compara 4–8 caminos con pros/contras breves; elige uno en borrador.',
  },
  commit: {
    title: '7/7 · Compromiso',
    layer: 7,
    maxTokensHint: 1800,
    voice: 'Cierra: ACTIONS concretas o CLARIFY estructurado. Sin ensayo para el usuario.',
  },
}

const READ_TOOLS_HELP = [
  'Herramientas read-only (solo en capas 3 y 5), bloque <<<READ … READ>>>:',
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
  '- PROHIBIDO inventar un cuestionario en prosa; si hace falta aclarar, anótalo para la capa 7 como CLARIFY.',
  '- No repitas el pedido entero ni copies el contexto del proyecto: solo lo que usas.',
  '- Longitud: 4–12 líneas útiles. Mejor denso que ensayo.',
].join('\n')

export function reasoningSystemPreamble(mode: AgentMode): string {
  return [
    'Eres el coproductor de JasWave. Antes de actuar pasas por 7 capas de pensamiento privado.',
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
  return isProjectAuditIntent(userText)
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
  },
): string {
  const meta = REASONING_PHASE_META[phase]
  const refine = isRefine(opts.userText)
  const audit = isAudit(opts.userText) || opts.mode === 'ask'
  const lines: string[] = [
    `## Capa ${meta.layer}/7 — ${meta.title.replace(/^\d+\/7 · /, '')}`,
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
    case 'sense':
      lines.push(
        audit
          ? 'Pista: huele a AUDITORÍA del proyecto existente (clips/notas/tiempos), no a crear canción. Anota qué mirarías primero.'
          : refine
            ? 'Pista: huele a refinamiento (tempo/feel), no a canción desde cero. Anota el impulso («está rápida → quiero aire»).'
            : '¿Qué es lo primero que te viene? Crear, editar, mezcla, duda… Sin solución todavía.',
      )
      break
    case 'frame':
      lines.push(
        audit
          ? 'Objetivo: listar qué está mal o flojo en clips MIDI (timing, duplicados, vacíos, densidades). NO crear melodía nueva. NO «base en G mayor» salvo que el usuario lo pida.'
          : 'Lista mental: (1) lo que pidió de verdad, (2) lo implícito, (3) lo que NO pidió, (4) defaults que asumirías.',
        audit
          ? 'Si el contexto trae Timeline MIDI, úsalo. Si falta un clip concreto, <<<READ midi.notes.get>>>.'
          : opts.mode === 'create' || opts.mode === 'auto' || refine
            ? 'Si ya hay género/estilo o «hazlo/más lenta», no inventes preguntas — asume y sigue.'
            : 'Si falta algo crítico, anótalo como duda (no preguntes al usuario aquí).',
      )
      break
    case 'research1':
      lines.push(
        audit
          ? 'Revisa Timeline MIDI del contexto: inicio/dur/fin por clip, notas, flags ⚠. Hechos con beats/compás. <<<READ>>> solo si falta detalle de notas.'
          : refine
            ? 'Mira BPM actual y pistas. Si el contexto ya lo tiene, no hace falta READ. Si no, <<<READ>>>.'
            : '¿Qué del proyecto confirma o choca con tu intuición? Usa <<<READ>>> solo si te falta un dato concreto.',
        'Termina con 2–4 hechos (no un plan de producción nueva).',
      )
      break
    case 'critique':
      lines.push(
        audit
          ? '¿Estás inventando problemas? ¿Ignoraste tiempos de clip? Sé duro: solo issues respaldados por datos.'
          : refine
            ? '¿Bajar BPM basta o hay que regenerar? ¿El modelo se iría a 120 otra vez? Sé duro contigo.'
            : 'Ataca tu idea: riesgo, overkill, dato que falte de verdad vs vanidad. Descarta ruido.',
      )
      break
    case 'research2':
      lines.push(
        audit
          ? 'Cierra huecos de timing (notas fuera, duplicados). Si el timeline basta: «tengo bastante para diagnosticar».'
          : 'Solo cierra huecos que la duda dejó abiertos. Si no hay ninguno: «tengo bastante para decidir».',
        '<<<READ>>> opcional. Nada de ACTIONS ni CLARIFY todavía.',
      )
      break
    case 'synthesize':
      lines.push(
        audit
          ? 'Prioriza 3–8 problemas (P1/P2/P3) con pista+clip+beats. Camino = informe de arreglo, no musicBuild.'
          : 'Dos o tres caminos en una línea cada uno + por qué gana el que eliges (borrador).',
        audit
          ? 'No escribas «¡Listo!» vacío ni exclamaciones. Sé concreto.'
          : refine
            ? 'Camino esperado: setBpm bajo (~70–80) ± musicBuild si pide sublime/estilo. Nunca 120 si dijo rápida.'
            : 'No escribas el mensaje al usuario. Solo el razonamiento de elección.',
      )
      break
    case 'commit':
      lines.push(
        'Compromiso final (para el turno de ejecución, no para charlar):',
        audit
          ? [
              '- ESCRIBE YA 4–10 bullets de diagnóstico con datos (pista «…» / clip «…» / beats / notas).',
              '- Ejemplo de bullet: «P1 · Bajo / loop · ~12 duplicados en pitch+inicio — dedupe».',
              '- PROHIBIDO describir cómo debes escribir; PROHIBIDO musicBuild; PROHIBIDO ¡¡¡ o «¡Listo!».',
              '- Si no hay datos en el contexto, di exactamente qué clip falta inspeccionar.',
            ].join('\n')
          : refine
            ? [
                '- Lista ACTIONS: project.setBpm y/o daw.musicBuild con bpm lento si aplica.',
                '- PROHIBIDO CLARIFY / pedir opciones al usuario.',
              ].join('\n')
            : [
                '- Si faltan datos críticos: anota que el turno final usará <<<CLARIFY>>> (tú inventas options).',
                '- Si hay suficiente: lista tipos de ACTIONS y un orden de tareas (checklist mental).',
                '- 3–6 bullets. Cero «¡vamos a ello!» de asistente.',
              ].join('\n'),
        audit
          ? 'El turno final mostrará el diagnóstico; aquí ya debes tener los bullets escritos.'
          : 'Si ya está claro qué hacer: el cliente convertirá ACTIONS en checklist paso a paso (Continuar).',
      )
      break
  }

  lines.push(
    '',
    audit
      ? 'Escribe solo el pensamiento de ESTA capa: bullets de diagnóstico reales. No firmes. No uses ¡¡¡.'
      : 'Escribe solo el pensamiento de ESTA capa. No firmes. No saludes. No uses ¡¡¡ ni «¡Listo!» vacío.',
  )
  return lines.join('\n')
}

export function buildFinalTurnUserMessage(opts: {
  userText: string
  decisionBrief: string
  stepsSummary: string
  mode?: AgentMode
}): string {
  const mode = opts.mode ?? 'create'
  const createish = mode === 'create' || mode === 'auto'
  const refine = isRefine(opts.userText)
  const audit = isAudit(opts.userText) || mode === 'ask'
  return [
    '## Pensamiento privado (7 capas) — ya cerrado',
    'Usa estas notas mentales; NO las copies al usuario ni digas «según mi razonamiento».',
    opts.stepsSummary.slice(0, 6000),
    '',
    '## Compromiso (capa 7)',
    opts.decisionBrief.slice(0, 3000),
    '',
    '## Pedido original',
    opts.userText,
    '',
    '## Ahora sí: salida al usuario',
    audit
      ? [
          'Eres productor: diagnostica el proyecto con datos (pista, clip, beats/compás, notas).',
          '1–3 frases + lista priorizada de lo que hay que arreglar. Cita tiempos reales del Timeline MIDI.',
          'PROHIBIDO inventar canción nueva, «base en G mayor», musicBuild o ¡¡¡¡ / «¡Listo!» vacío.',
          'Si propones arreglos concretos opcionales, puedes listar ACTIONS candidatas con aplicar:false; no mutes.',
        ].join('\n')
      : '1–2 frases naturales en español (como productor, no como chatbot) Y el bloque técnico.',
    !audit && createish && refine
      ? [
          'REFINAR → <<<ACTIONS>>> obligatorio (sin CLARIFY).',
          'Ej.: <<<ACTIONS [{"type":"project.setBpm","payload":{"bpm":72}},{"type":"daw.musicBuild","payload":{"aplicar":true,"prompt":"más sublime y lenta","bpm":72,"midiSource":"ai"}}] ACTIONS>>>',
          'PROHIBIDO BPM 120 si pidió más lenta; PROHIBIDO «escribe las opciones».',
        ].join('\n')
      : !audit && createish
        ? [
            'A) Datos críticos faltantes → solo <<<CLARIFY … CLARIFY>>> (tú inventas question+options ≥3).',
            'B) Suficiente / créalo / respuestas → <<<ACTIONS [{"type":"daw.musicBuild",…}] ACTIONS>>>',
            'PROHIBIDO cuestionario en prosa o pedir que el usuario invente las opciones.',
          ].join('\n')
        : !audit
          ? 'Según modo: <<<PLAN>>> / <<<DOC>>> / <<<CLARIFY>>> o ACTIONS con aplicar:false.'
          : '',
  ]
    .filter(Boolean)
    .join('\n')
}
