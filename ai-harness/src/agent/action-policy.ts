/**
 * Política de acciones del agente (solo lectura vs mutación) — sin permisos UI.
 */

import type { HarnessDawAction } from '../types/actions'
import { modeBlocksMutation, wantsFullProject, type AgentMode } from './modes'

/**
 * Clase de riesgo de cada acción que el agente puede emitir (fail closed):
 * - read: solo lectura (se ejecuta sin confirmación, también en research del razonamiento).
 * - write: muta el proyecto de forma deshacible (undo) — confirmación según autonomía.
 * - destructive: borra contenido — SIEMPRE requiere confirmación del usuario.
 * - system: efectos fuera del proyecto (disco, dispositivo de audio, proyecto nuevo, bounce,
 *   importaciones) — SIEMPRE requiere confirmación del usuario.
 * Un tipo que no esté aquí no tiene clase → se bloquea y se registra.
 */
export type AgentActionClass = 'read' | 'write' | 'destructive' | 'system'

export const AGENT_ACTION_CLASSES: Readonly<Record<string, AgentActionClass>> = Object.freeze({
  // ── Lectura ─────────────────────────────────────────────
  // Herramientas de respaldo (A1): solo CALCULAN propuestas a partir del estado; no mutan.
  'fallback.userIntent': 'read',
  'fallback.styleEnhance': 'read',
  'fallback.midiClipEdit': 'read',
  'fallback.sectionSplit': 'read',
  'fallback.midiAuditFix': 'read',
  'plugin.lookup': 'read',
  'plugin.probe': 'read',
  'plugin.listParameters': 'read',
  'plugin.searchParameters': 'read',
  'plugin.getParameter': 'read',
  'library.preset.list': 'read',
  'library.preset.search': 'read',
  'library.preset.listGlobal': 'read',
  'library.preset.searchGlobal': 'read',
  'style.profile.list': 'read',
  'style.profile.search': 'read',
  'doc.evaluate': 'read',
  'doc.read': 'read',
  'doc.list': 'read',
  'analysis.loudness': 'read',
  'analysis.compareTarget': 'read',
  'analysis.spectrum': 'read',
  'analysis.stereo': 'read',
  'analysis.fullReport': 'read',
  'analysis.track': 'read',
  'analysis.mix': 'read',
  'analysis.masking': 'read',
  'analysis.dynamics': 'read',
  'analysis.section': 'read',
  'analysis.reference': 'read',
  'analysis.diagnose': 'read',
  'analysis.timing': 'read',
  'analysis.buffer': 'read',
  'analysis.fxBlame': 'read',
  'render.getStatus': 'read',
  'track.getFxChain': 'read',
  'web.search': 'read',
  'midi.notes.get': 'read',
  'midi.getNotes': 'read',
  'midi.getClipSummary': 'read',
  'midi.clip.md.read': 'read',
  'midi.notes.compare': 'read',
  'selection.get': 'read',
  'project.getSummary': 'read',
  'track.list': 'read',
  'audio.listDevices': 'read',
  'audio.getDevice': 'read',

  // ── A9 · Auditoría y progreso ───────────────────────────
  // Lecturas del estado del trabajo: plan, bitácora del turno, auditorías y resumen.
  'plan.get': 'read',
  'plan.status': 'read',
  'run.log': 'read',
  'run.diff': 'read',
  'audit.project': 'read',
  'audit.mix': 'read',
  'audit.step': 'read',
  'audit.history': 'read',
  'audit.compareReference': 'read',
  'session.summary': 'read',

  // ── Escritura (deshacible) ──────────────────────────────
  'doc.create': 'write',
  'doc.write': 'write',
  'doc.append': 'write',
  'project.setBpm': 'write',
  'project.setTimeSignature': 'write',
  'project.update': 'write',
  'ui.setZoom': 'write',
  'track.create': 'write',
  'track.move': 'write',
  'track.update': 'write',
  'track.toggleMute': 'write',
  'track.toggleSolo': 'write',
  'track.toggleArm': 'write',
  'track.freeze': 'write',
  'track.unfreeze': 'write',
  'transport.toggle': 'write',
  'transport.stop': 'write',
  'transport.toggleLoop': 'write',
  'transport.toggleMetronome': 'write',
  'transport.toggleRecord': 'write',
  'transport.togglePunch': 'write',
  'transport.toggleCountIn': 'write',
  'transport.seek': 'write',
  'transport.setRecordMode': 'write',
  'master.update': 'write',
  'clip.create': 'write',
  'clip.split': 'write',
  'clip.merge': 'write',
  'clip.resize': 'write',
  'clip.move': 'write',
  'midi.clip.splitIntoSections': 'write',
  'midi.notes.set': 'write',
  'midi.notes.patch': 'write',
  'midi.clip.create': 'write',
  'midi.transpose': 'write',
  'midi.quantize': 'write',
  'midi.humanize': 'write',
  'midi.setVelocity': 'write',
  'midi.createNotes': 'write',
  'midi.notes.dedupe': 'write',
  'midi.clip.md.upsert': 'write',
  'midi.clip.md.apply': 'write',
  'midi.makeStaccato': 'write',
  'midi.makeLegato': 'write',
  'midi.repeatPattern': 'write',
  'midi.reverse': 'write',
  'midi.invert': 'write',
  'midi.timeStretch': 'write',
  'midi.constrainScale': 'write',
  'midi.generatePattern': 'write',
  'midi.applyGroove': 'write',
  'midi.setCC': 'write',
  'midi.setPitchBend': 'write',
  'plugin.insert': 'write',
  'plugin.move': 'write',
  'plugin.bypass': 'write',
  'plugin.duplicate': 'write',
  'plugin.replace': 'write',
  'plugin.setParameter': 'write',
  'plugin.snapshotState': 'write',
  'fxChain.copy': 'write',
  'fxChain.paste': 'write',
  'fxChain.loadPreset': 'write',
  'fxChain.savePreset': 'write',
  'automation.setCurve': 'write',
  'automation.writePoint': 'write',
  'bus.create': 'write',
  'send.set': 'write',
  'sidechain.connect': 'write',

  // ── A7c · Actuación con valores reales (ganancia, EQ, compresor, límite, master) ──
  'track.ganancia': 'write',
  'pista.pan': 'write',
  'pista.eq.agregar': 'write',
  'pista.eq.editar': 'write',
  'pista.eq.quitar': 'write',
  'pista.compresor.agregar': 'write',
  'pista.compresor.editar': 'write',
  'pista.compresor.quitar': 'write',
  'pista.limite': 'write',
  'master.normalizar': 'write',
  'take.folder.ensure': 'write',
  'take.add': 'write',
  'take.rename': 'write',
  'take.preview': 'write',
  'comp.segment.set': 'write',
  'reference.toggleAB': 'write',
  // A7d · FX propios JasWave (mezcla): inserta + setea parámetros del VST propio.
  'mix.eq': 'write',
  'mix.compress': 'write',
  'mix.limit': 'write',
  'library.preset.save': 'write',
  'library.preset.saveGlobal': 'write',
  'library.preset.promote': 'write',
  'library.preset.apply': 'write',
  'library.preset.audition': 'write',
  'library.preset.saveFxChainGlobal': 'write',
  'style.profile.saveFromClip': 'write',
  'style.profile.apply': 'write',
  'audio.armNative': 'write',
  'daw.musicBuild': 'write',
  'daw.composeProject': 'write',
  'daw.generateMidiSong': 'write',
  'daw.masterPass': 'write',

  // ── A9 · Escritura sobre el plan (siempre vía Command System) ──
  'plan.updateStep': 'write',
  'plan.addStep': 'write',
  'plan.proposeChange': 'write',

  // ── Destructivas (borran contenido) ─────────────────────
  'track.delete': 'destructive',
  'clip.delete': 'destructive',
  'plugin.remove': 'destructive',
  'midi.deleteNotes': 'destructive',
  'daw.wipeProject': 'destructive',
  'automation.clear': 'destructive',
  'take.delete': 'destructive',
  'comp.segment.clear': 'destructive',

  // ── Sistema (fuera del proyecto / disco / dispositivo) ──
  'project.new': 'system',
  'project.save': 'system',
  'project.saveAs': 'system',
  'project.load': 'system',
  'audio.setDevice': 'system',
  'audio.ensureBest': 'system',
  'audio.clearQuarantine': 'system',
  'audio.import': 'system',
  'reference.import': 'system',
  'render.start': 'system',
  'render.cancel': 'system',
  'score.exportClip': 'system',
  'score.exportProject': 'system',
})

