/**
 * Criterio de uso de VSTs: rol, rango MIDI y mapa de notas.
 * No asume piano: batería, guitarra, orquesta, synth, etc.
 */

import type { PluginDescriptor } from './plugin/types'

export type InstrumentRole =
  | 'drums'
  | 'percussion'
  | 'bass'
  | 'guitar'
  | 'piano'
  | 'keys'
  | 'pad'
  | 'lead'
  | 'strings'
  | 'brass'
  | 'woodwind'
  | 'choir'
  | 'synth'
  | 'fx'
  | 'unknown'

export type MidiNoteMapEntry = {
  pitch: number
  name: string
  usage: string
}

export type PluginUsageGuide = {
  name: string
  role: InstrumentRole
  chromatic: boolean
  range: { lo: number; hi: number }
  map: MidiNoteMapEntry[]
  keyswitches: MidiNoteMapEntry[]
  ccs: Array<{ cc: number; name: string }>
  tips: string
  source: 'local' | 'web'
  pluginId?: string
}

/** GM / GS drum map (canal 10). Muchos kits VST lo respetan o se acercan. */
export const GM_DRUM_MAP: MidiNoteMapEntry[] = [
  { pitch: 35, name: 'B0', usage: 'kick acoustic' },
  { pitch: 36, name: 'C1', usage: 'kick / bombo' },
  { pitch: 37, name: 'C#1', usage: 'side stick' },
  { pitch: 38, name: 'D1', usage: 'snare / caja' },
  { pitch: 39, name: 'D#1', usage: 'clap' },
  { pitch: 40, name: 'E1', usage: 'snare 2' },
  { pitch: 41, name: 'F1', usage: 'tom grave' },
  { pitch: 42, name: 'F#1', usage: 'hihat cerrado' },
  { pitch: 43, name: 'G1', usage: 'tom' },
  { pitch: 44, name: 'G#1', usage: 'hihat pedal' },
  { pitch: 45, name: 'A1', usage: 'tom medio' },
  { pitch: 46, name: 'A#1', usage: 'hihat abierto' },
  { pitch: 47, name: 'B1', usage: 'tom agudo' },
  { pitch: 49, name: 'C#2', usage: 'crash' },
  { pitch: 51, name: 'D#2', usage: 'ride' },
  { pitch: 53, name: 'F2', usage: 'ride bell' },
  { pitch: 54, name: 'F#2', usage: 'tambourine' },
  { pitch: 56, name: 'G#2', usage: 'cowbell' },
]

const ROLE_PATTERNS: Array<{ role: InstrumentRole; re: RegExp }> = [
  { role: 'drums', re: /drum|bater|kit|addictive|superior|ezdrummer|\bbfd\b|slate|groove agent|battery|drumforge|mt power/i },
  { role: 'percussion', re: /percus|conga|bongo|shaker|tabla|latpercussion/i },
  { role: 'bass', re: /bass|bajo|trilian|scape|helix bass|ample bass/i },
  { role: 'guitar', re: /guitar|guitarra|ample|shreddage|musiclab|guitarist|strat|les paul/i },
  { role: 'piano', re: /piano|keyscape|grand|upright|rhodes|wurli|electric piano/i },
  { role: 'strings', re: /string|cuerda|violin|viola|cello|spitfire|cinematic studio strings/i },
  { role: 'brass', re: /brass|metal|trumpet|trombone|horn|tuba/i },
  { role: 'woodwind', re: /woodwind|flute|sax|clarinet|oboe/i },
  { role: 'choir', re: /choir|choir|coro|vocaloid|voices? of/i },
  { role: 'pad', re: /\bpad\b|atmosphere|texture|ambient/i },
  { role: 'lead', re: /\blead\b|solo synth|scream/i },
  { role: 'synth', re: /serum|vital|massive|phase plant|sylenth|nexus|pigments|synth/i },
  { role: 'fx', re: /reverb|delay|compress|eq |limiter|saturat|distortion|chorus/i },
  { role: 'keys', re: /organ|clav|harpsi|keys|kontakt|play\b|engine/i },
]

