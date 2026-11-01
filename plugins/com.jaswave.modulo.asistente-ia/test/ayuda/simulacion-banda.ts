/**
 * Simulación guionizada de una producción de la banda (11 músicos, 10 secciones) SIN modelo real ni dinero.
 *
 * Usa el catálogo real de herramientas, el `ejecutarProduccion` real, el tool runner real y una tienda real; solo el
 * "modelo" es un guion determinista que reacciona a lo que ve (rol, paso, estado del proyecto). Registra todo lo que
 * `cfg.chat` enviaría (sistema, esquemas de herramientas, historial) para medir tokens estimados (≈ chars / 3,5) por
 * etapa, y las escrituras para comprobar la equivalencia entre variantes.
 */
import assert from 'node:assert/strict'
import { ejecutarProduccion, buildReadOnlyProjectContext } from '@jaswave/host-sdk'
import type { ChatAgente, HerramientaAgente, ParticipanteProduccion, RespuestaModelo, ResultadoHerramienta } from '@jaswave/host-sdk'
import { crearEstadoInicial, crearTiendaDAW, toolRegistry } from '../../../../shared/src/index'
import { registerAgentCatalogOnRegistry } from '@/src/lib/agent-action-catalog'
import { runRegisteredTool } from '../../src/motor/agent-tool-runner'
import { catalogoAgente, HERRAMIENTAS_BASE } from '../../src/motor/turno/catalogo-agente'
import { analizarCoherencia, parsearAcorde, seccionesFaltantes, diagnosticoEscritura } from '../../src/motor/turno/coherencia-banda'
import { guardarEscrituraArmonia, tablaArmoniaMusico, tipoDePista, type OpcionesArmonia } from '../../src/motor/turno/armonia-banda'
import { resumenPartes } from '../../src/motor/turno/turno-banda'
import { habilidadesBasePorRol } from '../../src/motor/habilidades-agentes'

const CH = 3.5
export const tokens = (chars: number) => Math.round(chars / CH)

export type Variante = {
  nombre: string
  /** Opciones de ahorro del harness (`false` = comportamiento anterior). */
  ahorro: unknown
  /** Diagnóstico determinista en el resultado de cada escritura (módulo). */
  diagnostico?: boolean
  /** Poda de herramientas por rol en el catálogo enviado (módulo). */
  podaCatalogo?: boolean
  /** Guardia de armonía al escribir + tabla de armonía en el encargo (módulo). */
  armonia?: boolean | OpcionesArmonia
}

type Kind = 'piano' | 'bateria' | 'bajo' | 'arpegio' | 'pad' | 'lead'
const MUSICOS: Array<{ id: string; nombre: string; kind: Kind; base: number; descripcion: string; perezoso?: boolean; /** Fracción de notas que se salen de la armonía en su primer intento. */ malas?: number }> = [
  { id: 'baterista', nombre: 'Baterista', kind: 'bateria', base: 36, descripcion: 'batería, groove y baterista' },
  { id: 'bajista', nombre: 'Bajista', kind: 'bajo', base: 38, descripcion: 'bajo, fundamental y bombo' },
  { id: 'percusion', nombre: 'Percusión', kind: 'bateria', base: 36, descripcion: 'percusión auxiliar' },
  { id: 'pianista', nombre: 'Pianista', kind: 'piano', base: 60, descripcion: 'piano, acordes', malas: 0.08 },
  { id: 'guitarra1', nombre: 'Guitarra rítmica', kind: 'arpegio', base: 55, descripcion: 'guitarra eléctrica rítmica', malas: 0.08 },
  { id: 'guitarra2', nombre: 'Guitarra lead', kind: 'lead', base: 69, descripcion: 'guitarra lead', perezoso: true },
  { id: 'sinte', nombre: 'Sintetizador', kind: 'pad', base: 57, descripcion: 'pads' },
  { id: 'cuerdas', nombre: 'Cuerdas', kind: 'pad', base: 62, descripcion: 'cuerdas' },
  { id: 'coros', nombre: 'Coros', kind: 'pad', base: 64, descripcion: 'coros', perezoso: true },
  { id: 'organo', nombre: 'Órgano', kind: 'pad', base: 52, descripcion: 'órgano' },
  { id: 'lead', nombre: 'Lead vocal', kind: 'lead', base: 74, descripcion: 'melodía principal', malas: 0.4 },
]