/** Claves de payload que indican una ruta de disco (plugin.insert con path → system). */
const PATH_PAYLOAD_KEYS = ['path', 'ruta', 'filePath', 'pluginPath', 'vstPath', 'dllPath']

function payloadHasPath(p: Record<string, unknown>): boolean {
  for (const k of PATH_PAYLOAD_KEYS) {
    if (typeof p[k] === 'string' && String(p[k]).trim()) return true
  }
  const plugin = p.plugin
  if (plugin && typeof plugin === 'object') {
    const pl = plugin as Record<string, unknown>
    for (const k of PATH_PAYLOAD_KEYS) {
      if (typeof pl[k] === 'string' && String(pl[k]).trim()) return true
    }
  }
  return false
}

/** Clase estática (por tipo) — undefined = sin clasificar (fail closed). */
export function agentActionClassOfType(type: string): AgentActionClass | undefined {
  return Object.prototype.hasOwnProperty.call(AGENT_ACTION_CLASSES, type)
    ? AGENT_ACTION_CLASSES[type]
    : undefined
}

/** Clase efectiva teniendo en cuenta el payload (notas vacías, rutas de disco…). */
export function agentActionClass(action: AgentAction): AgentActionClass | undefined {
  const base = agentActionClassOfType(action.type)
  if (!base) return undefined
  const p = payloadOfAction(action)
  if (action.type === 'plugin.insert' && payloadHasPath(p)) return 'system'
  if (action.type === 'midi.notes.set') {
    const notas = p.notas ?? p.notes
    if (Array.isArray(notas) && notas.length === 0) return 'destructive'
  }
  return base
}