export function inferPluginRole(name: string, category = ''): InstrumentRole {
  const blob = `${name} ${category}`
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(blob)) return p.role
  }
  return 'unknown'
}

function chromaticGuide(name: string, role: InstrumentRole, lo: number, hi: number, tips: string): PluginUsageGuide {
  return {
    name,
    role,
    chromatic: true,
    range: { lo, hi },
    map: [
      { pitch: lo, name: midiName(lo), usage: 'nota más grave usable' },
      { pitch: 60, name: 'C4', usage: 'centro / unison' },
      { pitch: hi, name: midiName(hi), usage: 'nota más aguda usable' },
    ],
    keyswitches: [],
    ccs: [
      { cc: 1, name: 'mod wheel / expresión' },
      { cc: 11, name: 'expression' },
      { cc: 64, name: 'sustain' },
    ],
    tips,
    source: 'local',
  }
}

function midiName(p: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const n = ((p % 12) + 12) % 12
  const oct = Math.floor(p / 12) - 1
  return `${names[n]}${oct}`
}

export function localUsageGuide(name: string, category = ''): PluginUsageGuide {
  const role = inferPluginRole(name, category)
  if (role === 'drums' || role === 'percussion') {
    return {
      name,
      role,
      chromatic: false,
      range: { lo: 35, hi: 81 },
      map: GM_DRUM_MAP,
      keyswitches: [],
      ccs: [{ cc: 1, name: 'kit morph / intensity (si el VST lo usa)' }],
      tips: 'No escribas escalas: cada tecla es un hit. Bombo C1 (36), caja D1 (38), hihats F#1/A#1 (42/46), crash C#2 (49). Velocidad = dinámica del golpe.',
      source: 'local',
    }
  }
  if (role === 'guitar') {
    return {
      name,
      role,
      chromatic: true,
      range: { lo: 40, hi: 88 },
      map: [
        { pitch: 40, name: 'E2', usage: '6ª cuerda (grave)' },
        { pitch: 45, name: 'A2', usage: '5ª' },
        { pitch: 50, name: 'D3', usage: '4ª' },
        { pitch: 55, name: 'G3', usage: '3ª' },
        { pitch: 59, name: 'B3', usage: '2ª' },
        { pitch: 64, name: 'E4', usage: '1ª' },
      ],
      keyswitches: [
        { pitch: 24, name: 'C0', usage: 'keyswitch típico: sustain / mute (varía por librería)' },
        { pitch: 26, name: 'D0', usage: 'keyswitch típico: rasgueo / chord mode' },
      ],
      ccs: [{ cc: 1, name: 'vibrato / dynamics' }],
      tips: 'Rasgueo = notas del acorde graves→agudas con 10–25 ms de delay. Muchos VST de guitarra usan octavas graves como keyswitch: no las dejes sonando como melodía.',
      source: 'local',
    }
  }
  if (role === 'bass') {
    return chromaticGuide(name, role, 28, 67, 'Bajo: raíces y quintas, octava 1–2. Evita acordes densos. Velocidad más estable que la batería.')
  }
  if (role === 'strings' || role === 'brass' || role === 'woodwind' || role === 'choir') {
    return {
      ...chromaticGuide(
        name,
        role,
        48,
        96,
        'Librerías orquestales: CC1 (mod) = intensidad, a menudo keyswitches en C-1/C0 para legato/staccato/pizz. No dispares la octava de keyswitch como melodía.',
      ),
      keyswitches: [
        { pitch: 24, name: 'C0', usage: 'articulación A (legato / sustain)' },
        { pitch: 26, name: 'D0', usage: 'articulación B (staccato / pizz)' },
      ],
      ccs: [
        { cc: 1, name: 'mod / dynamics' },
        { cc: 11, name: 'expression' },
      ],
    }
  }
  if (role === 'piano' || role === 'keys') {
    return chromaticGuide(name, role, 21, 108, 'Piano/keys cromático. Dinámica = velocity. Pedal CC64 si el VST lo soporta.')
  }
  if (role === 'synth' || role === 'lead' || role === 'pad') {
    return chromaticGuide(name, role, 36, 96, 'Synth cromático. El timbre lo define el preset, no la tecla. Lead en octava 4–5; pad más grave y legato.')
  }
  return chromaticGuide(
    name,
    role,
    36,
    96,
    'Instrumento no clasificado: trata como cromático hasta consultar el manual. Si es un kit, usa el mapa GM (C1 bombo, D1 caja).',
  )
}