const SECCIONES = [
  ['Intro', 4], ['Verso 1', 8], ['Pre-coro', 4], ['Coro 1', 8], ['Verso 2', 8], ['Coro 2', 8], ['Puente', 8], ['Coro 3', 8], ['Coro 4', 8], ['Outro', 4],
] as const
const PROG = ['D', 'G', 'Bm', 'A']

export const HOJA = {
  tonalidad: 'Re mayor',
  bpm: 72,
  numerador: 4,
  secciones: SECCIONES.map(([nombre, compases], i) => ({
    nombre,
    compases,
    acordes: Array.from({ length: compases }, (_, c) => PROG[(c + i) % 4]!),
    caracter: i % 2 ? 'crece' : 'suave',
  })),
}

let semilla = 1
const alea = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

function notasSeccion(kind: Kind, base: number, acordes: string[], malas = 0) {
  const out: Array<{ pitch: number; inicio: number; duracion: number; velocidad: number }> = []
  const nota = (pc: number, b: number) => b + ((((pc - b) % 12) + 12) % 12)
  acordes.forEach((a, c) => {
    const ac = parsearAcorde(a)!
    const t = [...ac.notas]
    const v = () => 62 + Math.round(alea() * 36)
    const b0 = c * 4
    if (kind === 'bateria') {
      out.push({ pitch: 36, inicio: b0, duracion: 0.25, velocidad: 100 }, { pitch: 38, inicio: b0 + 1, duracion: 0.25, velocidad: 96 }, { pitch: 36, inicio: b0 + 2, duracion: 0.25, velocidad: 92 }, { pitch: 38, inicio: b0 + 3, duracion: 0.25, velocidad: 98 })
      for (let i = 0; i < 8; i++) out.push({ pitch: 42, inicio: b0 + i * 0.5, duracion: 0.25, velocidad: 50 + Math.round(alea() * 40) })
    } else if (kind === 'bajo') {
      out.push({ pitch: nota(ac.bajo, base), inicio: b0, duracion: 1.75, velocidad: v() }, { pitch: nota(ac.bajo, base), inicio: b0 + 2, duracion: 1, velocidad: v() }, { pitch: nota(t[1] ?? ac.raiz, base + 12), inicio: b0 + 3.5, duracion: 0.5, velocidad: v() })
    } else if (kind === 'piano') {
      for (let i = 0; i < 8; i++) out.push({ pitch: nota(t[i % t.length]!, base + (i % 3) * 5), inicio: b0 + i * 0.5, duracion: i % 4 === 0 ? 1 : 0.5, velocidad: v() })
      out[out.length - 8]!.pitch = nota(ac.raiz, base)
    } else if (kind === 'arpegio') {
      for (let i = 0; i < 6; i++) out.push({ pitch: nota(t[i % t.length]!, base), inicio: b0 + i * 0.75 * (i ? 1 : 0), duracion: i === 0 ? 1.5 : 0.75, velocidad: v() })
      out[out.length - 6]!.pitch = nota(ac.raiz, base)
    } else if (kind === 'pad') {
      t.slice(0, 3).forEach((pc, i) => out.push({ pitch: nota(pc, base + i * 4), inicio: b0, duracion: 3.5 + (c % 2) * 0.5, velocidad: 60 + (c % 3) * 10 + i }))
    } else {
      out.push({ pitch: nota(ac.raiz, base), inicio: b0, duracion: 1.5, velocidad: v() }, { pitch: nota(t[1] ?? ac.raiz, base), inicio: b0 + 1.5, duracion: 0.5, velocidad: v() }, { pitch: nota(t[2] ?? ac.raiz, base), inicio: b0 + 2, duracion: 2, velocidad: v() })
    }
  })
  // Notas fuera de armonía (un do natural en Re mayor) repartidas de forma determinista.
  const cada = malas > 0 ? Math.max(2, Math.round(1 / malas)) : 0
  return out.map((n, i) => ({ ...n, pitch: Math.min(100, cada && i % cada === 1 ? n.pitch - (((n.pitch % 12) + 12) % 12) + (n.pitch % 12 === 0 ? 1 : 0) : n.pitch) }))
}

