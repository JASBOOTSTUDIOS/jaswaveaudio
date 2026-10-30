/**
 * Habilidad «producir / completar canción».
 *
 * El modelo actúa de productor: en UNA llamada decide forma, progresiones (con color: sus, add9,
 * séptimas, inversiones), arco de intensidad, instrumentación, estilo y humanización. El compositor
 * determinista (`daw.composeWorship`) es el músico de sesión que lo toca. Si el proyecto ya tiene
 * contenido (p. ej. una intro grabada por el usuario) la canción continúa desde el compás siguiente,
 * en la misma tonalidad, tempo y compás.
 */

import {
  ROLES_WORSHIP,
  construirAcorde,
  crearTonal,
  parsearAcorde,
  type DAWState,
  type EscalaWorship,
  type EstiloWorship,
  type RaizWorship,
  type RolWorship,
  type SpecSeccionWorship,
  type TipoSeccionWorship,
} from '@jaswave/shared'

import { extraerJson, type ContextoHabilidad, type Habilidad, type MensajeBrief, type PlanHabilidad } from './tipos'

const TIPOS_SECCION: readonly TipoSeccionWorship[] = ['intro', 'verso', 'precoro', 'coro', 'puente', 'coroFinal', 'outro']
const ESTILOS: readonly EstiloWorship[] = ['ballad', 'anthem', 'ambient']
const RAIZ_POR_PC: readonly RaizWorship[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const MAX_COMPASES_TOTALES = 128

const NOMBRE_SECCION: Record<TipoSeccionWorship, string> = {
  intro: 'Intro',
  verso: 'Verso',
  precoro: 'Pre-coro',
  coro: 'Coro',
  puente: 'Puente',
  coroFinal: 'Coro final',
  outro: 'Outro',
}

export type ResumenProyectoCancion = {
  bpm: number
  compas: '4/4' | '6/8'
  beatsPorCompas: number
  tonalidad: { raiz: RaizWorship; escala: EscalaWorship } | null
  pistas: Array<{ nombre: string; tipo: string; clips: number; notas: number }>
  /** Último beat con contenido audible (0 si el proyecto está vacío). */
  finBeat: number
  /** Compás (1-based) donde empezaría lo nuevo. */
  compasInicio: number
  inicioBeat: number
}

export type BriefCancion = {
  titulo: string
  idea: string
  estilo: EstiloWorship
  bpm: number
  tonalidad: { raiz: RaizWorship; escala: EscalaWorship }
  compas: '4/4' | '6/8'
  humanizacion: number
  roles: RolWorship[]
  secciones: SpecSeccionWorship[]
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Estado del proyecto que importa para continuar una canción. Pura. */
export function resumirProyectoParaCancion(state: DAWState): ResumenProyectoCancion {
  const p = state.project
  const bpm = num(p.bpm?.valor) ?? 120
  const ts = p.timeSignature as unknown as { numerador?: number; denominador?: number } | undefined
  const compas: '4/4' | '6/8' = ts?.numerador === 6 && ts?.denominador === 8 ? '6/8' : '4/4'
  const beatsPorCompas = compas === '6/8' ? 3 : 4
  const raw = p.metadata?.customData?.['jaswave.tonalidad'] as { enabled?: boolean; root?: number; mode?: string } | undefined
  const tonalidad =
    raw?.enabled && Number.isFinite(Number(raw.root))
      ? { raiz: RAIZ_POR_PC[((Number(raw.root) % 12) + 12) % 12]!, escala: (raw.mode === 'minor' ? 'menor' : 'mayor') as EscalaWorship }
      : null
  let finBeat = 0
  const pistas: ResumenProyectoCancion['pistas'] = []
  const pesoPc = new Array<number>(12).fill(0)
  for (const t of p.tracks ?? []) {
    if (t.tipo === 'master') continue
    let notas = 0
    const clips = (t.clips ?? []) as Array<{ inicio: number; duracion: number; silenciado?: boolean; notas?: unknown[] }>
    for (const c of clips) {
      if (c.silenciado) continue
      if (Array.isArray(c.notas)) {
        notas += c.notas.length
        for (const n of c.notas as Array<{ pitch?: number; duracion?: number }>) {
          if (Number.isFinite(n.pitch)) pesoPc[((n.pitch as number) % 12 + 12) % 12]! += Math.max(0.25, Number(n.duracion) || 1)
        }
      }
      finBeat = Math.max(finBeat, (num(c.inicio) ?? 0) + (num(c.duracion) ?? 0))
    }
    pistas.push({ nombre: t.nombre, tipo: t.tipo, clips: clips.length, notas })
  }
  const compasesUsados = Math.ceil(finBeat / beatsPorCompas - 1e-6)
  return {
    bpm,
    compas,
    beatsPorCompas,
    tonalidad: tonalidad ?? inferirTonalidad(pesoPc),
    pistas,
    finBeat,
    compasInicio: compasesUsados + 1,
    inicioBeat: compasesUsados * beatsPorCompas,
  }
}

const MAYOR = [0, 2, 4, 5, 7, 9, 11]

/**
 * Tonalidad mayor más compatible con las notas ya escritas (peso por duración). Devuelve null si hay pocas notas
 * o si demasiado material queda fuera de la escala. Los acordes de color (maj9, 11, 13sus) son diatónicos, así que
 * la escala mayor que contiene el material es la referencia correcta para continuar.
 */
export function inferirTonalidad(pesoPc: number[]): { raiz: RaizWorship; escala: EscalaWorship } | null {
  const total = pesoPc.reduce((a, b) => a + b, 0)
  if (total < 4) return null
  let mejor = -1
  let puntos = -Infinity
  for (let t = 0; t < 12; t++) {
    const dentro = MAYOR.reduce((a, s) => a + pesoPc[(t + s) % 12]!, 0)
    // Desempate: tónica y dominante presentes.
    const p = dentro + 0.05 * (pesoPc[t]! + pesoPc[(t + 7) % 12]!)
    if (p > puntos) {
      puntos = p
      mejor = t
    }
  }
  const dentro = MAYOR.reduce((a, s) => a + pesoPc[(mejor + s) % 12]!, 0)
  return dentro / total >= 0.85 ? { raiz: RAIZ_POR_PC[mejor]!, escala: 'mayor' } : null
}

const RE_VERBO = /\b(complet|termin|continu|desarroll|arm[ae]|produc|compon|crea|haz|hac(?:er|e)|genera|escrib|monta|extiend|alarg|sigue|agrega|añade|anade|pon)/i
const RE_OBJETO = /\b(canci[oó]n|tema|song|arreglo|el resto|resto del tema|producci[oó]n|banda completa|la banda|estructura completa|track completo)\b/i
const RE_ROL = /\b(bajo|bater[ií]a|drums|pad|cuerdas|strings|guitarra|piano|melod[ií]a)\b/gi
const RE_NO = /\b(c[oó]mo|qu[eé] opinas|explica|analiza|revisa|borra|elimina|quita|silencia|bpm a|cambia el (?:bpm|tempo)|exporta|mezcla solo|masteriza)\b/i

/** Confianza 0..1 de que el pedido es producir/completar una canción entera. Pura. */
export function coincideCompletarCancion(texto: string): number {
  const t = texto.trim()
  if (t.length < 8) return 0
  if (RE_NO.test(t) && !RE_OBJETO.test(t)) return 0
  if (/^\s*¿/.test(t) && !/\b(puedes|podr[ií]as)\b/i.test(t)) return 0
  const verbo = RE_VERBO.test(t)
  const objeto = RE_OBJETO.test(t)
  const roles = new Set((t.match(RE_ROL) ?? []).map((r) => r.toLowerCase())).size
  if (verbo && objeto) return roles >= 1 || /complet|termin|continu|resto/i.test(t) ? 0.95 : 0.8
  if (verbo && roles >= 3) return 0.75
  return 0
}

function tablaAcordes(raiz: RaizWorship, escala: EscalaWorship): string {
  const tonal = crearTonal(raiz, escala)
  const filas: string[] = []
  for (let g = 0; g < 7; g++) {
    const tri = construirAcorde(tonal, { grado: g, ext: 'tri' })
    const color = (['sus2', 'add9', 'sept', 'nov', 'once', 'trece'] as const)
      .map((ext) => {
        try {
          const a = construirAcorde(tonal, { grado: g, ext })
          return `${a.romano}=${a.simbolo}`
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    filas.push(`- ${tri.romano}=${tri.simbolo} · ${color.join(' · ')}`)
  }
  return filas.join('\n')
}

function mensajesBriefCancion(ctx: ContextoHabilidad): MensajeBrief[] {
  const r = resumirProyectoParaCancion(ctx.state)
  const ton = r.tonalidad ?? { raiz: 'D' as RaizWorship, escala: 'mayor' as EscalaWorship }
  const continua = r.finBeat > 0
  const proyecto = [
    `BPM ${Math.round(r.bpm)} · compás ${r.compas} · tonalidad ${r.tonalidad ? `${r.tonalidad.raiz} ${r.tonalidad.escala}` : 'sin fijar'}`,
    r.pistas.length
      ? `Pistas: ${r.pistas.map((p) => `${p.nombre} (${p.tipo}, ${p.clips} clips, ${p.notas} notas)`).join('; ')}`
      : 'Proyecto vacío.',
    continua
      ? `Ya hay ${r.compasInicio - 1} compases hechos por el usuario. Lo nuevo empieza en el compás ${r.compasInicio}: NO repitas la intro; continúa la canción desde ahí respetando tonalidad, tempo y compás.`
      : 'Empieza desde el compás 1.',
  ].join('\n')

  const system = [
    'Eres el productor musical de JasWave. Diseñas el arreglo; un motor de interpretación humano lo toca.',
    'Responde SOLO con un objeto JSON válido en UNA línea, sin texto antes ni después. Sé breve: no expliques nada.',
    '',
    'Esquema (en este orden):',
    '{"secciones":[{"tipo":"intro|verso|precoro|coro|puente|coroFinal|outro","compases":2-16,"progresion":["…"],"intensidad":0.0-1.0}],',
    ' "roles":["piano","pad","cuerdas","bajo","bateria","guitarra","melodia"],"estilo":"ballad|anthem|ambient",',
    ' "bpm":número,"tonalidad":"C|Db|D|Eb|E|F|F#|G|Ab|A|Bb|B","escala":"mayor|menor","humanizacion":0.0-1.0,',
    ' "titulo":"máx. 5 palabras","idea":"máx. 12 palabras"}',
    '',
    'Reglas de creatividad (no uses fórmulas de siempre):',
    '- Cada sección con su propia progresión (2 a 8 acordes; se reparten en los compases). No repitas la misma progresión en todas.',
    '- Da color moderno (jazz-pop): novenas (maj9, 9), oncenas (11), 13sus4, add9, sus2/sus4, séptimas e inversiones con barra (p. ej. "V/3", "IVmaj9/I") para que el bajo camine. Combina disonancia con resolución: un 13sus4 o un 11 que resuelve en el siguiente acorde.',
    '- Usa SOLO grados romanos de la tabla (son los acordes válidos de la tonalidad). Nada cromático.',
    '- Arco dinámico: versos contenidos (0.3-0.5), coros arriba (0.7-0.85), un respiro (puente o verso bajo) y clímax en el coroFinal (0.95-1).',
    '- Entre 5 y 9 secciones (48 a 96 compases), salvo que el usuario pida otra cantidad: entonces respeta su pedido.',
    '- humanizacion 0.6-0.8 para sonar a banda real.',
  ].join('\n')

  const user = [
    `Pedido del usuario: «${ctx.userText.trim()}»`,
    '',
    '## Proyecto',
    proyecto,
    '',
    `## Acordes válidos en ${ton.raiz} ${ton.escala} (grado=acorde)`,
    tablaAcordes(ton.raiz, ton.escala),
    '',
    r.tonalidad ? 'Mantén la tonalidad del proyecto.' : 'Elige la tonalidad que mejor sirva a la idea (la tabla es orientativa para D mayor).',
    continua ? `Mantén BPM ${Math.round(r.bpm)} y compás ${r.compas}.` : '',
    'Devuelve el JSON.',
  ]
    .filter((l) => l !== '')
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Primer campo presente entre varios nombres posibles (los modelos pequeños cambian claves o idioma). */
function campo(o: Record<string, unknown>, ...claves: string[]): unknown {
  for (const k of claves) if (o[k] !== undefined && o[k] !== null) return o[k]
  const porNormal = new Map(Object.entries(o).map(([k, v]) => [normalizar(k), v]))
  for (const k of claves) {
    const v = porNormal.get(normalizar(k))
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

const normalizar = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const SINONIMOS_SECCION: Record<string, TipoSeccionWorship> = {
  intro: 'intro', introduccion: 'intro',
  verso: 'verso', estrofa: 'verso', verse: 'verso',
  precoro: 'precoro', prechorus: 'precoro', puentecillo: 'precoro', subida: 'precoro',
  coro: 'coro', chorus: 'coro', estribillo: 'coro',
  puente: 'puente', bridge: 'puente', interludio: 'puente', interlude: 'puente', breakdown: 'puente',
  corofinal: 'coroFinal', finalchorus: 'coroFinal', ultimocoro: 'coroFinal', climax: 'coroFinal',
  outro: 'outro', final: 'outro', cierre: 'outro', coda: 'outro', ending: 'outro',
}

/** «Verso 2», «Pre-coro», «Coro final», «Bridge»… → tipo de sección. Pura. */
export function normalizarTipoSeccion(v: unknown): TipoSeccionWorship | null {
  const n = normalizar(v).replace(/\d+$/, '')
  if (!n) return null
  if (SINONIMOS_SECCION[n]) return SINONIMOS_SECCION[n]!
  // Prefijos: «coro final 2», «versodos», «chorus x2»…
  for (const [clave, tipo] of Object.entries(SINONIMOS_SECCION).sort((a, b) => b[0].length - a[0].length)) {
    if (n.startsWith(clave)) return tipo
  }
  return null
}

const SINONIMOS_ROL: Record<string, RolWorship> = {
  piano: 'piano', keys: 'piano', teclado: 'piano', teclados: 'piano', rhodes: 'piano',
  pad: 'pad', pads: 'pad', sintetizador: 'pad', synth: 'pad', atmosfera: 'pad',
  cuerdas: 'cuerdas', strings: 'cuerdas', violines: 'cuerdas',
  bajo: 'bajo', bass: 'bajo', bajoelectrico: 'bajo',
  bateria: 'bateria', drums: 'bateria', percusion: 'bateria', batera: 'bateria',
  guitarra: 'guitarra', guitar: 'guitarra', guitarraelectrica: 'guitarra', electricguitar: 'guitarra',
  melodia: 'melodia', melody: 'melodia', lead: 'melodia', voz: 'melodia',
}

function normalizarRol(v: unknown): RolWorship | null {
  const n = normalizar(v)
  return SINONIMOS_ROL[n] ?? null
}

/** Valida un brief del modelo contra el proyecto. Descarta lo inválido y completa lo que falte. Pura. */
export function validarBriefCancion(
  bruto: Record<string, unknown> | null,
  resumen: ResumenProyectoCancion,
  semilla: number,
): { brief: BriefCancion; avisos: string[]; delModelo: boolean } {
  const avisos: string[] = []
  const b = bruto ?? {}
  const continua = resumen.finBeat > 0

  const raizModelo = typeof b.tonalidad === 'string' && (RAIZ_POR_PC as readonly string[]).concat(['C#']).includes(b.tonalidad) ? (b.tonalidad as RaizWorship) : null
  const tonalidad = resumen.tonalidad ?? {
    raiz: raizModelo ?? 'D',
    escala: (b.escala === 'menor' ? 'menor' : 'mayor') as EscalaWorship,
  }
  const tonal = crearTonal(tonalidad.raiz, tonalidad.escala)

  const bpmModelo = num(b.bpm)
  const bpm = continua || !bpmModelo ? resumen.bpm : clamp(Math.round(bpmModelo), 56, 140)
  const estiloN = normalizar(campo(b, 'estilo', 'style'))
  const estilo: EstiloWorship = ESTILOS.includes(estiloN as EstiloWorship) ? (estiloN as EstiloWorship) : /balad/.test(estiloN) ? 'ballad' : /ambien/.test(estiloN) ? 'ambient' : 'anthem'
  const humanizacion = clamp(num(b.humanizacion) ?? 0.7, 0.35, 0.95)

  const rolesCrudos = campo(b, 'roles', 'instrumentos', 'banda', 'instrumentacion', 'instruments')
  let roles = Array.isArray(rolesCrudos) ? (rolesCrudos as unknown[]).map(normalizarRol).filter((x): x is RolWorship => x !== null) : []
  roles = [...new Set(roles)]
  // Una canción completa necesita base rítmica y armónica aunque el modelo la olvide.
  for (const imprescindible of ['bajo', 'bateria'] as RolWorship[]) {
    if (!roles.includes(imprescindible)) roles.push(imprescindible)
  }
  if (!roles.some((r) => r === 'piano' || r === 'guitarra' || r === 'pad')) roles.push('piano', 'pad')
  if (roles.length < 4) for (const r of ['piano', 'pad', 'guitarra'] as RolWorship[]) if (!roles.includes(r) && roles.length < 5) roles.push(r)
  roles = ROLES_WORSHIP.filter((r) => roles.includes(r))

  const secciones: SpecSeccionWorship[] = []
  let total = 0
  const seccionesCrudas = campo(b, 'secciones', 'estructura', 'forma', 'sections', 'structure', 'arreglo')
  const crudas = Array.isArray(seccionesCrudas) ? (seccionesCrudas as unknown[]) : []
  for (const s of crudas) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const tipo = normalizarTipoSeccion(campo(o, 'tipo', 'seccion', 'nombre', 'type', 'section', 'name'))
    if (!tipo) continue
    if (continua && tipo === 'intro' && secciones.length === 0) continue // la intro ya la hizo el usuario
    const compases = clamp(Math.round(num(campo(o, 'compases', 'barras', 'duracion', 'bars', 'length', 'measures')) ?? 8), 2, 16)
    if (total + compases > MAX_COMPASES_TOTALES) break
    const sec: SpecSeccionWorship = { tipo, compases }
    const progCruda = campo(o, 'progresion', 'acordes', 'progression', 'chords', 'armonia')
    const tokens = Array.isArray(progCruda) ? progCruda : typeof progCruda === 'string' ? progCruda.split(/[\s,|–—-]+/) : null
    if (tokens) {
      const validos: string[] = []
      for (const tok of tokens as unknown[]) {
        if (typeof tok !== 'string' || !tok.trim()) continue
        try {
          parsearAcorde(tok.trim(), tonal)
          validos.push(tok.trim())
        } catch {
          avisos.push(`Acorde descartado en ${NOMBRE_SECCION[tipo]}: «${tok}»`)
        }
      }
      if (validos.length >= 2) sec.progresion = validos.slice(0, 8)
    }
    const intensidad = num(campo(o, 'intensidad', 'energia', 'intensity', 'energy'))
    if (intensidad !== null) sec.intensidad = clamp(intensidad, 0.05, 1)
    secciones.push(sec)
    total += compases
  }

  // Con dos secciones basta (p. ej. «añade una estrofa y un coro»); con menos, el brief no define una forma.
  const delModelo = secciones.length >= 2
  const final = delModelo ? secciones : formaDeRespaldo(semilla, continua)
  if (!delModelo) avisos.push(bruto ? 'El brief del modelo no traía secciones válidas: uso una forma propia.' : 'Sin respuesta del modelo: uso una forma propia.')

  const tituloCrudo = campo(b, 'titulo', 'title', 'nombre')
  const ideaCruda = campo(b, 'idea', 'concepto', 'intencion', 'descripcion')
  const titulo = typeof tituloCrudo === 'string' && tituloCrudo.trim() ? tituloCrudo.trim().slice(0, 60) : 'Nueva canción'
  const idea = typeof ideaCruda === 'string' ? ideaCruda.trim().slice(0, 240) : ''
  return {
    brief: { titulo, idea, estilo, bpm, tonalidad, compas: resumen.compas, humanizacion, roles, secciones: final },
    avisos,
    delModelo,
  }
}

/** Forma variada por semilla cuando el modelo no responde (el compositor elige progresiones con la misma semilla). */
function formaDeRespaldo(semilla: number, continua: boolean): SpecSeccionWorship[] {
  const formas: SpecSeccionWorship[][] = [
    [
      { tipo: 'verso', compases: 8, intensidad: 0.4 },
      { tipo: 'precoro', compases: 4, intensidad: 0.6 },
      { tipo: 'coro', compases: 8, intensidad: 0.8 },
      { tipo: 'verso', compases: 8, intensidad: 0.5 },
      { tipo: 'coro', compases: 8, intensidad: 0.85 },
      { tipo: 'puente', compases: 8, intensidad: 0.45 },
      { tipo: 'coroFinal', compases: 8, intensidad: 1 },
      { tipo: 'outro', compases: 4, intensidad: 0.25 },
    ],
    [
      { tipo: 'verso', compases: 8, intensidad: 0.35 },
      { tipo: 'coro', compases: 8, intensidad: 0.75 },
      { tipo: 'verso', compases: 8, intensidad: 0.45 },
      { tipo: 'precoro', compases: 4, intensidad: 0.65 },
      { tipo: 'coro', compases: 8, intensidad: 0.85 },
      { tipo: 'puente', compases: 12, intensidad: 0.6 },
      { tipo: 'coroFinal', compases: 8, intensidad: 1 },
      { tipo: 'outro', compases: 6, intensidad: 0.2 },
    ],
    [
      { tipo: 'verso', compases: 12, intensidad: 0.4 },
      { tipo: 'precoro', compases: 4, intensidad: 0.6 },
      { tipo: 'coro', compases: 8, intensidad: 0.8 },
      { tipo: 'puente', compases: 8, intensidad: 0.35 },
      { tipo: 'coro', compases: 8, intensidad: 0.9 },
      { tipo: 'coroFinal', compases: 8, intensidad: 1 },
      { tipo: 'outro', compases: 4, intensidad: 0.2 },
    ],
  ]
  const forma = formas[Math.abs(semilla) % formas.length]!.map((s) => ({ ...s }))
  return continua ? forma : [{ tipo: 'intro', compases: 4, intensidad: 0.3 }, ...forma]
}

function planCompletarCancion(ctx: ContextoHabilidad, respuesta: string | null): PlanHabilidad {
  const resumen = resumirProyectoParaCancion(ctx.state)
  const semilla = ctx.semilla ?? Math.floor(Math.random() * 1_000_000)
  const { brief, avisos, delModelo } = validarBriefCancion(extraerJson(respuesta), resumen, semilla)
  const continua = resumen.finBeat > 0
  const forma = brief.secciones.map((s) => `${NOMBRE_SECCION[s.tipo]} ${s.compases}`).join(' → ')
  const decisiones = [
    brief.idea ? `Idea: ${brief.idea}` : '',
    `Forma: ${forma}`,
    ...brief.secciones
      .filter((s) => s.progresion?.length)
      .map((s) => `${NOMBRE_SECCION[s.tipo]}: ${s.progresion!.join(' – ')}${s.intensidad !== undefined ? ` (intensidad ${s.intensidad.toFixed(2)})` : ''}`),
    `Banda: ${brief.roles.join(', ')} · estilo ${brief.estilo} · humanización ${brief.humanizacion.toFixed(2)}`,
    ...avisos,
  ].filter(Boolean)
  const accion = {
    type: 'daw.composeWorship',
    payload: {
      prompt: ctx.userText,
      semilla,
      titulo: brief.titulo,
      estilo: brief.estilo,
      bpm: brief.bpm,
      tonalidad: brief.tonalidad.raiz,
      escala: brief.tonalidad.escala,
      compas: brief.compas,
      humanizacion: brief.humanizacion,
      roles: brief.roles,
      secciones: brief.secciones,
      inicioBeat: resumen.inicioBeat,
      prefijoId: 'jas',
      // Al continuar se respetan el tempo, la tonalidad y el compás que el usuario ya fijó.
      ajustarProyecto: !continua,
    },
  }
  const resumenTxt = [
    `**${brief.titulo}** — ${brief.tonalidad.raiz} ${brief.tonalidad.escala}, ${Math.round(brief.bpm)} BPM, ${brief.secciones.reduce((a, s) => a + s.compases, 0)} compases`,
    continua ? `Continúo tu canción desde el compás ${resumen.compasInicio}.` : '',
    `Forma: ${forma}.`,
    `Banda: ${brief.roles.join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n')
  return { acciones: [accion], resumen: resumenTxt, decisiones, creativoDelModelo: delModelo }
}

export const habilidadCompletarCancion: Habilidad = {
  id: 'cancion.completa',
  nombre: 'Producir o completar canción',
  descripcion: 'Diseña forma, armonía con color, dinámica e instrumentación y la produce con la banda (VST3) y mezcla medida.',
  coincide: (ctx) => coincideCompletarCancion(ctx.userText),
  mensajesBrief: mensajesBriefCancion,
  planificar: planCompletarCancion,
}
