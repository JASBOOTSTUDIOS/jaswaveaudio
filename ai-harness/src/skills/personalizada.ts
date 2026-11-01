/**
 * Habilidades personalizadas: el usuario describe en lenguaje natural lo que quiere que haga un
 * agente y se compila (una llamada LLM, o reglas locales si falla) a un PROCEDIMIENTO JSON:
 * pasos fijos con herramientas reales del catálogo y marcadores ({{trackId}}, {{clipIds}}…).
 *
 * En ejecución el modelo sólo rellena los huecos variables (qué pista, intensidad…) con un brief
 * JSON corto; el resto es determinista. Así un modelo débil no se pierde ni inventa herramientas,
 * y si falta un dato imprescindible la habilidad pregunta en lugar de suponer.
 */

import type { DAWState } from '@jaswave/shared'

import { agentActionClassOfType } from '../agent/action-policy'
import type { HarnessDawAction as DawAction } from '../types/actions'
import { extraerJson, type ContextoHabilidad, type Habilidad, type MensajeBrief, type PlanHabilidad } from './tipos'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export const VERSION_PROCEDIMIENTO = 1

export type SiSinDatos = 'preguntar' | 'saltar'

export type PasoProcedimiento = {
  /** `type` exacto de una herramienta del catálogo. */
  herramienta: string
  /** Payload con marcadores: "{{trackId}}", "{{clipId?}}", "{{clipIds}}", "{{pista:destino}}", "{{texto}}", "{{variable}}". */
  payload: Record<string, unknown>
  motivo: string
  /** Qué hacer si un marcador obligatorio no se puede resolver (por defecto: preguntar). */
  siSinDatos?: SiSinDatos
  /** Pista foco del paso (marcador de pista); por defecto la pista principal. */
  pista?: string
  /** 'porPistaMidi': el paso se repite para cada pista con grabaciones MIDI (un perfil por instrumento). */
  repetir?: 'porPistaMidi'
}

export type TipoVariable = 'pista' | 'numero' | 'texto' | 'opcion'

/** Hueco que decide el modelo en cada ejecución (lo único «creativo» que se le pide). */
export type VariableProcedimiento = {
  nombre: string
  descripcion: string
  tipo: TipoVariable
  min?: number
  max?: number
  opciones?: string[]
  porDefecto?: string | number
}

export type ProcedimientoHabilidad = {
  version: number
  id: string
  nombre: string
  objetivo: string
  disparadores: string[]
  herramientasPermitidas: string[]
  pasos: PasoProcedimiento[]
  variables?: VariableProcedimiento[]
  preguntasSiFalta?: string[]
  criteriosExito: string[]
  /** Prompt corto, imperativo y numerado para el modelo. */
  instruccionesModelo: string
  /** Descripción original del usuario (para recompilar). */
  descripcionOriginal?: string
}

export type HerramientaCatalogo = {
  type: string
  description: string
  examplePayload?: Record<string, unknown>
  schema?: Record<string, unknown>
}

export type ResultadoValidacion = { procedimiento: ProcedimientoHabilidad | null; avisos: string[] }

export type ResultadoCompilacion = ResultadoValidacion & { origen: 'modelo' | 'local' | 'mixto' }

// ─── Utilidades ──────────────────────────────────────────────────────────────

export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const unicos = <T>(xs: T[]): T[] => [...new Set(xs)]
const slug = (s: string) =>
  normalizarTexto(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'habilidad'

/** Marcadores que el DAW resuelve solo (sin preguntar al modelo). */
export const MARCADORES_DAW = ['trackId', 'clipId', 'clipIds', 'instrumento', 'nombrePista', 'texto'] as const
const RE_MARCADOR = /\{\{\s*([\w:.\- áéíóúñÁÉÍÓÚÑ]+?)(\?)?\s*\}\}/g

type Marcador = { clave: string; opcional: boolean }

function marcadoresDe(valor: unknown, out: Marcador[] = []): Marcador[] {
  if (typeof valor === 'string') {
    for (const m of valor.matchAll(RE_MARCADOR)) out.push({ clave: m[1]!.trim(), opcional: m[2] === '?' })
  } else if (Array.isArray(valor)) {
    for (const v of valor) marcadoresDe(v, out)
  } else if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor)) marcadoresDe(v, out)
  }
  return out
}

/** Normaliza variantes que escriben los modelos: {trackId}, <trackId>, ${trackId}, {{ track_id }}. */
function normalizarMarcadores(valor: unknown): unknown {
  if (typeof valor === 'string') {
    let s = valor
    s = s.replace(/\$\{\s*([\w:.-]+\??)\s*\}/g, '{{$1}}')
    s = s.replace(/(^|[^{])\{\s*([A-Za-z][\w:.-]*\??)\s*\}(?!\})/g, '$1{{$2}}')
    s = s.replace(/<\s*(trackId|clipId|clipIds|instrumento|texto)\s*>/g, '{{$1}}')
    s = s.replace(/\{\{\s*track_id\s*\}\}/gi, '{{trackId}}').replace(/\{\{\s*clip_id\s*\}\}/gi, '{{clipId}}')
    return s
  }
  if (Array.isArray(valor)) return valor.map(normalizarMarcadores)
  if (valor && typeof valor === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) o[k] = normalizarMarcadores(v)
    return o
  }
  return valor
}

// ─── Vocabulario (es → términos del catálogo) ────────────────────────────────

