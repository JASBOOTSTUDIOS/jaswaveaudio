/**
 * Mencionar pistas, clips, plugins, VSTs del catálogo, acciones y modos con @.
 */

import type { DAWState } from '../../../shared/src/types/state'
import { AGENT_MODE_META, type AgentMode } from './ai-modes'
import { listAgentDocs } from './agent-docs'
import { pluginRegistry } from './plugin/registry'

export type MentionKind = 'mode' | 'action' | 'track' | 'clip' | 'plugin' | 'vst' | 'doc' | 'message' | 'agent'

export type MentionableMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  actionsSummary?: string
}

export type Mentionable = {
  kind: MentionKind
  id: string
  trackId?: string
  clipId?: string
  pluginInstanceId?: string
  pluginId?: string
  messageId?: string
  messageExcerpt?: string
  mode?: Exclude<AgentMode, 'auto'>
  label: string
  hint: string
  insertText?: string
  /** Otros nombres con los que también se encuentra (p. ej. `/learn` para `/aprender`). */
  alias?: string[]
}

/** Disparador del autocompletado: `/` abre comandos, `@` abre referencias del proyecto. */
export type MentionTrigger = '@' | '/'

const KINDS_BY_TRIGGER: Record<MentionTrigger, readonly MentionKind[]> = {
  '/': ['action', 'mode'],
  '@': ['message', 'agent', 'doc', 'track', 'clip', 'plugin', 'vst'],
}

export function mentionKindsFor(trigger: MentionTrigger): readonly MentionKind[] {
  return KINDS_BY_TRIGGER[trigger]
}

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  message: 'Mensajes',
  mode: 'Modos',
  action: 'Acciones',
  track: 'Pistas',
  clip: 'Clips',
  plugin: 'Plugins en el proyecto',
  vst: 'Catálogo VST',
  doc: 'Documentos',
  agent: 'Agentes y Músicos Virtuales',
}

export const MAX_CITED_MESSAGES = 5

export function messagePreview(content: string, max = 42): string {
  const one = content.replace(/\s+/g, ' ').trim()
  if (!one) return '(vacío)'
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
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
    { kind: 'action', id: 'action:aprender', label: '/aprender', alias: ['/learn'], hint: 'recuerdo una preferencia tuya para este proyecto', insertText: '/aprender ' },
    { kind: 'action', id: 'action:meta', label: '/meta', alias: ['/goal'], hint: 'trabajo varios pasos seguidos hasta cumplir un objetivo', insertText: '/meta ' },
    { kind: 'action', id: 'action:plan', label: '/plan', hint: 'preparo un plan paso a paso sin tocar tu proyecto', insertText: '/plan ' },
    { kind: 'action', id: 'action:entrevista', label: '/entrevista', alias: ['/grill-me'], hint: 'te hago preguntas hasta tener claro lo que quieres', insertText: '/entrevista ' },
    { kind: 'action', id: 'action:programar', label: '/programar', alias: ['/schedule'], hint: 'hago una tarea más tarde o cada cierto tiempo', insertText: '/programar ' },
    {
      kind: 'action',
      id: 'action:configurar',
      label: '/configurar',
      alias: ['/config', '/personalizar'],
      hint: 'te ayudo a crear, editar o quitar tus habilidades, prompts, planes y reglas',
      insertText: '/configurar ',
    },
    { kind: 'action', id: 'action:clip', label: 'crear un clip', hint: 'en la pista seleccionada', insertText: 'crea un clip MIDI en la pista seleccionada' },
    { kind: 'action', id: 'action:project', label: 'canción desde cero', hint: 'pistas, notas y mezcla', insertText: 'créame una canción completa desde cero' },
    { kind: 'action', id: 'action:bpm', label: 'cambiar el tempo', hint: 'velocidad de la canción', insertText: 'pon el tempo a ' },
    { kind: 'action', id: 'action:insert-vst', label: 'añadir un instrumento o efecto', hint: 'en la pista seleccionada', insertText: 'añade el instrumento ' },
    { kind: 'action', id: 'action:lookup', label: 'cómo se usa un plugin', hint: 'te lo explico', insertText: 'explícame cómo se usa el plugin ' },
    { kind: 'action', id: 'action:plan-md', label: 'actualizar el plan', hint: 'lo que vamos a hacer', insertText: 'actualiza el plan con lo que vamos a hacer y revisa después cómo vamos' },
    { kind: 'action', id: 'action:eval-plan', label: 'revisar el plan', hint: 'qué falta por hacer', insertText: 'revisa el plan: qué ya está hecho y qué falta' },
  ]
  return [...modes, ...actions]
}

