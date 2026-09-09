/**
 * Política de acciones del agente (solo lectura vs mutación) — sin permisos UI.
 */

import type { HarnessDawAction } from '../types/actions'
import { modeBlocksMutation, wantsFullProject, type AgentMode } from './modes'

export const AGENT_READ_ONLY_ACTIONS = new Set([
  'plugin.lookup',
  'plugin.probe',
  'library.preset.list',
  'library.preset.search',
  'style.profile.list',
  'style.profile.search',
  'doc.evaluate',
  'doc.read',
  'doc.list',
  'analysis.loudness',
  'analysis.compareTarget',
  'analysis.spectrum',
  'analysis.stereo',
  'analysis.fullReport',
  'analysis.timing',
  'analysis.buffer',
  'analysis.fxBlame',
  'render.getStatus',
  'track.getFxChain',
  'web.search',
  'library.preset.listGlobal',
  'library.preset.searchGlobal',
  'midi.notes.get',
  'midi.getNotes',
  'midi.getClipSummary',
  'midi.clip.md.read',
  'midi.notes.compare',
  'selection.get',
  'project.getSummary',
  'track.list',
])

export const AGENT_DOCS_WRITE_ACTIONS = new Set(['doc.create', 'doc.write', 'doc.append'])

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
  const t = action.type
  if (t === 'track.delete' || t === 'clip.delete' || t === 'plugin.remove') return true
  if (t === 'daw.wipeProject') return true
  if (t === 'midi.deleteNotes') return true
  if (t === 'midi.notes.set') {
    const notas = payloadOfAction(action).notas
    if (Array.isArray(notas) && notas.length === 0) return true
  }
  return false
}

export function isDestructiveToolName(tool: string): boolean {
  return (
    tool === 'track.delete' ||
    tool === 'clip.delete' ||
    tool === 'plugin.remove' ||
    tool === 'midi.deleteNotes' ||
    tool === 'daw.wipeProject'
  )
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

export function actionRiskLevel(action: AgentAction): 'read' | 'write' | 'dangerous' {
  if (isReadOnlyAction(action) || isDocsWriteAction(action) || isPreviewOnlyAction(action)) {
    return 'read'
  }
  if (isDestructiveAction(action)) return 'dangerous'
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
  if (/\bbachata\b/.test(t) || /\bprince\s*royce\b/.test(t)) {
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
  destructive: AgentAction[]
}

export function partitionActions(
  actions: AgentAction[],
  userText = '',
  needsPermissionConfirm: (action: AgentAction) => boolean = () => false,
): ActionPartition {
  const readonly: AgentAction[] = []
  const mutating: AgentAction[] = []
  const destructive: AgentAction[] = []
  const forceConfirm = batchNeedsDestructiveConfirm(actions, userText)

  for (const a of actions) {
    if (isReadOnlyAction(a) || isPreviewOnlyAction(a)) {
      readonly.push(a)
      continue
    }
    const needsConfirm = forceConfirm || isDestructiveAction(a) || needsPermissionConfirm(a)
    if (needsConfirm) {
      destructive.push(a)
      continue
    }
    mutating.push(a)
  }
  return { readonly, mutating, destructive }
}