const SINONIMOS: Array<[RegExp, string[]]> = [
  [/analiz|analisis|estudia|mide|medir|detecta|examina/, ['analysis', 'analyze', 'analiza']],
  [/micro-?tiempo|microtiempo|timing|a destiempo|adelant|atras/, ['touch', 'timing', 'micro']],
  [/micro-?dinamica|microdinamica|dinamica|velocidad|velocity|intensidad de cada nota|ataque/, ['touch', 'velocity', 'dinamica']],
  [/toque|forma de tocar|estilo de tocar|interpretaci|matices|feel|groove personal/, ['touch', 'style', 'toque']],
  [/aprend|perfil|captura|memoriza/, ['learn', 'profile', 'perfil']],
  [/aplica|replica|imita|transfiere|usa mi/, ['apply', 'aplica']],
  [/estilo/, ['style', 'estilo']],
  [/cuantiz|cuadra|a la rejilla/, ['quantize', 'cuantiza']],
  [/humaniz/, ['humanize', 'humaniza']],
  [/tempo|bpm/, ['bpm', 'tempo', 'setbpm']],
  [/tonalidad|escala/, ['key', 'setkey', 'tonalidad']],
  [/volumen|nivel/, ['volume', 'gain', 'volumen']],
  [/paneo|panea/, ['pan', 'paneo']],
  [/reverb|espacio|ambiente/, ['reverb', 'ambience']],
  [/ecualiz|\beq\b/, ['eq', 'equalizer']],
  [/compres/, ['compressor', 'compresion']],
  [/melodi/, ['melody', 'melodia', 'generate', 'midi']],
  [/acorde/, ['chord', 'acordes']],
  [/arpegi/, ['arpeggio', 'arpegio']],
  [/nota/, ['notes', 'note', 'midi']],
  [/genera|crea|compon|escribe|nuevas?/, ['generate', 'create', 'compose', 'genera']],
  [/pista/, ['track', 'pista']],
  [/clip|grabacion/, ['clip', 'midi']],
  [/mezcl/, ['mix', 'mezcla']],
  [/master/, ['master']],
  [/exporta/, ['export']],
  [/bateria|drums/, ['drums', 'bateria']],
  [/bajo\b/, ['bass', 'bajo']],
]

function terminosDe(texto: string): string[] {
  const t = normalizarTexto(texto)
  const out: string[] = []
  for (const [re, terms] of SINONIMOS) if (re.test(t)) out.push(...terms)
  for (const w of t.split(/[^a-z0-9]+/)) if (w.length >= 5) out.push(w)
  return unicos(out)
}

function puntuarHerramienta(terminos: string[], h: HerramientaCatalogo): number {
  const tipo = h.type.toLowerCase()
  const desc = normalizarTexto(h.description)
  let p = 0
  for (const t of terminos) {
    if (tipo.includes(t)) p += 2
    else if (desc.includes(t)) p += 1
  }
  return p
}

// ─── Recetas locales (respaldo determinista) ─────────────────────────────────

type Receta = {
  id: string
  detectar: RegExp
  nombre: string
  objetivo: string
  disparadores: string[]
  pasos: PasoProcedimiento[]
  variables: VariableProcedimiento[]
  preguntasSiFalta: string[]
  criteriosExito: string[]
}

const RECETAS: Receta[] = [
  {
    id: 'toque',
    detectar:
      /micro-?tiempo|microtiempo|micro-?dinamica|microdinamica|mi toque|toque natural|mi forma de tocar|como (yo )?toco|mis interpretaciones|replica(r)? (exactamente )?mi|aprende(r)? (de )?mi (estilo|toque)|matices de (mi )?estilo/,
    nombre: 'Mi toque personal',
    objetivo: 'Medir micro-tiempos, velocity y ataque de cada nota en tus grabaciones MIDI, guardar un perfil por instrumento y aplicarlo a lo nuevo.',
    disparadores: [
      'mi toque',
      'micro-tiempos',
      'microdinamica',
      'toca como yo',
      'replica mi toque',
      'mi forma de tocar',
      'aplica mi estilo',
      'aprende mi toque',
      'como lo toco yo',
    ],
    pasos: [
      {
        herramienta: 'analysis.touch',
        payload: { trackId: '{{trackId}}', clipIds: '{{clipIds}}', instrumento: '{{instrumento}}' },
        motivo: 'Medir micro-tiempos, velocity, ataque y articulación nota a nota (arpegios y acordes incluidos).',
        repetir: 'porPistaMidi',
        siSinDatos: 'preguntar',
      },
      {
        herramienta: 'style.touch.learn',
        payload: { trackId: '{{trackId}}', clipIds: '{{clipIds}}', nombre: 'Mi toque · {{instrumento}}', instrumento: '{{instrumento}}' },
        motivo: 'Guardar el perfil de toque de ese instrumento.',
        repetir: 'porPistaMidi',
        siSinDatos: 'preguntar',
      },
      {
        herramienta: 'style.touch.apply',
        payload: { nombre: 'Mi toque · {{instrumento}}', trackId: '{{trackId}}', clipId: '{{clipId?}}', intensidad: '{{intensidad}}' },
        motivo: 'Aplicar tu toque a la melodía nueva de la pista destino.',
        pista: '{{pista:destino}}',
        siSinDatos: 'preguntar',
      },
    ],
    variables: [
      { nombre: 'destino', descripcion: 'pista donde está la melodía nueva a la que se aplica el toque', tipo: 'pista' },
      { nombre: 'intensidad', descripcion: 'cuánto del toque aplicar (1 = idéntico)', tipo: 'numero', min: 0, max: 1, porDefecto: 1 },
    ],
    preguntasSiFalta: ['¿En qué pista está la melodía nueva a la que aplico tu toque? Selecciónala o dime su nombre.'],
    criteriosExito: [
      'Hay un perfil de toque por cada instrumento grabado.',
      'La melodía nueva conserva sus notas y adopta tus micro-tiempos y dinámicas.',
    ],
  },
]

function detectarReceta(texto: string): Receta | null {
  const t = normalizarTexto(texto)
  return RECETAS.find((r) => r.detectar.test(t)) ?? null
}

// ─── Compilación: mensajes para el modelo ────────────────────────────────────