export function isClassifiedAction(action: AgentAction): boolean {
  return agentActionClassOfType(action.type) !== undefined
}

/** Destructivas y de sistema: siempre requieren confirmación explícita del usuario. */
export function actionAlwaysNeedsConfirm(action: AgentAction): boolean {
  const c = agentActionClass(action)
  return c === 'destructive' || c === 'system' || c === undefined
}

/** Tipos sin clasificar dentro de una lista (para tests / auditoría). */
export function unclassifiedActionTypes(types: Iterable<string>): string[] {
  const out: string[] = []
  for (const t of types) if (!agentActionClassOfType(t)) out.push(t)
  return out
}

export const AGENT_READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(
  Object.entries(AGENT_ACTION_CLASSES)
    .filter(([, c]) => c === 'read')
    .map(([t]) => t),
)

export const AGENT_DOCS_WRITE_ACTIONS: ReadonlySet<string> = new Set(['doc.create', 'doc.write', 'doc.append'])

export type AgentAction = HarnessDawAction

export function payloadOfAction(action: AgentAction): Record<string, unknown> {
  return (action.payload ?? {}) as Record<string, unknown>
}

export function isReadOnlyAction(action: AgentAction): boolean {
  return AGENT_READ_ONLY_ACTIONS.has(action.type)
}

export function isDocsWriteAction(action: AgentAction): boolean {
  return AGENT_DOCS_WRITE_ACTIONS.has(action.type)
}

