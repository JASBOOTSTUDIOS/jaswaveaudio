import type { Encargo, EtapaProduccion, EventoProduccion, HojaDeRuta, InformeEtapa, NotaUsuario, RolProduccion } from './produccion'

/**
 * Diario de producción (plan Q): registro append-only (JSON-lines) de lo que hace la banda, de modo que una
 * producción interrumpida (corte de internet, cierre forzado, memoria, apagado) se pueda reanudar donde se quedó.
 *
 * Este módulo es PURO (sin disco): define el formato, lo parsea tolerando una última línea truncada y reconstruye el
 * estado a partir de los registros. Quien escribe a disco es el proceso principal de Electron
 * (`jas-wave/electron/produccion-diario.ts`).
 */

export const VERSION_DIARIO = 1
/** Sin señal de vida durante este tiempo, una producción «en curso» se considera interrumpida. */
export const UMBRAL_INTERRUMPIDA_MS = 90_000
/** Cada cuánto se escribe la señal de vida. */
export const INTERVALO_VIDA_MS = 15_000

export type EstadoDiario = 'en_curso' | 'pausada_red' | 'detenida' | 'completada' | 'interrumpida'

export type ParticipanteDiario = { id: string; nombre: string; rol: RolProduccion }

type Base = { v: typeof VERSION_DIARIO; t: number }
export type RegistroDiario = Base &
  (
    | {
        k: 'inicio'
        runId: string
        proyectoId: string
        pedido: string
        /** Configuración relevante (presupuesto, límite, ensayo…); solo datos simples. */
        config?: Record<string, unknown>
        participantes: ParticipanteDiario[]
        /** Producción de la que esta es continuación. */
        reanudaDe?: string
      }
    | { k: 'evento'; e: EventoProduccion; /** Huella de la revisión del proyecto en el momento (mediciones). */ huella?: string }
    | { k: 'estado'; estado: EstadoDiario; motivo?: string }
    | { k: 'vida'; etapa?: EtapaProduccion }
    | { k: 'control'; que: string; huella: string; archivo?: string }
  )
/** Un registro sin sello (lo añade quien escribe). */
export type EntradaDiario = RegistroDiario extends infer R ? (R extends unknown ? Omit<R, 'v' | 't'> : never) : never

/** Eventos que se anotan: todos menos el detalle de cada paso de los agentes (demasiado voluminoso). */
export function debeRegistrarse(e: EventoProduccion): boolean {
  return e.tipo !== 'agente'
}

export function serializarRegistro(r: EntradaDiario, ahora = Date.now()): string {
  return JSON.stringify({ v: VERSION_DIARIO, t: ahora, ...r }) + '\n'
}

export type DiarioLeido = { registros: RegistroDiario[]; /** La última línea estaba cortada y se descartó. */ truncada: boolean; /** Líneas dañadas en medio. */ dañadas: number }

/** Lee el diario tolerando una última línea truncada (cierre a mitad de escritura) y líneas sueltas dañadas. */
export function parsearDiario(texto: string): DiarioLeido {
  const lineas = texto.split('\n')
  const registros: RegistroDiario[] = []
  let truncada = false
  let dañadas = 0
  lineas.forEach((l, i) => {
    const t = l.trim()
    if (!t) return
    try {
      const o = JSON.parse(t) as RegistroDiario
      if (o && typeof o === 'object' && o.v === VERSION_DIARIO && typeof o.k === 'string' && typeof o.t === 'number') registros.push(o)
      else dañadas++
    } catch {
      // La última línea no vacía sin salto de línea final es el caso típico de un corte a mitad de escritura.
      if (i === lineas.length - 1 || lineas.slice(i + 1).every((x) => !x.trim())) truncada = true
      else dañadas++
    }
  })
  return { registros, truncada, dañadas }
}

/** Lo necesario para continuar una producción interrumpida (`ejecutarProduccion({ reanudar })`). */
export type EstadoProduccionGuardado = {
  runId?: string
  proyectoId?: string
  pedido: string
  plan: string
  hoja: HojaDeRuta | null
  encargos: Encargo[]
  /** Informes de las etapas ya terminadas, en orden. */
  etapas: InformeEtapa[]
  /** Etapas terminadas (con su informe) o repartos hechos. */
  etapasCompletas: EtapaProduccion[]
  /** Músicos cuya parte se dio por terminada. */
  musicosTerminados: string[]
  notas: NotaUsuario[]
  /** Tiempo de trabajo acumulado antes de la interrupción. */
  tiempoPrevioMs: number
}

export type ResumenDiario = {
  runId: string
  proyectoId: string
  pedido: string
  inicio: number
  ultimaActividad: number
  /** Estado escrito en el diario (sin considerar la señal de vida). */
  estado: EstadoDiario
  etapaActual: EtapaProduccion | null
  guardado: EstadoProduccionGuardado
  ultimoControl?: { que: string; huella: string; archivo?: string; t: number }
  /** El diario tenía una última línea cortada. */
  truncada: boolean
}