/** Recorta el catálogo a las herramientas relevantes (los modelos débiles se pierden con 150). */
export function preseleccionarHerramientas(texto: string, catalogo: readonly HerramientaCatalogo[], max = 40): HerramientaCatalogo[] {
  if (catalogo.length <= max) return [...catalogo]
  const terminos = terminosDe(texto)
  const receta = detectarReceta(texto)
  const obligatorias = new Set(receta?.pasos.map((p) => p.herramienta) ?? [])
  return [...catalogo]
    .map((h, i) => ({ h, i, p: obligatorias.has(h.type) ? 1000 : puntuarHerramienta(terminos, h) }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, max)
    .map((x) => x.h)
}

export function mensajesCompilarHabilidad(textoUsuario: string, catalogo: readonly HerramientaCatalogo[]): MensajeBrief[] {
  const lista = preseleccionarHerramientas(textoUsuario, catalogo)
  const system = [
    'Conviertes una habilidad descrita por el usuario en un PROCEDIMIENTO JSON que el DAW JasWave ejecuta paso a paso.',
    'Responde SOLO con un objeto JSON válido. Sin texto antes ni después.',
    '',
    'Reglas:',
    '1. "herramienta" = un "type" EXACTO de la lista HERRAMIENTAS. Nunca inventes herramientas; si nada encaja, pon menos pasos.',
    '2. Orden: primero leer/analizar, después aprender/calcular, al final aplicar o crear.',
    '3. En "payload" no inventes ids. Usa marcadores: {{trackId}} pista, {{clipId}} clip, {{clipIds}} clips MIDI de la pista, {{instrumento}} instrumento de la pista, {{texto}} pedido del usuario, {{pista:destino}} pista que se elige al ejecutar, {{nombre}} un valor variable (decláralo en "variables").',
    '4. "repetir":"porPistaMidi" si el paso debe hacerse una vez por cada instrumento grabado.',
    '5. Marcador opcional con "?": {{clipId?}}.',
    '6. "siSinDatos": "preguntar" si sin ese dato no tiene sentido; "saltar" si el paso es opcional.',
    '7. "disparadores": 4-10 frases cortas que diría el usuario para pedir esta habilidad.',
    '8. "instruccionesModelo": 3-6 órdenes numeradas, cortas y concretas.',
    '',
    'Esquema:',
    '{"nombre":"…","objetivo":"una frase","disparadores":["…"],',
    ' "pasos":[{"herramienta":"type","payload":{…},"motivo":"por qué","siSinDatos":"preguntar|saltar","pista":"{{pista:destino}} (opcional)","repetir":"porPistaMidi (opcional)"}],',
    ' "variables":[{"nombre":"…","descripcion":"…","tipo":"pista|numero|texto|opcion","min":0,"max":1,"porDefecto":1}],',
    ' "preguntasSiFalta":["…"],"criteriosExito":["…"],"instruccionesModelo":"1. … 2. …"}',
  ].join('\n')
  const user = [
    `Habilidad descrita por el usuario: «${textoUsuario.trim()}»`,
    '',
    'HERRAMIENTAS (type: descripción):',
    ...lista.map((h) => `- ${h.type}: ${h.description.replace(/\s+/g, ' ').slice(0, 160)}`),
    '',
    'Devuelve el JSON.',
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// ─── Validación ──────────────────────────────────────────────────────────────

export type OpcionesValidacion = {
  textoUsuario?: string
  /** Restricción externa (rol/modo): sólo estas herramientas. */
  permitidas?: readonly string[]
  /** Por defecto false: se descartan herramientas destructivas (borrar pistas, clips…). */
  permitirDestructivas?: boolean
}

function arrStr(v: unknown, max: number, largo = 200): string[] {
  if (typeof v === 'string') v = v.split(/\n|;|,(?=\s)/)
  if (!Array.isArray(v)) return []
  return unicos(
    (v as unknown[])
      .map((x) => str(x).replace(/^[-*\d.)\s]+/, '').slice(0, largo))
      .filter((x) => x.length >= 2),
  ).slice(0, max)
}

function normalizarVariable(v: unknown): VariableProcedimiento | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const nombre = str(o.nombre ?? o.name).replace(/[{}?\s]/g, '')
  if (!nombre || (MARCADORES_DAW as readonly string[]).includes(nombre)) return null
  const tipo: TipoVariable = (['pista', 'numero', 'texto', 'opcion'] as const).includes(o.tipo as TipoVariable)
    ? (o.tipo as TipoVariable)
    : o.tipo === 'number'
      ? 'numero'
      : o.tipo === 'track'
        ? 'pista'
        : 'texto'
  const out: VariableProcedimiento = { nombre, descripcion: str(o.descripcion ?? o.description).slice(0, 160) || nombre, tipo }
  const min = num(o.min)
  const max = num(o.max)
  if (min !== null) out.min = min
  if (max !== null) out.max = max
  if (tipo === 'opcion') {
    const ops = arrStr(o.opciones ?? o.options, 12, 40)
    if (ops.length) out.opciones = ops
    else out.tipo = 'texto'
  }
  if (typeof o.porDefecto === 'number' || typeof o.porDefecto === 'string') out.porDefecto = o.porDefecto
  return out
}

function instruccionesDesdePasos(nombre: string, pasos: PasoProcedimiento[], variables: VariableProcedimiento[]): string {
  const lineas = [
    `Habilidad «${nombre}». Sigue estos pasos en orden; no uses otras herramientas.`,
    ...pasos.map((p, i) => `${i + 1}. ${p.herramienta}${p.repetir ? ' (una vez por cada pista con MIDI)' : ''}: ${p.motivo}`),
  ]
  if (variables.length) lineas.push(`${pasos.length + 1}. Decide sólo: ${variables.map((v) => `${v.nombre} (${v.descripcion})`).join('; ')}.`)
  lineas.push(`${pasos.length + (variables.length ? 2 : 1)}. Si falta la pista o el clip, pregunta; no inventes ids.`)
  return lineas.join('\n')
}

/**
 * Valida un procedimiento (del modelo o guardado): descarta herramientas inexistentes, no
 * permitidas o destructivas, normaliza marcadores y completa lo que falte. Pura.
 */
export function validarProcedimiento(
  json: unknown,
  catalogo: readonly HerramientaCatalogo[],
  opciones: OpcionesValidacion = {},
): ResultadoValidacion {
  const avisos: string[] = []
  const bruto = typeof json === 'string' ? extraerJson(json) : json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null
  if (!bruto) return { procedimiento: null, avisos: ['La respuesta no es un JSON de procedimiento.'] }

  const porTipo = new Map(catalogo.map((h) => [h.type, h.type]))
  const porTipoMin = new Map(catalogo.map((h) => [h.type.toLowerCase(), h.type]))
  const permitidasExt = opciones.permitidas ? new Set(opciones.permitidas) : null
  const resolverHerramienta = (nombre: string): string | null => {
    const exacta = porTipo.get(nombre) ?? porTipoMin.get(nombre.toLowerCase())
    if (!exacta) {
      avisos.push(`Herramienta inexistente descartada: «${nombre}».`)
      return null
    }
    if (permitidasExt && !permitidasExt.has(exacta)) {
      avisos.push(`Herramienta no permitida para este agente: «${exacta}».`)
      return null
    }
    if (!opciones.permitirDestructivas && agentActionClassOfType(exacta) === 'destructive') {
      avisos.push(`Herramienta destructiva descartada: «${exacta}».`)
      return null
    }
    return exacta
  }

  const variables: VariableProcedimiento[] = []
  const crudasVar = Array.isArray(bruto.variables) ? bruto.variables : []
  for (const v of crudasVar) {
    const nv = normalizarVariable(v)
    if (nv && !variables.some((x) => x.nombre === nv.nombre)) variables.push(nv)
  }

  const pasos: PasoProcedimiento[] = []
  const crudos = Array.isArray(bruto.pasos) ? bruto.pasos : Array.isArray(bruto.steps) ? bruto.steps : []
  for (const c of crudos as unknown[]) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const nombreH = str(o.herramienta ?? o.tool ?? o.type ?? o.accion)
    if (!nombreH) continue
    const herramienta = resolverHerramienta(nombreH)
    if (!herramienta) continue
    const payloadBruto = o.payload ?? o.args ?? o.parametros ?? o.params
    const payload =
      payloadBruto && typeof payloadBruto === 'object' && !Array.isArray(payloadBruto)
        ? (normalizarMarcadores(payloadBruto) as Record<string, unknown>)
        : {}
    const paso: PasoProcedimiento = {
      herramienta,
      payload,
      motivo: str(o.motivo ?? o.reason ?? o.descripcion).slice(0, 200) || herramienta,
    }
    const sin = str(o.siSinDatos)
    paso.siSinDatos = sin === 'saltar' ? 'saltar' : 'preguntar'
    const pista = normalizarMarcadores(str(o.pista)) as string
    if (pista && /^\{\{\s*(pista:[^}]+|trackId)\s*\}\}$/.test(pista)) paso.pista = pista
    if (o.repetir === 'porPistaMidi' || o.repetir === true || o.porCadaPista === true) paso.repetir = 'porPistaMidi'
    // Marcadores desconocidos → huecos que decidirá el modelo (no se inventan valores).
    for (const m of marcadoresDe([payload, paso.pista ?? ''])) {
      const base = m.clave.startsWith('pista:') ? m.clave.slice(6) : m.clave
      if ((MARCADORES_DAW as readonly string[]).includes(m.clave)) continue
      if (variables.some((v) => v.nombre === base)) continue
      variables.push({ nombre: base, descripcion: base, tipo: m.clave.startsWith('pista:') ? 'pista' : 'texto' })
      avisos.push(`Marcador «${m.clave}» declarado como variable.`)
    }
    pasos.push(paso)
    if (pasos.length >= 12) break
  }
  if (!pasos.length) {
    avisos.push('El procedimiento no tiene pasos con herramientas válidas.')
    return { procedimiento: null, avisos }
  }

  const textoUsuario = opciones.textoUsuario ?? str(bruto.descripcionOriginal)
  const nombre = str(bruto.nombre ?? bruto.name).slice(0, 60) || (textoUsuario ? textoUsuario.slice(0, 40) : 'Habilidad personalizada')
  const usadas = unicos(pasos.map((p) => p.herramienta))
  const extra = arrStr(bruto.herramientasPermitidas, 24, 80)
    .map((t) => porTipo.get(t) ?? porTipoMin.get(t.toLowerCase()))
    .filter((t): t is string => !!t && (!permitidasExt || permitidasExt.has(t)) && (opciones.permitirDestructivas || agentActionClassOfType(t) !== 'destructive'))
  let disparadores = arrStr(bruto.disparadores ?? bruto.triggers, 12, 80).map((d) => normalizarTexto(d)).filter((d) => d.length >= 3)
  if (!disparadores.length && textoUsuario) disparadores = disparadoresDesdeTexto(textoUsuario)
  const variablesUsadas = variables.filter((v) =>
    pasos.some((p) => marcadoresDe([p.payload, p.pista ?? '']).some((m) => m.clave === v.nombre || m.clave === `pista:${v.nombre}`)),
  )
  let instruccionesModelo = str(bruto.instruccionesModelo ?? bruto.instrucciones).slice(0, 900)
  if (!/(^|\n)\s*1[.)]/.test(instruccionesModelo)) instruccionesModelo = instruccionesDesdePasos(nombre, pasos, variablesUsadas)

  const procedimiento: ProcedimientoHabilidad = {
    version: VERSION_PROCEDIMIENTO,
    id: str(bruto.id).startsWith('usuario.') ? str(bruto.id).slice(0, 60) : `usuario.${slug(nombre)}`,
    nombre,
    objetivo: str(bruto.objetivo ?? bruto.goal).slice(0, 300) || nombre,
    disparadores,
    herramientasPermitidas: unicos([...usadas, ...extra]),
    pasos,
    criteriosExito: arrStr(bruto.criteriosExito, 8),
    instruccionesModelo,
  }
  if (variablesUsadas.length) procedimiento.variables = variablesUsadas
  const preguntas = arrStr(bruto.preguntasSiFalta, 5)
  if (preguntas.length) procedimiento.preguntasSiFalta = preguntas
  if (textoUsuario) procedimiento.descripcionOriginal = textoUsuario.slice(0, 2000)
  return { procedimiento, avisos }
}

