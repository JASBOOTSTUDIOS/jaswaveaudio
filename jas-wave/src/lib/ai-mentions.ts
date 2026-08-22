/**
 * Mencionar pistas, clips, plugins, VSTs del catálogo, acciones y modos con @.
 */

import type { DAWState } from '../../../shared/src/types/state'
import { AGENT_MODE_META, type AgentMode } from './ai-modes'
import { pluginRegistry } from './plugin/registry'

export type MentionKind = 'mode' | 'action' | 'track' | 'clip' | 'plugin' | 'vst'

export type Mentionable = {
  kind: MentionKind
  id: string
  trackId?: string
  clipId?: string
  pluginInstanceId?: string
  pluginId?: string
  mode?: Exclude<AgentMode, 'auto'>
  label: string
  hint: string
  insertText?: string
}

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  mode: 'Modos',
  action: 'Acciones',
  track: 'Pistas',
  clip: 'Clips',
  plugin: 'Plugins en el proyecto',
  vst: 'Catálogo VST',
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function staticMentions(): Mentionable[] {
  const modes: Mentionable[] = (Object.keys(AGENT_MODE_META) as Array<Exclude<AgentMode, 'auto'>>).map(
    (mode) => ({
      kind: 'mode',
      id: `mode:${mode}`,
      mode,
      label: AGENT_MODE_META[mode].label,
      hint: AGENT_MODE_META[mode].hint,
      insertText: AGENT_MODE_META[mode].insert,
    }),
  )
  const actions: Mentionable[] = [
    { kind: 'action', id: 'action:clip', label: 'crear clip MIDI', hint: 'clip en pista seleccionada', insertText: 'crea un clip MIDI en la pista seleccionada' },
    { kind: 'action', id: 'action:project', label: 'proyecto desde cero', hint: 'plan + pistas + VSTs', insertText: 'crea un proyecto completo desde cero con vista previa' },
    { kind: 'action', id: 'action:bpm', label: 'cambiar BPM', hint: 'tempo', insertText: 'pon el BPM a ' },
    { kind: 'action', id: 'action:insert-vst', label: 'insertar VST', hint: 'catálogo en pista', insertText: 'inserta el VST ' },
    { kind: 'action', id: 'action:lookup', label: 'consultar VST', hint: 'mapa MIDI / manual', insertText: 'consulta cómo se usa el VST ' },
  ]
  return [...modes, ...actions]
}

export function listMentionables(state: DAWState): Mentionable[] {
  const out: Mentionable[] = [...staticMentions()]
  for (const t of state.project?.tracks ?? []) {
    out.push({
      kind: 'track',
      id: `track:${t.id}`,
      trackId: t.id,
      label: t.nombre || t.id,
      hint: t.tipo,
    })
    for (const c of t.clips ?? []) {
      const name = (c as { nombre?: string }).nombre || 'Clip'
      out.push({
        kind: 'clip',
        id: `clip:${c.id}`,
        trackId: t.id,
        clipId: c.id,
        label: name,
        hint: `${t.nombre} · clip`,
      })
    }
    for (const pl of t.plugins ?? []) {
      out.push({
        kind: 'plugin',
        id: `plugin:${pl.id}`,
        trackId: t.id,
        pluginInstanceId: pl.id,
        label: pl.nombre,
        hint: `${t.nombre} · ${pl.tipo}`,
      })
    }
  }
  const masterPlugins = state.project?.master?.plugins ?? []
  for (const pl of masterPlugins) {
    out.push({
      kind: 'plugin',
      id: `plugin:${pl.id}`,
      trackId: 'master',
      pluginInstanceId: pl.id,
      label: pl.nombre,
      hint: `Master · ${pl.tipo}`,
    })
  }
  for (const d of pluginRegistry.list()) {
    out.push({
      kind: 'vst',
      id: `vst:${d.pluginId}`,
      pluginId: d.pluginId,
      label: d.name,
      hint: `${d.format} · ${d.isInstrument ? 'instrumento' : 'efecto'} · ${d.vendor}`,
      insertText: d.name.includes(' ') ? `@"${d.name}"` : `@${d.name}`,
    })
  }
  return out
}