export function scoreDescriptorForRole(d: PluginDescriptor, role: InstrumentRole): number {
  const blob = `${d.name} ${d.vendor} ${d.category}`.toLowerCase()
  const inferred = inferPluginRole(d.name, d.category)
  let s = inferred === role ? 8 : 0
  if (role === 'drums' && /drum|kit|bater/.test(blob)) s += 6
  if (role === 'guitar' && /guitar/.test(blob)) s += 6
  if (role === 'bass' && /bass|bajo/.test(blob)) s += 6
  if (role === 'piano' && /piano/.test(blob)) s += 6
  if (d.isInstrument && role !== 'fx') s += 2
  if (d.isEffect && role === 'fx') s += 4
  if (!d.isInstrument && role !== 'fx') s -= 3
  return s
}

export function pickVstForRole(catalog: PluginDescriptor[], role: InstrumentRole): PluginDescriptor | undefined {
  let best: PluginDescriptor | undefined
  let bestScore = 0
  for (const d of catalog) {
    const sc = scoreDescriptorForRole(d, role)
    if (sc > bestScore) {
      bestScore = sc
      best = d
    }
  }
  return bestScore >= 4 ? best : undefined
}

export type ArrangementTrackDraft = {
  nombre: string
  rol: InstrumentRole
  tipo: 'midi' | 'instrumento'
  pluginName?: string
  pluginId?: string
  articulacion: 'drums' | 'bass' | 'strum' | 'arp' | 'pad' | 'melody' | 'block'
  noteMapSummary: string
}

/** Fallback de roles por género cuando la IA NO envía `pistas[]`. Preferir spec de la IA. */
const GENRE_ROLES: Record<string, InstrumentRole[]> = {
  rock: ['drums', 'bass', 'guitar', 'guitar', 'keys'],
  metal: ['drums', 'bass', 'guitar', 'guitar'],
  pop: ['drums', 'bass', 'keys', 'pad', 'lead'],
  edm: ['drums', 'bass', 'synth', 'lead', 'pad'],
  hiphop: ['drums', 'bass', 'keys', 'pad'],
  trap: ['drums', 'bass', 'synth', 'lead'],
  jazz: ['drums', 'bass', 'piano', 'brass'],
  latin: ['drums', 'percussion', 'bass', 'keys', 'guitar'],
  orchestral: ['strings', 'brass', 'woodwind', 'choir', 'percussion'],
  ballad: ['piano', 'pad', 'strings', 'bass'],
  worship: ['drums', 'bass', 'guitar', 'guitar', 'piano', 'pad'],
  gospel: ['drums', 'bass', 'piano', 'keys', 'choir', 'pad'],
  default: ['drums', 'bass', 'keys', 'pad', 'lead'],
}

export function inferGenreRoles(text: string): InstrumentRole[] {
  const t = text.toLowerCase()
  if (/worship|alabanza|adoraci[oó]n|hillsong|bethel|elevation/.test(t)) return GENRE_ROLES.worship!
  if (/gospel/.test(t)) return GENRE_ROLES.gospel!
  if (/metal|djent/.test(t)) return GENRE_ROLES.metal!
  if (/rock|indie/.test(t)) return GENRE_ROLES.rock!
  if (/edm|house|techno|danc/.test(t)) return GENRE_ROLES.edm!
  if (/trap/.test(t)) return GENRE_ROLES.trap!
  if (/hip\s*hop|rap/.test(t)) return GENRE_ROLES.hiphop!
  if (/jazz/.test(t)) return GENRE_ROLES.jazz!
  if (/latin|salsa|cumbia|reggaet/.test(t)) return GENRE_ROLES.latin!
  if (/orquest|cinem|film|trailer/.test(t)) return GENRE_ROLES.orchestral!
  if (/balad|ballad|piano suave/.test(t)) return GENRE_ROLES.ballad!
  if (/pop/.test(t)) return GENRE_ROLES.pop!
  return GENRE_ROLES.default!
}