export function isPreviewOnlyAction(action: AgentAction): boolean {
  if (action.type === 'midi.clip.md.upsert') {
    const p = payloadOfAction(action)
    return p.aplicar !== true && p.apply !== true
  }
  if (
    action.type !== 'daw.musicBuild' &&
    action.type !== 'daw.composeProject' &&
    action.type !== 'daw.generateMidiSong' &&
    action.type !== 'daw.wipeProject'
  ) {
    return false
  }
  const p = payloadOfAction(action)
  return p.aplicar !== true && p.apply !== true
}

export function isMutatingAction(action: AgentAction): boolean {
  if (isReadOnlyAction(action)) return false
  if (isDocsWriteAction(action)) return false
  // Orquestadores: siempre van a la tarjeta Aplicar (aunque payload.aplicar=false en preview).
  // Si no, processActionsForMode los ejecuta como “plan” y el usuario ve pending vacío / sin cambios.
  if (
    action.type === 'daw.musicBuild' ||
    action.type === 'daw.composeProject' ||
    action.type === 'daw.generateMidiSong' ||
    action.type === 'daw.wipeProject'
  ) {
    return true
  }
  if (isPreviewOnlyAction(action)) return false
  return true
}

export function isDestructiveAction(action: AgentAction): boolean {
  return agentActionClass(action) === 'destructive'
}

/** Acción con efectos fuera del proyecto (disco, dispositivo, proyecto nuevo, bounce…). */
export function isSystemAction(action: AgentAction): boolean {
  return agentActionClass(action) === 'system'
}

export function isDestructiveToolName(tool: string): boolean {
  return agentActionClassOfType(tool) === 'destructive'
}

/**
 * Destructivos/writes de a uno: el agente valida éxito antes del siguiente.
 * Conserva lecturas; deja solo la primera mutación.
 * Si hay daw.musicBuild / compose, ese orquestador gana sobre setBpm suelto.
 */
export function limitToOneMutatingAction<T extends { type: string; payload?: Record<string, unknown> }>(
  actions: T[],
): { kept: T[]; deferred: T[] } {
  const reads: T[] = []
  const writes: T[] = []
  for (const a of actions) {
    const fake = { type: a.type, payload: a.payload } as AgentAction
    if (
      a.type === 'daw.musicBuild' ||
      a.type === 'daw.composeProject' ||
      a.type === 'daw.generateMidiSong' ||
      a.type === 'daw.wipeProject'
    ) {
      writes.push(a)
      continue
    }
    if (
      isReadOnlyAction(fake) ||
      isPreviewOnlyAction(fake) ||
      isDocsWriteAction(fake) ||
      isLoopReadOnlyTool(a.type)
    ) {
      reads.push(a)
    } else {
      writes.push(a)
    }
  }
  if (!writes.length) return { kept: reads, deferred: [] }

  const orchIdx = writes.findIndex(
    (a) =>
      a.type === 'daw.musicBuild' ||
      a.type === 'daw.composeProject' ||
      a.type === 'daw.generateMidiSong' ||
      a.type === 'daw.wipeProject',
  )
  const primary = orchIdx >= 0 ? writes[orchIdx]! : writes[0]!
  const deferred = writes.filter((a) => a !== primary)
  return { kept: [...reads, primary], deferred }
}

/** @deprecated usar limitToOneMutatingAction */
export function limitToOneDestructiveAction<T extends { type: string; payload?: Record<string, unknown> }>(
  actions: T[],
): { kept: T[]; deferred: T[] } {
  return limitToOneMutatingAction(actions)
}

function isLoopReadOnlyTool(tool: string): boolean {
  return (
    tool === 'selection.get' ||
    tool === 'project.getSummary' ||
    tool === 'track.list' ||
    AGENT_READ_ONLY_ACTIONS.has(tool)
  )
}

export function batchNeedsDestructiveConfirm(actions: AgentAction[], userText = ''): boolean {
  if (/borra(r)?\s+todo|elimina(r)?\s+todo|clear\s+project|vac[ií]a(r)?\s+(el\s+)?proyecto/i.test(userText)) {
    return actions.some(isMutatingAction)
  }
  const deletes = actions.filter(
    (a) => a.type === 'track.delete' || a.type === 'clip.delete' || a.type === 'plugin.remove',
  )
  return deletes.length >= 2 || actions.some(isDestructiveAction)
}