function matchItem(query: string, item: Mentionable): boolean {
  const q = norm(query)
  if (!q) return true
  const label = norm(item.label)
  const hint = norm(item.hint)
  return label === q || label.startsWith(q) || label.includes(q) || hint.includes(q)
}

/** Resuelve @Nombre / @"Nombre con espacios" contra el proyecto. */
export function resolveAtMentions(text: string, state: DAWState): Mentionable[] {
  const items = listMentionables(state)
  const sorted = [...items].sort((a, b) => b.label.length - a.label.length)
  const found: Mentionable[] = []
  const seen = new Set<string>()

  const take = (name: string) => {
    const hit =
      sorted.find((it) => norm(it.label) === norm(name)) ||
      sorted.find((it) => matchItem(name, it) && norm(name).length >= 2)
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id)
      found.push(hit)
    }
  }

  const quoted = [...text.matchAll(/@"([^"]+)"|@«([^»]+)»/g)]
  for (const m of quoted) take((m[1] ?? m[2] ?? '').trim())

  let i = 0
  while (i < text.length) {
    if (text[i] !== '@') {
      i++
      continue
    }
    if (text[i + 1] === '"' || text[i + 1] === '«') {
      i++
      continue
    }
    const rest = text.slice(i + 1)
    const hit = sorted.find((it) => {
      const lab = it.label
      if (!lab) return false
      const slice = rest.slice(0, lab.length)
      if (norm(slice) !== norm(lab)) return false
      const next = rest[lab.length] ?? ''
      return next === '' || /[\s,.;:!?)]/.test(next)
    })
    if (hit) {
      take(hit.label)
      i += 1 + hit.label.length
      continue
    }
    const token = rest.match(/^[^\s@,;]+/)
    if (token) take(token[0])
    i++
  }
  return found
}

export type MentionDraft = {
  start: number
  query: string
}

/** Fragmento incompleto tras el último @ (para autocompletado). */
export function mentionDraftAtCaret(text: string, caret: number): MentionDraft | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const frag = before.slice(at + 1)
  if (/\n/.test(frag)) return null
  if (frag.startsWith('"') && frag.includes('"', 1)) return null
  return { start: at, query: frag.replace(/^"/, '') }
}

export function filterMentionables(items: Mentionable[], query: string): Mentionable[] {
  const q = norm(query)
  const hits = q ? items.filter((it) => matchItem(q, it)) : items
  return hits.slice(0, 200)
}

export function groupMentionables(items: Mentionable[]): Array<{ kind: MentionKind; label: string; items: Mentionable[] }> {
  const order: MentionKind[] = ['mode', 'action', 'track', 'clip', 'plugin', 'vst']
  return order
    .map((kind) => ({
      kind,
      label: MENTION_KIND_LABEL[kind],
      items: items.filter((i) => i.kind === kind),
    }))
    .filter((g) => g.items.length > 0)
}

export function formatMentionsForPrompt(mentions: Mentionable[]): string {
  if (mentions.length === 0) return '(ninguna)'
  return mentions
    .map((m) => {
      if (m.kind === 'track') return `- pista id=${m.trackId} «${m.label}» (${m.hint})`
      if (m.kind === 'clip') return `- clip id=${m.clipId} pista=${m.trackId} «${m.label}»`
      if (m.kind === 'plugin') return `- plugin id=${m.pluginInstanceId} pista=${m.trackId} «${m.label}» (${m.hint})`
      if (m.kind === 'vst') return `- VST catálogo id=${m.pluginId} «${m.label}» (${m.hint})`
      if (m.kind === 'mode') return `- modo ${m.label}`
      return `- acción «${m.label}»`
    })
    .join('\n')
}