// ─── Compilador local ────────────────────────────────────────────────────────

const PALABRAS_VACIAS = new Set(
  'para como cada todas todos estos estas este esta esos esas desde hasta sobre entre dentro incluyendo exactamente precision natural nuevas nuevos jaswave quiero tambien despues luego'.split(' '),
)

function disparadoresDesdeTexto(texto: string): string[] {
  const palabras = normalizarTexto(texto)
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 6 && !PALABRAS_VACIAS.has(w))
  return unicos(palabras).slice(0, 8)
}

function payloadGenerico(h: HerramientaCatalogo): Record<string, unknown> {
  const props = (h.schema?.properties ?? {}) as Record<string, unknown>
  const claves = new Set([...Object.keys(h.examplePayload ?? {}), ...Object.keys(props)])
  const p: Record<string, unknown> = {}
  if (claves.has('trackId')) p.trackId = '{{trackId}}'
  if (claves.has('clipId')) p.clipId = '{{clipId?}}'
  if (claves.has('clipIds')) p.clipIds = '{{clipIds?}}'
  if (claves.has('prompt')) p.prompt = '{{texto}}'
  return p
}

/** Compilador por reglas/palabras clave: sólo usa herramientas del catálogo. Puro. */
export function compilarHabilidadLocal(textoUsuario: string, catalogo: readonly HerramientaCatalogo[], opciones: OpcionesValidacion = {}): ResultadoValidacion {
  const receta = detectarReceta(textoUsuario)
  if (receta) {
    const { procedimiento, avisos } = validarProcedimiento(
      {
        nombre: receta.nombre,
        objetivo: receta.objetivo,
        disparadores: receta.disparadores,
        pasos: receta.pasos,
        variables: receta.variables,
        preguntasSiFalta: receta.preguntasSiFalta,
        criteriosExito: receta.criteriosExito,
      },
      catalogo,
      { ...opciones, textoUsuario },
    )
    if (procedimiento) return { procedimiento, avisos }
  }
  // Genérico: una herramienta por cláusula, la que mejor encaje por vocabulario.
  const clausulas = textoUsuario
    .split(/[.;\n]+|,?\s+(?:y\s+)?(?:luego|despu[eé]s|a continuaci[oó]n|finalmente)\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length >= 6)
  const pasos: PasoProcedimiento[] = []
  for (const c of clausulas) {
    const terminos = terminosDe(c)
    let mejor: HerramientaCatalogo | null = null
    let puntos = 0
    for (const h of catalogo) {
      if (pasos.some((p) => p.herramienta === h.type)) continue
      const p = puntuarHerramienta(terminos, h)
      if (p > puntos) {
        puntos = p
        mejor = h
      }
    }
    if (mejor && puntos >= 3) pasos.push({ herramienta: mejor.type, payload: payloadGenerico(mejor), motivo: c.slice(0, 160), siSinDatos: 'preguntar' })
    if (pasos.length >= 6) break
  }
  const nombre = textoUsuario.trim().split(/[.,;\n]/)[0]!.slice(0, 40) || 'Habilidad personalizada'
  return validarProcedimiento({ nombre, objetivo: textoUsuario.slice(0, 300), disparadores: disparadoresDesdeTexto(textoUsuario), pasos }, catalogo, {
    ...opciones,
    textoUsuario,
  })
}