/**
 * Riesgo para permisos/UI. Destructivas, de sistema y sin clasificar → 'dangerous'.
 */
export function actionRiskLevel(action: AgentAction): 'read' | 'write' | 'dangerous' {
  const cls = agentActionClass(action)
  if (cls === undefined) return 'dangerous'
  if (cls === 'destructive' || cls === 'system') return 'dangerous'
  if (isReadOnlyAction(action) || isDocsWriteAction(action) || isPreviewOnlyAction(action)) {
    return 'read'
  }
  return 'write'
}

export function withAplicarTrue(actions: AgentAction[]): AgentAction[] {
  return actions.map((a) => {
    if (
      a.type === 'daw.musicBuild' ||
      a.type === 'daw.composeProject' ||
      a.type === 'daw.generateMidiSong' ||
      a.type === 'daw.wipeProject'
    ) {
      return {
        ...a,
        payload: { ...payloadOfAction(a), aplicar: true },
      }
    }
    return a
  })
}

export function forcePreviewAplicar(actions: AgentAction[], mode: AgentMode): AgentAction[] {
  if (!modeBlocksMutation(mode)) return actions
  return actions.map((a) => {
    if (
      a.type === 'daw.musicBuild' ||
      a.type === 'daw.composeProject' ||
      a.type === 'daw.generateMidiSong' ||
      a.type === 'daw.wipeProject'
    ) {
      return {
        ...a,
        payload: { ...payloadOfAction(a), aplicar: false },
      }
    }
    return a
  })
}

export function ensureMusicBuildForFullProject(
  actions: AgentAction[],
  userText: string,
  opts: { aplicar: boolean },
): AgentAction[] {
  if (!wantsFullProject(userText)) return actions
  const hasOrch = actions.some(
    (a) => a.type === 'daw.musicBuild' || a.type === 'daw.composeProject',
  )
  // setBpm suelto sobra: el BPM va dentro de musicBuild
  const withoutSingleClip = actions.filter(
    (a) => a.type !== 'daw.generateMidiSong' && a.type !== 'project.setBpm',
  )
  const hints = musicBuildHintsFromUserText(userText)
  if (hasOrch) {
    return withoutSingleClip.map((a) => {
      if (a.type !== 'daw.musicBuild' && a.type !== 'daw.composeProject') return a
      const prev = payloadOfAction(a)
      return {
        ...a,
        payload: {
          ...prev,
          // Hints del pedido del usuario GANAN sobre alucinaciones del modelo (p. ej. bachata a 70 BPM)
          ...hints,
          aplicar: opts.aplicar,
          prompt: String(prev.prompt ?? userText),
          midiSource: 'procedural',
        },
      }
    })
  }
  return [
    {
      type: 'daw.musicBuild',
      payload: {
        ...hints,
        aplicar: opts.aplicar,
        prompt: userText,
        midiSource: 'procedural',
      },
    },
  ]
}

