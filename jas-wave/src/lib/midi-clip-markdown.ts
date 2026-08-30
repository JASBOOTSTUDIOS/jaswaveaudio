/**
 * Contrato Cursor-like: un .md por clip MIDI con todas las propiedades de cada nota.
 * Round-trip serialize ↔ parse ↔ diff (por id estable).
 */

import type { MidiClip, MidiClipExpression, MidiNote } from '@jaswave/shared'

export const MIDI_CLIP_MD_NOTE_COLUMNS = [
  'id',
  'pitch',
  'name',
  'inicio',
  'duracion',
  'velocidad',
  'canal',
  'mute',
  'articulation',
  'releaseVelocity',
  'probability',
  'source',
] as const

export type MidiClipMdMeta = {
  clipId: string
  trackId: string
  nombre: string
  inicio: number
  duracion: number
  bpm?: number
  compas?: string
  instrumentoHint?: string
  trackName?: string
  genero?: string
  rol?: string
}

export type MidiClipMdParseResult = {
  meta: MidiClipMdMeta
  notas: MidiNote[]
  expression?: MidiClipExpression
  errors: string[]
  rawHadFrontmatter: boolean
}

export type MidiNoteFieldChange = {
  field: string
  before: unknown
  after: unknown
}

export type MidiNotesDiff = {
  added: MidiNote[]
  removed: MidiNote[]
  changed: Array<{ id: string; before: MidiNote; after: MidiNote; fields: MidiNoteFieldChange[] }>
  unchanged: number
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function pitchToName(pitch: number): string {
  const p = Math.max(0, Math.min(127, Math.round(pitch)))
  const name = PITCH_NAMES[p % 12]!
  const octave = Math.floor(p / 12) - 1
  return `${name}${octave}`
}

export function midiClipDocSlug(clipId: string): string {
  const id = String(clipId)
    .trim()
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `clip-${id || 'nuevo'}.md`.toLowerCase()
}

function genNoteId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`
}

function escapeCell(v: unknown): string {
  if (v == null || v === '') return ''
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function parseBool(raw: string): boolean | undefined {
  const t = raw.trim().toLowerCase()
  if (!t) return undefined
  if (t === 'true' || t === '1' || t === 'yes' || t === 'sí' || t === 'si') return true
  if (t === 'false' || t === '0' || t === 'no') return false
  return undefined
}

function parseNum(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

function yamlScalar(v: string | number | undefined | null): string {
  if (v == null || v === '') return '""'
  if (typeof v === 'number') return String(v)
  const s = String(v)
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || /\s/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string; ok: boolean } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trimStart())
  if (!m) return { meta: {}, body: text, ok: false }
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    let val = kv[2]!.trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    meta[kv[1]!] = val
  }
  return { meta, body: m[2] ?? '', ok: true }
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cur = ''
  let esc = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    if (esc) {
      cur += ch
      esc = false
      continue
    }
    if (ch === '\\') {
      esc = true
      continue
    }
    if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function isSepRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')))
}

function materializeNote(partial: Partial<MidiNote> & { pitch: number }): MidiNote {
  return {
    id: partial.id?.trim() || genNoteId(),
    pitch: Math.max(0, Math.min(127, Math.round(partial.pitch))),
    velocidad: partial.velocidad ?? 80,
    inicio: partial.inicio ?? 0,
    duracion: Math.max(0.01, partial.duracion ?? 0.25),
    canal: partial.canal ?? 0,
    presion: partial.presion ?? 0,
    seleccionada: partial.seleccionada ?? false,
    releaseVelocity: partial.releaseVelocity,
    mute: partial.mute,
    articulation: partial.articulation,
    probability: partial.probability,
    source: partial.source,
    voice: partial.voice,
    lane: partial.lane,
    variation: partial.variation,
    noteExpression: partial.noteExpression,
    metadata: partial.metadata,
  }
}

export function serializeMidiClipMd(
  clip: Pick<MidiClip, 'id' | 'nombre' | 'trackId' | 'inicio' | 'duracion' | 'notas' | 'expression'> | MidiClip,
  metaExtra?: Partial<MidiClipMdMeta>,
): string {
  const meta: MidiClipMdMeta = {
    clipId: metaExtra?.clipId ?? clip.id,
    trackId: metaExtra?.trackId ?? clip.trackId,
    nombre: metaExtra?.nombre ?? clip.nombre ?? 'Clip',
    inicio: metaExtra?.inicio ?? Number(clip.inicio ?? 0),
    duracion: metaExtra?.duracion ?? Number(clip.duracion ?? 0),
    bpm: metaExtra?.bpm,
    compas: metaExtra?.compas,
    instrumentoHint: metaExtra?.instrumentoHint,
    trackName: metaExtra?.trackName,
    genero: metaExtra?.genero,
    rol: metaExtra?.rol,
  }
  const notes = [...(clip.notas ?? [])].sort(
    (a, b) => a.inicio - b.inicio || a.pitch - b.pitch || a.id.localeCompare(b.id),
  )
  const lines: string[] = [
    '---',
    `clipId: ${yamlScalar(meta.clipId)}`,
    `trackId: ${yamlScalar(meta.trackId)}`,
    `nombre: ${yamlScalar(meta.nombre)}`,
    `inicio: ${meta.inicio}`,
    `duracion: ${meta.duracion}`,
  ]
  if (meta.bpm != null) lines.push(`bpm: ${meta.bpm}`)
  if (meta.compas) lines.push(`compas: ${yamlScalar(meta.compas)}`)
  if (meta.trackName) lines.push(`trackName: ${yamlScalar(meta.trackName)}`)
  if (meta.instrumentoHint) lines.push(`instrumentoHint: ${yamlScalar(meta.instrumentoHint)}`)
  if (meta.genero) lines.push(`genero: ${yamlScalar(meta.genero)}`)
  if (meta.rol) lines.push(`rol: ${yamlScalar(meta.rol)}`)
  lines.push('---', '', `# Clip MIDI · ${meta.nombre}`, '', '## Notas', '')
  lines.push(`| ${MIDI_CLIP_MD_NOTE_COLUMNS.join(' | ')} |`)
  lines.push(`| ${MIDI_CLIP_MD_NOTE_COLUMNS.map(() => '---').join(' | ')} |`)
  for (const n of notes) {
    const row = [
      n.id,
      n.pitch,
      pitchToName(n.pitch),
      Number(n.inicio.toFixed(4)),
      Number(n.duracion.toFixed(4)),
      n.velocidad,
      n.canal,
      n.mute === true ? 'true' : n.mute === false ? 'false' : '',
      n.articulation ?? '',
      n.releaseVelocity ?? '',
      n.probability ?? '',
      n.source ?? '',
    ]
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`)
  }
  if (!notes.length) {
    lines.push('')
    lines.push('_Sin notas aún. La IA debe rellenar la tabla nota a nota (pitch, inicio, duración, velocidad…)._')
  }

  const expr = clip.expression ?? undefined
  if (expr && (expr.cc?.length || expr.pitchBend?.length)) {
    lines.push('', '## Expresión', '')
    if (expr.cc?.length) {
      lines.push('| kind | cc | tiempo | valor |', '| --- | --- | --- | --- |')
      for (const lane of expr.cc) {
        for (const pt of lane.puntos ?? []) {
          lines.push(
            `| cc | ${lane.cc} | ${Number(pt.tiempo.toFixed(4))} | ${Number(pt.valor.toFixed(4))} |`,
          )
        }
      }
    }
    if (expr.pitchBend?.length) {
      lines.push('', '| kind | tiempo | valor |', '| --- | --- | --- |')
      for (const pt of expr.pitchBend) {
        lines.push(`| pitchBend | ${Number(pt.tiempo.toFixed(4))} | ${Number(pt.valor.toFixed(4))} |`)
      }
    }
  }

  lines.push(
    '',
    '## Notas para la IA',
    '- Cada fila es una nota independiente identificada por `id`.',
    '- Edita celdas (velocidad, duración, inicio, pitch…) o añade/borra filas.',
    '- Tras editar: `midi.clip.md.upsert` (preview) → `midi.clip.md.apply` (timeline).',
    '',
  )
  return lines.join('\n')
}

export function parseMidiClipMd(text: string): MidiClipMdParseResult {
  const errors: string[] = []
  const { meta: fm, body, ok } = parseFrontmatter(text)
  const meta: MidiClipMdMeta = {
    clipId: fm.clipId || '',
    trackId: fm.trackId || '',
    nombre: fm.nombre || 'Clip',
    inicio: parseNum(fm.inicio ?? '') ?? 0,
    duracion: parseNum(fm.duracion ?? '') ?? 0,
    bpm: parseNum(fm.bpm ?? ''),
    compas: fm.compas || undefined,
    instrumentoHint: fm.instrumentoHint || undefined,
    trackName: fm.trackName || undefined,
    genero: fm.genero || undefined,
    rol: fm.rol || undefined,
  }
  if (!meta.clipId) errors.push('Falta clipId en frontmatter')
  if (!meta.trackId) errors.push('Falta trackId en frontmatter')

  const notas: MidiNote[] = []
  const lines = body.split(/\r?\n/)
  let i = 0
  let inNotes = false
  let header: string[] | null = null

  const expression: MidiClipExpression = {
    cc: [],
    pitchBend: [],
    channelPressure: [],
  }
  const ccMap = new Map<number, { cc: number; puntos: Array<{ id: string; tiempo: number; valor: number }> }>()

  while (i < lines.length) {
    const line = lines[i]!
    if (/^##\s+Notas\b/i.test(line)) {
      inNotes = true
      header = null
      i += 1
      continue
    }
    if (/^##\s+Expresi[oó]n\b/i.test(line)) {
      inNotes = false
      header = null
      i += 1
      // parse expression tables below
      continue
    }
    if (/^##\s+/.test(line)) {
      inNotes = false
      header = null
      i += 1
      continue
    }

    if (inNotes && /^\|/.test(line.trim())) {
      const cells = splitTableRow(line)
      if (!header) {
        header = cells.map((c) => c.toLowerCase())
        i += 1
        if (i < lines.length && isSepRow(splitTableRow(lines[i]!))) i += 1
        continue
      }
      if (isSepRow(cells)) {
        i += 1
        continue
      }
      const get = (key: string) => {
        const idx = header!.indexOf(key.toLowerCase())
        return idx >= 0 ? cells[idx] ?? '' : ''
      }
      const pitch = parseNum(get('pitch'))
      if (pitch == null) {
        errors.push(`Fila sin pitch válido: ${line.trim().slice(0, 80)}`)
        i += 1
        continue
      }
      const mute = parseBool(get('mute'))
      notas.push(
        materializeNote({
          id: get('id') || undefined,
          pitch,
          inicio: parseNum(get('inicio')) ?? 0,
          duracion: parseNum(get('duracion')) ?? 0.25,
          velocidad: parseNum(get('velocidad')) ?? 80,
          canal: parseNum(get('canal')) ?? 0,
          mute,
          articulation: get('articulation') || undefined,
          releaseVelocity: parseNum(get('releaseVelocity')),
          probability: parseNum(get('probability')),
          source: get('source') || undefined,
        }),
      )
      i += 1
      continue
    }

    // Expression rows (loose): | kind | cc? | tiempo | valor |
    if (!inNotes && /^\|/.test(line.trim()) && /cc|pitchbend/i.test(line)) {
      const cells = splitTableRow(line)
      if (isSepRow(cells) || cells.some((c) => /^(kind|cc|tiempo|valor)$/i.test(c))) {
        i += 1
        continue
      }
      const kind = (cells[0] ?? '').toLowerCase()
      if (kind === 'cc' && cells.length >= 4) {
        const cc = parseNum(cells[1] ?? '') ?? 1
        const tiempo = parseNum(cells[2] ?? '') ?? 0
        const valor = parseNum(cells[3] ?? '') ?? 0
        let lane = ccMap.get(cc)
        if (!lane) {
          lane = { cc, puntos: [] }
          ccMap.set(cc, lane)
        }
        lane.puntos.push({ id: genNoteId(), tiempo, valor })
      } else if (kind === 'pitchbend' && cells.length >= 3) {
        const tiempo = parseNum(cells[1] ?? '') ?? 0
        const valor = parseNum(cells[2] ?? '') ?? 0
        expression.pitchBend.push({ id: genNoteId(), tiempo, valor })
      }
    }
    i += 1
  }

  expression.cc = [...ccMap.values()]
  const hasExpr = expression.cc.length > 0 || expression.pitchBend.length > 0

  return {
    meta,
    notas,
    expression: hasExpr ? expression : undefined,
    errors,
    rawHadFrontmatter: ok,
  }
}

const DIFF_FIELDS: Array<keyof MidiNote> = [
  'pitch',
  'inicio',
  'duracion',
  'velocidad',
  'canal',
  'mute',
  'articulation',
  'releaseVelocity',
  'probability',
  'source',
  'presion',
]

export function diffMidiNotes(before: MidiNote[], after: MidiNote[]): MidiNotesDiff {
  const aMap = new Map(before.map((n) => [n.id, n]))
  const bMap = new Map(after.map((n) => [n.id, n]))
  const added: MidiNote[] = []
  const removed: MidiNote[] = []
  const changed: MidiNotesDiff['changed'] = []
  let unchanged = 0

  for (const [id, n] of bMap) {
    const prev = aMap.get(id)
    if (!prev) {
      added.push(n)
      continue
    }
    const fields: MidiNoteFieldChange[] = []
    for (const f of DIFF_FIELDS) {
      const bv = prev[f]
      const av = n[f]
      if (bv !== av && !(bv == null && av == null)) {
        if (typeof bv === 'number' && typeof av === 'number' && Math.abs(bv - av) < 1e-6) continue
        fields.push({ field: f, before: bv, after: av })
      }
    }
    if (fields.length) changed.push({ id, before: prev, after: n, fields })
    else unchanged += 1
  }
  for (const [id, n] of aMap) {
    if (!bMap.has(id)) removed.push(n)
  }
  return { added, removed, changed, unchanged }
}

export function formatMidiNotesDiffForPrompt(diff: MidiNotesDiff, max = 24): string {
  const lines: string[] = [
    `Diff notas: +${diff.added.length} / -${diff.removed.length} / ~${diff.changed.length} (iguales ${diff.unchanged})`,
  ]
  let shown = 0
  for (const n of diff.added) {
    if (shown >= max) break
    lines.push(`+ ${n.id} pitch=${n.pitch} t=${n.inicio} d=${n.duracion} v=${n.velocidad}`)
    shown += 1
  }
  for (const n of diff.removed) {
    if (shown >= max) break
    lines.push(`- ${n.id} pitch=${n.pitch} t=${n.inicio}`)
    shown += 1
  }
  for (const c of diff.changed) {
    if (shown >= max) break
    const bits = c.fields.map((f) => `${f.field}:${f.before}→${f.after}`).join(', ')
    lines.push(`~ ${c.id} ${bits}`)
    shown += 1
  }
  return lines.join('\n')
}

/** Stub vacío para Music Build (pista lista, melodía pendiente). */
export function emptyMidiClipMdStub(meta: MidiClipMdMeta): string {
  return serializeMidiClipMd(
    {
      id: meta.clipId,
      nombre: meta.nombre,
      trackId: meta.trackId,
      inicio: meta.inicio,
      duracion: meta.duracion,
      tipo: 'midi',
      notas: [],
      velocidadGlobal: 100,
      cuantizacion: 0.25,
      color: '#888',
      seleccionado: false,
      loop: { activo: false, inicio: 0, fin: meta.duracion },
    },
    meta,
  )
}