/**
 * Compila con la respuesta del modelo (o `null`) y cae al compilador local si el modelo falló
 * o se saltó pasos de una receta conocida (p. ej. el toque: analizar → aprender → aplicar).
 */
export function compilarHabilidad(
  textoUsuario: string,
  catalogo: readonly HerramientaCatalogo[],
  respuestaModelo: string | null,
  opciones: OpcionesValidacion = {},
): ResultadoCompilacion {
  const local = compilarHabilidadLocal(textoUsuario, catalogo, opciones)
  if (!respuestaModelo) return { ...local, origen: 'local', avisos: ['Sin respuesta del modelo: compilado con reglas locales.', ...local.avisos] }
  const modelo = validarProcedimiento(respuestaModelo, catalogo, { ...opciones, textoUsuario })
  if (!modelo.procedimiento) {
    return { ...local, origen: 'local', avisos: [...modelo.avisos, 'Uso el compilador local.', ...local.avisos] }
  }
  const receta = detectarReceta(textoUsuario)
  if (receta && local.procedimiento) {
    const esperadas = local.procedimiento.pasos.map((p) => p.herramienta)
    const delModelo = modelo.procedimiento.pasos.map((p) => p.herramienta)
    let i = 0
    for (const h of delModelo) if (h === esperadas[i]) i++
    if (i < esperadas.length) {
      const p = local.procedimiento
      return {
        procedimiento: {
          ...p,
          nombre: modelo.procedimiento.nombre || p.nombre,
          disparadores: unicos([...p.disparadores, ...modelo.procedimiento.disparadores]).slice(0, 14),
          criteriosExito: p.criteriosExito.length ? p.criteriosExito : modelo.procedimiento.criteriosExito,
        },
        avisos: [...modelo.avisos, 'Los pasos del modelo estaban incompletos o desordenados: uso la receta verificada.'],
        origen: 'mixto',
      }
    }
  }
  return { ...modelo, origen: 'modelo' }
}

// ─── Ejecución: de procedimiento a Habilidad ─────────────────────────────────

type PistaLite = { id: string; nombre: string; tipo: string; instrumento: string; clips: Array<{ id: string; inicio: number; notas: number }> }

const INSTRUMENTOS: Array<[RegExp, string]> = [
  [/piano|keys|teclad|rhodes|wurli|epiano/, 'piano'],
  [/organo|organ|hammond/, 'organo'],
  [/bajo|bass/, 'bajo'],
  [/guitarra|guitar|gtr/, 'guitarra'],
  [/bateria|drum|perc|kit/, 'bateria'],
  [/cuerda|string|violin|cello|viola/, 'cuerdas'],
  [/pad|atmos|ambient/, 'pad'],
  [/synth|sinte|lead/, 'sinte'],
  [/voz|vocal|coro/, 'voz'],
  [/trompet|sax|flaut|brass|metal|viento/, 'vientos'],
]