export function listMessageMentionables(messages: MentionableMessage[] = []): Mentionable[] {
  const out: Mentionable[] = []
  for (const m of [...messages].reverse()) {
    const text = [m.content, m.actionsSummary].filter((p) => p?.trim()).join(' ')
    if (!text.trim() || m.role === 'system') continue
    const preview = messagePreview(m.content || m.actionsSummary || '')
    out.push({
      kind: 'message',
      id: `msg:${m.id}`,
      messageId: m.id,
      messageExcerpt: [m.content.trim(), m.actionsSummary?.trim()].filter(Boolean).join('\n').slice(0, 1200),
      label: preview,
      hint: m.role === 'user' ? 'tú' : 'asistente',
      insertText: `@msg:${m.id}`,
    })
    if (out.length >= 30) break
  }
  return out
}

export function listMentionables(state: DAWState, messages: MentionableMessage[] = []): Mentionable[] {
  const out: Mentionable[] = [...listMessageMentionables(messages), ...staticMentions()]
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
  for (const d of listAgentDocs(state.project?.id || 'default')) {
    out.push({
      kind: 'doc',
      id: `doc:${d.slug}`,
      label: d.slug,
      hint: 'markdown del proyecto',
      insertText: d.slug === 'plan.md' ? 'lee y actualiza @plan.md' : `abre @${d.slug}`,
    })
  }

  // Agentes y Músicos Virtuales (editables y creables por el usuario)
  try {
    const raw =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem('jaswave-especialistas-custom-v2')
        : null
    const lista = raw ? JSON.parse(raw) : null
    const agentes =
      Array.isArray(lista) && lista.length > 0
        ? lista
        : [
            { id: 'director', nombre: 'Director de Banda', role: 'director' },
            { id: 'pianista', nombre: 'Pianista / Teclista', role: 'musico', instrumento: 'Piano' },
            { id: 'guitarrista', nombre: 'Guitarrista', role: 'musico', instrumento: 'Guitarra eléctrica' },
            { id: 'baterista', nombre: 'Baterista / Percusión', role: 'musico', instrumento: 'Drums' },
            { id: 'bajista', nombre: 'Bajista', role: 'musico', instrumento: 'Bajo' },
            { id: 'sintetizador', nombre: 'Diseñador de Sintes / Leads', role: 'musico', instrumento: 'Synthesizer' },
            { id: 'qa', nombre: 'QA / Auditor de Calidad Musical', role: 'qa' },
            { id: 'mezcla', nombre: 'Ingeniero de Mezcla', role: 'mezcla' },
            { id: 'mastering', nombre: 'Ingeniero de Mastering', role: 'mastering' },
          ]
    for (const ag of agentes) {
      if (ag.activo === false) continue
      const label = ag.nombre || ag.id
      out.push({
        kind: 'agent',
        id: `agent:${ag.id}`,
        label,
        hint: `${ag.role}${ag.instrumento ? ` · ${ag.instrumento}` : ''} · especialista`,
        insertText: label.includes(' ') ? `@"${label}"` : `@${label}`,
      })
    }
  } catch {
    /* ignore */
  }

  return out
}

function matchItem(query: string, item: Mentionable): boolean {
  const q = norm(query)
  if (!q) return true
  const label = norm(item.label)
  const hint = norm(item.hint)
  const excerpt = norm(item.messageExcerpt ?? '')
  const alias = (item.alias ?? []).map(norm)
  return (
    label.includes(q) ||
    hint.includes(q) ||
    alias.some((a) => a.includes(q)) ||
    (excerpt.length > 0 && excerpt.includes(q))
  )
}