/** Extrae bpm/minutos/género del pedido para no dejar musicBuild genérico. */
export function musicBuildHintsFromUserText(userText: string): Record<string, unknown> {
  const t = userText.toLowerCase()
  const out: Record<string, unknown> = {}
  const bpm =
    t.match(/\b(\d{2,3})\s*bpm\b/) ||
    t.match(/\bbpm\s*(?:a|de|=|:)?\s*(\d{2,3})/)
  if (bpm) out.bpm = Number(bpm[1])
  const mins =
    t.match(/\b(\d+(?:[.,]\d+)?)\s*minutos?\b/) ||
    t.match(/\b(\d+)\s*:\s*(\d{2})\b/) ||
    t.match(/\b(\d+(?:[.,]\d+)?)\s*min\b/)
  if (mins) {
    if (mins[2] != null) out.minutos = Number(mins[1]) + Number(mins[2]) / 60
    else out.minutos = Number(String(mins[1]).replace(',', '.'))
  }
  if (/\bbachata\b/.test(t)) {
    out.genero = 'bachata'
    // Bachata real ~118–130. 60–80 es half-time (error frecuente del LLM).
    if (out.bpm == null || Number(out.bpm) < 100 || Number(out.bpm) > 160) out.bpm = 125
    if (out.minutos == null) out.minutos = 3
  } else if (/\breggaet[oó]n\b/.test(t)) {
    out.genero = 'reggaeton'
    if (out.bpm == null) out.bpm = 95
  } else if (/\bworship|gospel|adoraci[oó]n|alabanza\b/.test(t)) {
    out.genero = 'worship'
    if (out.bpm == null) out.bpm = 72
  }
  return out
}

/** True si el lote pendiente es solo un Music Build (candidato a auto-aplicar). */
export function isSoloMusicBuildPending(actions: AgentAction[]): boolean {
  const writes = actions.filter(
    (a) =>
      !isReadOnlyAction(a) &&
      !isDocsWriteAction(a) &&
      a.type !== 'selection.get' &&
      a.type !== 'project.getSummary' &&
      a.type !== 'track.list',
  )
  return writes.length === 1 && (writes[0]!.type === 'daw.musicBuild' || writes[0]!.type === 'daw.composeProject')
}

export type ActionPartition = {
  readonly: AgentAction[]
  mutating: AgentAction[]
  /** Requieren confirmación del usuario (destructivas, sistema, permisos, lote «borra todo»). */
  destructive: AgentAction[]
  /** Sin clase de riesgo conocida: no se ejecutan nunca (fail closed). */
  blocked: AgentAction[]
}

export function partitionActions(
  actions: AgentAction[],
  userText = '',
  needsPermissionConfirm: (action: AgentAction) => boolean = () => false,
): ActionPartition {
  const readonly: AgentAction[] = []
  const mutating: AgentAction[] = []
  const destructive: AgentAction[] = []
  const blocked: AgentAction[] = []
  const forceConfirm = batchNeedsDestructiveConfirm(actions, userText)

  for (const a of actions) {
    if (!isClassifiedAction(a)) {
      blocked.push(a)
      continue
    }
    if (isReadOnlyAction(a) || isPreviewOnlyAction(a)) {
      readonly.push(a)
      continue
    }
    const needsConfirm =
      forceConfirm || actionAlwaysNeedsConfirm(a) || needsPermissionConfirm(a)
    if (needsConfirm) {
      destructive.push(a)
      continue
    }
    mutating.push(a)
  }
  return { readonly, mutating, destructive, blocked }
}

export type AgentActionGateDecision =
  | { allow: true; cls: AgentActionClass }
  | { allow: false; cls: AgentActionClass | undefined; reason: 'unclassified' | 'needs-confirmation'; message: string }

/**
 * Puerta de ejecución (defensa en profundidad, justo antes de ejecutar):
 * - sin clase → bloqueada siempre;
 * - destructiva/sistema propuesta por la IA (sin confirmación explícita del usuario) → bloqueada.
 */
export function gateAgentActionExecution(
  action: AgentAction,
  opts: { userConfirmed: boolean },
): AgentActionGateDecision {
  const cls = agentActionClass(action)
  if (cls === undefined) {
    return {
      allow: false,
      cls,
      reason: 'unclassified',
      message: `Bloqueada: ${action.type} no tiene clase de riesgo conocida (fail closed).`,
    }
  }
  if ((cls === 'destructive' || cls === 'system') && !opts.userConfirmed) {
    return {
      allow: false,
      cls,
      reason: 'needs-confirmation',
      message: `Requiere confirmación del usuario: ${action.type} (${cls === 'system' ? 'sistema' : 'destructiva'}). Propónlo en la tarjeta de confirmación.`,
    }
  }
  return { allow: true, cls }
}