function inferirInstrumento(...fuentes: Array<string | undefined>): string | null {
  const t = normalizarTexto(fuentes.filter(Boolean).join(' '))
  for (const [re, nombre] of INSTRUMENTOS) if (re.test(t)) return nombre
  return null
}

function pistasDe(state: DAWState): PistaLite[] {
  const out: PistaLite[] = []
  for (const t of state.project?.tracks ?? []) {
    if (t.tipo === 'master') continue
    const tr = t as unknown as { id: string; nombre: string; tipo: string; clips?: unknown[]; instrumento?: { nombre?: string } }
    const clips = (Array.isArray(tr.clips) ? tr.clips : [])
      .map((c) => c as { id?: string; inicio?: number; notas?: unknown[] })
      .filter((c) => typeof c.id === 'string' && Array.isArray(c.notas))
      .map((c) => ({ id: c.id!, inicio: num(c.inicio) ?? 0, notas: c.notas!.length }))
      .sort((a, b) => a.inicio - b.inicio)
    out.push({
      id: tr.id,
      nombre: tr.nombre,
      tipo: tr.tipo,
      instrumento: inferirInstrumento(tr.nombre, tr.instrumento?.nombre) ?? normalizarTexto(tr.nombre),
      clips,
    })
  }
  return out
}

const tieneMidi = (p: PistaLite) => p.clips.some((c) => c.notas > 0)

function buscarPista(pistas: PistaLite[], ref: unknown): PistaLite | null {
  const r = str(ref)
  if (!r || r === 'null') return null
  const byId = pistas.find((p) => p.id === r)
  if (byId) return byId
  const n = normalizarTexto(r)
  return pistas.find((p) => normalizarTexto(p.nombre) === n) ?? pistas.find((p) => n.length >= 3 && normalizarTexto(p.nombre).includes(n)) ?? null
}