/** Reconstruye el estado de una producción a partir de sus registros. */
export function reconstruirEstado(leido: DiarioLeido | RegistroDiario[]): ResumenDiario | null {
  const registros = Array.isArray(leido) ? leido : leido.registros
  const truncada = Array.isArray(leido) ? false : leido.truncada
  const inicio = registros.find((r) => r.k === 'inicio')
  if (!inicio || inicio.k !== 'inicio') return null
  const g: EstadoProduccionGuardado = {
    runId: inicio.runId,
    proyectoId: inicio.proyectoId,
    pedido: inicio.pedido,
    plan: '',
    hoja: null,
    encargos: [],
    etapas: [],
    etapasCompletas: [],
    musicosTerminados: [],
    notas: [],
    tiempoPrevioMs: 0,
  }
  let estado: EstadoDiario = 'en_curso'
  let etapaActual: EtapaProduccion | null = null
  let ultimoControl: ResumenDiario['ultimoControl']
  const completas = new Set<EtapaProduccion>()
  for (const r of registros) {
    if (r.k === 'estado') estado = r.estado
    else if (r.k === 'vida') {
      etapaActual = r.etapa ?? etapaActual
      // Señal de vida posterior a un «interrumpida» (suspensión del equipo que no llegó a matar la app): sigue viva.
      if (estado === 'interrumpida') estado = 'en_curso'
    }
    else if (r.k === 'control') ultimoControl = { que: r.que, huella: r.huella, ...(r.archivo ? { archivo: r.archivo } : {}), t: r.t }
    else if (r.k === 'evento') {
      const e = r.e
      if (e.tipo === 'etapa' && e.fase === 'inicio') etapaActual = e.etapa
      else if (e.tipo === 'plan_definido') {
        g.plan = e.plan
        g.hoja = e.hoja
      } else if (e.tipo === 'encargos') {
        g.encargos = e.encargos
        completas.add('direccion')
      } else if (e.tipo === 'informe') {
        const i = g.etapas.findIndex((x) => x.etapa === e.informe.etapa)
        // La coherencia se vuelve a medir y su último informe sustituye al anterior.
        if (i >= 0 && e.informe.etapa === 'coherencia') g.etapas[i] = e.informe
        else if (i < 0) g.etapas.push(e.informe)
        completas.add(e.informe.etapa)
      } else if (e.tipo === 'musico') {
        if (e.ok && !g.musicosTerminados.includes(e.participante)) g.musicosTerminados.push(e.participante)
      } else if (e.tipo === 'nota') g.notas.push({ texto: e.texto })
      else if (e.tipo === 'tiempo') g.tiempoPrevioMs = Math.max(g.tiempoPrevioMs, e.totalMs)
    }
  }
  g.etapasCompletas = [...completas]
  const ultimaActividad = registros.reduce((m, r) => Math.max(m, r.t), 0)
  return { runId: inicio.runId, proyectoId: inicio.proyectoId, pedido: inicio.pedido, inicio: inicio.t, ultimaActividad, estado, etapaActual, guardado: g, ultimoControl, truncada }
}

/** Estado real: «en curso» (o «pausada») sin señal de vida durante más de `umbralMs` = interrumpida. */
export function estadoEfectivo(r: Pick<ResumenDiario, 'estado' | 'ultimaActividad'>, ahora: number, umbralMs = UMBRAL_INTERRUMPIDA_MS): EstadoDiario {
  // Una pausa por red también escribe señal de vida: si se calla, la app se cerró.
  if ((r.estado === 'en_curso' || r.estado === 'pausada_red') && ahora - r.ultimaActividad > umbralMs) return 'interrumpida'
  return r.estado
}

/** ¿Se puede reanudar? Solo lo interrumpido (o detenido a mano) que ya tiene hoja de ruta. */
export function esReanudable(r: ResumenDiario, ahora: number): boolean {
  const e = estadoEfectivo(r, ahora)
  return (e === 'interrumpida' || e === 'detenida') && !!r.guardado.hoja
}

const NOMBRE_ETAPA_CORTO: Record<EtapaProduccion, string> = {
  plan: 'el plan',
  direccion: 'el reparto',
  musicos: 'la grabación',
  ensayo: 'el ensayo',
  coherencia: 'la revisión de coherencia',
  qa_musicos: 'la revisión de las partes',
  mezcla: 'la mezcla',
  qa_mezcla: 'la revisión de la mezcla',
  master: 'el máster',
  qa_master: 'la revisión del máster',
  entrega: 'la entrega',
}

function hace(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  return `${Math.round(m / 60)} h`
}

/** Texto para la tarjeta del panel: dónde se quedó y qué estaba hecho (lenguaje llano). */
export function textoInterrupcion(r: ResumenDiario, ahora: number): string {
  const g = r.guardado
  const hecho: string[] = []
  if (g.hoja) hecho.push('plan listo')
  if (g.encargos.length) hecho.push(`${g.encargos.length} ${g.encargos.length === 1 ? 'encargo repartido' : 'encargos repartidos'}`)
  if (g.musicosTerminados.length) hecho.push(`${g.musicosTerminados.length} de ${g.encargos.length || g.musicosTerminados.length} músicos terminaron su parte`)
  for (const e of g.etapas) if (['ensayo', 'coherencia', 'qa_musicos', 'mezcla', 'master'].includes(e.etapa)) hecho.push(`${NOMBRE_ETAPA_CORTO[e.etapa]} hecha`)
  const donde = r.etapaActual ? NOMBRE_ETAPA_CORTO[r.etapaActual] : 'el principio'
  return `La producción se interrumpió en ${donde} hace ${hace(ahora - r.ultimaActividad)}${hecho.length ? ` · ${hecho.join(', ')}` : ''}.`
}

/** Producciones a conservar por proyecto (el resto se limpia). */
export const PRODUCCIONES_A_CONSERVAR = 10