function articulationForRole(role: InstrumentRole): ArrangementTrackDraft['articulacion'] {
  if (role === 'drums' || role === 'percussion') return 'drums'
  if (role === 'bass') return 'bass'
  if (role === 'guitar') return 'strum'
  if (role === 'pad' || role === 'strings' || role === 'choir') return 'pad'
  if (role === 'lead' || role === 'brass') return 'melody'
  if (role === 'piano' || role === 'keys') return 'block'
  return 'arp'
}

/**
 * Borrador de pistas — SOLO fallback si Music Build / compose no reciben `pistas` de la IA.
 * La creatividad de instrumentación debe venir del agente (rol + pluginId + presetId).
 */
export function draftArrangement(
  text: string,
  catalog: PluginDescriptor[],
): ArrangementTrackDraft[] {
  const roles = inferGenreRoles(text)
  const used = new Set<string>()
  const guitarCount = { n: 0 }
  return roles.map((rol) => {
    const vst = pickVstForRole(
      catalog.filter((d) => !used.has(d.pluginId)),
      rol,
    )
    if (vst) used.add(vst.pluginId)
    const guide = localUsageGuide(vst?.name ?? rol, vst?.category ?? '')
    let nombre: string = rol
    if (rol === 'guitar') {
      guitarCount.n += 1
      nombre = guitarCount.n === 1 ? 'Guitarra ritmo' : 'Guitarra lead'
    } else if (rol === 'drums') nombre = 'Batería'
    else if (rol === 'bass') nombre = 'Bajo'
    else if (rol === 'piano') nombre = 'Piano'
    else if (rol === 'keys') nombre = 'Keys'
    else if (rol === 'pad') nombre = 'Pad'
    else if (rol === 'lead') nombre = 'Lead'
    else if (rol === 'strings') nombre = 'Cuerdas'
    else if (rol === 'brass') nombre = 'Metales'
    else if (rol === 'woodwind') nombre = 'Vientos'
    else if (rol === 'choir') nombre = 'Coro'
    else if (rol === 'synth') nombre = 'Synth'
    else if (rol === 'percussion') nombre = 'Percusión'
    return {
      nombre,
      rol,
      tipo: 'midi' as const,
      pluginName: vst?.name,
      pluginId: vst?.pluginId,
      articulacion: rol === 'guitar' && guitarCount.n > 1 ? 'melody' : articulationForRole(rol),
      noteMapSummary: guide.chromatic
        ? `cromático ${midiName(guide.range.lo)}–${midiName(guide.range.hi)}`
        : guide.map
            .slice(0, 6)
            .map((m) => `${m.name} ${m.usage}`)
            .join(', '),
    }
  })
}

export function mergeWebSnippets(guide: PluginUsageGuide, snippets: string[]): PluginUsageGuide {
  const extra = snippets.filter(Boolean).join(' ').slice(0, 800)
  if (!extra) return guide
  return {
    ...guide,
    source: 'web',
    tips: `${guide.tips}\n\nFuente web: ${extra}`,
  }
}

export function formatGuideForPrompt(g: PluginUsageGuide): string {
  const hits = g.map
    .slice(0, 12)
    .map((m) => `    ${m.pitch} ${m.name}: ${m.usage}`)
    .join('\n')
  const ks = g.keyswitches.length
    ? g.keyswitches.map((m) => `    ${m.pitch} ${m.name}: ${m.usage}`).join('\n')
    : '    (ninguno conocido)'
  return [
    `### ${g.name} · rol=${g.role} · ${g.chromatic ? 'cromático' : 'mapa de hits'}`,
    `Rango ${g.range.lo}–${g.range.hi}. ${g.tips}`,
    'Notas:',
    hits,
    'Keyswitches:',
    ks,
  ].join('\n')
}
