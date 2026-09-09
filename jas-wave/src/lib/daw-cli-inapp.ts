/**
 * Parsea líneas al estilo `daw-cli` y las ejecuta en el DAW (misma vía que la CLI).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DawAction } from './ai-daw-agent'
import {
  buildStateSummary,
  controlTransport,
  listAllActions,
  runCliActions,
} from './agent-audit-bridge'
import { appendAiDawAudit } from './ai-daw-audit-store'

export type TermCwd = string[]

export type DawCliParse =
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'pwd' }
  | { kind: 'cd'; path: string }
  | { kind: 'ls'; path?: string }
  | { kind: 'echo'; text: string }
  | { kind: 'date' }
  | { kind: 'whoami' }
  | { kind: 'history' }
  | { kind: 'exit' }
  | { kind: 'list'; filter?: string }
  | { kind: 'state' }
  | { kind: 'health' }
  | { kind: 'audit' }
  | { kind: 'transport'; action: string; seekSec?: number }
  | { kind: 'action'; type: string; payload: Record<string, unknown> }
  | { kind: 'error'; error: string }

export const DAW_CLI_HELP_SECTIONS: { title: string; rows: { cmds: string; desc: string }[] }[] = [
  {
    title: 'Básico',
    rows: [
      { cmds: 'ayuda, help, ?', desc: 'Esta ayuda' },
      { cmds: 'limpiar, clear, cls', desc: 'Vacía la pantalla' },
      { cmds: 'donde, pwd', desc: 'Carpeta actual' },
      { cmds: 'ir, cd [ruta]', desc: 'Cambia de carpeta  (cd ..  /  pistas)' },
      { cmds: 'listar, ls, dir', desc: 'Contenido de la carpeta' },
      { cmds: 'eco, echo <texto>', desc: 'Imprime texto' },
      { cmds: 'fecha, hora', desc: 'Fecha y hora' },
      { cmds: 'historial, history', desc: 'Comandos de esta sesión' },
    ],
  },
  {
    title: 'Transporte',
    rows: [
      { cmds: 'reproducir, play', desc: 'Play' },
      { cmds: 'pausar, pause', desc: 'Pausa' },
      { cmds: 'detener, parar, stop', desc: 'Stop' },
      { cmds: 'buscar, seek <s>', desc: 'Ir a un tiempo' },
    ],
  },
  {
    title: 'Proyecto',
    rows: [
      { cmds: 'estado, state', desc: 'Resumen (pistas, BPM)' },
      { cmds: 'pistas', desc: 'Lista pistas' },
      { cmds: 'bpm <n>', desc: 'Cambia el tempo  (bpm 72)' },
      { cmds: 'list [texto]', desc: 'Catálogo de acciones DAW' },
    ],
  },
]

export const DAW_CLI_HELP = [
  'JasWave CLI',
  ...DAW_CLI_HELP_SECTIONS.flatMap((s) => [
    '',
    s.title,
    ...s.rows.map((r) => `  ${r.cmds.padEnd(26)}${r.desc}`),
  ]),
  '',
  'Carpetas: /  /pistas  /pistas/<nombre>  /transporte  /mixer',
].join('\n')

export function formatTermCwd(cwd: TermCwd | undefined | null): string {
  return cwd?.length ? `/${cwd.join('/')}` : '/'
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function splitPath(raw: string): string[] {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.')
}

export function resolveTermCd(cwd: TermCwd, path: string): TermCwd {
  const t = path.trim()
  if (!t || t === '~' || t === '/') return []
  let next = t.startsWith('/') ? [] : [...cwd]
  for (const part of splitPath(t)) {
    if (part === '..') next = next.slice(0, -1)
    else next = [...next, part]
  }
  return next
}

function trackByName(tienda: TiendaDAW, name: string) {
  const q = norm(name)
  const tracks = tienda.obtenerEstado().project?.tracks ?? []
  return tracks.find((tr) => norm(String(tr.nombre)) === q)
}

function validateCwd(tienda: TiendaDAW, cwd: TermCwd): { ok: true; cwd: TermCwd } | { ok: false; error: string } {
  if (cwd.length === 0) return { ok: true, cwd: [] }
  const root = norm(cwd[0] ?? '')
  if (root === 'pistas') {
    if (cwd.length === 1) return { ok: true, cwd }
    if (cwd.length === 2) {
      const tr = trackByName(tienda, cwd[1] ?? '')
      if (!tr) return { ok: false, error: `No hay pista «${cwd[1]}»` }
      return { ok: true, cwd: ['pistas', String(tr.nombre)] }
    }
    return { ok: false, error: `Ruta no válida: ${formatTermCwd(cwd)}` }
  }
  if ((root === 'transporte' || root === 'mixer') && cwd.length === 1) return { ok: true, cwd }
  return { ok: false, error: `No existe ${formatTermCwd(cwd)}` }
}

function listCwd(tienda: TiendaDAW, cwd: TermCwd): string {
  const st = tienda.obtenerEstado()
  const tracks = st.project?.tracks ?? []
  if (cwd.length === 0) {
    return ['pistas/', 'transporte/', 'mixer/'].join('\n')
  }
  if (norm(cwd[0] ?? '') === 'pistas' && cwd.length === 1) {
    if (!tracks.length) return '(sin pistas)'
    return tracks.map((tr) => `${tr.nombre}/`).join('\n')
  }
  if (norm(cwd[0] ?? '') === 'pistas' && cwd.length === 2) {
    const tr = trackByName(tienda, cwd[1] ?? '')
    const clips = tr?.clips ?? []
    if (!clips.length) return '(sin clips)'
    return clips.map((c) => String((c as { nombre?: string }).nombre ?? c.id)).join('\n')
  }
  if (norm(cwd[0] ?? '') === 'transporte') {
    const s = buildStateSummary(tienda)
    return `reproduciendo=${s.playing}\nbpm=${s.bpm}\npos=${Number(s.positionSec).toFixed(2)}s`
  }
  if (norm(cwd[0] ?? '') === 'mixer') {
    return tracks.map((tr) => `${tr.nombre}  vol=${Number(tr.volumen ?? 0).toFixed(2)}`).join('\n') || '(vacío)'
  }
  return '(vacío)'
}

const TRANSPORT = /^(play|pause|stop|toggle|reproducir|pausar|pausa|detener|parar)$/i

function parsePayload(raw: string, type: string): Record<string, unknown> {
  const s = raw.trim()
  if (!s) return {}
  if (/^\{[\s\S]*\}$/.test(s) || /^\[/.test(s)) {
    try {
      const v = JSON.parse(s) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v }
    } catch (e) {
      throw new Error(`JSON inválido: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (/^[\d.]+$/.test(s)) {
    const n = Number(s)
    if (type === 'project.setBpm' || type.endsWith('.setBpm')) return { bpm: n }
    if (type === 'transport.seek') return { segundos: n }
    return { value: n }
  }
  return { value: s }
}

export function parseDawCliLine(line: string): DawCliParse {
  const t = line.trim()
  if (!t) return { kind: 'error', error: 'Vacío' }
  if (/^(-h|--help|help|ayuda|man|\?)$/i.test(t)) return { kind: 'help' }
  if (/^(limpiar|clear|cls)$/i.test(t)) return { kind: 'clear' }
  if (/^(donde|pwd)$/i.test(t)) return { kind: 'pwd' }
  if (/^(fecha|hora|date)$/i.test(t)) return { kind: 'date' }
  if (/^(quien|whoami)$/i.test(t)) return { kind: 'whoami' }
  if (/^(historial|history)$/i.test(t)) return { kind: 'history' }
  if (/^(salir|exit|quit)$/i.test(t)) return { kind: 'exit' }
  if (/^health$/i.test(t)) return { kind: 'health' }
  if (/^(estado|state)$/i.test(t)) return { kind: 'state' }
  if (/^audit$/i.test(t)) return { kind: 'audit' }
  if (/^pistas$/i.test(t)) return { kind: 'ls', path: 'pistas' }

  const echo = t.match(/^(eco|echo)\s+([\s\S]+)$/i)
  if (echo) return { kind: 'echo', text: echo[2] ?? '' }

  if (/^(ir|cd)\.\.$/i.test(t)) return { kind: 'cd', path: '..' }
  const cd = t.match(/^(ir|cd)(?:\s+(.*))?$/i)
  if (cd) return { kind: 'cd', path: (cd[2] ?? '').trim() }

  const ls = t.match(/^(listar|ls|dir)(?:\s+(.+))?$/i)
  if (ls) return { kind: 'ls', path: ls[2]?.trim() || undefined }

  const list = t.match(/^list(?:\s+(.+))?$/i)
  if (list) return { kind: 'list', filter: list[1]?.trim() || undefined }

  const bpm = t.match(/^bpm\s+([\d.]+)$/i)
  if (bpm) return { kind: 'action', type: 'project.setBpm', payload: { bpm: Number(bpm[1]) } }

  const seek = t.match(/^(seek|buscar)\s+([\d.]+)$/i)
  if (seek) return { kind: 'transport', action: 'seek', seekSec: Number(seek[2]) }
  if (TRANSPORT.test(t)) {
    const raw = t.toLowerCase()
    const action =
      raw === 'reproducir' ? 'play' : raw === 'pausar' || raw === 'pausa' ? 'pause' : raw === 'detener' || raw === 'parar' ? 'stop' : raw
    return { kind: 'transport', action }
  }

  let rest = t
  if (/^(action|cmd)\s+/i.test(t)) rest = t.replace(/^(action|cmd)\s+/i, '')
  const m = rest.match(/^([a-z][a-z0-9]+(?:\.[a-z0-9]+)+)\s*(.*)$/i)
  if (!m) return { kind: 'error', error: `Comando desconocido: ${t.slice(0, 80)}\nEscribe «ayuda» para la lista.` }
  try {
    return { kind: 'action', type: m[1]!, payload: parsePayload(m[2] ?? '', m[1]!) }
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

export type DawCliRunResult = {
  ok: boolean
  title: string
  body: string
  echo?: boolean
  clear?: boolean
  cwd?: TermCwd
}

export async function runDawCliLine(
  tienda: TiendaDAW,
  line: string,
  ctx?: { conversationId?: string; messageId?: string; cwd?: TermCwd; history?: string[] },
): Promise<DawCliRunResult> {
  const cwd = ctx?.cwd ?? []
  const parsed = parseDawCliLine(line)
  if (parsed.kind === 'error') return { ok: false, title: 'cli', body: parsed.error, echo: true }
  if (parsed.kind === 'help') return { ok: true, title: 'help', body: DAW_CLI_HELP, echo: true }
  if (parsed.kind === 'clear') return { ok: true, title: 'clear', body: '', echo: true, clear: true }
  if (parsed.kind === 'pwd') return { ok: true, title: 'pwd', body: formatTermCwd(cwd), echo: true }
  if (parsed.kind === 'echo') return { ok: true, title: 'echo', body: parsed.text, echo: true }
  if (parsed.kind === 'date') {
    return { ok: true, title: 'date', body: new Date().toLocaleString('es-ES'), echo: true }
  }
  if (parsed.kind === 'whoami') return { ok: true, title: 'whoami', body: 'jaswave', echo: true }
  if (parsed.kind === 'history') {
    const hist = ctx?.history ?? []
    return { ok: true, title: 'history', body: hist.length ? hist.map((h, i) => `${i + 1}  ${h}`).join('\n') : '(vacío)', echo: true }
  }
  if (parsed.kind === 'exit') {
    return {
      ok: true,
      title: 'exit',
      body: 'Esta terminal no se cierra con salir. Usa el icono de papelera o cierra la pestaña.',
      echo: true,
    }
  }

  if (parsed.kind === 'cd') {
    const next = resolveTermCd(cwd, parsed.path)
    const valid = validateCwd(tienda, next)
    if (!valid.ok) return { ok: false, title: 'cd', body: valid.error, echo: true }
    return { ok: true, title: 'cd', body: '', echo: true, cwd: valid.cwd }
  }

  if (parsed.kind === 'ls') {
    const target = parsed.path ? resolveTermCd(cwd, parsed.path) : cwd
    const valid = validateCwd(tienda, target)
    if (!valid.ok) return { ok: false, title: 'ls', body: valid.error, echo: true }
    return { ok: true, title: 'ls', body: listCwd(tienda, valid.cwd), echo: true }
  }

  if (parsed.kind === 'list') {
    const listed = listAllActions(tienda)
    let actions = listed.actions
    if (parsed.filter) {
      const q = parsed.filter.toLowerCase()
      actions = actions.filter(
        (a) => a.type.toLowerCase().includes(q) || String(a.description || '').toLowerCase().includes(q),
      )
    }
    const body = `${actions.length} acciones\n` + actions.map((a) => `  ${a.type}`).join('\n')
    return { ok: true, title: 'list', body, echo: true }
  }

  if (parsed.kind === 'state') {
    const s = buildStateSummary(tienda)
    return { ok: true, title: 'state', body: JSON.stringify(s, null, 2), echo: true }
  }

  if (parsed.kind === 'health') {
    const s = buildStateSummary(tienda)
    const body = JSON.stringify(
      { ok: true, window: true, bpm: s.bpm, playing: s.playing, tracks: s.tracks.length },
      null,
      2,
    )
    return { ok: true, title: 'health', body, echo: true }
  }

  if (parsed.kind === 'audit') {
    const s = buildStateSummary(tienda)
    const lines = [
      `bpm=${s.bpm} playing=${s.playing} t=${Number(s.positionSec).toFixed(2)}s`,
      ...s.tracks.map(
        (tr) =>
          `  ${tr.nombre} (${tr.tipo}) clips=${tr.clips.length} notes=${tr.clips.reduce((n, c) => n + (c.notas ?? 0), 0)}`,
      ),
    ]
    return { ok: true, title: 'audit', body: lines.join('\n'), echo: true }
  }

  if (parsed.kind === 'transport') {
    const r = await controlTransport(tienda, parsed.action, parsed.seekSec)
    appendAiDawAudit({
      conversationId: ctx?.conversationId ?? '',
      messageId: ctx?.messageId ?? '',
      agentMode: 'create',
      source: 'cli',
      tool: `transport.${parsed.action}`,
      params: parsed.seekSec != null ? { segundos: parsed.seekSec } : {},
      status: r.ok ? 'executed' : 'failed',
      result: { success: r.ok, message: r.message },
    })
    return { ok: r.ok, title: `transport.${parsed.action}`, body: r.message }
  }

  const actions: DawAction[] = [{ type: parsed.type, payload: parsed.payload }]
  const r = await runCliActions(tienda, actions)
  const first = r.results[0]
  const body =
    first?.message ||
    (r.ok ? 'ok' : 'falló') +
      (first?.data != null ? `\n${JSON.stringify(first.data, null, 2).slice(0, 4000)}` : '')
  return { ok: r.ok, title: parsed.type, body }
}
