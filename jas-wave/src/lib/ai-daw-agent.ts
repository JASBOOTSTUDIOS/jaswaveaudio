/**
 * Agente DAW: interpreta ACTIONS del modelo y ejecuta comandos reales en JasWave.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DAWState } from '../../../shared/src/types/state'
import type { MusicBuildAiPartial } from './music-build/types'
import {
  composeMidiFromBrief,
  hashSeed,
  inferClipNameFromText,
  inferKeyFromText,
  inferMinutesFromText,
  inferProgressionFromText,
  inferArticulationFromText,
  parseMidiBriefFromText,
  wantsDawCreation,
  type Articulation,
  type GeneratedNote,
} from './midi-song-generator'
import { buildReadOnlyProjectContext } from './ai-read-context'
import { getSelectedTrackId } from './selection-helpers'
import { formatMentionsForPrompt, resolveAtMentions, type MentionableMessage } from './ai-mentions'
import { pluginRegistry } from './plugin/registry'
import { descriptorToPluginInfo } from './plugin/plugin-info-adapter'
import {
  ensureTrackVstPlugin,
  extractHostPluginPath,
  listSlotParameters,
  setSlotParameter,
  slotIdForTrackPlugin,
} from './plugin/track-vst-runtime'
import {
  enrichParameter,
  searchParameters,
  summarizeParametersForAi,
} from './plugin/plugin-parameter-intel'
import { detectAgentMode, modePromptBlock, wantsFullProject, type AgentMode } from './ai-modes'
import {
  forcePreviewAplicar,
  isMutatingAction,
  modeBlocksMutation,
  payloadOfAction,
} from './ai-action-policy'
import {
  appendAiDawAudit,
  type AiDawAuditSource,
} from './ai-daw-audit-store'
import {
  draftArrangement,
  formatGuideForPrompt,
  localUsageGuide,
  mergeWebSnippets,
  pickVstForRole,
  type InstrumentRole,
  type PluginUsageGuide,
} from './plugin-knowledge'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import type { ProjectPlanData, ProjectPlanTrack } from './project-plan'
import {
  bindAgentDocsDisk,
  createAgentDoc,
  docsPromptActions,
  formatDocsForPrompt,
  getAgentDoc,
  getMarkdownSection,
  listAgentDocs,
  PLAN_SLUG,
  setMarkdownSection,
  writeAgentDoc,
} from './agent-docs'
import { ensurePlanFromCompose, syncPlanAfterDawChange } from './agent-plan-eval'

const ZOOM_MIN = 0.15
const ZOOM_MAX = 256

export type DawAction = {
  type: string
  payload?: Record<string, unknown>
}

export type ActionResult = {
  type: string
  success: boolean
  message: string
  data?: unknown
}

const ACTIONS_RE = /<<<ACTIONS\s*([\s\S]*?)\s*ACTIONS>>>/gi

export function buildAgentSystemPrompt(
  state: DAWState,
  userText = '',
  mode: AgentMode = 'auto',
  chatMessages: MentionableMessage[] = [],
): string {
  const context = buildReadOnlyProjectContext(state)
  const tracks = state.project.tracks
    .slice(0, 24)
    .map((t) => `  - id=${t.id} «${t.nombre}» tipo=${t.tipo} clips=${(t.clips ?? []).length}`)
    .join('\n')
  const selectedId = getSelectedTrackId(state)
  const selected = selectedId ? state.project.tracks.find((t) => t.id === selectedId) : undefined
  const mentions = userText ? resolveAtMentions(userText, state, chatMessages) : []
  const resolvedMode = detectAgentMode(userText, mode)
  const catalog = pluginRegistry.list()
  const instruments = catalog.filter((d) => d.isInstrument).slice(0, 80)
  const effects = catalog.filter((d) => d.isEffect && !d.isInstrument).slice(0, 40)
  const catalogBlock = [
    instruments.length
      ? 'Instrumentos VST/builtin:\n' +
        instruments.map((d) => `  - ${d.name} [${d.format}] id=${d.pluginId} · ${d.vendor}`).join('\n')
      : 'Instrumentos: (catálogo vacío — inserta JasWave Roles / VST)',
    effects.length
      ? 'Efectos:\n' + effects.map((d) => `  - ${d.name} [${d.format}] id=${d.pluginId}`).join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return [
    context,
    '',
    formatDocsForPrompt(state.project?.id || 'default'),
    '',
    '## Pistas (ids para acciones)',
    tracks || '  (ninguna)',
    '',
    '## Pista / clip seleccionados',
    selected
      ? `Pista activa: id=${selected.id} «${selected.nombre}» tipo=${selected.tipo}. Si el usuario pide SOLO un clip, úsala (no crees pistas extra).`
      : 'Ninguna pista seleccionada.',
    '',
    '## Menciones @ del mensaje',
    formatMentionsForPrompt(mentions),
    'El usuario puede referirse a pistas, clips, plugins o mensajes anteriores con @. Un mensaje citado es ancla extra: no descartes el hilo actual.',
    '',
    '## Catálogo de plugins (consulta esto para elegir instrumento/FX)',
    catalogBlock,
    '',
    modePromptBlock(resolvedMode),
    '',
    '## Rol: ingeniero de sonido / arreglista de JasWave',
    'Controlas el proyecto REAL. TÚ decides el arreglo (género, forma, progresiones por sección, roles). El motor solo renderiza MIDI; NO asumas plantilla worship/pop.',
    '- Obliga: en canciones declara genero + secciones[{nombre,bars,degrees,density}] + pistas[{nombre,rol,articulacion,pluginId?}].',
    '- Armonía: cada sección puede tener su progresión (Nashville 1–7). Contraste verso≠coro≠puente.',
    '- Anti-repetición y dinámica humanas. Tras generar, midi.humanize / applyGroove si suena mecánico.',
    '- Instrumentos: catálogo VST + biblioteca del proyecto (library.preset.*). Antes de un VST dudoso: plugin.probe.',
    'NUNCA digas que uses Ableton/Logic. NUNCA digas que no puedes generar MIDI.',
    'NUNCA uses una plantilla fija ni asumas C menor si el usuario pidió otra tonalidad.',
    'Si pide solo un clip en la pista seleccionada: una acción de clip. Sin track.create.',
    'Responde al usuario SOLO en español natural (1-3 frases). NO pegues JSON ni bloques ACTIONS en el texto visible.',
    'Las acciones van SOLO dentro del bloque delimitado (el cliente las ejecuta y las oculta).',
    '',
    'Formato obligatorio cuando debas mutar el DAW:',
    '<<<ACTIONS',
    '[{"type":"ACCION","payload":{...}}]',
    'ACTIONS>>>',
    '',
    'Acciones (type):',
    '- project.setBpm { bpm: number }',
    '- project.setTimeSignature { numerador, denominador }',
    '- ui.setZoom { horizontal?: 0.15-256, vertical?: 0.5-3, scrollX? }',
    '- track.create { nombre?, tipo: "midi"|"audio"|"instrumento"|"bus" }  ← solo si pide pista nueva',
    '- track.delete { trackId }',
    '- track.update { trackId, datos: { nombre?, color?, volumen? } }',
    '- track.toggleMute|track.toggleSolo|track.toggleArm { trackId }',
    '- transport.toggle | transport.stop | transport.toggleLoop | transport.toggleMetronome | transport.toggleRecord',
    '- transport.seek { segundos }',
    '- daw.musicBuild { aplicar, prompt, nombre?, bpm?, minutos?, genero?, progresion?, secciones:[{nombre|name,bars|compases,degrees|progresion,density?}], pistas:[{nombre,rol,articulacion?,pluginId?,presetId?}] }',
    '  ← TÚ defines el spec. El cliente mergea tu JSON sobre heurísticas. Preferible spec completo.',
    '- daw.composeProject { aplicar, nombre?, bpm?, tonalidad?, minutos?, genero?, progresion?, secciones?, pistas:[...] }',
    '- daw.generateMidiSong { aplicar, prompt?, progresion?, secciones?, genero?, articulacion?, minutos?, bpm?, seed?, pistaId? }',
    '- plugin.lookup { nombre }  ← manual + mapa MIDI',
    '- plugin.probe { pluginId? | path? | nombre? }  ← ¿carga en el host?',
    '- library.preset.list | library.preset.search { query?, rol?, genero? }',
    '- library.preset.save { trackId?, pluginInstanceId?, nombre, rol?, generoTags?, notas? }',
    '- library.preset.apply { presetId, trackId }',
    '- library.preset.audition { presetId, bars?, articulacion? }',
    '- midi.clip.create { pistaId, nombre?, inicio?, duracion?, notas:[{pitch,inicio,duracion,velocidad}] }',
    '- midi.notes.set { pistaId, clipId, notas:[...] }',
    '- midi.transpose { pistaId, clipId, semitonos, noteIds? }',
    '- midi.quantize { pistaId, clipId, gridBeats, strength? }',
    '- midi.humanize { pistaId, clipId, seed, timingAmount?, velocityAmount? }',
    '- midi.setVelocity { pistaId, clipId, velocity? | relativeFactor?, noteIds? }',
    '- midi.makeStaccato | midi.makeLegato { pistaId, clipId, noteIds?, ratio? }',
    '- midi.constrainScale { pistaId, clipId, root, scale }',
    '- midi.generatePattern { pistaId, kind: "bass_funk"|"arp"|"drums"|"pad_chords", bars?, root?, scale?, seed?, clipId?, replace? }',
    '- midi.applyGroove { pistaId, clipId, grooveId, strength?, seed? }',
    '- midi.setCC { pistaId, clipId, cc, puntos:[{tiempo,valor}] }',
    '- midi.setPitchBend { pistaId, clipId, puntos:[{tiempo,valor:-1..1}] }',
    '- clip.delete { pistaId, clipId }',
    '- clip.move { pistaId, clipId, inicio, pistaDestinoId? }',
    '- master.update { datos: { volumen?, paneo?, muted? } }',
    '- track.getFxChain { trackId }',
    '- plugin.insert { trackId, plugin: { nombre, tipo, estadoPluginBase64?, ... }, presetId? }',
    '- plugin.remove { trackId, pluginInstanceId }',
    '- plugin.move { trackId, pluginInstanceId, toIndex }',
    '- plugin.bypass { trackId, pluginInstanceId, bypass }',
    '- plugin.duplicate { trackId, pluginInstanceId }',
    '- plugin.replace { trackId, pluginInstanceId, plugin: {...} }',
    '- plugin.setParameter { trackId, pluginInstanceId, parameterId, normalizedValue 0..1, delta? }',
    '- plugin.listParameters { trackId, pluginInstanceId? }',
    '- plugin.searchParameters { trackId, query, pluginInstanceId? }',
    '- plugin.getParameter { trackId, pluginInstanceId, parameterId }',
    '- fxChain.copy | fxChain.paste { trackId, plugins? }',
    '- fxChain.loadPreset { trackId, presetId, nombre, plugins:[...] }',
    '- render.start { format:"wav"|"flac"|"mp3", startSec?, endSec?, stems?, normalize?: "peak"|"lufs"|false, listenTarget?, outputPath?, sampleRate?, bitDepth?, bitrate? }',
    '- render.cancel { renderJobId } | render.getStatus { renderJobId }',
    '- analysis.loudness | analysis.spectrum | analysis.stereo | analysis.fullReport { jobId? } | analysis.timing | analysis.buffer | analysis.fxBlame',
    '- analysis.compareTarget { target: "streaming"|"club"|"cd", jobId? }',
    '- analysis.fxBlame { sampleMs?, settleMs?, includeInstruments?, trackId? } — aísla qué VST empeora buffer/peaks',
    '- daw.masterPass { target?: "streaming"|"club"|"cd", genero?, minutes? }',
    '- automation.setCurve { trackId, parametro: "volumen"|"paneo"|paramId, puntos:[{tiempo,valor}] }',
    '- automation.clear { trackId, parametro? }',
    '- bus.create { nombre? } | send.set { trackId, busId, amount 0..1, preFader? } | sidechain.connect { origenTrackId, destinoTrackId }',
    '- track.freeze { trackId } | track.unfreeze { trackId }',
    '- audio.listDevices | audio.getDevice | audio.setDevice { backend, deviceId?, sampleRate?, bufferSize? } | audio.ensureBest { preferName? }',
    docsPromptActions(),
    '',
    'MIDI: velocidades propias por nota; densidad por sección. Sustain piano/pad = midi.setCC cc:64.',
    'Arreglo: NO dejes que el motor invente la canción — manda genero/secciones/progresion en el payload.',
    'VST: plugin.probe antes de confiar; library.preset.* para sonidos del proyecto. listParameters antes de setParameter.',
    'Entrega: tras bounce/masterPass lee AudioListenReport (analysis.fullReport). NO digas "master listo" si listen.ok=false o compareTarget fuera de rango.',
  ].join('\n')
}

/** Quita bloques ACTIONS y basura de tool-calls del texto visible. */
export function stripActionsBlock(text: string): string {
  return text
    .replace(ACTIONS_RE, '')
    .replace(/<<<DOC[\s\S]*?DOC>>>/gi, '')
    .replace(/<<<DOC[\s\S]*$/gi, '')
    .replace(/<<<PLAN[\s\S]*PLAN>>>/gi, '')
    .replace(/<<<ACTIONS[\s\S]*$/gi, '')
    .replace(/<<<PLAN[\s\S]*$/gi, '')
    .replace(/##\s*Cambios en el proyecto[\s\S]*$/gi, '')
    .replace(/^\s*\[?\s*\{\s*"type"\s*:[\s\S]*$/gm, '')
    .replace(/\bdaw\.generateMidiSong\s*\([^)]*\)\s*;?/gi, '')
    .replace(/\b(?:track|midi|plugin|transport|ui|project)\.\w+\s*\([^)]*\)\s*;?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseActionsFromText(text: string): DawAction[] {
  const match = /<<<ACTIONS\s*([\s\S]*?)\s*ACTIONS>>>/i.exec(text)
  if (!match) return []
  try {
    let raw = match[1].trim()
    // A veces el modelo envuelve en markdown
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is DawAction =>
        !!a && typeof a === 'object' && typeof (a as DawAction).type === 'string',
    )
  } catch {
    return []
  }
}

function clipOnlyIntent(text: string): boolean {
  return /clip|midi|acorde|arpeg|rasgueo|progresi/i.test(text) && !/pista nueva|crea(r|me)? una pista|track nueva/i.test(text)
}

export { parsePlanFromText } from './project-plan'

export function fallbackActionsFromUserIntent(
  userText: string,
  state?: DAWState,
  mode: AgentMode = 'auto',
): DawAction[] {
  const actions: DawAction[] = []
  const lower = userText.toLowerCase()
  const mentions = state ? resolveAtMentions(userText, state) : []
  const mentionedTrack = mentions.find((m) => m.kind === 'track')
  const mentionedClip = mentions.find((m) => m.kind === 'clip')
  const mentionedPlugin = mentions.find((m) => m.kind === 'plugin')
  const mentionedVst = mentions.find((m) => m.kind === 'vst')
  const selectedId = state ? getSelectedTrackId(state) : null
  const resolved = detectAgentMode(userText, mode)

  const bpmMatch =
    lower.match(/\b(\d{2,3})\s*bpm\b/) ||
    lower.match(/\bbpm\s*(?:a|de|=|:)?\s*(\d{2,3})\b/) ||
    lower.match(/\btempo\s*(?:a|de|=|:)?\s*(\d{2,3})\b/)
  if (bpmMatch) {
    actions.push({ type: 'project.setBpm', payload: { bpm: Number(bpmMatch[1]) } })
  }

  const zoomMatch = lower.match(/zoom\s*(?:a|de|=|:|horizontal)?\s*(\d+(?:[.,]\d+)?)/)
  if (zoomMatch || /acercar|alejar|zoom\s+in|zoom\s+out/i.test(lower)) {
    let z = zoomMatch ? parseFloat(zoomMatch[1].replace(',', '.')) : undefined
    if (z == null) {
      if (/alejar|zoom\s+out|menos zoom/i.test(lower)) z = 0.5
      else z = 2
    }
    actions.push({
      type: 'ui.setZoom',
      payload: { horizontal: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) },
    })
  }

  if (mentionedPlugin && /bypass|quita|saca|elimina/i.test(lower)) {
    actions.push({
      type: /bypass/i.test(lower) ? 'plugin.bypass' : 'plugin.remove',
      payload: {
        trackId: mentionedPlugin.trackId,
        pluginInstanceId: mentionedPlugin.pluginInstanceId,
        bypass: true,
      },
    })
  }

  if (mentionedVst && /inserta|carga|usa|pon(me)? el vst|añade/i.test(lower)) {
    actions.push({
      type: 'plugin.insert',
      payload: {
        trackId: mentionedTrack?.trackId || selectedId,
        pluginId: mentionedVst.pluginId,
        nombre: mentionedVst.label,
      },
    })
  }

  if (/consulta|c[oó]mo se usa|mapa midi|qu[eé] nota|keyswitch|manual del vst/i.test(lower)) {
    const nombre = mentionedVst?.label || mentionedPlugin?.label
    if (nombre) {
      actions.push({ type: 'plugin.lookup', payload: { nombre } })
    }
  }

  if (/evalu[aá](r|cion)?\s*(el )?plan|plan\.md.*(vs|contra|evalu)|compara(r)? (el )?plan/i.test(lower)) {
    actions.push({ type: 'doc.evaluate', payload: {} })
  }

  if (wantsFullProject(userText)) {
    actions.push({
      type: 'daw.musicBuild',
      payload: {
        prompt: userText,
        aplicar: resolved === 'create',
        nombre: inferClipNameFromText(userText, inferKeyFromText(userText).label),
      },
    })
    return forcePreviewAplicar(actions, resolved)
  }

  if (wantsDawCreation(userText) || mentionedClip) {
    const brief = parseMidiBriefFromText(userText)
    const key = inferKeyFromText(userText)
    const progression = inferProgressionFromText(userText) ?? brief.degrees
    const articulacion = inferArticulationFromText(userText)
    const minutes = inferMinutesFromText(userText, brief.minutes)
    const nombre = inferClipNameFromText(userText, key.explicit ? key.label : brief.keyLabel)
    const pistaId =
      mentionedTrack?.trackId ||
      mentionedClip?.trackId ||
      selectedId ||
      undefined
    const allowApply = resolved === 'create'

    if (mentionedClip && /modifica|cambia|reemplaza|reescribe|inserta/i.test(lower)) {
      actions.push({
        type: 'daw.generateMidiSong',
        payload: {
          prompt: userText,
          nombre,
          minutos: minutes,
          tonalidad: key.label,
          keyRoot: key.root,
          scale: key.scale,
          progresion: progression,
          articulacion,
          pistaId,
          clipId: mentionedClip.clipId,
          bpm: brief.bpm,
          aplicar: allowApply,
          reemplazar: true,
          seed: hashSeed(userText),
        },
      })
    } else {
      actions.push({
        type: 'daw.generateMidiSong',
        payload: {
          prompt: userText,
          nombre,
          minutos: minutes,
          tonalidad: key.label,
          keyRoot: key.root,
          scale: brief.scale,
          progresion: progression,
          articulacion,
          pistaId,
          bpm: brief.bpm,
          aplicar:
            allowApply &&
            (clipOnlyIntent(userText) || /crea|pon|aplica|inserta|arm/i.test(lower)),
          seed: hashSeed(userText),
        },
      })
    }
  }

  return forcePreviewAplicar(actions, resolved)
}

function isMidiCapableTrack(tipo: string | undefined): boolean {
  return tipo === 'midi' || tipo === 'instrumento' || tipo === 'audio'
}

async function resolveMidiTrackForClip(
  tienda: TiendaDAW,
  opts: { pistaId?: string; nombre?: string; allowCreate?: boolean },
): Promise<{ trackId: string; created: boolean; error?: string; trackName?: string }> {
  const state = tienda.obtenerEstado()
  const tracks = state.project.tracks

  if (opts.pistaId) {
    const t = tracks.find((x) => x.id === opts.pistaId)
    if (t && isMidiCapableTrack(t.tipo)) return { trackId: t.id, created: false, trackName: t.nombre }
    if (t) {
      return {
        trackId: '',
        created: false,
        error: `La pista «${t.nombre}» es ${t.tipo}, no MIDI. Selecciona o crea una pista MIDI para el clip.`,
        trackName: t.nombre,
      }
    }
  }

  const selectedId = getSelectedTrackId(state)
  if (selectedId) {
    const t = tracks.find((x) => x.id === selectedId)
    if (t && isMidiCapableTrack(t.tipo)) return { trackId: t.id, created: false, trackName: t.nombre }
  }

  const anyMidi = tracks.find((t) => isMidiCapableTrack(t.tipo))
  if (anyMidi) return { trackId: anyMidi.id, created: false, trackName: anyMidi.nombre }

  if (opts.allowCreate === false) {
    return { trackId: '', created: false, error: 'No hay pista MIDI. Selecciona una o pide crear la pista.' }
  }

  const result = await tienda.executor.execute('track.create', {
    nombre: opts.nombre || 'MIDI',
    tipo: 'midi',
    color: '#a78bfa',
  })
  if (!result.success) {
    return {
      trackId: '',
      created: false,
      error: result.error?.message ?? 'No se pudo crear la pista MIDI',
    }
  }
  const after = tienda.obtenerEstado()
  const created = after.project.tracks[after.project.tracks.length - 1]
  if (!created) return { trackId: '', created: false, error: 'Pista creada pero no encontrada' }
  return { trackId: created.id, created: true, trackName: created.nombre }
}

async function lookupPluginUsage(nombre: string): Promise<PluginUsageGuide> {
  const desc = pluginRegistry.findByName(nombre)[0]
  let guide = localUsageGuide(nombre, desc?.category ?? '')
  guide = { ...guide, pluginId: desc?.pluginId }
  const lookup = typeof window !== 'undefined' ? window.electron?.pluginLookup : undefined
  if (typeof lookup === 'function') {
    try {
      const hits = await lookup(nombre)
      const snippets = (hits ?? []).map((h) => [h.title, h.snippet].filter(Boolean).join(': '))
      if (snippets.length) guide = mergeWebSnippets(guide, snippets)
    } catch {
      /* sin red */
    }
  }
  return guide
}

function planFromPrompt(text: string, bpm: number, nombre?: string): ProjectPlanData {
  const key = inferKeyFromText(text)
  const minutes = inferMinutesFromText(text, 2)
  const drafts = draftArrangement(text, pluginRegistry.list())
  return {
    kind: 'projectPlan',
    nombre: nombre || inferClipNameFromText(text, key.label),
    bpm,
    keyLabel: key.label,
    minutes,
    pensamiento: `Arreglo ${drafts.map((d) => d.rol).join(' + ')} en ${key.label}. Cada pista usa el mapa MIDI de su instrumento (un kit no se escribe como piano).`,
    tracks: drafts.map((d) => ({
      nombre: d.nombre,
      rol: d.rol,
      tipo: d.tipo,
      pluginNombre: d.pluginName,
      pluginId: d.pluginId,
      articulacion: d.articulacion,
      noteMapSummary: d.noteMapSummary,
    })),
  }
}

function payloadOf(action: DawAction): Record<string, unknown> {
  return payloadOfAction(action)
}

function pluginsOnTrack(state: DAWState, trackId: string): { trackId: string; plugins: PluginInfo[] } {
  if (trackId === 'master' || trackId === '__master__') {
    return { trackId: 'master', plugins: state.project.master.plugins ?? [] }
  }
  const t = state.project.tracks.find((x) => x.id === trackId)
  return { trackId, plugins: t?.plugins ?? [] }
}

async function collectLiveParameters(
  trackId: string,
  pluginInstanceId: string | undefined,
  state: DAWState,
) {
  const { plugins } = pluginsOnTrack(state, trackId)
  const targets = pluginInstanceId ? plugins.filter((p) => p.id === pluginInstanceId) : plugins
  const bundles: Array<{
    pluginInstanceId: string
    name: string
    slotId: string
    parameters: ReturnType<typeof enrichParameter>[]
    summary: string
  }> = []
  for (const pl of targets) {
    const path = extractHostPluginPath(pl.descripcion ?? '', pl.id)
    const hostId = trackId === 'master' || trackId === '__master__' ? 'master' : trackId
    const slotId = slotIdForTrackPlugin(hostId, pl.id)
    if (path) {
      await ensureTrackVstPlugin(hostId, pl)
    }
    const raw = path ? await listSlotParameters(slotId) : []
    const parameters = raw.length
      ? raw.map((param) => enrichParameter(param, pl.id, slotId))
      : []
    bundles.push({
      pluginInstanceId: pl.id,
      name: pl.nombre,
      slotId,
      parameters,
      summary: parameters.length
        ? summarizeParametersForAi(parameters)
        : 'Sin catálogo VST3 (plugin no cargado o builtin sin IEditController).',
    })
  }
  return bundles
}

export type ExecuteDawOptions = {
  agentMode?: AgentMode
  /** Permite mutaciones aunque el modo sea plan/think (botón Construir). */
  forceApply?: boolean
  source?: AiDawAuditSource
  conversationId?: string
  messageId?: string
  /** Si true, no ejecuta mutaciones en plan/think (defensa en profundidad). */
  respectModeGate?: boolean
}

export async function executeDawActions(
  tienda: TiendaDAW,
  actions: DawAction[],
  opts: ExecuteDawOptions = {},
): Promise<ActionResult[]> {
  const results: ActionResult[] = []
  const st = tienda.obtenerEstado()
  bindAgentDocsDisk(st.project?.id || 'default', st.project?.ruta)

  if (actions.some((a) => {
    const t = a.type
    if (t.startsWith('analysis.')) return false
    if (t === 'audio.listDevices' || t === 'audio.getDevice') return false
    if (t === 'project.new' || t === 'project.load') return false
    if (t === 'audio.armNative' || t === 'audio.ensureBest' || t === 'audio.setDevice') return false
    return (
      t.startsWith('transport.') ||
      t.startsWith('daw.') ||
      t.startsWith('plugin.') ||
      t.startsWith('midi.') ||
      t.startsWith('clip.') ||
      t.startsWith('track.')
    )
  })) {
    const { waitUntilProjectReady } = await import('./project-ready')
    await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
  }

  const mode = opts.agentMode ?? 'create'
  const source = opts.source ?? 'model_actions'
  const conversationId = opts.conversationId ?? ''
  const messageId = opts.messageId ?? ''
  const blockMutations =
    opts.respectModeGate !== false && modeBlocksMutation(mode) && !opts.forceApply

  for (const action of actions) {
    const p = payloadOf(action)
    const auditBase = {
      conversationId,
      messageId,
      agentMode: mode,
      source,
      tool: action.type,
      params: { ...p },
    }

    if (blockMutations && isMutatingAction(action)) {
      appendAiDawAudit({
        ...auditBase,
        status: 'skipped_by_mode',
        result: {
          success: false,
          message: `Omitido: modo ${mode} no muta el DAW (usa Construir)`,
        },
      })
      results.push({
        type: action.type,
        success: false,
        message: `Omitido (modo ${mode}): ${action.type} — pulsa Construir para aplicar`,
      })
      continue
    }

    try {
      switch (action.type) {
        case 'project.setBpm': {
          const bpm = Number(p.bpm)
          const r = await tienda.executor.execute('project.setBpm', { bpm })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `BPM → ${bpm}` : r.error?.message ?? 'Error BPM',
          })
          break
        }
        case 'project.setTimeSignature': {
          const r = await tienda.executor.execute('project.setTimeSignature', {
            numerador: Number(p.numerador ?? 4),
            denominador: Number(p.denominador ?? 4),
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Compás → ${p.numerador ?? 4}/${p.denominador ?? 4}`
              : r.error?.message ?? 'Error compás',
          })
          break
        }
        case 'ui.setZoom': {
          const horizontal =
            p.horizontal != null
              ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(p.horizontal)))
              : undefined
          const r = await tienda.executor.execute('ui.setZoom', {
            horizontal,
            vertical: p.vertical != null ? Number(p.vertical) : undefined,
            scrollX: p.scrollX != null ? Number(p.scrollX) : undefined,
          })
          if (horizontal != null) {
            window.dispatchEvent(
              new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: horizontal } }),
            )
          }
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Zoom horizontal → ${horizontal ?? '—'}x`
              : r.error?.message ?? 'Error zoom',
          })
          break
        }
        case 'track.create': {
          const nombre = String(p.nombre ?? 'Pista')
          const tipo = (p.tipo as string) || 'midi'
          const r = await tienda.executor.execute('track.create', {
            nombre,
            tipo,
            color: p.color as string | undefined,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `Pista «${nombre}» (${tipo}) creada` : r.error?.message ?? 'Error pista',
          })
          break
        }
        case 'track.delete': {
          const r = await tienda.executor.execute('track.delete', { trackId: String(p.trackId) })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Pista eliminada' : r.error?.message ?? 'Error al eliminar',
          })
          break
        }
        case 'track.update': {
          const r = await tienda.executor.execute('track.update', {
            trackId: String(p.trackId),
            datos: p.datos ?? p,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Pista actualizada' : r.error?.message ?? 'Error update',
          })
          break
        }
        case 'track.toggleMute':
        case 'track.toggleSolo':
        case 'track.toggleArm': {
          const r = await tienda.executor.execute(action.type, { trackId: String(p.trackId) })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `${action.type} OK` : r.error?.message ?? 'Error toggle',
          })
          break
        }
        case 'transport.toggle':
        case 'transport.stop':
        case 'transport.toggleLoop':
        case 'transport.toggleMetronome':
        case 'transport.toggleRecord': {
          const r = await tienda.executor.execute(action.type, {})
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `${action.type} OK` : r.error?.message ?? 'Error transporte',
          })
          break
        }
        case 'transport.seek': {
          const r = await tienda.executor.execute('transport.seek', {
            segundos: Number(p.segundos ?? 0),
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `Seek → ${p.segundos}s` : r.error?.message ?? 'Error seek',
          })
          break
        }
        case 'master.update': {
          const r = await tienda.executor.execute('master.update', { datos: p.datos ?? p })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Master actualizado' : r.error?.message ?? 'Error master',
          })
          break
        }
        case 'clip.delete': {
          const r = await tienda.executor.execute('clip.delete', {
            pistaId: String(p.pistaId),
            clipId: String(p.clipId),
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Clip eliminado' : r.error?.message ?? 'Error clip',
          })
          break
        }
        case 'clip.move': {
          const r = await tienda.executor.execute('clip.move', {
            pistaId: String(p.pistaId),
            clipId: String(p.clipId),
            inicio: Number(p.inicio),
            pistaDestinoId: p.pistaDestinoId as string | undefined,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Clip movido' : r.error?.message ?? 'Error move',
          })
          break
        }
        case 'midi.notes.set': {
          const r = await tienda.executor.execute('midi.notes.set', {
            pistaId: String(p.pistaId),
            clipId: String(p.clipId),
            notas: p.notas,
            duracion: p.duracion != null ? Number(p.duracion) : undefined,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? 'Notas MIDI actualizadas' : r.error?.message ?? 'Error notas',
          })
          break
        }
        case 'plugin.lookup': {
          const nombre = String(p.nombre ?? p.name ?? '')
          if (!nombre) {
            results.push({ type: action.type, success: false, message: 'Falta el nombre del VST' })
            break
          }
          const guide = await lookupPluginUsage(nombre)
          results.push({
            type: action.type,
            success: true,
            message: formatGuideForPrompt(guide),
            data: { kind: 'pluginGuide', ...guide },
          })
          break
        }
        case 'daw.musicBuild': {
          const { executeMusicBuild, specToProjectPlan } = await import('./music-build')
          const promptText = String(p.prompt ?? p.nombre ?? '')
          const aplicar = p.aplicar === true || p.apply === true
          const nested =
            p.spec && typeof p.spec === 'object' ? (p.spec as Record<string, unknown>) : {}
          const ai: MusicBuildAiPartial = {
            nombre: p.nombre != null ? String(p.nombre ?? nested.nombre) : (nested.nombre != null ? String(nested.nombre) : undefined),
            bpm: p.bpm != null ? (Number(p.bpm) as number) : (nested.bpm != null ? (Number(nested.bpm) as number) : undefined),
            minutos: p.minutos != null ? (Number(p.minutos ?? nested.minutos ?? nested.minutes) as number) : (nested.minutos != null ? (Number(nested.minutos) as number) : (nested.minutes != null ? (Number(nested.minutes) as number) : undefined)),
            tonalidad: p.tonalidad != null ? String(p.tonalidad ?? nested.tonalidad) : (nested.tonalidad != null ? String(nested.tonalidad) : undefined),
            genero: p.genero != null ? String(p.genero ?? p.genre ?? nested.genero ?? nested.genre) : (p.genre != null ? String(p.genre) : (nested.genero != null ? String(nested.genero) : (nested.genre != null ? String(nested.genre) : undefined))),
            progresion: (Array.isArray(p.progresion) ? (p.progresion as number[]) : (Array.isArray(p.progression) ? (p.progression as number[]) : (Array.isArray(nested.progresion) ? (nested.progresion as number[]) : (Array.isArray(nested.progression) ? (nested.progression as number[]) : undefined)))),
            degrees: (Array.isArray(p.degrees) ? (p.degrees as number[]) : (Array.isArray(nested.degrees) ? (nested.degrees as number[]) : undefined)),
            secciones: (Array.isArray(p.secciones) ? (p.secciones as NonNullable<MusicBuildAiPartial['secciones']>) : (Array.isArray(p.sections) ? (p.sections as NonNullable<MusicBuildAiPartial['secciones']>) : (Array.isArray(nested.secciones) ? (nested.secciones as NonNullable<MusicBuildAiPartial['secciones']>) : (Array.isArray(nested.sections) ? (nested.sections as NonNullable<MusicBuildAiPartial['secciones']>) : undefined)))),
            sections: (Array.isArray(p.sections) ? (p.sections as NonNullable<MusicBuildAiPartial['sections']>) : (Array.isArray(nested.sections) ? (nested.sections as NonNullable<MusicBuildAiPartial['sections']>) : undefined)),
            pistas: (Array.isArray(p.pistas) ? (p.pistas as NonNullable<MusicBuildAiPartial['pistas']>) : (Array.isArray(p.tracks) ? (p.tracks as NonNullable<MusicBuildAiPartial['pistas']>) : (Array.isArray(nested.pistas) ? (nested.pistas as NonNullable<MusicBuildAiPartial['pistas']>) : (Array.isArray(nested.tracks) ? (nested.tracks as NonNullable<MusicBuildAiPartial['pistas']>) : undefined)))),
            tracks: (Array.isArray(p.tracks) ? (p.tracks as NonNullable<MusicBuildAiPartial['tracks']>) : (Array.isArray(nested.tracks) ? (nested.tracks as NonNullable<MusicBuildAiPartial['tracks']>) : undefined)),
            keyRoot: p.keyRoot != null ? (Number(p.keyRoot) as number) : (nested.keyRoot != null ? (Number(nested.keyRoot) as number) : undefined),
            scale: (p.scale === 'major' || p.scale === 'minor') ? p.scale : ((nested.scale === 'major' || nested.scale === 'minor') ? (nested.scale as 'major' | 'minor') : undefined),
            keyLabel: p.keyLabel != null ? String(p.keyLabel ?? nested.keyLabel) : (nested.keyLabel != null ? String(nested.keyLabel) : undefined),
          }
          const build = await executeMusicBuild(tienda, {
            prompt: promptText,
            aplicar,
            bpm: p.bpm != null ? Number(p.bpm) : undefined,
            nombre: p.nombre ? String(p.nombre) : undefined,
            minutos: p.minutos != null ? Number(p.minutos) : undefined,
            softPadOnly: p.softPadOnly === true || p.soloSoftPad === true,
            ai,
          })
          const plan = specToProjectPlan(build.spec, build.applied)
          ensurePlanFromCompose(tienda.obtenerEstado().project.id, plan)
          const stageLine = build.stages
            .map((s) => `${s.status === 'ok' ? '✓' : s.status === 'fail' ? '✗' : s.status === 'running' ? '●' : ' '} ${s.label}`)
            .join(' · ')
          results.push({
            type: action.type,
            success: build.status !== 'failed',
            message: aplicar
              ? `Music Build «${build.spec.nombre}»: ${stageLine}`
              : `Music Build planificado «${build.spec.nombre}»: ${build.spec.tracks.length} pistas · ${build.spec.sections.map((s) => s.name).join(' → ')}${build.spec.genero ? ` · ${build.spec.genero}` : ''}`,
            data: build,
          })
          break
        }
        case 'daw.composeProject': {
          const st0 = tienda.obtenerEstado()
          const bpm = Number(p.bpm ?? st0.project.bpm?.valor ?? st0.transport?.bpm ?? 120)
          const promptText = String(p.prompt ?? p.nombre ?? '')
          let plan: ProjectPlanData
          if (Array.isArray(p.pistas) && (p.pistas as unknown[]).length > 0) {
            const tracks = (p.pistas as Record<string, unknown>[]).map((t) => ({
              nombre: String(t.nombre ?? 'Pista'),
              rol: String(t.rol ?? 'keys'),
              tipo: (t.tipo === 'audio' || t.tipo === 'instrumento' ? t.tipo : 'midi') as ProjectPlanTrack['tipo'],
              pluginNombre: t.pluginNombre ? String(t.pluginNombre) : t.pluginName ? String(t.pluginName) : undefined,
              pluginId: t.pluginId ? String(t.pluginId) : undefined,
              articulacion: t.articulacion ? String(t.articulacion) : undefined,
              noteMapSummary: t.notasUso ? String(t.notasUso) : undefined,
            }))
            plan = {
              kind: 'projectPlan',
              nombre: String(p.nombre ?? inferClipNameFromText(promptText, inferKeyFromText(promptText).label)),
              bpm,
              keyLabel: String(p.tonalidad ?? inferKeyFromText(promptText).label),
              minutes: Number(p.minutos ?? inferMinutesFromText(promptText, 2)),
              pensamiento: p.pensamiento ? String(p.pensamiento) : undefined,
              tracks,
            }
          } else {
            plan = planFromPrompt(promptText, bpm, p.nombre ? String(p.nombre) : undefined)
          }
          ensurePlanFromCompose(st0.project.id, plan)
          if (p.aplicar !== true) {
            results.push({
              type: action.type,
              success: true,
              message: `Plan «${plan.nombre}»: ${plan.tracks.length} pistas (vista previa)`,
              data: plan,
            })
            break
          }
          await tienda.executor.execute('project.setBpm', { bpm: plan.bpm })
          for (const t of plan.tracks) {
            const created = await tienda.executor.execute('track.create', {
              nombre: t.nombre,
              tipo: t.tipo === 'audio' ? 'audio' : 'midi',
              color: t.rol === 'drums' ? '#f59e0b' : t.rol === 'bass' ? '#38bdf8' : '#a78bfa',
            })
            if (!created.success) continue
            const trackId = tienda.obtenerEstado().project.tracks.at(-1)?.id
            if (!trackId) continue
            const d =
              (t.pluginId ? pluginRegistry.findById(t.pluginId) : undefined) ??
              (t.pluginNombre ? pluginRegistry.findByName(t.pluginNombre)[0] : undefined) ??
              pickVstForRole(pluginRegistry.list(), (t.rol as InstrumentRole) || 'unknown')
            if (d) {
              const info = descriptorToPluginInfo(d)
              await tienda.executor.execute('plugin.insert', { trackId, plugin: info })
              try {
                const { ensureTrackVstInstrument } = await import('./plugin/track-vst-runtime')
                void ensureTrackVstInstrument(trackId, info)
              } catch {
                /* host opcional */
              }
              t.pluginNombre = d.name
              t.pluginId = d.pluginId
              const guide = localUsageGuide(d.name, d.category)
              t.noteMapSummary = guide.chromatic
                ? `cromático ${guide.range.lo}–${guide.range.hi}`
                : guide.map
                    .slice(0, 5)
                    .map((m) => `${m.name} ${m.usage}`)
                    .join(', ')
            }
            if (t.tipo === 'audio') continue
            const art = (t.articulacion as Articulation) || (t.rol === 'drums' ? 'drums' : t.rol === 'bass' ? 'bass' : 'pad')
            const brief = parseMidiBriefFromText(`${promptText} ${t.rol} ${t.nombre}`, plan.bpm)
            brief.articulation = art
            brief.minutes = plan.minutes
            if (Array.isArray(p.progresion) && (p.progresion as unknown[]).length >= 2) {
              brief.degrees = (p.progresion as unknown[]).map((n) => Math.max(1, Math.min(7, Number(n))))
            }
            let barPlan: import('./midi-song-generator').MidiBarPlan[] | undefined
            const secRaw = p.secciones ?? p.sections
            if (Array.isArray(secRaw) && secRaw.length > 0) {
              const { expandSectionsToBarPlan, normalizeAiSections } = await import('./music-build')
              const sections = normalizeAiSections({ secciones: secRaw as never }) ?? []
              if (sections.length) barPlan = expandSectionsToBarPlan(sections, brief.degrees)
            }
            const song = composeMidiFromBrief(brief, {
              bpm: plan.bpm,
              seed: hashSeed(plan.nombre + t.nombre),
              barPlan,
              aiDirected: !!barPlan?.length || Array.isArray(p.progresion),
            })
            await tienda.executor.execute('midi.clip.create', {
              pistaId: trackId,
              nombre: t.nombre,
              inicio: 0,
              duracion: song.durationBeats,
              notas: song.notes,
            })
          }
          plan.applied = true
          results.push({
            type: action.type,
            success: true,
            message: `Proyecto «${plan.nombre}»: ${plan.tracks.length} pistas creadas`,
            data: plan,
          })
          break
        }
        case 'daw.generateMidiSong': {
          const state = tienda.obtenerEstado()
          const projectBpm = state.project.bpm?.valor ?? state.transport?.bpm ?? 120
          const promptText = String(p.prompt ?? p.nombre ?? p.tonalidad ?? '')
          const brief = parseMidiBriefFromText(promptText, projectBpm)
          if (p.keyRoot != null) brief.keyRoot = Number(p.keyRoot)
          if (p.scale === 'major' || p.scale === 'minor') brief.scale = p.scale
          if (p.tonalidad) {
            const k = inferKeyFromText(String(p.tonalidad))
            if (k.explicit) {
              brief.keyRoot = k.root
              brief.scale = k.scale
              brief.keyLabel = k.label
              brief.keyExplicit = true
            }
          }
          if (Array.isArray(p.progresion) && p.progresion.length >= 2) {
            brief.degrees = (p.progresion as unknown[]).map((n) => Math.max(1, Math.min(7, Number(n))))
          }
          if (Array.isArray(p.progression) && p.progression.length >= 2) {
            brief.degrees = (p.progression as unknown[]).map((n) => Math.max(1, Math.min(7, Number(n))))
          }
          if (typeof p.articulacion === 'string') brief.articulation = p.articulacion as Articulation
          if (p.minutos != null) brief.minutes = Math.max(0.25, Number(p.minutos))
          const vel = p.velocidades as { base?: number; accent?: number } | undefined
          if (vel?.base != null) brief.velocityBase = Number(vel.base)
          if (vel?.accent != null) brief.velocityAccent = Number(vel.accent)
          if (p.nombre) brief.clipName = String(p.nombre)

          const bpm = p.bpm != null ? Number(p.bpm) : brief.bpm ?? projectBpm
          const seed =
            p.seed != null
              ? typeof p.seed === 'number'
                ? p.seed
                : hashSeed(String(p.seed))
              : hashSeed(promptText || brief.clipName)

          let barPlan: import('./midi-song-generator').MidiBarPlan[] | undefined
          const secRaw = p.secciones ?? p.sections
          if (Array.isArray(secRaw) && secRaw.length > 0) {
            const { expandSectionsToBarPlan, normalizeAiSections } = await import('./music-build')
            const sections = normalizeAiSections({ secciones: secRaw as never }) ?? []
            if (sections.length) {
              barPlan = expandSectionsToBarPlan(sections, brief.degrees)
            }
          }

          const song = composeMidiFromBrief(brief, {
            seed,
            bpm,
            barPlan,
            aiDirected: !!barPlan?.length || Array.isArray(p.progresion) || Array.isArray(p.progression),
          })
          const nombre = String(p.nombre ?? brief.clipName)
          const mins = (song.durationBeats / Math.max(1, bpm)).toFixed(1)
          const apply = p.aplicar === true || p.apply === true
          const preview = {
            kind: 'midiPreview' as const,
            nombre,
            keyLabel: brief.keyLabel,
            bpm,
            durationBeats: song.durationBeats,
            notes: song.notes,
            structureLabel: song.structureLabel,
            mood: song.mood,
            style: song.style,
            seed: song.seed,
            pistaId: '' as string,
            applied: false,
          }

          if (apply) {
            if (bpm !== projectBpm) {
              await tienda.executor.execute('project.setBpm', { bpm })
            }
            const clipId = p.clipId ? String(p.clipId) : ''
            const replace = p.reemplazar === true || p.replace === true
            if (replace && clipId && p.pistaId) {
              const r = await tienda.executor.execute('midi.notes.set', {
                pistaId: String(p.pistaId),
                clipId,
                notas: song.notes,
                duracion: song.durationBeats,
              })
              preview.pistaId = String(p.pistaId)
              preview.applied = r.success
              results.push({
                type: action.type,
                success: r.success,
                message: r.success
                  ? `Clip actualizado «${nombre}» · ${brief.keyLabel} · ${song.notes.length} notas`
                  : r.error?.message ?? 'No se pudo actualizar el clip',
                data: preview,
              })
              break
            }
            const track = await resolveMidiTrackForClip(tienda, {
              pistaId: p.pistaId ? String(p.pistaId) : undefined,
              nombre,
              allowCreate: !p.pistaId,
            })
            if (!track.trackId) {
              results.push({
                type: action.type,
                success: false,
                message: track.error ?? 'Sin pista MIDI',
                data: preview,
              })
              break
            }
            preview.pistaId = track.trackId
            const r = await tienda.executor.execute('midi.clip.create', {
              pistaId: track.trackId,
              nombre,
              inicio: Number(p.inicio ?? 0),
              duracion: song.durationBeats,
              notas: song.notes,
            })
            preview.applied = r.success
            results.push({
              type: action.type,
              success: r.success,
              message: r.success
                ? `Clip «${nombre}» en «${track.trackName ?? track.trackId}» · ${brief.keyLabel} · ${song.notes.length} notas · ${mins} min`
                : r.error?.message ?? 'Error al crear el clip',
              data: preview,
            })
            break
          }

          results.push({
            type: action.type,
            success: true,
            message: `Vista previa «${nombre}» · ${brief.keyLabel} · ${song.notes.length} notas · ${mins} min`,
            data: preview,
          })
          break
        }
        case 'midi.clip.create': {
          let pistaId = p.pistaId ? String(p.pistaId) : ''
          if (!pistaId) {
            const track = await resolveMidiTrackForClip(tienda, {
              nombre: String(p.nombre ?? 'MIDI'),
              allowCreate: true,
            })
            if (!track.trackId) {
              results.push({ type: action.type, success: false, message: track.error ?? 'Sin pista' })
              break
            }
            pistaId = track.trackId
          }
          const notas = (p.notas as GeneratedNote[]) ?? []
          const r = await tienda.executor.execute('midi.clip.create', {
            pistaId,
            nombre: String(p.nombre ?? 'Clip MIDI'),
            inicio: Number(p.inicio ?? 0),
            duracion: p.duracion != null ? Number(p.duracion) : undefined,
            notas,
          })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Clip MIDI con ${notas.length} notas`
              : r.error?.message ?? 'Error clip MIDI',
          })
          break
        }
        case 'track.getFxChain': {
          const trackId = String(p.trackId ?? '')
          const st = tienda.obtenerEstado()
          const plugins =
            trackId === 'master' || trackId === '__master__'
              ? st.project.master.plugins ?? []
              : st.project.tracks.find((t) => t.id === trackId)?.plugins ?? []
          const trackName =
            trackId === 'master'
              ? 'Master'
              : st.project.tracks.find((t) => t.id === trackId)?.nombre ?? trackId
          results.push({
            type: action.type,
            success: true,
            message: `${trackName}: ${plugins.length} plugins`,
            data: {
              trackId,
              trackName,
              plugins: plugins.map((pl, position) => ({
                instanceId: pl.id,
                name: pl.nombre,
                type: pl.tipo,
                position,
                bypass: pl.bypass,
                latency: pl.latencia,
                estado: pl.estado,
              })),
            },
          })
          break
        }
        case 'plugin.insert': {
          const st = tienda.obtenerEstado()
          const trackId = String(p.trackId ?? getSelectedTrackId(st) ?? '')
          const presetId = p.presetId ? String(p.presetId) : ''
          if (presetId) {
            const { libraryApplyPreset } = await import('./library/ops')
            const applied = await libraryApplyPreset(tienda, { presetId, trackId })
            results.push({
              type: action.type,
              success: applied.ok,
              message: applied.message,
              data: applied.probe,
            })
            break
          }
          let plugin = p.plugin as Record<string, unknown> | undefined
          if (!plugin) {
            const byId = p.pluginId ? pluginRegistry.findById(String(p.pluginId)) : undefined
            const byName =
              (p.nombre ? pluginRegistry.findByName(String(p.nombre))[0] : undefined) ??
              (typeof p.pluginName === 'string' ? pluginRegistry.findByName(p.pluginName)[0] : undefined)
            let d = byId ?? byName
            // path explícito gana al catálogo por nombre (evita «BFD Player» → Keyzone mal etiquetado).
            if (typeof p.path === 'string' && p.path.trim()) {
              const path = String(p.path).trim()
              const name = String(p.nombre ?? p.pluginName ?? path.split(/[/\\]/).pop() ?? 'VST')
              const catalogPath = (d?.path || '').replace(/\\/g, '/').toLowerCase()
              const wantPath = path.replace(/\\/g, '/').toLowerCase()
              if (!d || catalogPath !== wantPath) {
                let hash = 0
                for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
                const isDll = path.toLowerCase().endsWith('.dll')
                const shortId = `${isDll ? 'vst2' : 'vst3'}.${(hash >>> 0).toString(16)}`
                d = {
                  pluginId: shortId,
                  name,
                  path,
                  format: isDll ? 'vst2' : 'vst3',
                  category: 'instrument',
                  isInstrument: true,
                  isEffect: false,
                  vendor: '',
                  version: '',
                  hostReady: true,
                  scanStatus: 'ok',
                  supportsMidiInput: true,
                  supportsMidiOutput: false,
                  supportsAudioInput: false,
                  supportsAudioOutput: true,
                  supportsSidechain: false,
                  supportsEditor: true,
                  parameterCount: 0,
                  isolation: 'out-of-process',
                } as import('./plugin/types').PluginDescriptor
                pluginRegistry.register(d)
              }
            }
            if (d) plugin = descriptorToPluginInfo(d) as unknown as Record<string, unknown>
          }
          if (!trackId || !plugin) {
            results.push({
              type: action.type,
              success: false,
              message: !trackId ? 'Sin pista para insertar el plugin' : 'Plugin no está en el catálogo',
            })
            break
          }
          if (typeof p.estadoPluginBase64 === 'string') {
            plugin = { ...plugin, estadoPluginBase64: p.estadoPluginBase64 }
          }
          if (!plugin.id) {
            plugin = {
              ...plugin,
              id: `plugin-inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            }
          }
          const insertPayload: Record<string, unknown> = { trackId, plugin }
          if (p.index != null && Number.isFinite(Number(p.index))) {
            insertPayload.index = Number(p.index)
          }
          const r = await tienda.executor.execute('plugin.insert', insertPayload)
          let hostLoaded = false
          let hostErr = ''
          if (r.success) {
            try {
              const inserted = (tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)
                ?.plugins?.at(-1) ?? plugin) as import('../../../shared/src/types/entidades').PluginInfo
              const path =
                extractHostPluginPath(inserted.descripcion ?? '', inserted.id) ||
                (typeof p.path === 'string' ? p.path : '')
              const withPath = path
                ? ({ ...inserted, descripcion: path } as typeof inserted)
                : inserted
              if (path && !(inserted.descripcion || '').includes(path)) {
                tienda.establecerEstado((s) => {
                  const tracks = (s.project?.tracks ?? []).map((t) => {
                    if (t.id !== trackId) return t
                    return {
                      ...t,
                      plugins: (t.plugins ?? []).map((pl) =>
                        pl.id === inserted.id ? { ...pl, descripcion: path } : pl,
                      ),
                    }
                  })
                  return { ...s, project: { ...s.project!, tracks } }
                })
              }
              hostLoaded = await ensureTrackVstPlugin(trackId, withPath)
              if (!hostLoaded) {
                const { getLastVstLoadError } = await import('./plugin/track-vst-runtime')
                hostErr = getLastVstLoadError() || 'host no cargó el VST'
              }
            } catch (e) {
              hostErr = e instanceof Error ? e.message : 'host error'
            }
          }
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? hostLoaded
                ? `Plugin «${String(plugin.nombre ?? plugin.name ?? '')}» insertado y cargado en host`
                : `Plugin «${String(plugin.nombre ?? plugin.name ?? '')}» en proyecto; host: ${hostErr || 'pendiente'}`
              : r.error?.message ?? 'Error plugin.insert',
            data: r.success ? { hostLoaded, hostErr: hostErr || undefined } : undefined,
          })
          break
        }
        case 'plugin.probe': {
          const { libraryProbeByRef } = await import('./library/ops')
          const probe = await libraryProbeByRef({
            pluginId: p.pluginId ? String(p.pluginId) : undefined,
            path: p.path ? String(p.path) : undefined,
            nombre: p.nombre ? String(p.nombre) : p.pluginName ? String(p.pluginName) : undefined,
          })
          results.push({
            type: action.type,
            success: probe.ok,
            message: probe.ok ? `Probe OK: ${probe.path}` : `Probe falló: ${probe.message}`,
            data: probe,
          })
          break
        }
        case 'library.preset.list': {
          const { libraryList } = await import('./library/ops')
          const list = libraryList(tienda)
          results.push({
            type: action.type,
            success: true,
            message: `${list.length} presets en biblioteca`,
            data: {
              presets: list.map((x) => ({
                id: x.id,
                nombre: x.nombre,
                pluginNombre: x.pluginNombre,
                rol: x.rol,
                generoTags: x.generoTags,
                probeOk: x.probeOk,
              })),
            },
          })
          break
        }
        case 'library.preset.search': {
          const { librarySearch } = await import('./library/ops')
          const list = librarySearch(tienda, {
            query: p.query ? String(p.query) : undefined,
            rol: p.rol ? String(p.rol) : undefined,
            genero: p.genero ? String(p.genero) : p.genre ? String(p.genre) : undefined,
          })
          results.push({
            type: action.type,
            success: true,
            message: `${list.length} presets`,
            data: { presets: list },
          })
          break
        }
        case 'library.preset.save': {
          const { librarySaveFromTrack } = await import('./library/ops')
          const trackId = String(p.trackId ?? getSelectedTrackId(tienda.obtenerEstado()) ?? '')
          const tags = Array.isArray(p.generoTags)
            ? (p.generoTags as unknown[]).map(String)
            : typeof p.genero === 'string'
              ? [String(p.genero)]
              : []
          const saved = await librarySaveFromTrack(tienda, {
            trackId,
            pluginInstanceId: p.pluginInstanceId ? String(p.pluginInstanceId) : undefined,
            nombre: String(p.nombre ?? 'Preset'),
            rol: p.rol ? String(p.rol) : undefined,
            generoTags: tags,
            notas: p.notas ? String(p.notas) : undefined,
          })
          results.push({
            type: action.type,
            success: saved.ok,
            message: saved.message,
            data: saved.preset,
          })
          break
        }
        case 'library.preset.apply': {
          const { libraryApplyPreset } = await import('./library/ops')
          const trackId = String(p.trackId ?? getSelectedTrackId(tienda.obtenerEstado()) ?? '')
          const applied = await libraryApplyPreset(tienda, {
            presetId: String(p.presetId ?? ''),
            trackId,
          })
          results.push({
            type: action.type,
            success: applied.ok,
            message: applied.message,
            data: applied.probe,
          })
          break
        }
        case 'library.preset.audition': {
          const { libraryAuditionPreset } = await import('./library/ops')
          const aud = await libraryAuditionPreset(tienda, {
            presetId: String(p.presetId ?? ''),
            bars: p.bars != null ? Number(p.bars) : 2,
            articulacion: p.articulacion ? String(p.articulacion) : undefined,
          })
          results.push({
            type: action.type,
            success: aud.ok,
            message: aud.message,
            data: { trackId: aud.trackId },
          })
          break
        }
        case 'plugin.listParameters': {
          const trackId = String(p.trackId ?? p.pistaId ?? '')
          if (!trackId) {
            results.push({ type: action.type, success: false, message: 'Falta trackId' })
            break
          }
          const bundles = await collectLiveParameters(
            trackId,
            p.pluginInstanceId ? String(p.pluginInstanceId) : undefined,
            tienda.obtenerEstado(),
          )
          results.push({
            type: action.type,
            success: true,
            message: bundles.map((b) => `«${b.name}»: ${b.summary}`).join('\n') || 'Sin plugins en la pista',
            data: bundles,
          })
          break
        }
        case 'plugin.searchParameters': {
          const trackId = String(p.trackId ?? p.pistaId ?? '')
          const query = String(p.query ?? p.q ?? '')
          if (!trackId || !query) {
            results.push({ type: action.type, success: false, message: 'Falta trackId o query' })
            break
          }
          const bundles = await collectLiveParameters(
            trackId,
            p.pluginInstanceId ? String(p.pluginInstanceId) : undefined,
            tienda.obtenerEstado(),
          )
          const hits = bundles.flatMap((b) =>
            searchParameters(b.parameters, query).map((param) => ({
              ...param,
              plugin: b.name,
            })),
          )
          results.push({
            type: action.type,
            success: true,
            message: hits.length
              ? hits
                  .slice(0, 12)
                  .map(
                    (h) =>
                      `${h.plugin} · ${h.name} id=${h.parameterId} = ${h.displayValue || h.normalizedValue.toFixed(3)}`,
                  )
                  .join('\n')
              : `Ningún parámetro coincide con «${query}». Usa plugin.listParameters; no inventes IDs.`,
            data: hits,
          })
          break
        }
        case 'plugin.getParameter': {
          const trackId = String(p.trackId ?? p.pistaId ?? '')
          const pluginInstanceId = String(p.pluginInstanceId ?? '')
          const parameterId = String(p.parameterId ?? p.paramId ?? '')
          const bundles = await collectLiveParameters(trackId, pluginInstanceId, tienda.obtenerEstado())
          const hit = bundles
            .flatMap((b) => b.parameters)
            .find((x) => x.parameterId === parameterId || x.name === parameterId)
          results.push({
            type: action.type,
            success: !!hit,
            message: hit
              ? `${hit.name} = ${hit.displayValue || hit.normalizedValue.toFixed(3)}`
              : 'Parámetro no encontrado',
            data: hit,
          })
          break
        }
        case 'plugin.remove':
        case 'plugin.move':
        case 'plugin.bypass':
        case 'plugin.duplicate':
        case 'plugin.replace':
        case 'fxChain.copy':
        case 'fxChain.paste':
        case 'fxChain.loadPreset':
        case 'fxChain.savePreset': {
          const r = await tienda.executor.execute(action.type, p)
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `OK ${action.type}` : r.error?.message ?? `Error ${action.type}`,
            data: r.result,
          })
          break
        }
        case 'plugin.setParameter': {
          const trackId = String(p.trackId ?? p.pistaId ?? '')
          const pluginInstanceId = String(p.pluginInstanceId ?? '')
          let normalized = p.normalizedValue != null ? Number(p.normalizedValue) : NaN
          if (p.delta != null && Number.isFinite(Number(p.delta))) {
            const bundles = await collectLiveParameters(trackId, pluginInstanceId, tienda.obtenerEstado())
            const parameterId = String(p.parameterId ?? '')
            const cur =
              bundles
                .flatMap((b) => b.parameters)
                .find((x) => x.parameterId === parameterId || x.name === parameterId)?.normalizedValue ?? 0
            normalized = Math.max(0, Math.min(1, cur + Number(p.delta)))
          }
          if (!Number.isFinite(normalized)) {
            results.push({ type: action.type, success: false, message: 'Falta normalizedValue o delta' })
            break
          }
          const r = await tienda.executor.execute('plugin.setParameter', {
            trackId,
            pluginInstanceId,
            parameterId: String(p.parameterId ?? ''),
            normalizedValue: normalized,
            name: typeof p.name === 'string' ? p.name : undefined,
          })
          if (r.success) {
            const slotId = slotIdForTrackPlugin(trackId === 'master' ? 'master' : trackId, pluginInstanceId)
            void setSlotParameter(slotId, String(p.parameterId ?? ''), normalized)
          }
          results.push({
            type: action.type,
            success: r.success,
            message: r.success
              ? `Parámetro ${String(p.parameterId)} → ${normalized.toFixed(3)}`
              : r.error?.message ?? 'Error plugin.setParameter',
            data: r.result,
          })
          break
        }
        case 'midi.transpose':
        case 'midi.quantize':
        case 'midi.humanize':
        case 'midi.setVelocity':
        case 'midi.deleteNotes':
        case 'midi.createNotes':
        case 'midi.makeStaccato':
        case 'midi.makeLegato':
        case 'midi.repeatPattern':
        case 'midi.reverse':
        case 'midi.invert':
        case 'midi.timeStretch':
        case 'midi.constrainScale':
        case 'midi.generatePattern':
        case 'midi.applyGroove':
        case 'midi.setCC':
        case 'midi.setPitchBend': {
          const r = await tienda.executor.execute(action.type, p)
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `OK ${action.type}` : r.error?.message ?? `Error ${action.type}`,
            data: r.result,
          })
          break
        }
        case 'doc.list': {
          const docs = listAgentDocs(tienda.obtenerEstado().project.id)
          results.push({
            type: action.type,
            success: true,
            message: docs.map((d) => d.slug).join(', ') || 'sin docs',
            data: docs.map((d) => ({ slug: d.slug, title: d.title, updatedAt: d.updatedAt })),
          })
          break
        }
        case 'doc.read': {
          const slug = String(p.slug ?? PLAN_SLUG)
          const doc = getAgentDoc(tienda.obtenerEstado().project.id, slug)
          results.push({
            type: action.type,
            success: Boolean(doc),
            message: doc ? doc.content.slice(0, 6000) : `No existe ${slug}`,
            data: doc,
          })
          break
        }
        case 'doc.create':
        case 'doc.write': {
          const slug = String(p.slug ?? PLAN_SLUG)
          const content = String(p.content ?? p.markdown ?? '')
          if (!content.trim()) {
            results.push({ type: action.type, success: false, message: 'Falta content' })
            break
          }
          const projectId = tienda.obtenerEstado().project.id
          const doc =
            action.type === 'doc.create'
              ? createAgentDoc(projectId, slug, content, 'ai')
              : writeAgentDoc(projectId, slug, content, { origin: 'ai' })
          results.push({ type: action.type, success: true, message: `Documento ${doc.slug}`, data: { slug: doc.slug } })
          break
        }
        case 'doc.append': {
          const projectId = tienda.obtenerEstado().project.id
          const slug = String(p.slug ?? PLAN_SLUG)
          const chunk = String(p.markdown ?? p.content ?? '')
          const section = p.section ? String(p.section) : ''
          const prev = getAgentDoc(projectId, slug)
          let next = prev?.content ?? `# ${slug.replace(/\.md$/i, '')}\n`
          if (section) {
            const cur = getMarkdownSection(next, section)
            next = setMarkdownSection(next, section, [cur, chunk].filter(Boolean).join('\n\n'))
          } else {
            next = `${next.trimEnd()}\n\n${chunk}\n`
          }
          const doc = writeAgentDoc(projectId, slug, next, { origin: 'ai' })
          results.push({ type: action.type, success: true, message: `Actualizado ${doc.slug}`, data: { slug: doc.slug } })
          break
        }
        case 'doc.evaluate': {
          const stEval = tienda.obtenerEstado()
          const ev = syncPlanAfterDawChange(stEval.project.id, stEval)
          results.push({
            type: action.type,
            success: Boolean(ev),
            message: ev?.summary ?? 'No hay plan.md que evaluar. Añade tareas `- [ ]` en Por implementar.',
            data: ev
              ? { planned: ev.planned, done: ev.done, missing: ev.missing, extraTracks: ev.extraTracks }
              : undefined,
          })
          break
        }
        case 'analysis.timing': {
          const { audioEngine } = await import('@/lib/audio-engine')
          const d = audioEngine.getTimingDiagnostics()
          const skewVsAhead = Math.abs(d.skewMs - d.pathAheadMs)
          const ok = !d.playing || skewVsAhead < 40
          results.push({
            type: action.type,
            success: true,
            message: ok
              ? `Timing OK · ahead ${d.pathAheadMs.toFixed(0)} ms · buf ${d.bufferSize} · ${d.sampleRate} Hz`
              : `Timing sospechoso · skew ${d.skewMs.toFixed(0)} ms vs ahead ${d.pathAheadMs.toFixed(0)} ms · buf ${d.bufferSize}`,
            data: { ...d, ok, skewVsAheadMs: skewVsAhead },
          })
          break
        }
        case 'analysis.buffer': {
          const { analyzeBufferHealth } = await import('./audio-buffer-health')
          const p = (action.payload ?? {}) as { sampleMs?: number; reset?: boolean }
          const report = await analyzeBufferHealth({
            sampleMs: typeof p.sampleMs === 'number' ? p.sampleMs : 400,
            reset: p.reset !== false,
          })
          results.push({
            type: action.type,
            success: true,
            message: `[${report.status}] ${report.summary}`,
            data: report,
          })
          break
        }
        case 'analysis.fxBlame': {
          const { runFxBlame } = await import('./audio-fx-blame')
          const p = (action.payload ?? {}) as {
            sampleMs?: number
            settleMs?: number
            includeInstruments?: boolean
            trackId?: string
            maxCandidates?: number
          }
          const report = await runFxBlame({
            getState: () => tienda.obtenerEstado(),
            setBypass: async (trackId, pluginInstanceId, bypass) => {
              const r = await tienda.executor.execute('plugin.bypass', {
                trackId,
                pluginInstanceId,
                bypass,
              })
              return Boolean(r.success)
            },
            sampleMs: typeof p.sampleMs === 'number' ? p.sampleMs : 350,
            settleMs: typeof p.settleMs === 'number' ? p.settleMs : 120,
            includeInstruments: p.includeInstruments === true,
            trackId: typeof p.trackId === 'string' ? p.trackId : undefined,
            maxCandidates: typeof p.maxCandidates === 'number' ? p.maxCandidates : 24,
          })
          results.push({
            type: action.type,
            success: true,
            message: report.summary,
            data: report,
          })
          if (report.suspects[0] && tienda.obtenerEstado().project?.id) {
            try {
              const { writeAgentDoc, PLAN_SLUG, getAgentDoc, setMarkdownSection } = await import(
                './agent-docs'
              )
              const pid = tienda.obtenerEstado().project.id
              const prev = getAgentDoc(pid, PLAN_SLUG)?.content ?? '# Plan\n'
              const block = [
                `## FX blame (${new Date().toISOString().slice(0, 19)})`,
                report.summary,
                ...report.suspects.slice(0, 5).map(
                  (s, i) =>
                    `${i + 1}. **${s.pluginName}** @ ${s.trackName} (${s.role}) Δ${s.improvement} · ${s.confidence} — ${s.reason}`,
                ),
                ...report.advice.map((a) => `- ${a}`),
              ].join('\n')
              const next = setMarkdownSection(prev, 'FX blame', block)
              writeAgentDoc(pid, PLAN_SLUG, next, { origin: 'ai' })
            } catch {
              /* docs opcionales */
            }
          }
          break
        }
        case 'render.start':
        case 'render.cancel':
        case 'render.getStatus':
        case 'analysis.loudness':
        case 'analysis.compareTarget':
        case 'analysis.spectrum':
        case 'analysis.stereo':
        case 'analysis.fullReport':
        case 'automation.setCurve':
        case 'automation.clear':
        case 'bus.create':
        case 'send.set':
        case 'sidechain.connect': {
          const r = await tienda.executor.execute(action.type, (action.payload ?? {}) as Record<string, unknown>)
          if (action.type === 'render.start' && r.success && r.result) {
            const job = r.result as import('../../../shared/src/types/render').RenderJob
            try {
              const { runNativeBounce, buildRuntimeBounceContent } = await import(
                '@/src/lib/bounce-service'
              )
              const stBounce = tienda.obtenerEstado()
              const content = buildRuntimeBounceContent(stBounce, {
                startSec: job.start.segundos ?? 0,
                endSec: job.end.segundos,
              })
              const done = await runNativeBounce(job, content, undefined, stBounce)
              const listen = done.listenReport
              const listenLine = listen
                ? ` · listen: ${listen.ok ? 'OK' : 'ISSUE'} ${listen.summary}`
                : ''
              results.push({
                type: action.type,
                success: done.status === 'completed',
                message:
                  done.status === 'completed'
                    ? `Bounce OK ${done.outputPath} (${done.loudness?.integrated?.toFixed(1) ?? '?'} LUFS)${listenLine}`
                    : done.error ?? done.status,
                data: done,
              })
              if (listen && stBounce.project.id) {
                try {
                  const { writeAgentDoc, PLAN_SLUG, getAgentDoc, setMarkdownSection } = await import(
                    './agent-docs'
                  )
                  const prev = getAgentDoc(stBounce.project.id, PLAN_SLUG)?.content ?? '# Plan\n'
                  if (!prev.includes(listen.summary.slice(0, 40))) {
                    const next = setMarkdownSection(
                      prev,
                      'Evaluación',
                      `AudioListenReport: ${listen.summary}\n`,
                    )
                    writeAgentDoc(stBounce.project.id, PLAN_SLUG, next, { origin: 'ai' })
                  }
                } catch {
                  /* optional */
                }
              }
            } catch (e) {
              results.push({
                type: action.type,
                success: false,
                message: e instanceof Error ? e.message : String(e),
              })
            }
          } else {
            results.push({
              type: action.type,
              success: r.success,
              message: r.success
                ? JSON.stringify(r.result)
                : r.error?.message ?? `Error ${action.type}`,
              data: r.result,
            })
          }
          break
        }
        case 'daw.masterPass': {
          const { runMasterPass } = await import('./master-pass')
          const p = (action.payload ?? {}) as {
            target?: 'streaming' | 'club' | 'cd'
            genero?: string
            minutes?: number
          }
          const mp = await runMasterPass(tienda, p)
          results.push({
            type: action.type,
            success: mp.ok,
            message: mp.message,
            data: mp,
          })
          break
        }
        case 'track.freeze': {
          const { freezeTrack } = await import('./track-freeze')
          const trackId = String((action.payload as { trackId?: string })?.trackId ?? '')
          const fr = await freezeTrack(tienda, trackId)
          results.push({ type: action.type, success: fr.ok, message: fr.message, data: fr })
          break
        }
        case 'track.unfreeze': {
          const { unfreezeTrack } = await import('./track-freeze')
          const trackId = String((action.payload as { trackId?: string })?.trackId ?? '')
          const fr = await unfreezeTrack(tienda, trackId)
          results.push({ type: action.type, success: fr.ok, message: fr.message, data: fr })
          break
        }
        case 'audio.listDevices': {
          const { listAudioDevices } = await import('./audio-device-cli')
          const r = await listAudioDevices()
          results.push({
            type: action.type,
            success: r.ok,
            message: r.ok
              ? `${r.devices?.length ?? 0} dispositivos · actual: ${r.audio?.backend}/${r.audio?.deviceName || '?'}`
              : r.message || 'list falló',
            data: r,
          })
          break
        }
        case 'audio.getDevice': {
          const { getAudioDevice } = await import('./audio-device-cli')
          const r = await getAudioDevice()
          results.push({
            type: action.type,
            success: r.ok,
            message: r.audio
              ? `${r.audio.backend} · ${r.audio.deviceName} · ${r.audio.sampleRate}Hz/${r.audio.bufferSize} running=${r.audio.running}`
              : r.message || 'sin audio',
            data: r,
          })
          break
        }
        case 'audio.setDevice': {
          const { setAudioDevice } = await import('./audio-device-cli')
          const r = await setAudioDevice(tienda, {
            backend: String(p.backend ?? 'asio'),
            deviceId: p.deviceId != null ? String(p.deviceId) : undefined,
            sampleRate: p.sampleRate != null ? Number(p.sampleRate) : undefined,
            bufferSize: p.bufferSize != null ? Number(p.bufferSize) : undefined,
            exclusive: p.exclusive === true,
          })
          results.push({ type: action.type, success: r.ok, message: r.message, data: r })
          break
        }
        case 'audio.ensureBest': {
          const { ensureBestAudioDevice } = await import('./audio-device-cli')
          const r = await ensureBestAudioDevice(tienda, p.preferName ? String(p.preferName) : 'UMC')
          results.push({ type: action.type, success: r.ok, message: r.message, data: r })
          break
        }
        case 'audio.armNative': {
          const { armNativeAudioOutput } = await import('./audio-device-cli')
          const r = await armNativeAudioOutput()
          results.push({ type: action.type, success: r.ok, message: r.message, data: r })
          break
        }
        case 'audio.clearQuarantine': {
          const { clearPluginQuarantineAndRestore } = await import('./audio-device-cli')
          const r = await clearPluginQuarantineAndRestore(tienda)
          results.push({ type: action.type, success: r.ok, message: r.message, data: r })
          break
        }
        case 'project.new': {
          const nombre = String(p.nombre ?? 'Proyecto nuevo').trim() || 'Proyecto nuevo'
          const r = await tienda.executor.execute('project.new', { nombre })
          results.push({
            type: action.type,
            success: r.success,
            message: r.success ? `Proyecto nuevo «${nombre}»` : r.error?.message ?? 'Error project.new',
            data: r.result,
          })
          break
        }
        default:
          results.push({
            type: action.type,
            success: false,
            message: `Acción no soportada: ${action.type}`,
          })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        type: action.type,
        success: false,
        message,
      })
      appendAiDawAudit({
        ...auditBase,
        status: 'failed',
        result: { success: false, message, error: message },
      })
      continue
    }

    const last = results[results.length - 1]
    if (last && last.type === action.type) {
      appendAiDawAudit({
        ...auditBase,
        status: last.success ? 'executed' : 'failed',
        result: { success: last.success, message: last.message },
      })
    }
  }

  return results
}

export function formatActionResultsForUser(results: ActionResult[]): string {
  if (results.length === 0) return ''
  return results.map((r) => `${r.success ? '✓' : '✗'} ${r.message}`).join('\n')
}