export type EtapaMetrica = { llamadas: number; sistema: number; herramientas: number; historial: number; entrada: number; cacheable: number; salida: number; nHerramientas: number }
export type Informe = {
  /** Llamadas al modelo del arreglista (rondas de coherencia). */
  llamadasArreglista: number
  rechazosArmonia: number
  ajustesArmonia: number
  variante: string
  porEtapa: Record<string, EtapaMetrica>
  total: EtapaMetrica
  escrituras: string[]
  estructuras: string[]
  cobertura: Record<string, number>
  coherenciaOk: boolean
  coherenciaDetalles: string[]
  estado: string
  etapas: string
  /** Primer sistema/herramientas/mensajes observados por etapa (para inspección). */
  muestras: Record<string, { sistema: string; herramientas: string[]; historial: number }>
}

const vacia = (): EtapaMetrica => ({ llamadas: 0, sistema: 0, herramientas: 0, historial: 0, entrada: 0, cacheable: 0, salida: 0, nHerramientas: 0 })

export async function simular(v: Variante): Promise<Informe> {
  semilla = 1
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  toolRegistry.setContext(tienda.executor, tienda.permisos)
  for (const n of ['track.create', 'track.update', 'midi.clip.create', 'midi.notes.get', 'midi.notes.patch', 'midi.createNotes', 'midi.notes.set']) {
    try {
      registerAgentCatalogOnRegistry(toolRegistry, [n], tienda.registroComandos)
    } catch {
      /* herramienta no registrable en la prueba */
    }
  }
  const catalogoCompleto = catalogoAgente({ rol: 'asistente', habilidades: [] })
  const catalogo: HerramientaAgente[] = catalogoCompleto
  const participantes: ParticipanteProduccion[] = [
    { id: 'planificador', nombre: 'Planificador Musical', rol: 'planificador', descripcion: 'plan', instrucciones: 'Analiza la solicitud y desglosa el tema en partes claras.' },
    { id: 'director', nombre: 'Director de Banda', rol: 'director', descripcion: 'dirige', instrucciones: 'Coordina los músicos de la banda.' },
    ...MUSICOS.map((m) => ({ id: m.id, nombre: m.nombre, rol: 'musico' as const, descripcion: m.descripcion, instrucciones: `Toca como ${m.nombre}: dinámicas humanas, sin bloques iguales.`, habilidades: habilidadesBasePorRol().musico })),
    { id: 'arreglista', nombre: 'Arreglista', rol: 'coherencia', descripcion: 'coherencia', instrucciones: '' },
    { id: 'qa', nombre: 'QA', rol: 'qa', descripcion: 'calidad', instrucciones: '' },
    { id: 'mezcla', nombre: 'Mezcla', rol: 'mezcla', descripcion: 'mezcla', instrucciones: '' },
    { id: 'master', nombre: 'Máster', rol: 'master', descripcion: 'máster', instrucciones: '' },
  ]
  const porNombre = new Map(participantes.map((p) => [p.nombre, p]))

  // ── Métricas ─────────────────────────────────────────────────────────────
  const porEtapa: Record<string, EtapaMetrica> = {}
  const muestras: Informe['muestras'] = {}
  const ultimo = new Map<string, string>()
  const escrituras: string[] = []
  const estructuras: string[] = []
  let hojaVigente: typeof HOJA | null = null
  let rechazos = 0
  let ajustes = 0
  const opcionesArmonia = typeof v.armonia === 'object' ? v.armonia : undefined
  const nombrePista = (ref: unknown) => tienda.obtenerEstado().project.tracks.find((t) => t.id === ref)?.nombre ?? String(ref ?? '')

  const etapaDe = (rol: string, primero: string): string => {
    if (rol === 'planificador') return 'plan'
    if (rol === 'director') return /^Ensayo/.test(primero) ? 'ensayo (director)' : 'direccion'
    if (rol === 'musico') return /^Ensayo de la banda\. Escucha/.test(primero) ? 'ensayo' : /^Tu parte est/.test(primero) ? 'musicos (reintento)' : /^Te devuelven|^Corrige tu|^Ensayo de la banda: se acord/.test(primero) ? 'musicos (regrabar)' : 'musicos'
    if (rol === 'coherencia') return 'coherencia'
    if (rol === 'qa') return /SOLO la mezcla/.test(primero) ? 'qa_mezcla' : /SOLO el máster/.test(primero) ? 'qa_master' : 'qa_musicos'
    return rol === 'master' ? 'master' : 'mezcla'
  }

  const chatBase: ChatAgente = async (o) => {
    const nombre = /^Eres (.+?) en la producci/.exec(o.sistema)?.[1] ?? '?'
    const p = porNombre.get(nombre)
    const rol = p?.rol ?? 'musico'
    const primero = o.mensajes[0]?.role === 'user' ? o.mensajes[0].content : ''
    const etapa = etapaDe(rol, primero)
    const m = (porEtapa[etapa] ??= vacia())
    const hist = JSON.stringify(o.mensajes).length
    const herr = JSON.stringify(o.herramientas).length
    const entradaChars = o.sistema.length + herr + hist
    const serial = `${JSON.stringify(o.herramientas)}\u0001${o.sistema}\u0001${JSON.stringify(o.mensajes)}`
    const clave = `${nombre}|${primero.slice(0, 80)}|${o.mensajes.length > 1 ? '' : 'i'}`
    const run = `${nombre}|${primero.slice(0, 120)}`
    const previo = ultimo.get(run)
    let comun = 0
    if (previo) {
      const n = Math.min(previo.length, serial.length)
      while (comun < n && previo.charCodeAt(comun) === serial.charCodeAt(comun)) comun++
    }
    ultimo.set(run, serial)
    void clave
    m.llamadas++
    m.sistema += o.sistema.length
    m.herramientas += herr
    m.historial += hist
    m.entrada += entradaChars
    m.cacheable += comun
    m.nHerramientas += o.herramientas.length
    muestras[etapa] ??= { sistema: o.sistema, herramientas: o.herramientas.map((h) => `${h.name}:${JSON.stringify(h).length}`), historial: hist }
    const r = await guion(p, rol, o, tienda)
    m.salida += JSON.stringify(r.llamadas.map((l) => l.argumentos)).length + r.texto.length
    return r
  }

  const ejecutar = async (l: { id: string; nombre: string; argumentos: Record<string, unknown> }, h: HerramientaAgente): Promise<ResultadoHerramienta> => {
    let args = l.argumentos
    let avisos: string[] = []
    if (v.armonia && h.clase !== 'lectura') {
      const g = guardarEscrituraArmonia(tienda.obtenerEstado(), hojaVigente, { nombre: l.nombre, argumentos: args }, opcionesArmonia)
      if ('error' in g) {
        rechazos++
        return { ok: false, error: g.error }
      }
      args = g.args
      avisos = g.avisos
      if (avisos.length) ajustes++
    }
    const r = await runRegisteredTool(tienda, { id: l.id, tool: l.nombre, arguments: args }, { forceApply: true, agentMode: 'create' })
    if (r.status === 'success' && h.clase !== 'lectura') (escrituras.push(`${l.nombre}|${JSON.stringify(normalizar(args, nombrePista))}`), estructuras.push(`${l.nombre}|${JSON.stringify(normalizar(args, nombrePista, true))}`))
    if (r.status === 'success') return { ok: true, datos: avisos.length ? { ...(r.data && typeof r.data === 'object' ? (r.data as object) : {}), avisos } : r.data, resumen: 'ok' }
    if (r.error?.code === 'COMMAND_NOT_FOUND' || /no registrado/i.test(r.error?.message ?? '')) return { ok: true, datos: { ok: true, nota: 'simulado' } }
    return { ok: false, error: r.error?.message ?? 'error' }
  }

  const hojaH = HOJA
  const cfgAhorro = v.ahorro
  const catalogoEnviado = v.podaCatalogo ? catalogo : catalogo
  const resultado = await ejecutarProduccion({
    pedido: 'Canción worship completa en Re mayor con toda la banda',
    catalogo: catalogoEnviado,
    base: HERRAMIENTAS_BASE,
    participantes,
    chat: chatBase,
    ejecutar: ejecutar as never,
    contexto: () => buildReadOnlyProjectContext(tienda.obtenerEstado()).slice(0, 3000),
    partes: () => resumenPartes(tienda.obtenerEstado()),
    resolverPista: (ref) => {
      const q = ref.trim().toLowerCase()
      const t = tienda.obtenerEstado().project.tracks.find((x) => x.id === ref || x.nombre.trim().toLowerCase() === q)
      return t ? { id: t.id, nombre: t.nombre } : null
    },
    completitud: (e, hoja) => (e.pista ? seccionesFaltantes(tienda.obtenerEstado(), hoja, { pista: e.pista, encargo: e.encargo }) : null),
    coherencia: async (hoja) => analizarCoherencia(tienda.obtenerEstado(), hoja),
    ...(v.diagnostico
      ? { diagnostico: (e: { pista?: string; encargo: string }, hoja: typeof hojaH) => (e.pista ? diagnosticoEscritura(tienda.obtenerEstado(), hoja, { pista: e.pista, encargo: e.encargo }) : null) }
      : {}),
    ...(v.armonia
      ? {
          alDefinirHoja: (h: typeof HOJA) => {
            hojaVigente = h
          },
          guiaArmonia: (e: { pista?: string; encargo: string; participante: string }, hoja: typeof HOJA) => {
            const t = tienda.obtenerEstado().project.tracks.find((x) => x.id === e.pista)
            return tablaArmoniaMusico(hoja, { encargo: e.encargo, tipo: t ? tipoDePista(t.nombre) : { bateria: false, bajo: false } })
          },
        }
      : {}),
    medir: async () => ({ ok: true, detalles: ['Volumen general -14,2 LUFS.'] }),
    herramientasPorRol: {
      director: ['project.setBpm', 'project.setTimeSignature', 'project.update', 'track.create', 'track.update', 'track.addVstLayer', 'analysis.trackSound'],
      musico: ['midi.clip.create', 'midi.createNotes', 'midi.notes.set', 'midi.notes.get', 'track.create', 'track.addVstLayer', 'plugin.bypass'],
      coherencia: ['midi.notes.get', 'midi.notes.patch', 'midi.notes.set', 'midi.clip.create'],
      qa: ['analysis.trackSound', 'analysis.mix', 'midi.notes.get'],
      mezcla: ['track.update', 'mix.eq', 'mix.compress', 'bus.create', 'send.set', 'automation.writePoint', 'plugin.insert', 'plugin.setParameter', 'analysis.mix', 'analysis.trackSound'],
      master: ['master.update', 'mix.limit', 'mix.eq', 'plugin.insert', 'plugin.setParameter', 'analysis.mix', 'analysis.loudness'],
    },
    habilidadesPorRol: habilidadesBasePorRol(),
    ...(cfgAhorro !== undefined ? { ahorro: cfgAhorro } : {}),
  } as never)

  const total = vacia()
  for (const m of Object.values(porEtapa)) for (const k of Object.keys(total) as Array<keyof EtapaMetrica>) total[k] += m[k]
  const st = tienda.obtenerEstado()
  const cobertura: Record<string, number> = {}
  for (const t of st.project.tracks) cobertura[t.nombre] = (t.clips ?? []).filter((c) => (c.notas ?? []).length).length
  const coh = analizarCoherencia(st, HOJA)
  assert.ok(resultado.estado)
  return {
    variante: v.nombre,
    porEtapa,
    total,
    llamadasArreglista: porEtapa.coherencia?.llamadas ?? 0,
    rechazosArmonia: rechazos,
    ajustesArmonia: ajustes,
    escrituras: escrituras.sort(),
    estructuras: estructuras.sort(),
    cobertura,
    coherenciaOk: coh.ok,
    coherenciaDetalles: coh.detalles,
    estado: resultado.estado,
    etapas: resultado.etapas.map((e) => `${e.etapa}:${e.ok ? 'ok' : 'aviso'}`).join(' '),
    muestras,
  }
}

