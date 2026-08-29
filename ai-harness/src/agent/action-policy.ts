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

export function isMutatingAction(action: AgentAction): boolean {
  if (isReadOnlyAction(action)) return false
  if (isDocsWriteAction(action)) return false
  if (isPreviewOnlyAction(action)) return false
  return true
}

export function isDestructiveAction(action: AgentAction): boolean {
  const t = action.type
  if (t === 'track.delete' || t === 'clip.delete' || t === 'plugin.remove') return true
  if (t === 'midi.deleteNotes') return true
  if (t === 'midi.notes.set') {
    const notas = payloadOfAction(action).notas
    if (Array.isArray(notas) && notas.length === 0) return true
  }
  return false
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

export function forcePreviewAplicar(actions: AgentAction[], mode: AgentMode): AgentAction[] {
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

export function ensureMusicBuildForFullProject(
  actions: AgentAction[],
  userText: string,
  opts: { aplicar: boolean },
): AgentAction[] {
  if (!wantsFullProject(userText)) return actions
  const hasOrch = actions.some(
    (a) => a.type === 'daw.musicBuild' || a.type === 'daw.composeProject',
  )
  const withoutSingleClip = actions.filter((a) => a.type !== 'daw.generateMidiSong')
  if (hasOrch) return withoutSingleClip
  return [
    {
      type: 'daw.musicBuild',
      payload: {
        aplicar: opts.aplicar,
        prompt: userText,
      },
    },
    ...withoutSingleClip,
  ]
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