/** Resuelve @Nombre / @"Nombre con espacios" contra el proyecto. */
export function resolveAtMentions(
  text: string,
  state: DAWState,
  messages: MentionableMessage[] = [],
): Mentionable[] {
  const items = listMentionables(state, messages)
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

  const takeMessage = (id: string) => {
    const hit = items.find((it) => it.kind === 'message' && it.messageId === id)
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id)
      found.push(hit)
    }
  }

  for (const m of text.matchAll(/@msg:([A-Za-z0-9._-]+)/g)) {
    takeMessage(m[1] ?? '')
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
    if (rest.startsWith('msg:')) {
      const id = rest.slice(4).match(/^[A-Za-z0-9._-]+/)
      i += 1 + (id ? 4 + id[0].length : 4)
      continue
    }
    const hit = sorted.find((it) => {
      if (it.kind === 'message') return false
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
  trigger: MentionTrigger
}

/** Fragmento incompleto tras el último @ o / (para autocompletado). */
export function mentionDraftAtCaret(text: string, caret: number): MentionDraft | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  const slash = before.lastIndexOf('/')
  const triggerIdx = Math.max(at, slash)
  if (triggerIdx < 0) return null

  const draftAt = (): MentionDraft | null => {
    if (at < 0) return null
    const fragAt = before.slice(at + 1)
    if (/\n/.test(fragAt)) return null
    if (fragAt.startsWith('"') && fragAt.includes('"', 1)) return null
    return { start: at, query: fragAt.replace(/^"/, ''), trigger: '@' }
  }

  if (triggerIdx === at) return draftAt()

  // '/' solo abre comandos al inicio o tras un espacio (no en rutas como a/b), y se cierra al escribir
  // los argumentos del comando.
  if (triggerIdx > 0 && !/\s/.test(before[triggerIdx - 1] ?? '')) return draftAt()
  const frag = before.slice(triggerIdx + 1)
  if (/\s/.test(frag)) return null
  return { start: triggerIdx, query: frag, trigger: '/' }
}

/** Filtra por texto y, si se indica el disparador, solo por los tipos que le corresponden. */
export function filterMentionables(items: Mentionable[], query: string, trigger?: MentionTrigger): Mentionable[] {
  const q = norm(query)
  const kinds = trigger ? mentionKindsFor(trigger) : null
  const scoped = kinds ? items.filter((it) => kinds.includes(it.kind)) : items
  const hits = q ? scoped.filter((it) => matchItem(q, it)) : scoped
  return hits.slice(0, 200)
}

const GROUP_ORDER: readonly MentionKind[] = ['message', 'mode', 'action', 'agent', 'doc', 'track', 'clip', 'plugin', 'vst']

export function groupMentionables(items: Mentionable[]): Array<{ kind: MentionKind; label: string; items: Mentionable[] }> {
  return GROUP_ORDER.map((kind) => ({
    kind,
    label: MENTION_KIND_LABEL[kind],
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0)
}

/** Lista plana en el mismo orden en que se pintan los grupos: la que recorre el teclado. */
export function orderedMentionables(items: Mentionable[]): Mentionable[] {
  return groupMentionables(items).flatMap((g) => g.items)
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
      if (m.kind === 'agent') return `- agente «${m.label}» (${m.hint}): la consulta va dirigida a este miembro de la banda; responde desde su especialidad`
      if (m.kind === 'doc') return `- documento ${m.label} (markdown editable)`
      if (m.kind === 'message') {
        const excerpt = (m.messageExcerpt || m.label).replace(/\n/g, ' ').slice(0, 240)
        return `- mensaje anterior (${m.hint}) «${m.label}»: ${excerpt}`
      }
      return `- acción «${m.label}»`
    })
    .join('\n')
}

export function collectCitedMessages(
  text: string,
  chipIds: string[],
  state: DAWState,
  messages: MentionableMessage[],
): MentionableMessage[] {
  const fromAt = resolveAtMentions(text, state, messages)
    .filter((m) => m.kind === 'message' && m.messageId)
    .map((m) => m.messageId as string)
  const ids = [...new Set([...chipIds, ...fromAt])].slice(-MAX_CITED_MESSAGES)
  const byId = new Map(messages.map((m) => [m.id, m]))
  return ids.map((id) => byId.get(id)).filter((m): m is MentionableMessage => Boolean(m))
}

/** Texto que ve el modelo: ancla citada + pedido actual. El hilo reciente se envía aparte. */
export function formatUserTurnWithCitations(userText: string, cited: MentionableMessage[]): string {
  if (!cited.length) return userText
  const block = cited
    .map((m) => {
      const who = m.role === 'user' ? 'Tú' : 'Asistente'
      const body = [m.content.trim(), m.actionsSummary?.trim()].filter(Boolean).join('\n')
      return `> ${who}: ${body.slice(0, 1200)}`
    })
    .join('\n\n')
  return [
    'El usuario citó mensajes anteriores como ancla. Usa lo citado como contexto extra; NO descartes el hilo actual ni el pedido de abajo.',
    '',
    block,
    '',
    '## Pedido actual',
    userText,
  ].join('\n')
}

export function historyWithCitedPins(
  history: MentionableMessage[],
  cited: MentionableMessage[],
  excludeIds: string | string[] = [],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const skip = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds])
  const window = history
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.content.trim() &&
        !skip.has(m.id),
    )
    .slice(-12)
  const inWindow = new Set(window.map((m) => m.id))
  const pins = cited
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() && !inWindow.has(m.id))
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: `[Mensaje citado]\n${m.content}`,
    }))
  return [
    ...pins,
    ...window.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]
}