function normalizar(a: Record<string, unknown>, nombrePista: (r: unknown) => string, sinPitch = false): Record<string, unknown> {
  const o = { ...a }
  // Con el guardia de armonía las alturas pueden cambiar (se ajustan): se compara la estructura (inicio y duración).
  if (sinPitch && Array.isArray(o.notas)) o.notas = (o.notas as Array<{ inicio: number; duracion: number }>).map((n) => [n.inicio, n.duracion])
  for (const k of ['pistaId', 'trackId']) if (k in o) o[k] = nombrePista(o[k])
  delete o.clipId
  return o
}

// ── Guion del "modelo" ─────────────────────────────────────────────────────
let idLlamada = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `c${++idLlamada}`, nombre, argumentos })
const texto = (t: string): RespuestaModelo => ({ ok: true, texto: t, llamadas: [] })
const calls = (...l: ReturnType<typeof ll>[]): RespuestaModelo => ({ ok: true, texto: '', llamadas: l })

type Estado = ReturnType<ReturnType<typeof crearTiendaDAW>['obtenerEstado']>

async function guion(p: ParticipanteProduccion | undefined, rol: string, o: Parameters<ChatAgente>[0], tienda: ReturnType<typeof crearTiendaDAW>): Promise<RespuestaModelo> {
  const paso = o.mensajes.filter((m) => m.role === 'assistant').length
  const primero = o.mensajes[0]?.role === 'user' ? o.mensajes[0].content : ''
  const st: Estado = tienda.obtenerEstado()
  const pista = st.project.tracks.find((t) => t.nombre === p?.nombre)
  if (rol === 'planificador') return paso === 0 ? calls(ll('hoja_de_ruta', HOJA as never)) : texto('Plan: batería y bajo anclan; teclados y guitarras construyen; pads crecen en los coros. '.repeat(6))
  if (rol === 'director') {
    if (/^Ensayo/.test(primero)) return paso === 0 ? calls(ll('acordar_ajustes', { ajustes: [] })) : texto('Sin cambios.')
    if (paso === 0) return calls(...MUSICOS.map((m) => ll('track.create', { nombre: m.nombre, tipo: 'midi' })), ll('analysis.trackSound', {}))
    if (paso === 1) {
      return calls(
        ll('asignar_encargos', {
          encargos: MUSICOS.map((m) => ({
            musico: m.id,
            pista: st.project.tracks.find((t) => t.nombre === m.nombre)?.id,
            encargo: `Toca ${m.descripcion} en la pista «${m.nombre}» durante toda la canción, un clip por sección, con dinámicas y adornos humanos.`,
          })),
        }),
      )
    }
    return texto('Pistas creadas y encargos repartidos.')
  }
  if (rol === 'musico') {
    const info = MUSICOS.find((m) => m.nombre === p?.nombre)!
    if (/^Ensayo de la banda\. Escucha/.test(primero)) return paso === 0 ? calls(ll('midi.notes.get', { pistaId: pista?.id, clipId: pista?.clips?.[0]?.id })) : paso === 1 ? calls(ll('proponer_ajustes', { conforme: true, propuestas: [] })) : texto('Conforme.')
    // Secciones que faltan en su pista.
    let beat = 0
    const secs = HOJA.secciones.map((s) => {
      const r = { ...s, inicio: beat }
      beat += s.compases * 4
      return r
    })
    const tiene = (inicio: number) => (pista?.clips ?? []).some((c) => c.inicio === inicio && (c.notas ?? []).length)
    const faltan = secs.filter((s) => !tiene(s.inicio))
    const reintento = /^Tu parte est/.test(primero)
    const ultimaTool = [...o.mensajes].reverse().find((m) => m.role === 'tool')
    const rechazadoPorArmonia = !!ultimaTool && /fuera de la armonía/.test(ultimaTool.content)
    const porPaso = info.perezoso && !reintento && paso >= 1 ? 0 : 2
    if (paso === 0 && !reintento) return calls(ll('project.getSummary', {}), ll('track.list', {}))
    if (faltan.length && !(info.perezoso && !reintento && paso >= 2) && porPaso) {
      const lote = faltan.slice(0, info.perezoso && !reintento ? 1 : 2)
      return calls(
        ...lote.map((s) => ll('midi.clip.create', { pistaId: pista?.id, nombre: s.nombre, inicio: s.inicio, duracion: s.compases * 4, notas: notasSeccion(info.kind, info.base, s.acordes, rechazadoPorArmonia ? 0 : (info.malas ?? 0)) })),
      )
    }
    if (paso <= 12 && !o.mensajes.some((m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.name === 'analysis.trackSound')) && !reintento) {
      return calls(ll('midi.notes.get', { pistaId: pista?.id, clipId: pista?.clips?.[0]?.id, limit: 40 }), ll('analysis.trackSound', {}))
    }
    return texto(`Grabé ${pista?.clips?.length ?? 0} secciones en ${info.nombre} y comprobé que suena.`)
  }
  if (rol === 'coherencia') return paso === 0 ? calls(ll('midi.notes.get', { pistaId: st.project.tracks[0]?.id, clipId: st.project.tracks[0]?.clips?.[0]?.id })) : texto('Corregido lo señalado.')
  if (rol === 'qa') {
    if (paso === 0) return calls(ll('analysis.trackSound', {}), ...st.project.tracks.slice(0, 3).map((t) => ll('midi.notes.get', { pistaId: t.id, clipId: t.clips?.[0]?.id, limit: 40 })))
    return calls(ll('veredicto_calidad', { aprobado: true, resumen: 'Todo en orden.', problemas: [] }))
  }
  if (rol === 'mezcla') {
    if (paso === 0) return calls(ll('analysis.trackSound', {}))
    if (paso === 1) return calls(...st.project.tracks.map((t, i) => ll('track.update', { trackId: t.id, datos: { volumen: 0.6 + (i % 4) * 0.1, paneo: ((i % 5) - 2) / 4 } })), ll('analysis.mix', {}))
    return texto('Mezcla equilibrada.')
  }
  // máster
  if (paso === 0) return calls(ll('master.update', { datos: { volumen: 0.9 } }), ll('mix.limit', { trackId: 'master', ceiling: -1 }), ll('analysis.loudness', {}))
  return texto('Máster a -14 LUFS.')
}
