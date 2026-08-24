/**
 * Política de ejecución de ACTIONS del agente DAW (modos + destructivas).
 */

import type { AgentMode } from './ai-modes'
import type { DawAction } from './ai-daw-agent'

const READ_ONLY = new Set([
  'plugin.lookup',
  'plugin.probe',
  'library.preset.list',
  'library.preset.search',
  'doc.evaluate',
  'doc.read',
  'doc.list',
  'analysis.loudness',
  'analysis.compareTarget',
  'analysis.spectrum',
  'analysis.stereo',
  'analysis.fullReport',
  'render.getStatus',
])

/** Escribir plan.md / docs no muta pistas ni clips — permitido en Plan/Pensar. */
const DOCS_WRITE = new Set(['doc.create', 'doc.write', 'doc.append'])

export function payloadOfAction(action: DawAction): Record<string, unknown> {
  return (action.payload ?? {}) as Record<string, unknown>
}

export function isReadOnlyAction(action: DawAction): boolean {
  return READ_ONLY.has(action.type)
}

export function isDocsWriteAction(action: DawAction): boolean {
  return DOCS_WRITE.has(action.type)
}

/** Preview-only builds (aplicar:false) no mutan el proyecto. */
export function isPreviewOnlyAction(action: DawAction): boolean {
  if (
    action.type !== 'daw.musicBuild' &&
    action.type !== 'daw.composeProject' &&
    action.type !== 'daw.generateMidiSong'
  ) {
    return false
  }
  const p = payloadOfAction(action)
  return p.aplicar !== true && p.apply !== true
}

export function isMutatingAction(action: DawAction): boolean {
  if (isReadOnlyAction(action)) return false
  if (isDocsWriteAction(action)) return false
  if (isPreviewOnlyAction(action)) return false
  return true
}

export function isDestructiveAction(action: DawAction): boolean {
  const t = action.type
  if (t === 'track.delete' || t === 'clip.delete' || t === 'plugin.remove') return true
  if (t === 'midi.deleteNotes') return true
  if (t === 'midi.notes.set') {
    const notas = payloadOfAction(action).notas
    if (Array.isArray(notas) && notas.length === 0) return true
  }
  return false
}

/** Lote peligroso: varios deletes o “borra todo”. */
export function batchNeedsDestructiveConfirm(actions: DawAction[], userText = ''): boolean {
  if (/borra(r)?\s+todo|elimina(r)?\s+todo|clear\s+project|vac[ií]a(r)?\s+(el\s+)?proyecto/i.test(userText)) {
    return actions.some(isMutatingAction)
  }
  const deletes = actions.filter(
    (a) => a.type === 'track.delete' || a.type === 'clip.delete' || a.type === 'plugin.remove',
  )
  return deletes.length >= 2 || actions.some(isDestructiveAction)
}

export function modeBlocksMutation(mode: AgentMode): boolean {
  return mode === 'plan' || mode === 'think'
}

export function withAplicarTrue(actions: DawAction[]): DawAction[] {
  return actions.map((a) => {
    if (
      a.type === 'daw.musicBuild' ||
      a.type === 'daw.composeProject' ||
      a.type === 'daw.generateMidiSong'
    ) {
      return {
        ...a,
        payload: { ...payloadOfAction(a), aplicar: true },
      }
    }
    return a
  })
}

export function forcePreviewAplicar(actions: DawAction[], mode: AgentMode): DawAction[] {
  if (!modeBlocksMutation(mode)) return actions
  return actions.map((a) => {
    if (
      a.type === 'daw.musicBuild' ||
      a.type === 'daw.composeProject' ||
      a.type === 'daw.generateMidiSong'
    ) {
      return {
        ...a,
        payload: { ...payloadOfAction(a), aplicar: false },
      }
    }
    return a
  })
}

export type ActionPartition = {
  readonly: DawAction[]
  /** Mutaciones seguras (create mode) o pendientes (plan/think). */
  mutating: DawAction[]
  destructive: DawAction[]
}

export function partitionActions(actions: DawAction[], userText = ''): ActionPartition {
  const readonly: DawAction[] = []
  const mutating: DawAction[] = []
  const destructive: DawAction[] = []
  const forceConfirm = batchNeedsDestructiveConfirm(actions, userText)

  for (const a of actions) {
    if (isReadOnlyAction(a) || isPreviewOnlyAction(a)) {
      readonly.push(a)
      continue
    }
    if (forceConfirm || isDestructiveAction(a)) {
      destructive.push(a)
      continue
    }
    mutating.push(a)
  }
  return { readonly, mutating, destructive }
}