function pistaNombradaEnTexto(pistas: PistaLite[], texto: string): PistaLite | null {
  const t = normalizarTexto(texto)
  return pistas.find((p) => normalizarTexto(p.nombre).length >= 3 && new RegExp(`\\b${normalizarTexto(p.nombre).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) ?? null
}

type BriefValidado = { pista: PistaLite | null; valores: Record<string, unknown>; delModelo: boolean; avisos: string[] }

function validarBrief(proc: ProcedimientoHabilidad, pistas: PistaLite[], bruto: Record<string, unknown> | null): BriefValidado {
  const avisos: string[] = []
  const valores: Record<string, unknown> = {}
  let delModelo = false
  const b = bruto ?? {}
  const pista = buscarPista(pistas, b.pista)
  if (b.pista !== undefined && b.pista !== null && !pista) avisos.push(`El modelo eligió una pista que no existe («${str(b.pista)}»): la ignoro.`)
  if (pista) delModelo = true
  for (const v of proc.variables ?? []) {
    const raw = b[v.nombre]
    if (raw === undefined || raw === null || raw === '') continue
    if (v.tipo === 'pista') {
      const p = buscarPista(pistas, raw)
      if (p) {
        valores[v.nombre] = p
        delModelo = true
      } else avisos.push(`Pista «${str(raw)}» para ${v.nombre} no existe: la ignoro.`)
    } else if (v.tipo === 'numero') {
      const n = num(raw)
      if (n === null) continue
      valores[v.nombre] = Math.max(v.min ?? -Infinity, Math.min(v.max ?? Infinity, n))
      delModelo = true
    } else if (v.tipo === 'opcion') {
      const op = v.opciones?.find((o) => normalizarTexto(o) === normalizarTexto(str(raw)))
      if (op) {
        valores[v.nombre] = op
        delModelo = true
      }
    } else if (str(raw)) {
      valores[v.nombre] = str(raw).slice(0, 200)
      delModelo = true
    }
  }
  return { pista, valores, delModelo, avisos }
}

function describirPistas(state: DAWState, pistas: PistaLite[]): string {
  const sel = state.selection?.idsPistas?.[0]
  if (!pistas.length) return '(proyecto sin pistas)'
  return pistas
    .slice(0, 24)
    .map((p) => {
      const notas = p.clips.reduce((a, c) => a + c.notas, 0)
      return `- "${p.nombre}" (${p.instrumento}, ${p.clips.length} clips, ${notas} notas)${p.id === sel ? ' ← seleccionada' : ''}`
    })
    .join('\n')
}

function esquemaBrief(proc: ProcedimientoHabilidad): string {
  const campos = ['"pista": "nombre exacto de la pista principal, o null"']
  for (const v of proc.variables ?? []) {
    const def = v.porDefecto !== undefined ? ` (por defecto ${JSON.stringify(v.porDefecto)})` : ''
    if (v.tipo === 'pista') campos.push(`"${v.nombre}": "nombre exacto de una pista, o null" — ${v.descripcion}`)
    else if (v.tipo === 'numero') campos.push(`"${v.nombre}": número${v.min !== undefined && v.max !== undefined ? ` ${v.min}-${v.max}` : ''} — ${v.descripcion}${def}`)
    else if (v.tipo === 'opcion') campos.push(`"${v.nombre}": uno de ${JSON.stringify(v.opciones ?? [])} — ${v.descripcion}${def}`)
    else campos.push(`"${v.nombre}": "texto corto" — ${v.descripcion}${def}`)
  }
  return `{\n  ${campos.join(',\n  ')}\n}`
}

function mensajesBriefProcedimiento(proc: ProcedimientoHabilidad, ctx: ContextoHabilidad): MensajeBrief[] {
  const pistas = pistasDe(ctx.state)
  const system = [
    `Eres el agente de la habilidad «${proc.nombre}» en JasWave. Objetivo: ${proc.objetivo}`,
    'El DAW ejecuta los pasos fijos. Tú SOLO eliges los valores variables.',
    'Responde SOLO con un objeto JSON válido, sin texto antes ni después.',
    'Usa nombres de pista EXACTOS de la lista; si dudas, pon null (el DAW preguntará al usuario). Nunca inventes pistas.',
    '',
    proc.instruccionesModelo,
  ].join('\n')
  const user = [
    `Pedido del usuario: «${ctx.userText.trim()}»`,
    '',
    '## Pistas',
    describirPistas(ctx.state, pistas),
    '',
    '## Pasos que ejecutará el DAW',
    ...proc.pasos.map((p, i) => `${i + 1}. ${p.herramienta}${p.repetir ? ' (por cada pista con MIDI)' : ''} — ${p.motivo}`),
    '',
    '## Devuelve este JSON',
    esquemaBrief(proc),
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

const SIN_VALOR = Symbol('sin-valor')

type Entorno = {
  ctx: ContextoHabilidad
  pistas: PistaLite[]
  principal: PistaLite | null
  brief: BriefValidado
  proc: ProcedimientoHabilidad
}

function resolverPistaRef(ref: string, env: Entorno): PistaLite | null {
  const sel = env.ctx.state.selection?.idsPistas?.[0]
  const seleccionada = env.pistas.find((p) => p.id === sel) ?? null
  if (ref === 'trackId') return env.principal
  if (!ref.startsWith('pista:')) return null
  const nombre = ref.slice(6).trim()
  const variable = env.proc.variables?.find((v) => v.nombre === nombre)
  if (variable || nombre === 'destino' || nombre === 'pista') {
    const elegida = env.brief.valores[nombre]
    if (elegida && typeof elegida === 'object') return elegida as PistaLite
    if (nombre === 'pista') return env.principal
    return seleccionada
  }
  return buscarPista(env.pistas, nombre)
}

function valorMarcador(clave: string, foco: PistaLite | null, env: Entorno): unknown {
  const selClips = env.ctx.state.selection?.idsClips ?? []
  switch (clave) {
    case 'trackId':
      return foco?.id ?? SIN_VALOR
    case 'nombrePista':
      return foco?.nombre ?? SIN_VALOR
    case 'instrumento':
      return foco?.instrumento ?? SIN_VALOR
    case 'clipId': {
      if (!foco) return SIN_VALOR
      const sel = foco.clips.find((c) => selClips.includes(c.id))
      const ultimo = [...foco.clips].reverse().find((c) => c.notas > 0) ?? foco.clips[foco.clips.length - 1]
      return (sel ?? ultimo)?.id ?? SIN_VALOR
    }
    case 'clipIds': {
      if (!foco) return SIN_VALOR
      const sel = foco.clips.filter((c) => selClips.includes(c.id)).map((c) => c.id)
      const todos = foco.clips.filter((c) => c.notas > 0).map((c) => c.id)
      const r = sel.length ? sel : todos
      return r.length ? r : SIN_VALOR
    }
    case 'texto':
      return env.ctx.userText
  }
  if (clave.startsWith('pista:')) return resolverPistaRef(clave, env)?.id ?? SIN_VALOR
  const variable = env.proc.variables?.find((v) => v.nombre === clave)
  if (env.brief.valores[clave] !== undefined) {
    const v = env.brief.valores[clave]
    return v && typeof v === 'object' ? (v as PistaLite).id : v
  }
  if (variable?.porDefecto !== undefined) return variable.porDefecto
  return SIN_VALOR
}

function preguntaPara(clave: string, proc: ProcedimientoHabilidad): string {
  if (clave === 'grabacionesMidi') return 'No encuentro grabaciones MIDI con notas. ¿En qué pista están tus interpretaciones? Graba o importa un clip MIDI y selecciónalo.'
  if (clave === 'trackId' || clave === 'nombrePista' || clave === 'instrumento') return '¿Qué pista uso? Selecciónala en el arreglo o dime su nombre.'
  if (clave === 'clipId' || clave === 'clipIds') return '¿Qué clip MIDI uso? Selecciónalo en el arreglo.'
  const nombre = clave.startsWith('pista:') ? clave.slice(6) : clave
  const v = proc.variables?.find((x) => x.nombre === nombre)
  if (clave.startsWith('pista:') || v?.tipo === 'pista') return `¿Qué pista uso como «${nombre}»${v ? ` (${v.descripcion})` : ''}?`
  return `¿Qué valor uso para «${nombre}»${v ? ` (${v.descripcion})` : ''}?`
}

/** Sustituye marcadores; devuelve los obligatorios que faltan. */
function resolverValor(valor: unknown, foco: PistaLite | null, env: Entorno, faltan: string[]): unknown {
  if (typeof valor === 'string') {
    const entero = /^\{\{\s*([^}?]+?)(\?)?\s*\}\}$/.exec(valor)
    if (entero) {
      const v = valorMarcador(entero[1]!.trim(), foco, env)
      if (v === SIN_VALOR) {
        if (!entero[2]) faltan.push(entero[1]!.trim())
        return SIN_VALOR
      }
      return v
    }
    return valor.replace(RE_MARCADOR, (_m, clave: string, opc?: string) => {
      const v = valorMarcador(clave.trim(), foco, env)
      if (v === SIN_VALOR) {
        if (!opc) faltan.push(clave.trim())
        return ''
      }
      return Array.isArray(v) ? v.join(',') : String(v)
    }).trim()
  }
  if (Array.isArray(valor)) return valor.map((v) => resolverValor(v, foco, env, faltan)).filter((v) => v !== SIN_VALOR)
  if (valor && typeof valor === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) {
      const r = resolverValor(v, foco, env, faltan)
      if (r !== SIN_VALOR) o[k] = r
    }
    return o
  }
  return valor
}

function planProcedimiento(proc: ProcedimientoHabilidad, ctx: ContextoHabilidad, respuesta: string | null): PlanHabilidad {
  const pistas = pistasDe(ctx.state)
  const brief = validarBrief(proc, pistas, extraerJson(respuesta))
  const sel = ctx.state.selection?.idsPistas?.[0]
  const conMidi = pistas.filter(tieneMidi)
  const principal =
    brief.pista ??
    pistaNombradaEnTexto(pistas, ctx.userText) ??
    pistas.find((p) => p.id === sel) ??
    (conMidi.length === 1 ? conMidi[0]! : null)
  const env: Entorno = { ctx, pistas, principal, brief, proc }

  // Las pistas destino elegidas explícitamente por el modelo no se usan como fuente de aprendizaje.
  const destinosExplicitos = new Set<string>()
  for (const paso of proc.pasos) {
    const m = !paso.repetir && paso.pista ? /^\{\{\s*pista:([^}]+?)\s*\}\}$/.exec(paso.pista) : null
    const v = m ? brief.valores[m[1]!.trim()] : undefined
    if (v && typeof v === 'object') destinosExplicitos.add((v as PistaLite).id)
  }
  const origenes = conMidi.filter((p) => !destinosExplicitos.has(p.id))
  const fuentes = (origenes.length ? origenes : conMidi).slice(0, 8)

  const acciones: DawAction[] = []
  const decisiones: string[] = []
  const faltanTodas: string[] = []
  for (const paso of proc.pasos) {
    const focos: Array<PistaLite | null> = paso.repetir === 'porPistaMidi'
      ? fuentes
      : [paso.pista ? resolverPistaRef(paso.pista.replace(/^\{\{\s*|\s*\}\}$/g, ''), env) : principal]
    if (!focos.length) {
      if (paso.siSinDatos === 'saltar') {
        decisiones.push(`Salto ${paso.herramienta}: no hay pistas con MIDI.`)
        continue
      }
      faltanTodas.push('grabacionesMidi')
      continue
    }
    for (const foco of focos) {
      const faltan: string[] = []
      if (paso.pista && !foco) faltan.push(paso.pista.replace(/^\{\{\s*|\s*\}\}$/g, ''))
      const payload = resolverValor(paso.payload, foco, env, faltan) as Record<string, unknown>
      if (faltan.length) {
        if (paso.siSinDatos === 'saltar') {
          decisiones.push(`Salto ${paso.herramienta}${foco ? ` en «${foco.nombre}»` : ''}: falta ${unicos(faltan).join(', ')}.`)
          continue
        }
        faltanTodas.push(...faltan)
        continue
      }
      acciones.push({ type: paso.herramienta, payload })
      decisiones.push(`${paso.herramienta}${foco ? ` en «${foco.nombre}»` : ''}: ${paso.motivo}`)
    }
  }
  decisiones.push(...brief.avisos)

  if (faltanTodas.length) {
    const generadas = unicos(unicos(faltanTodas).map((c) => preguntaPara(c, proc)))
    const preguntas = unicos([...generadas, ...(proc.preguntasSiFalta ?? [])]).slice(0, 3)
    return {
      acciones: [],
      resumen: `**${proc.nombre}** — necesito un dato antes de actuar:\n${preguntas.map((p) => `- ${p}`).join('\n')}`,
      decisiones,
      creativoDelModelo: brief.delModelo,
      preguntas,
    }
  }
  const resumen = [
    `**${proc.nombre}** — ${acciones.length} paso(s): ${unicos(acciones.map((a) => a.type)).join(' → ')}`,
    proc.criteriosExito.length ? `Éxito si: ${proc.criteriosExito.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return { acciones, resumen, decisiones, creativoDelModelo: brief.delModelo }
}

/** Confianza 0..1 por disparadores (frase completa = 1 punto; palabra suelta = 0,5). Pura. */
export function coincideProcedimiento(proc: ProcedimientoHabilidad, texto: string): number {
  const t = normalizarTexto(texto)
  if (t.length < 4) return 0
  let puntos = 0
  for (const d of proc.disparadores) {
    const n = normalizarTexto(d)
    if (n.length < 3) continue
    const frase = n.includes(' ') || n.length >= 10
    if (t.includes(n)) {
      puntos += frase ? 1 : 0.5
      continue
    }
    if (frase) {
      const palabras = n.split(/[ -]+/).filter((w) => w.length >= 3)
      const presentes = palabras.filter((w) => t.includes(w)).length
      if (palabras.length >= 2 && presentes / palabras.length >= 0.75) puntos += 0.5
    }
  }
  let score = puntos >= 1 ? Math.min(0.95, 0.55 + 0.15 * puntos) : puntos * 0.5
  if (/^\s*¿/.test(texto) && !/\b(puedes|podr[ií]as|haz|aplica)\b/i.test(texto)) score *= 0.5
  return score
}

/** Convierte un procedimiento (validado) en una Habilidad ejecutable por el turno del agente. */
export function habilidadDesdeProcedimiento(proc: ProcedimientoHabilidad): Habilidad {
  return {
    id: proc.id,
    nombre: proc.nombre,
    descripcion: proc.objetivo,
    coincide: (ctx) => coincideProcedimiento(proc, ctx.userText),
    mensajesBrief: (ctx) => mensajesBriefProcedimiento(proc, ctx),
    planificar: (ctx, respuesta) => planProcedimiento(proc, ctx, respuesta),
  }
}

/** Instrucciones compactas para el prompt de sistema de un especialista. */
export function instruccionesCompactasProcedimiento(proc: ProcedimientoHabilidad, max = 500): string {
  const cuerpo = `Habilidad «${proc.nombre}» (se activa con: ${proc.disparadores.slice(0, 4).join(', ')}):\n${proc.instruccionesModelo}`
  return cuerpo.length > max ? `${cuerpo.slice(0, max - 1)}…` : cuerpo
}

/** Lee un procedimiento guardado (datos viejos o editados a mano); null si no es válido. */
export function esProcedimientoHabilidad(v: unknown): v is ProcedimientoHabilidad {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.nombre === 'string' && Array.isArray(o.pasos) && Array.isArray(o.disparadores)
}
